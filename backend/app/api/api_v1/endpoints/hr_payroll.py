from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_hr_permission
from app.services.hr_payroll_service import (
    finalize_run,
    generate_run,
    get_payslip,
    get_run,
    list_runs,
    recalculate_run,
    salary_overview,
    serialize_payslip,
    serialize_run,
    serialize_salary,
    upsert_salary,
)

router = APIRouter()


class SalaryPayload(BaseModel):
    basic: float = Field(default=0, ge=0, le=10000000)
    hra: float = Field(default=0, ge=0, le=10000000)
    allowances: float = Field(default=0, ge=0, le=10000000)
    other_deductions: float = Field(default=0, ge=0, le=10000000)
    tds: float = Field(default=0, ge=0, le=10000000)
    professional_tax: float = Field(default=200, ge=0, le=100000)
    pf_enabled: bool = True
    esi_enabled: bool = True


class PayRunCreate(BaseModel):
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2100)


@router.get("/payroll/salary-structures")
def list_salary_structures(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    return {"employees": salary_overview(db)}


@router.put("/payroll/salary-structures/{employee_id}")
def save_salary_structure(
    employee_id: int,
    payload: SalaryPayload,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    try:
        row = upsert_salary(db, employee_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_salary(row, row.employee)


@router.get("/payroll/runs")
def payroll_runs(
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    return {"runs": [serialize_run(row) for row in list_runs(db)]}


@router.post("/payroll/runs", status_code=201)
def create_pay_run(
    payload: PayRunCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(require_hr_permission("hr.payroll")),
):
    try:
        run, skipped = generate_run(
            db,
            payload.month,
            payload.year,
            str(session.get("sub") or "admin"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"run": serialize_run(run, include_payslips=True), "skipped": skipped}


@router.get("/payroll/runs/{run_id}")
def payroll_run_detail(
    run_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    try:
        run = get_run(db, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return serialize_run(run, include_payslips=True)


@router.post("/payroll/runs/{run_id}/recalculate")
def recalculate_pay_run(
    run_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    try:
        run, skipped = recalculate_run(db, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"run": serialize_run(run, include_payslips=True), "skipped": skipped}


@router.post("/payroll/runs/{run_id}/finalize")
def finalize_pay_run(
    run_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    try:
        run = finalize_run(db, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return serialize_run(run, include_payslips=True)


@router.get("/payroll/payslips/{payslip_id}")
def payslip_detail(
    payslip_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_hr_permission("hr.payroll")),
):
    try:
        row = get_payslip(db, payslip_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return serialize_payslip(row)
