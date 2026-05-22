from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.domain import AdCampaign, AdCampaignLaunch
from app.services.ad_campaign_service import ad_provider_status, launch_meta_campaign

router = APIRouter()

VALID_AD_OBJECTIVES = {"awareness", "traffic", "engagement", "leads", "sales"}
VALID_AD_PLATFORMS = {"facebook", "instagram"}
VALID_AD_STATUSES = {"draft", "planned", "ready", "launched", "paused", "completed", "failed"}


class AdCampaignCreate(BaseModel):
    name: str = Field(..., min_length=1)
    objective: str = "traffic"
    platforms: list[str] = Field(default_factory=lambda: ["facebook", "instagram"])
    audience: Optional[str] = None
    location: Optional[str] = None
    creative_message: str = Field(..., min_length=1)
    link_url: Optional[str] = None
    image_url: Optional[str] = None
    daily_budget: float = Field(0, ge=0)
    lifetime_budget: float = Field(0, ge=0)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str = "draft"


class AdMetricsUpdate(BaseModel):
    impressions: int = Field(0, ge=0)
    clicks: int = Field(0, ge=0)
    conversions: int = Field(0, ge=0)
    spend: float = Field(0, ge=0)
    revenue: float = Field(0, ge=0)


class AdLaunchRequest(BaseModel):
    dry_run: bool = False
    force_relaunch: bool = False
    mark_launched: bool = True


def _parse_optional_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid date: {value}") from exc


def _normalize_objective(value: str) -> str:
    objective = value.strip().lower()
    if objective not in VALID_AD_OBJECTIVES:
        raise HTTPException(status_code=422, detail="Unsupported ad objective.")
    return objective


def _normalize_platforms(platforms: list[str]) -> list[str]:
    cleaned = []
    for platform in platforms:
        normalized = platform.strip().lower()
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    invalid = [platform for platform in cleaned if platform not in VALID_AD_PLATFORMS]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unsupported platform: {', '.join(invalid)}")
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one ad platform is required.")
    return cleaned


def _normalize_status(value: str) -> str:
    status = value.strip().lower()
    if status not in VALID_AD_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported ad campaign status.")
    return status


def _ad_campaign_dict(campaign: AdCampaign) -> dict:
    spend = float(campaign.spend or 0)
    revenue = float(campaign.revenue or 0)
    clicks = int(campaign.clicks or 0)
    impressions = int(campaign.impressions or 0)
    conversions = int(campaign.conversions or 0)
    return {
        "id": campaign.id,
        "name": campaign.name,
        "objective": campaign.objective,
        "platforms": campaign.platforms or [],
        "audience": campaign.audience,
        "location": campaign.location,
        "creative_message": campaign.creative_message,
        "link_url": campaign.link_url,
        "image_url": campaign.image_url,
        "daily_budget": round(float(campaign.daily_budget or 0), 2),
        "lifetime_budget": round(float(campaign.lifetime_budget or 0), 2),
        "start_date": campaign.start_date.isoformat() if campaign.start_date else None,
        "end_date": campaign.end_date.isoformat() if campaign.end_date else None,
        "status": campaign.status,
        "external_campaign_id": campaign.external_campaign_id,
        "impressions": impressions,
        "clicks": clicks,
        "conversions": conversions,
        "spend": round(spend, 2),
        "revenue": round(revenue, 2),
        "ctr": round((clicks / impressions) * 100, 2) if impressions else 0,
        "cpc": round(spend / clicks, 2) if clicks else 0,
        "cpa": round(spend / conversions, 2) if conversions else 0,
        "roas": round(revenue / spend, 2) if spend else 0,
        "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
        "updated_at": campaign.updated_at.isoformat() if campaign.updated_at else None,
    }


def _launch_dict(launch: AdCampaignLaunch) -> dict:
    return {
        "id": launch.id,
        "campaign_id": launch.campaign_id,
        "provider": launch.provider,
        "status": launch.status,
        "external_campaign_id": launch.external_campaign_id,
        "error": launch.error,
        "dry_run": launch.dry_run,
        "attempted_at": launch.attempted_at.isoformat() if launch.attempted_at else None,
    }


def _launch_counts(launches: list[AdCampaignLaunch]) -> dict:
    return {
        "attempted_count": len(launches),
        "launched_count": sum(1 for launch in launches if launch.status == "launched"),
        "dry_run_count": sum(1 for launch in launches if launch.status == "dry_run"),
        "failed_count": sum(1 for launch in launches if launch.status == "failed"),
        "skipped_count": sum(1 for launch in launches if launch.status == "skipped"),
    }


def _campaign_launch_blockers(campaign: AdCampaign, provider_status: dict) -> list[str]:
    blockers: list[str] = []
    if not provider_status.get("configured"):
        blockers.extend(provider_status.get("missing_settings") or ["Meta Ads provider setup"])
    if not (float(campaign.daily_budget or 0) > 0 or float(campaign.lifetime_budget or 0) > 0):
        blockers.append("Daily or lifetime budget")
    if not (campaign.platforms or []):
        blockers.append("At least one platform")
    if not (campaign.creative_message or "").strip():
        blockers.append("Creative message")
    if campaign.status not in {"planned", "ready"}:
        blockers.append("Campaign must be planned or ready")
    return sorted(set(blockers))


@router.get("/provider-status")
def ads_provider_status():
    return ad_provider_status()


@router.get("/summary")
def ads_summary(db: Session = Depends(get_db)):
    total_campaigns = db.query(AdCampaign).count()
    active_campaigns = (
        db.query(AdCampaign)
        .filter(AdCampaign.status.in_(["ready", "launched", "planned"]))
        .count()
    )
    spend, revenue, clicks, conversions = (
        db.query(
            func.sum(AdCampaign.spend),
            func.sum(AdCampaign.revenue),
            func.sum(AdCampaign.clicks),
            func.sum(AdCampaign.conversions),
        )
        .one()
    )
    spend_value = float(spend or 0)
    revenue_value = float(revenue or 0)
    clicks_value = int(clicks or 0)
    conversions_value = int(conversions or 0)
    return {
        "total_campaigns": total_campaigns,
        "active_campaigns": active_campaigns,
        "total_spend": round(spend_value, 2),
        "total_revenue": round(revenue_value, 2),
        "total_clicks": clicks_value,
        "total_conversions": conversions_value,
        "average_cpc": round(spend_value / clicks_value, 2) if clicks_value else 0,
        "average_cpa": round(spend_value / conversions_value, 2) if conversions_value else 0,
        "roas": round(revenue_value / spend_value, 2) if spend_value else 0,
    }


@router.get("/launch-readiness")
def ads_launch_readiness(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    provider_status = ad_provider_status()
    campaigns = (
        db.query(AdCampaign)
        .filter(AdCampaign.status.in_(["draft", "planned", "ready", "failed"]))
        .order_by(AdCampaign.updated_at.desc(), AdCampaign.id.desc())
        .limit(limit)
        .all()
    )
    rows = []
    ready_count = 0
    blocked_count = 0
    planned_budget = 0.0

    for campaign in campaigns:
        budget = float(campaign.daily_budget or campaign.lifetime_budget or 0)
        planned_budget += budget
        blockers = _campaign_launch_blockers(campaign, provider_status)
        eligible = not blockers
        ready_count += 1 if eligible else 0
        blocked_count += 0 if eligible else 1
        rows.append(
            {
                "id": campaign.id,
                "name": campaign.name,
                "objective": campaign.objective,
                "status": campaign.status,
                "platforms": campaign.platforms or [],
                "budget": round(budget, 2),
                "eligible": eligible,
                "blockers": blockers,
            }
        )

    return {
        "provider_status": provider_status,
        "ready_count": ready_count,
        "blocked_count": blocked_count,
        "planned_budget": round(planned_budget, 2),
        "campaigns": rows,
    }


@router.post("/campaigns")
def create_ad_campaign(payload: AdCampaignCreate, db: Session = Depends(get_db)):
    start_date = _parse_optional_date(payload.start_date)
    end_date = _parse_optional_date(payload.end_date)
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date.")

    campaign = AdCampaign(
        name=payload.name.strip(),
        objective=_normalize_objective(payload.objective),
        platforms=_normalize_platforms(payload.platforms),
        audience=(payload.audience or "").strip() or None,
        location=(payload.location or "").strip() or None,
        creative_message=payload.creative_message.strip(),
        link_url=(payload.link_url or "").strip() or None,
        image_url=(payload.image_url or "").strip() or None,
        daily_budget=payload.daily_budget,
        lifetime_budget=payload.lifetime_budget,
        start_date=start_date,
        end_date=end_date,
        status=_normalize_status(payload.status),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return {"status": "ad campaign created", "campaign": _ad_campaign_dict(campaign)}


@router.get("/campaigns")
def list_ad_campaigns(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    campaigns = (
        db.query(AdCampaign)
        .order_by(AdCampaign.created_at.desc(), AdCampaign.id.desc())
        .limit(limit)
        .all()
    )
    return [_ad_campaign_dict(campaign) for campaign in campaigns]


@router.patch("/campaigns/{campaign_id}/metrics")
def update_ad_campaign_metrics(
    campaign_id: int,
    payload: AdMetricsUpdate,
    db: Session = Depends(get_db),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    campaign.impressions = payload.impressions
    campaign.clicks = payload.clicks
    campaign.conversions = payload.conversions
    campaign.spend = payload.spend
    campaign.revenue = payload.revenue
    campaign.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(campaign)
    return _ad_campaign_dict(campaign)


@router.get("/campaigns/{campaign_id}/launches")
def ad_campaign_launches(
    campaign_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    launches = (
        db.query(AdCampaignLaunch)
        .filter(AdCampaignLaunch.campaign_id == campaign.id)
        .order_by(AdCampaignLaunch.attempted_at.desc(), AdCampaignLaunch.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "campaign": _ad_campaign_dict(campaign),
        **_launch_counts(launches),
        "launches": [_launch_dict(launch) for launch in launches],
    }


@router.post("/campaigns/{campaign_id}/launch")
def launch_ad_campaign(
    campaign_id: int,
    payload: AdLaunchRequest,
    db: Session = Depends(get_db),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    if campaign.status == "launched" and not payload.force_relaunch and not payload.dry_run:
        raise HTTPException(status_code=409, detail="Campaign is already marked as launched.")

    provider_status = ad_provider_status()
    launch_kwargs = {
        "campaign_id": campaign.id,
        "attempted_at": datetime.utcnow(),
    }
    if payload.dry_run:
        launch = AdCampaignLaunch(
            **launch_kwargs,
            provider="dry_run",
            status="dry_run",
            dry_run=True,
            response_payload={
                "provider_status": provider_status,
                "launch_mode": "paused_campaign",
                "objective": campaign.objective,
            },
        )
    else:
        result = launch_meta_campaign(
            name=campaign.name,
            objective=campaign.objective,
            daily_budget=float(campaign.daily_budget or 0),
            lifetime_budget=float(campaign.lifetime_budget or 0),
        )
        launch = AdCampaignLaunch(
            **launch_kwargs,
            provider=result.provider,
            status=result.status,
            external_campaign_id=result.external_campaign_id,
            error=result.error,
            dry_run=False,
            response_payload=result.response_payload,
        )
        if result.status == "launched":
            campaign.external_campaign_id = result.external_campaign_id
            if payload.mark_launched:
                campaign.status = "launched"
        elif result.status == "failed":
            campaign.status = "failed"

    db.add(launch)
    db.commit()
    db.refresh(campaign)
    db.refresh(launch)
    return {
        "campaign": _ad_campaign_dict(campaign),
        "provider_status": provider_status,
        "dry_run": payload.dry_run,
        **_launch_counts([launch]),
        "launches": [_launch_dict(launch)],
    }
