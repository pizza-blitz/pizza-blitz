from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.deps import get_current_session, get_db
from app.core.config import settings
from app.models.domain import Customer
from app.services.auth_service import (
    create_access_token,
    verify_admin_credentials,
    verify_staff_credentials,
)


router = APIRouter()


class AdminLoginRequest(BaseModel):
    id: str
    password: str


class StaffLoginRequest(BaseModel):
    id: str
    password: str


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
def staff_login(payload: StaffLoginRequest):
    if not verify_staff_credentials(payload.id, payload.password):
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
