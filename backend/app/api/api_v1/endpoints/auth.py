from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.deps import get_current_session, get_db, require_roles
from app.core.config import settings
from app.models.domain import Customer
from app.services.auth_service import (
    create_access_token,
    has_managed_staff_credentials,
    managed_staff_credential_status,
    upsert_managed_staff_credential,
    verify_admin_credentials,
    verify_managed_staff_credentials,
    verify_staff_credentials,
)


router = APIRouter()


class AdminLoginRequest(BaseModel):
    id: str
    password: str


class StaffLoginRequest(BaseModel):
    id: str
    password: str


class StaffCredentialRequest(BaseModel):
    id: str
    password: str
    display_name: str | None = None
    is_active: bool = True


class CustomerLoginRequest(BaseModel):
    phone: str
    name: str | None = None
    email: EmailStr | None = None


@router.post("/admin/login")
def admin_login(payload: AdminLoginRequest):
    if not verify_admin_credentials(payload.id, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials.",
        )
    return create_access_token(
        subject=f"admin:{settings.PIZZA_BLITZ_ADMIN_ID}",
        role="admin",
        display_name=settings.PIZZA_BLITZ_ADMIN_NAME,
        expires_minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES,
    )


@router.post("/staff/login")
def staff_login(payload: StaffLoginRequest, db: Session = Depends(get_db)):
    if verify_admin_credentials(payload.id, payload.password):
        return create_access_token(
            subject=f"admin:{settings.PIZZA_BLITZ_ADMIN_ID}",
            role="admin",
            display_name=settings.PIZZA_BLITZ_ADMIN_NAME,
            expires_minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES,
        )

    managed_credential = verify_managed_staff_credentials(
        staff_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if managed_credential:
        return create_access_token(
            subject=f"staff:{managed_credential.staff_id}",
            role="staff",
            display_name=managed_credential.display_name,
            expires_minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES,
        )

    if not verify_staff_credentials(payload.id, payload.password, db=db):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid staff credentials.",
        )
    return create_access_token(
        subject=f"staff:{settings.PIZZA_BLITZ_STAFF_ID}",
        role="staff",
        display_name="Counter Staff",
        expires_minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES,
    )


@router.get("/staff/credential")
def staff_credential_status(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return managed_staff_credential_status(db)


@router.post("/staff/credential")
def save_staff_credential(
    payload: StaffCredentialRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    staff_id = payload.id.strip()
    password = payload.password
    if len(staff_id) < 3:
        raise HTTPException(status_code=422, detail="Staff ID must be at least 3 characters.")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Staff password must be at least 8 characters.")
    if staff_id.lower() in {"admin", settings.PIZZA_BLITZ_ADMIN_ID.lower()}:
        raise HTTPException(status_code=422, detail="Staff ID must be separate from the admin ID.")

    credential = upsert_managed_staff_credential(
        db=db,
        staff_id=staff_id,
        password=password,
        display_name=payload.display_name or "Counter Staff",
        is_active=payload.is_active,
    )
    return {
        "configured": bool(credential.is_active),
        "source": "managed",
        "staff_id": credential.staff_id,
        "display_name": credential.display_name,
        "is_active": bool(credential.is_active),
        "must_rotate": bool(credential.must_rotate),
        "updated_at": credential.updated_at.isoformat() if credential.updated_at else None,
        "last_login_at": credential.last_login_at.isoformat() if credential.last_login_at else None,
        "password_policy": "Minimum 8 characters. Store only a salted PBKDF2 hash.",
        "next_action": "Counter staff can sign in from the staff login once active.",
    }


@router.post("/staff/portal-verify")
def verify_staff_for_portal(payload: StaffLoginRequest, db: Session = Depends(get_db)):
    managed_credential = verify_managed_staff_credentials(
        staff_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if managed_credential:
        return {
            "ok": True,
            "source": "managed",
            "staff_id": managed_credential.staff_id,
            "display_name": managed_credential.display_name,
        }

    if verify_staff_credentials(payload.id, payload.password):
        return {
            "ok": True,
            "source": "environment",
            "staff_id": settings.PIZZA_BLITZ_STAFF_ID,
            "display_name": "Counter Staff",
        }

    if not has_managed_staff_credentials(db) and not (
        settings.PIZZA_BLITZ_STAFF_ID and settings.PIZZA_BLITZ_STAFF_PASSWORD
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Staff credentials are not configured yet.",
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid staff credentials.",
    )


@router.post("/customer/login")
def customer_login(payload: CustomerLoginRequest, db: Session = Depends(get_db)):
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No customer profile found for this phone number.",
        )

    if payload.name and payload.name.strip():
        customer.name = payload.name.strip()
    if payload.email:
        customer.email = str(payload.email)
    db.commit()
    db.refresh(customer)

    return create_access_token(
        subject=f"customer:{customer.id}",
        role="customer",
        display_name=customer.name,
        phone=customer.phone,
        email=customer.email,
        expires_minutes=settings.CUSTOMER_TOKEN_EXPIRE_MINUTES,
    )


@router.get("/me")
def current_session(session: dict = Depends(get_current_session)):
    return session
