import os

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.deps import get_current_session, get_db, require_roles
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.models.domain import Customer, RestaurantOrder
from app.services.operational_audit_service import record_operational_audit_event
from app.services.customer_otp_service import (
    OtpError,
    normalize_phone,
    request_customer_otp,
    verify_customer_otp,
)
from app.services.auth_service import (
    AuthError,
    decode_access_token,
    create_access_token,
    has_managed_admin_credentials,
    has_managed_staff_credentials,
    managed_admin_credential_status,
    managed_staff_credential_status,
    upsert_managed_admin_credential,
    upsert_managed_staff_credential,
    verify_admin_credentials,
    verify_managed_admin_credentials,
    verify_managed_staff_credentials,
    verify_staff_credentials,
)
from app.services.permission_service import (
    set_staff_permissions,
    staff_permission_state,
)
from app.services.two_factor_service import (
    TwoFactorError,
    confirm_setup,
    disable as disable_two_factor,
    start_setup,
    status as two_factor_status,
    two_factor_required,
    verify_login_code,
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


class AdminCredentialRequest(BaseModel):
    id: str
    password: str
    display_name: str | None = None
    is_active: bool = True


class CustomerLoginRequest(BaseModel):
    phone: str
    name: str | None = None
    email: EmailStr | None = None
    order_id: int | None = None


class CustomerOtpRequest(BaseModel):
    phone: str


class CustomerOtpVerify(BaseModel):
    phone: str
    code: str


class TwoFactorVerifyRequest(BaseModel):
    challenge_token: str
    code: str


class TwoFactorCodeRequest(BaseModel):
    code: str


class StaffPermissionUpdate(BaseModel):
    permissions: list[str]


def _two_factor_challenge(db: Session, subject: str, role: str, display_name: str) -> dict:
    challenge = create_access_token(
        subject=subject,
        role=role,
        display_name=display_name,
        expires_minutes=5,
        purpose="2fa",
    )
    return {
        "two_factor_required": True,
        "challenge_token": challenge["access_token"],
        "expires_at": challenge["expires_at"],
        "role": role,
        "display_name": display_name,
        "subject": subject,
    }


def _login_response(db: Session, subject: str, role: str, display_name: str) -> dict:
    if two_factor_required(db, subject):
        return _two_factor_challenge(db, subject, role, display_name)
    return create_access_token(
        subject=subject,
        role=role,
        display_name=display_name,
        expires_minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES,
    )


@router.post("/admin/login")
def admin_login(payload: AdminLoginRequest, request: Request, db: Session = Depends(get_db)):
    enforce_rate_limit(request, "auth-login", 30)
    managed_admin = verify_managed_admin_credentials(
        admin_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if not managed_admin and not verify_admin_credentials(payload.id, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials.",
        )
    admin_id = managed_admin.admin_id if managed_admin else settings.PIZZA_BLITZ_ADMIN_ID
    display_name = managed_admin.display_name if managed_admin else settings.PIZZA_BLITZ_ADMIN_NAME
    return _login_response(db, f"admin:{admin_id}", "admin", display_name)


@router.post("/staff/login")
def staff_login(payload: StaffLoginRequest, request: Request, db: Session = Depends(get_db)):
    enforce_rate_limit(request, "auth-login", 30)
    managed_admin = verify_managed_admin_credentials(
        admin_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if managed_admin or verify_admin_credentials(payload.id, payload.password):
        admin_id = managed_admin.admin_id if managed_admin else settings.PIZZA_BLITZ_ADMIN_ID
        display_name = managed_admin.display_name if managed_admin else settings.PIZZA_BLITZ_ADMIN_NAME
        return _login_response(db, f"admin:{admin_id}", "admin", display_name)

    managed_credential = verify_managed_staff_credentials(
        staff_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if managed_credential:
        return _login_response(
            db,
            f"staff:{managed_credential.staff_id}",
            "staff",
            managed_credential.display_name,
        )

    if not verify_staff_credentials(payload.id, payload.password, db=db):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid staff credentials.",
        )
    return _login_response(db, f"staff:{settings.PIZZA_BLITZ_STAFF_ID}", "staff", "Counter Staff")


@router.get("/admin/credential")
def admin_credential_status(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return managed_admin_credential_status(db)


@router.post("/admin/credential")
def save_admin_credential(
    payload: AdminCredentialRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    admin_id = payload.id.strip()
    password = payload.password
    if len(admin_id) < 3:
        raise HTTPException(status_code=422, detail="Admin ID must be at least 3 characters.")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Admin password must be at least 8 characters.")
    if admin_id.lower() == settings.PIZZA_BLITZ_STAFF_ID.lower():
        raise HTTPException(status_code=422, detail="Admin ID must be separate from the fallback staff ID.")

    credential = upsert_managed_admin_credential(
        db=db,
        admin_id=admin_id,
        password=password,
        display_name=payload.display_name or settings.PIZZA_BLITZ_ADMIN_NAME,
        is_active=payload.is_active,
    )
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="credential",
        action="admin_credential_upsert",
        resource_type="admin_credential",
        resource_id=credential.admin_id,
        detail=f"Master admin credential saved for {credential.admin_id}.",
        metadata={
            "is_active": bool(credential.is_active),
            "must_rotate": bool(credential.must_rotate),
            "display_name": credential.display_name,
        },
    )
    return managed_admin_credential_status(db)


@router.post("/admin/portal-verify")
def verify_admin_for_portal(payload: AdminLoginRequest, request: Request, db: Session = Depends(get_db)):
    enforce_rate_limit(request, "auth-login", 30)
    managed_credential = verify_managed_admin_credentials(
        admin_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if managed_credential:
        subject = f"admin:{managed_credential.admin_id}"
        if two_factor_required(db, subject):
            return _two_factor_challenge(
                db, subject, "admin", managed_credential.display_name
            )
        return {
            "ok": True,
            "source": "managed",
            "admin_id": managed_credential.admin_id,
            "display_name": managed_credential.display_name,
        }

    if verify_admin_credentials(payload.id, payload.password):
        subject = f"admin:{settings.PIZZA_BLITZ_ADMIN_ID}"
        if two_factor_required(db, subject):
            return _two_factor_challenge(
                db, subject, "admin", settings.PIZZA_BLITZ_ADMIN_NAME
            )
        return {
            "ok": True,
            "source": "environment",
            "admin_id": settings.PIZZA_BLITZ_ADMIN_ID,
            "display_name": settings.PIZZA_BLITZ_ADMIN_NAME,
        }

    if not has_managed_admin_credentials(db) and not (
        os.getenv("PIZZA_BLITZ_ADMIN_ID") and os.getenv("PIZZA_BLITZ_ADMIN_PASSWORD")
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin credentials are not configured yet.",
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid admin credentials.",
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
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
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
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="credential",
        action="staff_credential_upsert",
        resource_type="staff_credential",
        resource_id=credential.staff_id,
        detail=f"Counter staff credential saved for {credential.staff_id}.",
        metadata={
            "is_active": bool(credential.is_active),
            "must_rotate": bool(credential.must_rotate),
            "display_name": credential.display_name,
        },
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
def verify_staff_for_portal(payload: StaffLoginRequest, request: Request, db: Session = Depends(get_db)):
    enforce_rate_limit(request, "auth-login", 30)
    managed_credential = verify_managed_staff_credentials(
        staff_id=payload.id,
        password=payload.password,
        db=db,
        mark_login=True,
    )
    if managed_credential:
        subject = f"staff:{managed_credential.staff_id}"
        if two_factor_required(db, subject):
            return _two_factor_challenge(
                db, subject, "staff", managed_credential.display_name
            )
        return {
            "ok": True,
            "source": "managed",
            "staff_id": managed_credential.staff_id,
            "display_name": managed_credential.display_name,
        }

    if verify_staff_credentials(payload.id, payload.password):
        subject = f"staff:{settings.PIZZA_BLITZ_STAFF_ID}"
        if two_factor_required(db, subject):
            return _two_factor_challenge(db, subject, "staff", "Counter Staff")
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


@router.post("/customer/otp/request")
def request_customer_login_otp(
    payload: CustomerOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "customer-otp", 10)
    try:
        return request_customer_otp(db, payload.phone)
    except OtpError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/customer/otp/verify")
def verify_customer_login_otp(
    payload: CustomerOtpVerify,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "customer-otp-verify", 10)
    try:
        customer = verify_customer_otp(db, payload.phone, payload.code)
    except OtpError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc

    return create_access_token(
        subject=f"customer:{customer.id}",
        role="customer",
        display_name=customer.name or "Pizza Guest",
        phone=customer.phone,
        email=customer.email,
        expires_minutes=settings.CUSTOMER_TOKEN_EXPIRE_MINUTES,
    )


@router.post("/customer/login")
def customer_login(payload: CustomerLoginRequest, request: Request, db: Session = Depends(get_db)):
    enforce_rate_limit(request, "auth-login", 30)
    try:
        phone = normalize_phone(payload.phone)
    except OtpError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not payload.order_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in with a one-time verification code or a recent order ID.",
        )

    order = (
        db.query(RestaurantOrder)
        .filter(RestaurantOrder.id == payload.order_id)
        .first()
    )
    order_phone = ""
    if order is not None:
        try:
            order_phone = normalize_phone(order.customer_phone)
        except OtpError:
            order_phone = ""
    if order is None or order_phone != phone:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Phone number and order ID do not match.",
        )

    customer = db.query(Customer).filter(Customer.phone == phone).first()
    if customer is None:
        customer = Customer(phone=phone, total_orders=0, total_spend=0.0)
        db.add(customer)

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


@router.post("/2fa/verify")
def verify_two_factor_challenge(
    payload: TwoFactorVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    enforce_rate_limit(request, "auth-2fa", 20)
    try:
        challenge = decode_access_token(
            payload.challenge_token, allow_two_factor_challenge=True
        )
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc
    if challenge.get("purpose") != "2fa" or challenge.get("role") not in {"admin", "staff"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This is not a two-factor challenge.",
        )
    subject = str(challenge["subject"])
    if not verify_login_code(db, subject, payload.code.strip()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That authenticator or recovery code is not valid.",
        )
    token = create_access_token(
        subject=subject,
        role=challenge["role"],
        display_name=challenge.get("display_name"),
        expires_minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES,
    )
    return {
        **token,
        "ok": True,
        "two_factor_verified": True,
        "start_path": "/dashboard" if challenge["role"] == "admin" else "/orders",
    }


@router.get("/2fa/status")
def get_two_factor_status(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    return {
        **two_factor_status(db, session["subject"]),
        "subject": session["subject"],
        "role": session["role"],
    }


@router.post("/2fa/setup")
def begin_two_factor_setup(
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    try:
        return start_setup(db, session["subject"])
    except TwoFactorError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/2fa/confirm")
def confirm_two_factor_setup(
    payload: TwoFactorCodeRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    try:
        recovery_codes = confirm_setup(db, session["subject"], payload.code)
    except TwoFactorError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        **two_factor_status(db, session["subject"]),
        "recovery_codes": recovery_codes,
        "next_action": "Store these recovery codes somewhere safe. They will not be shown again.",
    }


@router.post("/2fa/disable")
def disable_two_factor_auth(
    payload: TwoFactorCodeRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin", "staff")),
):
    try:
        disable_two_factor(db, session["subject"], payload.code)
    except TwoFactorError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "enabled": False,
        "next_action": "Two-factor authentication is off. You can set it up again anytime.",
    }


@router.get("/permissions")
def list_staff_permissions(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles("admin")),
):
    return {
        "role": "staff",
        "permissions": staff_permission_state(db),
    }


@router.put("/permissions/staff")
def update_staff_permissions(
    payload: StaffPermissionUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: dict = Depends(require_roles("admin")),
):
    try:
        permissions = set_staff_permissions(db, payload.permissions)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_operational_audit_event(
        db,
        session=session,
        request=request,
        event_type="credential",
        action="staff_permissions_update",
        resource_type="role_permissions",
        resource_id="staff",
        detail="Staff permissions updated.",
        metadata={
            "enabled": [
                item["key"] for item in permissions if item["enabled"]
            ]
        },
    )
    return {"role": "staff", "permissions": permissions}
