from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_roles
from app.core.config import settings
from app.models.domain import AdCampaign, AdCampaignAction, AdCampaignLaunch
from app.services.ad_campaign_service import ad_provider_status, launch_meta_campaign

router = APIRouter()

VALID_AD_OBJECTIVES = {"awareness", "traffic", "engagement", "leads", "sales"}
VALID_AD_PLATFORMS = {"facebook", "instagram"}
VALID_AD_STATUSES = {"draft", "planned", "ready", "launched", "paused", "completed", "failed"}
VALID_AD_SYNC_STATUSES = {"launched", "paused", "completed", "failed"}


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


class AdCampaignActionRequest(BaseModel):
    note: Optional[str] = None


class AdCampaignDuplicateRequest(BaseModel):
    name: Optional[str] = None
    status: str = "ready"
    reset_metrics: bool = True
    note: Optional[str] = None


class AdProviderSyncRequest(BaseModel):
    external_campaign_id: Optional[str] = None
    status: str = "paused"
    dry_run: bool = True
    note: Optional[str] = None


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


def _normalize_sync_status(value: str) -> str:
    status = _normalize_status(value)
    if status not in VALID_AD_SYNC_STATUSES:
        raise HTTPException(
            status_code=422,
            detail="External sync status must be launched, paused, completed, or failed.",
        )
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
        "issue_reason": _launch_issue_reason(launch),
        "retryable": launch.status in {"failed", "skipped"},
        "recovery_action": _launch_recovery_action(launch),
        "attempted_at": launch.attempted_at.isoformat() if launch.attempted_at else None,
    }


def _action_dict(action: AdCampaignAction) -> dict:
    return {
        "id": action.id,
        "campaign_id": action.campaign_id,
        "action": action.action,
        "previous_status": action.previous_status,
        "next_status": action.next_status,
        "note": action.note,
        "actor": action.actor,
        "response_payload": action.response_payload or {},
        "created_at": action.created_at.isoformat() if action.created_at else None,
    }


def _launch_counts(launches: list[AdCampaignLaunch]) -> dict:
    return {
        "attempted_count": len(launches),
        "launched_count": sum(1 for launch in launches if launch.status == "launched"),
        "dry_run_count": sum(1 for launch in launches if launch.status == "dry_run"),
        "failed_count": sum(1 for launch in launches if launch.status == "failed"),
        "skipped_count": sum(1 for launch in launches if launch.status == "skipped"),
        "retryable_count": sum(1 for launch in launches if launch.status in {"failed", "skipped"}),
    }


def _action_counts(actions: list[AdCampaignAction]) -> dict:
    return {
        "action_count": len(actions),
        "pause_count": sum(1 for action in actions if action.action == "pause"),
        "resume_count": sum(1 for action in actions if action.action == "resume"),
        "complete_count": sum(1 for action in actions if action.action == "complete"),
        "duplicate_count": sum(1 for action in actions if action.action == "duplicate"),
        "external_sync_count": sum(1 for action in actions if action.action == "external_sync"),
    }


def _record_ad_action(
    db: Session,
    *,
    campaign: AdCampaign,
    action: str,
    previous_status: Optional[str],
    next_status: Optional[str],
    note: Optional[str],
    actor: Optional[str],
    response_payload: Optional[dict] = None,
) -> AdCampaignAction:
    row = AdCampaignAction(
        campaign_id=campaign.id,
        action=action,
        previous_status=previous_status,
        next_status=next_status,
        note=(note or "").strip() or None,
        actor=actor,
        response_payload=response_payload or {},
    )
    db.add(row)
    return row


def _actor_from_session(session: dict) -> str:
    return str(session.get("display_name") or session.get("subject") or session.get("role") or "portal")


def _ad_credential_checks(provider_status: dict) -> list[dict]:
    missing = set(provider_status.get("missing_settings") or [])
    return [
        {
            "key": "ADS_LAUNCH_ENABLED=true",
            "label": "Ad launch safety switch",
            "configured": "ADS_LAUNCH_ENABLED=true" not in missing,
        },
        {
            "key": "META_AD_ACCOUNT_ID",
            "label": "Meta ad account ID",
            "configured": "META_AD_ACCOUNT_ID" not in missing,
        },
        {
            "key": "META_AD_ACCESS_TOKEN",
            "label": "Meta marketing API token",
            "configured": "META_AD_ACCESS_TOKEN" not in missing,
        },
    ]


def _ad_provider_readiness() -> dict:
    status = ad_provider_status()
    missing = status.get("missing_settings") or []
    return {
        **status,
        "readiness_label": "Provider ready" if status.get("configured") else "Setup needed",
        "credential_checks": _ad_credential_checks(status),
        "graph_version": settings.META_GRAPH_VERSION,
        "external_sync": {
            "external_id_required_for_actions": True,
            "paused_launch_mode": status.get("launch_mode") == "paused_campaign",
            "dry_run_available": True,
            "local_status_sync_available": True,
        },
        "guardrails": [
            "Live launch creates a paused Meta campaign shell for review before ad sets and creatives are activated.",
            "Live launch is blocked until provider credentials and campaign preflight checks pass.",
            "External campaign ID must be attached before pause or resume is treated as Meta-connected.",
        ],
        "next_action": (
            "Run dry-run proof, then launch or sync the external Meta campaign ID."
            if status.get("configured")
            else f"Configure {', '.join(missing) if missing else 'Meta Ads provider settings'}, then rerun dry-run proof."
        ),
    }


def _launch_issue_reason(launch: AdCampaignLaunch) -> str:
    error = (launch.error or "").lower()
    if launch.status == "launched":
        return "none" if launch.external_campaign_id else "external_id"
    if launch.status == "dry_run":
        return "dry_run"
    if "provider not configured" in error or "meta_ad" in error or "ads_launch_enabled" in error:
        return "provider_setup"
    if launch.status == "failed":
        return "provider"
    if launch.status == "skipped":
        return "needs_review"
    return "pending"


def _launch_recovery_action(launch: AdCampaignLaunch) -> str:
    reason = _launch_issue_reason(launch)
    if launch.status == "launched":
        return "Provider campaign created; keep external ID attached before pausing or resuming."
    if launch.status == "dry_run":
        return "Dry run passed; launch live after provider setup and business review."
    if reason == "provider_setup":
        return "Configure Meta ad credentials and enable ADS_LAUNCH_ENABLED before retrying."
    if reason == "external_id":
        return "Attach the Meta campaign ID through external sync before treating it as provider-connected."
    if reason == "provider":
        return "Review the Meta API error, then retry launch after the provider issue is cleared."
    if reason == "needs_review":
        return "Review the skipped attempt and rerun dry-run once launch blockers are cleared."
    return "Monitor the pending provider attempt."


def _launch_audit_counts(launches: list[AdCampaignLaunch]) -> dict:
    return {
        "provider_setup_issue_count": sum(
            1 for launch in launches if _launch_issue_reason(launch) == "provider_setup"
        ),
        "provider_issue_count": sum(1 for launch in launches if _launch_issue_reason(launch) == "provider"),
        "external_id_issue_count": sum(1 for launch in launches if _launch_issue_reason(launch) == "external_id"),
        "needs_review_count": sum(1 for launch in launches if _launch_issue_reason(launch) == "needs_review"),
    }


def _campaign_sync_guardrails(campaign: AdCampaign) -> list[str]:
    guardrails: list[str] = []
    if campaign.status in {"launched", "paused", "completed"} and not campaign.external_campaign_id:
        guardrails.append("Attach external Meta campaign ID before provider-state actions.")
    if campaign.status == "failed":
        guardrails.append("Review the provider failure before relaunch or external sync.")
    if campaign.status in {"draft", "planned", "ready"}:
        guardrails.append("Run launch dry-run or external sync before marking provider-connected.")
    if campaign.external_campaign_id:
        guardrails.append("External Meta campaign ID is attached for audit and pause/resume handoff.")
    return guardrails


def _campaign_sync_row(campaign: AdCampaign) -> dict:
    has_external_id = bool((campaign.external_campaign_id or "").strip())
    provider_state = "synced" if has_external_id else "local_only"
    if campaign.status == "failed":
        provider_state = "needs_review"
    return {
        "id": campaign.id,
        "name": campaign.name,
        "status": campaign.status,
        "external_campaign_id": campaign.external_campaign_id,
        "provider_state": provider_state,
        "sync_ready": has_external_id or campaign.status in {"draft", "planned", "ready", "failed"},
        "guardrails": _campaign_sync_guardrails(campaign),
    }


def _inclusive_days(start: date, end: date) -> int:
    return max((end - start).days + 1, 1)


def _campaign_budget_health(campaign: AdCampaign, today: Optional[date] = None) -> dict:
    current_date = today or date.today()
    start_date = campaign.start_date or current_date
    end_date = campaign.end_date or start_date
    if end_date < start_date:
        end_date = start_date

    total_days = _inclusive_days(start_date, end_date)
    if current_date < start_date:
        elapsed_days = 0
        days_left = total_days
    elif current_date > end_date:
        elapsed_days = total_days
        days_left = 0
    else:
        elapsed_days = _inclusive_days(start_date, current_date)
        days_left = _inclusive_days(current_date, end_date)

    lifetime_budget = float(campaign.lifetime_budget or 0)
    daily_budget = float(campaign.daily_budget or 0)
    total_budget = lifetime_budget if lifetime_budget > 0 else daily_budget * total_days
    budget_type = "lifetime" if lifetime_budget > 0 else "daily"
    spend = float(campaign.spend or 0)
    revenue = float(campaign.revenue or 0)
    clicks = int(campaign.clicks or 0)
    conversions = int(campaign.conversions or 0)
    elapsed_ratio = elapsed_days / total_days if total_days else 0
    expected_spend = total_budget * elapsed_ratio if total_budget > 0 else 0
    remaining_budget = max(total_budget - spend, 0)
    spend_percent = (spend / total_budget * 100) if total_budget > 0 else 0
    elapsed_percent = elapsed_ratio * 100
    pacing_gap = spend - expected_spend
    pacing_ratio = spend / expected_spend if expected_spend > 0 else 0
    remaining_daily_budget = remaining_budget / days_left if days_left else 0
    roas = revenue / spend if spend else 0
    cpc = spend / clicks if clicks else 0
    cpa = spend / conversions if conversions else 0

    if total_budget <= 0:
        pacing_status = "no_budget"
    elif current_date < start_date:
        pacing_status = "not_started"
    elif current_date > end_date or campaign.status == "completed":
        pacing_status = "completed"
    elif expected_spend and spend > expected_spend * 1.2:
        pacing_status = "over_pacing"
    elif expected_spend and spend < expected_spend * 0.8:
        pacing_status = "under_pacing"
    else:
        pacing_status = "on_track"

    if spend == 0:
        performance_status = "learning"
    elif roas >= 3:
        performance_status = "strong"
    elif roas >= 1.5:
        performance_status = "profitable"
    elif conversions == 0:
        performance_status = "needs_conversion"
    else:
        performance_status = "watch"

    recommendations: list[str] = []
    if pacing_status == "no_budget":
        recommendations.append("Add a daily or lifetime budget before launch.")
    elif pacing_status == "not_started":
        recommendations.append("Campaign is scheduled but has not started yet.")
    elif pacing_status == "over_pacing":
        recommendations.append("Spend is ahead of plan; consider lowering budget or narrowing audience.")
    elif pacing_status == "under_pacing":
        recommendations.append("Spend is behind plan; consider widening audience or increasing bid/budget.")
    elif pacing_status == "completed":
        recommendations.append("Campaign window is complete; review ROAS before duplicating.")
    else:
        recommendations.append("Spend is tracking close to the planned pace.")

    if performance_status == "strong":
        recommendations.append("ROAS is strong; consider extending the campaign or cloning it.")
    elif performance_status == "profitable":
        recommendations.append("Campaign is profitable; keep monitoring CPA before scaling.")
    elif performance_status == "needs_conversion":
        recommendations.append("Spend exists without conversions; refresh the offer, landing page, or audience.")
    elif performance_status == "watch":
        recommendations.append("Revenue is below spend; review creative and promotion economics.")

    return {
        "today": current_date.isoformat(),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "budget_type": budget_type,
        "total_budget": round(total_budget, 2),
        "daily_budget": round(daily_budget, 2),
        "lifetime_budget": round(lifetime_budget, 2),
        "spend": round(spend, 2),
        "revenue": round(revenue, 2),
        "remaining_budget": round(remaining_budget, 2),
        "remaining_daily_budget": round(remaining_daily_budget, 2),
        "expected_spend_to_date": round(expected_spend, 2),
        "pacing_gap": round(pacing_gap, 2),
        "pacing_ratio": round(pacing_ratio, 2),
        "elapsed_days": elapsed_days,
        "total_days": total_days,
        "days_left": days_left,
        "elapsed_percent": round(elapsed_percent, 2),
        "spend_percent": round(spend_percent, 2),
        "pacing_status": pacing_status,
        "performance_status": performance_status,
        "roas": round(roas, 2),
        "cpc": round(cpc, 2),
        "cpa": round(cpa, 2),
        "recommendations": recommendations,
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


def _ads_summary_snapshot(db: Session) -> dict:
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


def _budget_attention_required(budget_health: dict) -> bool:
    return (
        budget_health["pacing_status"] in {"no_budget", "over_pacing", "under_pacing"}
        or budget_health["performance_status"] in {"needs_conversion", "watch"}
    )


def _campaign_management_next_action(
    campaign: AdCampaign,
    *,
    launch_blockers: list[str],
    sync_row: dict,
    budget_health: dict,
) -> str:
    if launch_blockers:
        return f"Clear launch blockers: {', '.join(launch_blockers)}."
    if campaign.status in {"launched", "paused", "completed"} and not campaign.external_campaign_id:
        return "Attach the external Meta campaign ID before provider-state actions."
    if _budget_attention_required(budget_health):
        return budget_health["recommendations"][0]
    if campaign.status in {"draft", "planned", "ready"}:
        return "Run dry-run proof, then launch a paused Meta campaign shell for review."
    if campaign.status == "paused":
        return "Review provider state, then resume or complete the campaign."
    if campaign.status == "completed":
        return "Review ROAS and duplicate only if the campaign economics still work."
    if sync_row["provider_state"] == "needs_review":
        return "Review the failed provider state before retrying launch or sync."
    return "Monitor campaign performance and keep provider sync audit current."


def _campaign_management_row(db: Session, campaign: AdCampaign, provider_status: dict) -> dict:
    launch_blockers = _campaign_launch_blockers(campaign, provider_status)
    budget_health = _campaign_budget_health(campaign)
    sync_row = _campaign_sync_row(campaign)
    latest_launch = (
        db.query(AdCampaignLaunch)
        .filter(AdCampaignLaunch.campaign_id == campaign.id)
        .order_by(AdCampaignLaunch.attempted_at.desc(), AdCampaignLaunch.id.desc())
        .first()
    )
    latest_action = (
        db.query(AdCampaignAction)
        .filter(AdCampaignAction.campaign_id == campaign.id)
        .order_by(AdCampaignAction.created_at.desc(), AdCampaignAction.id.desc())
        .first()
    )
    return {
        "id": campaign.id,
        "name": campaign.name,
        "objective": campaign.objective,
        "status": campaign.status,
        "platforms": campaign.platforms or [],
        "budget": round(float(campaign.daily_budget or campaign.lifetime_budget or 0), 2),
        "launch": {
            "eligible": not launch_blockers,
            "blockers": launch_blockers,
        },
        "sync": sync_row,
        "budget_health": {
            **budget_health,
            "attention_required": _budget_attention_required(budget_health),
        },
        "latest_launch": _launch_dict(latest_launch) if latest_launch else None,
        "latest_action": _action_dict(latest_action) if latest_action else None,
        "next_action": _campaign_management_next_action(
            campaign,
            launch_blockers=launch_blockers,
            sync_row=sync_row,
            budget_health=budget_health,
        ),
    }


@router.get("/provider-status")
def ads_provider_status(
    session: dict = Depends(require_roles("admin", "staff")),
):
    return _ad_provider_readiness()


@router.get("/summary")
def ads_summary(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
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
    session: dict = Depends(require_roles("admin", "staff")),
):
    provider_status = _ad_provider_readiness()
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


@router.get("/sync-readiness")
def ads_sync_readiness(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    provider_status = _ad_provider_readiness()
    all_campaigns = db.query(AdCampaign).all()
    campaigns = (
        db.query(AdCampaign)
        .order_by(AdCampaign.updated_at.desc(), AdCampaign.id.desc())
        .limit(limit)
        .all()
    )
    launches = (
        db.query(AdCampaignLaunch)
        .order_by(AdCampaignLaunch.attempted_at.desc(), AdCampaignLaunch.id.desc())
        .limit(limit)
        .all()
    )
    actions = (
        db.query(AdCampaignAction)
        .order_by(AdCampaignAction.created_at.desc(), AdCampaignAction.id.desc())
        .limit(limit)
        .all()
    )
    external_id_count = sum(1 for campaign in all_campaigns if campaign.external_campaign_id)
    provider_state_count = sum(
        1 for campaign in all_campaigns if campaign.status in {"launched", "paused", "completed"}
    )
    unsynced_live_count = sum(
        1
        for campaign in all_campaigns
        if campaign.status in {"launched", "paused", "completed"} and not campaign.external_campaign_id
    )
    audit = {
        **_launch_counts(launches),
        **_launch_audit_counts(launches),
        **_action_counts(actions),
        "external_id_count": external_id_count,
        "provider_state_count": provider_state_count,
        "unsynced_live_count": unsynced_live_count,
    }
    checklist = [
        {
            "label": "Meta launch credentials",
            "passed": provider_status["configured"],
            "detail": provider_status["readiness_label"],
        },
        {
            "label": "Paused launch guardrail",
            "passed": provider_status["external_sync"]["paused_launch_mode"],
            "detail": "Live launch creates paused Meta campaign shells.",
        },
        {
            "label": "External ID audit",
            "passed": True,
            "detail": f"{external_id_count} campaign(s) currently carry a Meta campaign ID.",
        },
        {
            "label": "Unsynced live campaigns",
            "passed": unsynced_live_count == 0,
            "detail": f"{unsynced_live_count} live/paused/completed campaign(s) need external ID sync.",
        },
    ]
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "provider_status": provider_status,
        "audit": audit,
        "checklist": checklist,
        "campaigns": [_campaign_sync_row(campaign) for campaign in campaigns],
        "guardrails": provider_status["guardrails"],
        "next_action": (
            "Add external campaign IDs to unsynced live campaigns before running pause/resume."
            if unsynced_live_count
            else provider_status["next_action"]
        ),
    }


@router.get("/management-control")
def ads_management_control(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    provider_status = _ad_provider_readiness()
    summary = _ads_summary_snapshot(db)
    all_campaigns = db.query(AdCampaign).all()
    campaigns = (
        db.query(AdCampaign)
        .order_by(AdCampaign.updated_at.desc(), AdCampaign.id.desc())
        .limit(limit)
        .all()
    )
    all_launches = db.query(AdCampaignLaunch).all()
    all_actions = db.query(AdCampaignAction).all()
    campaign_rows = [
        _campaign_management_row(db, campaign, provider_status)
        for campaign in campaigns
    ]
    launch_ready_count = sum(1 for campaign in campaign_rows if campaign["launch"]["eligible"])
    launch_blocked_count = len(campaign_rows) - launch_ready_count
    budget_attention_count = sum(
        1 for campaign in campaign_rows if campaign["budget_health"]["attention_required"]
    )
    unsynced_live_count = sum(
        1
        for campaign in all_campaigns
        if campaign.status in {"launched", "paused", "completed"} and not campaign.external_campaign_id
    )
    external_id_count = sum(1 for campaign in all_campaigns if campaign.external_campaign_id)
    launch_counts = _launch_counts(all_launches)
    action_counts = _action_counts(all_actions)

    if not provider_status["configured"]:
        overall_status = "setup_needed"
        next_action = provider_status["next_action"]
    elif unsynced_live_count:
        overall_status = "sync_needed"
        next_action = "Attach external Meta campaign IDs to live, paused, or completed campaigns."
    elif budget_attention_count:
        overall_status = "budget_review"
        next_action = "Review budget pacing before scaling or duplicating active campaigns."
    elif launch_ready_count:
        overall_status = "ready_to_launch"
        next_action = "Run dry-run proof, then launch paused Meta campaign shells for review."
    else:
        overall_status = "planning_needed"
        next_action = "Create or update campaigns until at least one is launch-ready."

    recent_launches = (
        db.query(AdCampaignLaunch)
        .order_by(AdCampaignLaunch.attempted_at.desc(), AdCampaignLaunch.id.desc())
        .limit(8)
        .all()
    )
    recent_actions = (
        db.query(AdCampaignAction)
        .order_by(AdCampaignAction.created_at.desc(), AdCampaignAction.id.desc())
        .limit(8)
        .all()
    )

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "provider_status": provider_status,
        "summary": {
            **summary,
            "overall_status": overall_status,
            "launch_ready_count": launch_ready_count,
            "launch_blocked_count": launch_blocked_count,
            "budget_attention_count": budget_attention_count,
            "unsynced_live_count": unsynced_live_count,
            "external_id_count": external_id_count,
            "retryable_launch_count": launch_counts["retryable_count"],
            "dry_run_count": launch_counts["dry_run_count"],
            "action_count": action_counts["action_count"],
            "external_sync_count": action_counts["external_sync_count"],
            "next_action": next_action,
        },
        "controls": [
            {
                "label": "Provider launch gate",
                "status": "ready" if provider_status["configured"] else "blocked",
                "detail": "Live launch is blocked until Meta Ads credentials and the launch safety switch are configured.",
            },
            {
                "label": "Paused launch guardrail",
                "status": "enforced",
                "detail": "Live launch creates paused Meta campaign shells so final review happens before activation.",
            },
            {
                "label": "Budget pacing gate",
                "status": "monitored",
                "detail": "Campaigns with no budget, over-pacing, under-pacing, or weak conversion signals are marked for review.",
            },
            {
                "label": "External ID audit",
                "status": "enforced",
                "detail": "Live, paused, and completed campaigns are flagged until the external Meta campaign ID is attached.",
            },
            {
                "label": "Action ledger",
                "status": "tracked",
                "detail": "Pause, resume, complete, duplicate, and external sync actions are recorded for campaign history.",
            },
        ],
        "campaigns": campaign_rows,
        "recent_launches": [_launch_dict(launch) for launch in recent_launches],
        "recent_actions": [_action_dict(action) for action in recent_actions],
    }


@router.post("/campaigns")
def create_ad_campaign(
    payload: AdCampaignCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
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
    session: dict = Depends(require_roles("admin", "staff")),
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
    session: dict = Depends(require_roles("admin")),
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


@router.get("/campaigns/{campaign_id}/actions")
def ad_campaign_actions(
    campaign_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    actions = (
        db.query(AdCampaignAction)
        .filter(AdCampaignAction.campaign_id == campaign.id)
        .order_by(AdCampaignAction.created_at.desc(), AdCampaignAction.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "campaign": _ad_campaign_dict(campaign),
        **_action_counts(actions),
        "actions": [_action_dict(action) for action in actions],
    }


@router.post("/campaigns/{campaign_id}/external-sync")
def sync_ad_campaign_external_state(
    campaign_id: int,
    payload: AdProviderSyncRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")

    next_status = _normalize_sync_status(payload.status)
    external_id = (payload.external_campaign_id or campaign.external_campaign_id or "").strip() or None
    if next_status in {"launched", "paused", "completed"} and not external_id:
        raise HTTPException(
            status_code=422,
            detail="External campaign ID is required for launched, paused, or completed provider sync.",
        )

    previous_status = campaign.status
    previous_external_id = campaign.external_campaign_id
    sync_preview = {
        "provider": "meta-ads",
        "previous_status": previous_status,
        "next_status": next_status,
        "previous_external_campaign_id": previous_external_id,
        "external_campaign_id": external_id,
        "dry_run": payload.dry_run,
        "guardrails": _campaign_sync_guardrails(campaign),
    }

    if payload.dry_run:
        return {
            "campaign": _ad_campaign_dict(campaign),
            "dry_run": True,
            "sync_preview": sync_preview,
            "guardrails": _ad_provider_readiness()["guardrails"],
        }

    campaign.external_campaign_id = external_id
    campaign.status = next_status
    campaign.updated_at = datetime.utcnow()
    action = _record_ad_action(
        db,
        campaign=campaign,
        action="external_sync",
        previous_status=previous_status,
        next_status=campaign.status,
        note=payload.note,
        actor=_actor_from_session(session),
        response_payload={
            **sync_preview,
            "source": "provider_sync_command",
            "dry_run": False,
        },
    )
    db.commit()
    db.refresh(campaign)
    db.refresh(action)
    return {
        "campaign": _ad_campaign_dict(campaign),
        "action": _action_dict(action),
        "dry_run": False,
        "sync_preview": {
            **sync_preview,
            "next_status": campaign.status,
            "external_campaign_id": campaign.external_campaign_id,
        },
    }


@router.post("/campaigns/{campaign_id}/pause")
def pause_ad_campaign(
    campaign_id: int,
    payload: AdCampaignActionRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    if campaign.status == "paused":
        raise HTTPException(status_code=409, detail="Campaign is already paused.")
    if campaign.status in {"completed", "failed"}:
        raise HTTPException(status_code=409, detail=f"Campaign cannot be paused from {campaign.status}.")

    previous_status = campaign.status
    campaign.status = "paused"
    campaign.updated_at = datetime.utcnow()
    action = _record_ad_action(
        db,
        campaign=campaign,
        action="pause",
        previous_status=previous_status,
        next_status=campaign.status,
        note=payload.note,
        actor=_actor_from_session(session),
        response_payload={
            "source": "portal",
            "external_campaign_id": campaign.external_campaign_id,
            "provider_guardrail": "Local pause recorded; confirm external pause in Meta or through provider sync.",
        },
    )
    db.commit()
    db.refresh(campaign)
    db.refresh(action)
    return {"campaign": _ad_campaign_dict(campaign), "action": _action_dict(action)}


@router.post("/campaigns/{campaign_id}/resume")
def resume_ad_campaign(
    campaign_id: int,
    payload: AdCampaignActionRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    if campaign.status != "paused":
        raise HTTPException(status_code=409, detail="Only paused campaigns can be resumed.")

    previous_status = campaign.status
    next_status = "launched" if campaign.external_campaign_id else "ready"
    campaign.status = next_status
    campaign.updated_at = datetime.utcnow()
    action = _record_ad_action(
        db,
        campaign=campaign,
        action="resume",
        previous_status=previous_status,
        next_status=campaign.status,
        note=payload.note,
        actor=_actor_from_session(session),
        response_payload={
            "source": "portal",
            "external_campaign_id": campaign.external_campaign_id,
            "provider_guardrail": "Resume returns to launched only when an external Meta campaign ID is attached.",
        },
    )
    db.commit()
    db.refresh(campaign)
    db.refresh(action)
    return {"campaign": _ad_campaign_dict(campaign), "action": _action_dict(action)}


@router.post("/campaigns/{campaign_id}/complete")
def complete_ad_campaign(
    campaign_id: int,
    payload: AdCampaignActionRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    if campaign.status == "completed":
        raise HTTPException(status_code=409, detail="Campaign is already completed.")

    previous_status = campaign.status
    campaign.status = "completed"
    campaign.updated_at = datetime.utcnow()
    action = _record_ad_action(
        db,
        campaign=campaign,
        action="complete",
        previous_status=previous_status,
        next_status=campaign.status,
        note=payload.note,
        actor=_actor_from_session(session),
        response_payload={
            "source": "portal",
            "external_campaign_id": campaign.external_campaign_id,
            "budget_health": _campaign_budget_health(campaign),
        },
    )
    db.commit()
    db.refresh(campaign)
    db.refresh(action)
    return {"campaign": _ad_campaign_dict(campaign), "action": _action_dict(action)}


@router.post("/campaigns/{campaign_id}/duplicate")
def duplicate_ad_campaign(
    campaign_id: int,
    payload: AdCampaignDuplicateRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    duplicate_status = _normalize_status(payload.status)
    if duplicate_status in {"launched", "completed", "failed"}:
        raise HTTPException(status_code=422, detail="Duplicate status must be draft, planned, ready, or paused.")

    clone = AdCampaign(
        name=(payload.name or f"{campaign.name} Copy").strip(),
        objective=campaign.objective,
        platforms=list(campaign.platforms or []),
        audience=campaign.audience,
        location=campaign.location,
        creative_message=campaign.creative_message,
        link_url=campaign.link_url,
        image_url=campaign.image_url,
        daily_budget=campaign.daily_budget,
        lifetime_budget=campaign.lifetime_budget,
        start_date=campaign.start_date,
        end_date=campaign.end_date,
        status=duplicate_status,
        impressions=0 if payload.reset_metrics else campaign.impressions,
        clicks=0 if payload.reset_metrics else campaign.clicks,
        conversions=0 if payload.reset_metrics else campaign.conversions,
        spend=0 if payload.reset_metrics else campaign.spend,
        revenue=0 if payload.reset_metrics else campaign.revenue,
    )
    db.add(clone)
    db.flush()
    source_action = _record_ad_action(
        db,
        campaign=campaign,
        action="duplicate",
        previous_status=campaign.status,
        next_status=campaign.status,
        note=payload.note,
        actor=_actor_from_session(session),
        response_payload={
            "source": "portal",
            "duplicate_campaign_id": clone.id,
            "reset_metrics": payload.reset_metrics,
        },
    )
    clone_action = _record_ad_action(
        db,
        campaign=clone,
        action="created_from_duplicate",
        previous_status=None,
        next_status=clone.status,
        note=f"Duplicated from campaign #{campaign.id}",
        actor=_actor_from_session(session),
        response_payload={
            "source_campaign_id": campaign.id,
            "source_campaign_name": campaign.name,
            "reset_metrics": payload.reset_metrics,
        },
    )
    db.commit()
    db.refresh(campaign)
    db.refresh(clone)
    db.refresh(source_action)
    db.refresh(clone_action)
    return {
        "campaign": _ad_campaign_dict(campaign),
        "duplicate": _ad_campaign_dict(clone),
        "action": _action_dict(source_action),
        "duplicate_action": _action_dict(clone_action),
    }


@router.get("/campaigns/{campaign_id}/budget-health")
def ad_campaign_budget_health(
    campaign_id: int,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    return {
        "campaign": _ad_campaign_dict(campaign),
        "budget_health": _campaign_budget_health(campaign),
    }


@router.get("/campaigns/{campaign_id}/launches")
def ad_campaign_launches(
    campaign_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
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
    session: dict = Depends(require_roles("admin")),
):
    campaign = db.get(AdCampaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Ad campaign not found")
    if campaign.status == "launched" and not payload.force_relaunch and not payload.dry_run:
        raise HTTPException(status_code=409, detail="Campaign is already marked as launched.")

    provider_status = _ad_provider_readiness()
    blockers = _campaign_launch_blockers(campaign, provider_status)
    if blockers and not payload.dry_run:
        raise HTTPException(
            status_code=409,
            detail=f"Campaign is not launch-ready: {', '.join(blockers)}",
        )
    launch_kwargs = {
        "campaign_id": campaign.id,
        "attempted_at": datetime.utcnow(),
    }
    if payload.dry_run:
        launch = AdCampaignLaunch(
            **launch_kwargs,
            provider=provider_status["provider"],
            status="dry_run",
            dry_run=True,
            response_payload={
                "provider_status": provider_status,
                "launch_mode": "paused_campaign",
                "objective": campaign.objective,
                "blockers": blockers,
                "guardrails": provider_status["guardrails"],
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
