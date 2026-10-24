"""HR payroll: salary structures, monthly runs, statutory defaults and payslips."""

import calendar
from datetime import date, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.domain import (
    HRAttendance,
    HREmployee,
    HRLeaveRequest,
    HRLeaveType,
    HRPayRun,
    HRPayslip,
    HRSalaryStructure,
)

PF_RATE = 0.12
PF_CAP = 15000.0
ESI_EMPLOYEE_RATE = 0.0075
ESI_EMPLOYER_RATE = 0.0325
ESI_CEILING = 21000.0


def round2(value: float) -> float:
    return round(float(value or 0), 2)


def serialize_salary(row: HRSalaryStructure | None, employee: HREmployee) -> dict:
    return {
        "employee_id": employee.id,
        "employee_code": employee.employee_code,
        "full_name": employee.full_name,
        "designation": employee.designation,
        "store_name": employee.store.name if employee.store else None,
        "structure": {
            "id": row.id,
            "basic": row.basic,
            "hra": row.hra,
            "allowances": row.allowances,
            "other_deductions": row.other_deductions,
            "tds": row.tds,
            "pf_enabled": bool(row.pf_enabled),
            "esi_enabled": bool(row.esi_enabled),
            "professional_tax": row.professional_tax,
            "effective_from": row.effective_from.isoformat()
            if row.effective_from
            else None,
            "monthly_gross": round2(row.basic + row.hra + row.allowances),
        }
        if row
        else None,
    }


def salary_overview(db: Session) -> list[dict]:
    employees = (
        db.query(HREmployee)
        .filter(HREmployee.status != "exited")
        .order_by(HREmployee.full_name.asc())
        .all()
    )
    by_employee = {
        row.employee_id: row for row in db.query(HRSalaryStructure).all()
    }
    return [
        serialize_salary(by_employee.get(employee.id), employee)
        for employee in employees
    ]


def upsert_salary(db: Session, employee_id: int, payload: dict) -> HRSalaryStructure:
    employee = (
        db.query(HREmployee).filter(HREmployee.id == int(employee_id)).first()
    )
    if employee is None:
        raise ValueError("Employee not found.")
    values = {}
    for key in (
        "basic",
        "hra",
        "allowances",
        "other_deductions",
        "tds",
        "professional_tax",
    ):
        amount = float(payload.get(key) or 0)
        if amount < 0 or amount > 10000000:
            raise ValueError(f"{key.replace('_', ' ').title()} is out of range.")
        values[key] = round2(amount)
    if values["basic"] + values["hra"] + values["allowances"] <= 0:
        raise ValueError("Basic, HRA and allowances cannot all be zero.")
    row = (
        db.query(HRSalaryStructure)
        .filter(HRSalaryStructure.employee_id == employee.id)
        .first()
    )
    if row is None:
        row = HRSalaryStructure(employee_id=employee.id)
        db.add(row)
    row.basic = values["basic"]
    row.hra = values["hra"]
    row.allowances = values["allowances"]
    row.other_deductions = values["other_deductions"]
    row.tds = values["tds"]
    row.professional_tax = values["professional_tax"]
    row.pf_enabled = bool(payload.get("pf_enabled", True))
    row.esi_enabled = bool(payload.get("esi_enabled", True))
    row.effective_from = date.today()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("Salary structure could not be saved.") from exc
    db.refresh(row)
    return row


def serialize_run(run: HRPayRun, include_payslips: bool = False) -> dict:
    data = {
        "id": run.id,
        "month": run.month,
        "year": run.year,
        "status": run.status,
        "employee_count": run.employee_count,
        "gross_total": run.gross_total,
        "deductions_total": run.deductions_total,
        "net_total": run.net_total,
        "employer_cost": run.employer_cost,
        "created_by": run.created_by,
        "finalized_at": run.finalized_at.isoformat() if run.finalized_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
    if include_payslips:
        data["payslips"] = [
            serialize_payslip(row)
            for row in sorted(run.payslips, key=lambda row: row.employee_name)
        ]
    return data


def serialize_payslip(row: HRPayslip) -> dict:
    return {
        "id": row.id,
        "run_id": row.run_id,
        "employee_id": row.employee_id,
        "employee_code": row.employee_code,
        "employee_name": row.employee_name,
        "designation": row.designation,
        "days_in_month": row.days_in_month,
        "paid_days": row.paid_days,
        "basic": row.basic,
        "hra": row.hra,
        "allowances": row.allowances,
        "gross": row.gross,
        "pf_employee": row.pf_employee,
        "esi_employee": row.esi_employee,
        "professional_tax": row.professional_tax,
        "tds": row.tds,
        "other_deductions": row.other_deductions,
        "total_deductions": row.total_deductions,
        "net": row.net,
        "employer_pf": row.employer_pf,
        "employer_esi": row.employer_esi,
        "breakdown": row.breakdown or {},
    }


def _unpaid_dates(
    db: Session, employee_id: int, year: int, month: int
) -> set[date]:
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    unpaid_type_ids = {
        row.id
        for row in db.query(HRLeaveType).filter(HRLeaveType.code == "unpaid").all()
    }
    dates: set[date] = set()
    if unpaid_type_ids:
        requests = (
            db.query(HRLeaveRequest)
            .filter(
                HRLeaveRequest.employee_id == employee_id,
                HRLeaveRequest.status == "approved",
                HRLeaveRequest.leave_type_id.in_(unpaid_type_ids),
                HRLeaveRequest.start_date <= last,
                HRLeaveRequest.end_date >= first,
            )
            .all()
        )
        for request in requests:
            cursor = max(request.start_date, first)
            end = min(request.end_date, last)
            while cursor <= end:
                dates.add(cursor)
                cursor = date.fromordinal(cursor.toordinal() + 1)
    absences = (
        db.query(HRAttendance)
        .filter(
            HRAttendance.employee_id == employee_id,
            HRAttendance.status == "absent",
            HRAttendance.date >= first,
            HRAttendance.date <= last,
        )
        .all()
    )
    for row in absences:
        dates.add(row.date)
    return dates


def _payslip_for(
    db: Session,
    employee: HREmployee,
    salary: HRSalaryStructure,
    run: HRPayRun,
) -> HRPayslip:
    days_in_month = calendar.monthrange(run.year, run.month)[1]
    unpaid = _unpaid_dates(db, employee.id, run.year, run.month)
    paid_days = max(0.0, float(days_in_month - len(unpaid)))
    ratio = paid_days / days_in_month if days_in_month else 0.0
    basic = round2(salary.basic * ratio)
    hra = round2(salary.hra * ratio)
    allowances = round2(salary.allowances * ratio)
    gross = round2(basic + hra + allowances)
    pf_employee = (
        round2(min(basic, PF_CAP) * PF_RATE)
        if salary.pf_enabled and basic > 0
        else 0.0
    )
    esi_employee = (
        round2(gross * ESI_EMPLOYEE_RATE)
        if salary.esi_enabled and 0 < gross <= ESI_CEILING
        else 0.0
    )
    professional_tax = round2(salary.professional_tax) if gross > 0 else 0.0
    tds = round2(salary.tds)
    other = round2(salary.other_deductions)
    deductions = round2(
        pf_employee + esi_employee + professional_tax + tds + other
    )
    net = round2(max(0.0, gross - deductions))
    employer_pf = (
        round2(min(basic, PF_CAP) * PF_RATE)
        if salary.pf_enabled and basic > 0
        else 0.0
    )
    employer_esi = (
        round2(gross * ESI_EMPLOYER_RATE)
        if salary.esi_enabled and 0 < gross <= ESI_CEILING
        else 0.0
    )
    breakdown = {
        "earnings": [
            {"label": "Basic", "amount": basic},
            {"label": "HRA", "amount": hra},
            {"label": "Allowances", "amount": allowances},
        ],
        "deductions": [
            {"label": "Provident Fund", "amount": pf_employee},
            {"label": "ESI", "amount": esi_employee},
            {"label": "Professional tax", "amount": professional_tax},
            {"label": "TDS", "amount": tds},
            {"label": "Other", "amount": other},
        ],
        "unpaid_days": len(unpaid),
        "paid_days": paid_days,
        "pf_cap": PF_CAP,
        "esi_ceiling": ESI_CEILING,
    }
    return HRPayslip(
        run_id=run.id,
        employee_id=employee.id,
        employee_code=employee.employee_code,
        employee_name=employee.full_name,
        designation=employee.designation,
        days_in_month=days_in_month,
        paid_days=paid_days,
        basic=basic,
        hra=hra,
        allowances=allowances,
        gross=gross,
        pf_employee=pf_employee,
        esi_employee=esi_employee,
        professional_tax=professional_tax,
        tds=tds,
        other_deductions=other,
        total_deductions=deductions,
        net=net,
        employer_pf=employer_pf,
        employer_esi=employer_esi,
        breakdown=breakdown,
    )


def _build_run(
    db: Session, run: HRPayRun, created_by: str | None
) -> tuple[HRPayRun, list[str]]:
    employees = (
        db.query(HREmployee)
        .filter(HREmployee.status.in_(["active", "onboarding", "notice"]))
        .order_by(HREmployee.full_name.asc())
        .all()
    )
    salaries = {
        row.employee_id: row for row in db.query(HRSalaryStructure).all()
    }
    skipped: list[str] = []
    payslips: list[HRPayslip] = []
    for employee in employees:
        salary = salaries.get(employee.id)
        if salary is None:
            skipped.append(employee.employee_code)
            continue
        payslips.append(_payslip_for(db, employee, salary, run))
    if not payslips:
        raise ValueError(
            "No employee has a salary structure. Add at least one salary first."
        )
    run.employee_count = len(payslips)
    run.gross_total = round2(sum(row.gross for row in payslips))
    run.deductions_total = round2(
        sum(row.total_deductions for row in payslips)
    )
    run.net_total = round2(sum(row.net for row in payslips))
    run.employer_cost = round2(
        sum(
            row.gross + row.employer_pf + row.employer_esi
            for row in payslips
        )
    )
    run.created_by = created_by
    db.add_all(payslips)
    return run, skipped


def generate_run(
    db: Session, month: int, year: int, created_by: str | None = None
) -> tuple[HRPayRun, list[str]]:
    if month < 1 or month > 12:
        raise ValueError("Month must be between 1 and 12.")
    if year < 2000 or year > 2100:
        raise ValueError("Year is out of range.")
    if (
        db.query(HRPayRun)
        .filter(HRPayRun.month == month, HRPayRun.year == year)
        .first()
        is not None
    ):
        raise ValueError("A pay run already exists for that month.")
    run = HRPayRun(year=year, month=month, status="draft")
    db.add(run)
    db.flush()
    run, skipped = _build_run(db, run, created_by)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("A pay run already exists for that month.") from exc
    db.refresh(run)
    return run, skipped


def recalculate_run(db: Session, run_id: int) -> tuple[HRPayRun, list[str]]:
    run = db.query(HRPayRun).filter(HRPayRun.id == run_id).first()
    if run is None:
        raise ValueError("Pay run not found.")
    if run.status != "draft":
        raise ValueError("Only draft pay runs can be recalculated.")
    for payslip in list(run.payslips):
        db.delete(payslip)
    db.flush()
    run, skipped = _build_run(db, run, run.created_by)
    db.commit()
    db.refresh(run)
    return run, skipped


def finalize_run(db: Session, run_id: int) -> HRPayRun:
    run = db.query(HRPayRun).filter(HRPayRun.id == run_id).first()
    if run is None:
        raise ValueError("Pay run not found.")
    if run.status != "draft":
        raise ValueError("Only draft pay runs can be finalized.")
    run.status = "finalized"
    run.finalized_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


def list_runs(db: Session) -> list[HRPayRun]:
    return db.query(HRPayRun).order_by(HRPayRun.year.desc(), HRPayRun.month.desc()).all()


def get_run(db: Session, run_id: int) -> HRPayRun:
    run = db.query(HRPayRun).filter(HRPayRun.id == run_id).first()
    if run is None:
        raise ValueError("Pay run not found.")
    return run


def get_payslip(db: Session, payslip_id: int) -> HRPayslip:
    row = db.query(HRPayslip).filter(HRPayslip.id == payslip_id).first()
    if row is None:
        raise ValueError("Payslip not found.")
    return row
