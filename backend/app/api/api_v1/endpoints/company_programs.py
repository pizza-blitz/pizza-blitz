"""HR programs and executive workspaces: training, goals and franchise."""

import re
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_department_permission
from app.core.clock import business_today
from app.models.domain import (
    CompanyGoal,
    FranchiseSite,
    HREmployee,
    TrainingCourse,
    TrainingRecord,
)

router = APIRouter()

TRAINING_DEPENDENCY = require_department_permission(
    "training",
    "hr.training",
    "training.view",
)
GOAL_DEPENDENCY = require_department_permission(
    "executive",
    "executive.budget",
    "executive.view",
)
FRANCHISE_DEPENDENCY = require_department_permission(
    "franchise",
    "executive.franchise",
    "franchise.view",
)

FRANCHISE_STAGES = {
    "lead",
    "qualified",
    "site_visit",
    "negotiation",
    "agreement",
    "construction",
    "open",
    "lost",
}
ACTIVE_RECORD_STATUSES = {"assigned", "in_progress"}

DEFAULT_COURSES = [
    {
        "key": "pizza-standards",
        "title": "Pizza Blitz service standards",
        "description": (
            "The greeting, order accuracy and handoff habits every shift "
            "must follow."
        ),
        "level": "core",
        "duration_minutes": 15,
        "pass_score": 80,
        "content": [
            {
                "title": "Greeting",
                "body": (
                    "Welcome every guest within ten seconds of them reaching "
                    "the counter or calling the store. Make eye contact, smile "
                    "and offer help before they have to ask."
                ),
            },
            {
                "title": "Order accuracy",
                "body": (
                    "Repeat the full order back to the guest, including size, "
                    "crust, toppings and drinks. Confirm the order total and "
                    "read back any special instructions before sending it to "
                    "the kitchen."
                ),
            },
            {
                "title": "Handoff",
                "body": (
                    "Check the ticket against the box, call the guest by name "
                    "and confirm the order number. Open the box to show the "
                    "pizza when the guest is present, then thank them and "
                    "invite them back."
                ),
            },
        ],
        "quiz": [
            {
                "prompt": "How quickly should a guest be greeted?",
                "options": [
                    "Within 10 seconds",
                    "Within 2 minutes",
                    "Only after they reach the till",
                    "Only when they call out",
                ],
                "correct_index": 0,
                "explanation": "A prompt greeting sets the tone for the visit.",
            },
            {
                "prompt": (
                    "What should you do before sending an order to the kitchen?"
                ),
                "options": [
                    "Repeat it back to the guest",
                    "Guess any missing items",
                    "Skip the drinks section",
                    "Apply a discount automatically",
                ],
                "correct_index": 0,
                "explanation": "Reading the order back catches mistakes early.",
            },
            {
                "prompt": "How should a completed order be handed off?",
                "options": [
                    "Confirm the guest name and order number",
                    "Leave it on the counter without a word",
                    "Ask the guest to find their own box",
                    "Hand it to any waiting guest",
                ],
                "correct_index": 0,
                "explanation": "Name and order number prevent mix-ups.",
            },
        ],
    },
    {
        "key": "food-safety-basics",
        "title": "Food safety basics",
        "description": (
            "Handwashing, safe temperatures and avoiding cross-contamination "
            "during every prep session."
        ),
        "level": "compliance",
        "duration_minutes": 20,
        "pass_score": 80,
        "content": [
            {
                "title": "Handwashing",
                "body": (
                    "Wash hands with soap and warm water for at least twenty "
                    "seconds before handling food, after using the washroom, "
                    "after touching raw meat and after clearing bins. Dry with "
                    "a single-use paper towel."
                ),
            },
            {
                "title": "Temperature control",
                "body": (
                    "Keep fridges between 1C and 5C, freezers at -15C or "
                    "colder and hot holding at 63C or above. Record every "
                    "check and move food out of the danger zone immediately "
                    "when a reading is out of range."
                ),
            },
            {
                "title": "Cross-contamination",
                "body": (
                    "Use separate colour-coded boards and knives for raw meat "
                    "and ready-to-eat food. Store raw items below cooked food, "
                    "cover everything and sanitise surfaces between tasks."
                ),
            },
        ],
        "quiz": [
            {
                "prompt": "How long should you wash your hands?",
                "options": [
                    "At least 20 seconds",
                    "About 3 seconds",
                    "Only until they are wet",
                    "Once per shift",
                ],
                "correct_index": 0,
                "explanation": "Twenty seconds of soap and water removes germs.",
            },
            {
                "prompt": "What is the safe fridge temperature range?",
                "options": [
                    "1C to 5C",
                    "-5C to 0C",
                    "8C to 12C",
                    "Anywhere below 10C",
                ],
                "correct_index": 0,
                "explanation": "Bacteria grow fastest outside 1C to 5C.",
            },
            {
                "prompt": "How do you prevent cross-contamination?",
                "options": [
                    "Use separate boards for raw and ready-to-eat food",
                    "Wipe the board with a dry cloth",
                    "Store raw meat above cooked food",
                    "Reuse the same knife for every task",
                ],
                "correct_index": 0,
                "explanation": "Separate equipment stops bacteria spreading.",
            },
        ],
    },
    {
        "key": "allergen-awareness",
        "title": "Allergen awareness",
        "description": (
            "Recognising the 14 major allergens, preventing cross-contact and "
            "communicating clearly with guests."
        ),
        "level": "compliance",
        "duration_minutes": 12,
        "pass_score": 80,
        "content": [
            {
                "title": "The 14 allergens",
                "body": (
                    "The 14 major allergens are celery, cereals containing "
                    "gluten, crustaceans, eggs, fish, lupin, milk, molluscs, "
                    "mustard, peanuts, sesame, soybeans, sulphur dioxide and "
                    "tree nuts. Know which menu items contain each one."
                ),
            },
            {
                "title": "Cross-contact",
                "body": (
                    "Clean and sanitise prep surfaces, utensils and pizza "
                    "cutters before handling an allergen order. Use separate "
                    "toppings from sealed containers and never reuse gloves "
                    "that have touched an allergen."
                ),
            },
            {
                "title": "Communication",
                "body": (
                    "When a guest mentions an allergy, confirm the ingredients "
                    "using the allergen matrix, repeat the request to the "
                    "kitchen and tell the guest about any shared equipment. "
                    "Escalate to a manager when you are unsure."
                ),
            },
        ],
        "quiz": [
            {
                "prompt": "How many major allergens must staff know?",
                "options": ["14", "4", "7", "20"],
                "correct_index": 0,
                "explanation": "There are 14 major regulated allergens.",
            },
            {
                "prompt": "How do you reduce cross-contact on an allergen order?",
                "options": [
                    "Clean surfaces and use separate utensils",
                    "Shake crumbs off the cutter",
                    "Use the same gloves as before",
                    "Ignore it if the guest is not watching",
                ],
                "correct_index": 0,
                "explanation": "Clean equipment and surfaces prevent transfer.",
            },
            {
                "prompt": "What should you do when a guest reports an allergy?",
                "options": [
                    "Confirm ingredients and tell the kitchen",
                    "Promise the food is always safe",
                    "Remove the topping and serve",
                    "Say nothing to the kitchen",
                ],
                "correct_index": 0,
                "explanation": "Clear communication protects the guest.",
            },
        ],
    },
]


class CourseCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    level: str = Field(default="core", min_length=1, max_length=30)
    duration_minutes: int = Field(default=15, ge=1, le=600)
    pass_score: int = Field(default=80, ge=0, le=100)
    quiz: Optional[list] = None
    content: Optional[list] = None
    key: Optional[str] = Field(default=None, max_length=80)


class CourseUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = None
    level: Optional[str] = Field(default=None, min_length=1, max_length=30)
    duration_minutes: Optional[int] = Field(default=None, ge=1, le=600)
    pass_score: Optional[int] = Field(default=None, ge=0, le=100)
    quiz: Optional[list] = None
    content: Optional[list] = None
    active: Optional[bool] = None


class TrainingRecordCreate(BaseModel):
    course_id: int
    employee_id: Optional[int] = None
    staff_name: Optional[str] = Field(default=None, max_length=160)
    due_on: Optional[date] = None


class TrainingRecordComplete(BaseModel):
    answers: Optional[list[int | str]] = None
    score: Optional[float] = None


class GoalCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    department_key: str = Field(
        default="executive", min_length=1, max_length=60
    )
    description: Optional[str] = Field(default=None, max_length=1000)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    metric: str = Field(default="revenue", min_length=1, max_length=120)
    target_value: float = Field(gt=0)
    current_value: float = Field(default=0, ge=0)
    unit: str = Field(default="₹", min_length=1, max_length=30)
    period: str = Field(default="monthly", min_length=1, max_length=30)
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class GoalUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=200)
    department_key: Optional[str] = Field(
        default=None, min_length=1, max_length=60
    )
    description: Optional[str] = Field(default=None, max_length=1000)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    metric: Optional[str] = Field(default=None, min_length=1, max_length=120)
    target_value: Optional[float] = Field(default=None, gt=0)
    current_value: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, min_length=1, max_length=30)
    period: Optional[str] = Field(default=None, min_length=1, max_length=30)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = Field(default=None, max_length=30)


class FranchiseSiteCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    city: str = Field(min_length=2, max_length=120)
    state: Optional[str] = Field(default=None, max_length=120)
    contact_name: Optional[str] = Field(default=None, max_length=160)
    contact_phone: Optional[str] = Field(default=None, max_length=30)
    contact_email: Optional[str] = Field(default=None, max_length=200)
    stage: str = Field(default="lead", min_length=1, max_length=40)
    expected_investment: float = Field(default=0, ge=0)
    probability: int = Field(default=20, ge=0, le=100)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    next_step: Optional[str] = Field(default=None, max_length=300)
    next_action_on: Optional[date] = None
    notes: Optional[str] = None


class FranchiseSiteUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    city: Optional[str] = Field(default=None, min_length=2, max_length=120)
    state: Optional[str] = Field(default=None, max_length=120)
    contact_name: Optional[str] = Field(default=None, max_length=160)
    contact_phone: Optional[str] = Field(default=None, max_length=30)
    contact_email: Optional[str] = Field(default=None, max_length=200)
    stage: Optional[str] = Field(default=None, min_length=1, max_length=40)
    expected_investment: Optional[float] = Field(default=None, ge=0)
    probability: Optional[int] = Field(default=None, ge=0, le=100)
    owner_staff_id: Optional[str] = Field(default=None, max_length=120)
    next_step: Optional[str] = Field(default=None, max_length=300)
    next_action_on: Optional[date] = None
    notes: Optional[str] = None


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _round1(value) -> float:
    return round(float(value or 0), 1)


def _round2(value) -> float:
    return round(float(value or 0), 2)


def _normalize_quiz(raw) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Quiz must be a list.")
    normalized: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise HTTPException(
                status_code=422,
                detail="Each quiz question must be an object.",
            )
        prompt = str(entry.get("prompt") or "").strip()
        if not prompt:
            raise HTTPException(
                status_code=422, detail="Each quiz question needs a prompt."
            )
        options = entry.get("options")
        if not isinstance(options, list) or len(options) < 2:
            raise HTTPException(
                status_code=422,
                detail="Each quiz question needs at least two options.",
            )
        cleaned_options = [str(option).strip() for option in options]
        if any(not option for option in cleaned_options):
            raise HTTPException(
                status_code=422, detail="Quiz options cannot be empty."
            )
        try:
            correct_index = int(entry.get("correct_index"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=422,
                detail="Each quiz question needs a numeric correct_index.",
            ) from exc
        if correct_index < 0 or correct_index >= len(cleaned_options):
            raise HTTPException(
                status_code=422,
                detail="correct_index is outside the option list.",
            )
        question = {
            "prompt": prompt,
            "options": cleaned_options,
            "correct_index": correct_index,
        }
        explanation = entry.get("explanation")
        if explanation is not None and str(explanation).strip():
            question["explanation"] = str(explanation).strip()
        normalized.append(question)
    return normalized


def _normalize_content(raw) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Content must be a list.")
    normalized: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise HTTPException(
                status_code=422,
                detail="Each content section must be an object.",
            )
        title = str(entry.get("title") or "").strip()
        body = str(entry.get("body") or "").strip()
        if not title:
            raise HTTPException(
                status_code=422, detail="Each content section needs a title."
            )
        if not body:
            raise HTTPException(
                status_code=422, detail="Each content section needs a body."
            )
        normalized.append({"title": title, "body": body})
    return normalized


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    return slug.strip("-")[:80] or "course"


def _unique_course_key(db: Session, base: str) -> str:
    key = base
    counter = 2
    while db.query(TrainingCourse.id).filter(TrainingCourse.key == key).first():
        suffix = f"-{counter}"
        key = f"{base[: 80 - len(suffix)]}{suffix}"
        counter += 1
    return key


def _seed_courses(db: Session) -> None:
    if db.query(TrainingCourse).count() > 0:
        return
    for spec in DEFAULT_COURSES:
        db.add(
            TrainingCourse(
                key=spec["key"],
                title=spec["title"],
                description=spec["description"],
                department_key="training",
                level=spec["level"],
                duration_minutes=spec["duration_minutes"],
                pass_score=spec["pass_score"],
                quiz=[dict(question) for question in spec["quiz"]],
                content=[dict(section) for section in spec["content"]],
                active=True,
            )
        )
    db.commit()


def _course_dict(course: TrainingCourse) -> dict:
    quiz = course.quiz if isinstance(course.quiz, list) else []
    content = course.content if isinstance(course.content, list) else []
    return {
        "id": course.id,
        "key": course.key,
        "title": course.title,
        "description": course.description,
        "level": course.level,
        "duration_minutes": int(course.duration_minutes or 0),
        "pass_score": int(course.pass_score or 0),
        "quiz_count": len(quiz),
        "content_count": len(content),
        "active": bool(course.active),
        "quiz": quiz,
        "content": content,
    }


def _record_dict(record: TrainingRecord, today: date) -> dict:
    course = record.course
    score = _round1(record.score) if record.score is not None else None
    pass_score = int(course.pass_score or 0) if course is not None else 0
    passed = bool(score is not None and score >= pass_score)
    overdue = (
        record.due_on is not None
        and record.due_on < today
        and record.status not in {"completed", "cancelled"}
    )
    return {
        "id": record.id,
        "course_id": record.course_id,
        "course_title": course.title if course is not None else None,
        "employee_id": record.employee_id,
        "staff_name": record.staff_name,
        "status": record.status,
        "score": score,
        "passed": passed,
        "due_on": _iso(record.due_on),
        "overdue": bool(overdue),
        "assigned_at": _iso(record.assigned_at),
        "completed_at": _iso(record.completed_at),
        "notes": record.notes,
    }


@router.get("/training")
def training_home(
    db: Session = Depends(get_db),
    session: dict = Depends(TRAINING_DEPENDENCY),
):
    del session
    _seed_courses(db)
    today = business_today()
    courses = db.query(TrainingCourse).order_by(TrainingCourse.id.asc()).all()
    records = (
        db.query(TrainingRecord).order_by(TrainingRecord.id.desc()).all()
    )
    course_rows = [_course_dict(course) for course in courses]
    record_rows = [_record_dict(record, today) for record in records]
    completed_scores = [
        row["score"]
        for row in record_rows
        if row["status"] == "completed" and row["score"] is not None
    ]
    summary = {
        "courses": len(course_rows),
        "active_records": sum(
            1 for row in record_rows if row["status"] in ACTIVE_RECORD_STATUSES
        ),
        "completed_records": sum(
            1 for row in record_rows if row["status"] == "completed"
        ),
        "overdue_records": sum(1 for row in record_rows if row["overdue"]),
        "average_score": (
            _round1(sum(completed_scores) / len(completed_scores))
            if completed_scores
            else None
        ),
    }
    return {
        "courses": course_rows,
        "records": record_rows,
        "summary": summary,
    }


@router.post("/training/courses")
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(TRAINING_DEPENDENCY),
):
    del session
    title = payload.title.strip()
    if len(title) < 2:
        raise HTTPException(status_code=422, detail="Course title is too short.")
    supplied_key = (payload.key or "").strip()
    if supplied_key:
        key = _slugify(supplied_key)
        if db.query(TrainingCourse.id).filter(TrainingCourse.key == key).first():
            raise HTTPException(
                status_code=422, detail="A course with that key already exists."
            )
    else:
        key = _unique_course_key(db, _slugify(title))
    course = TrainingCourse(
        key=key,
        title=title,
        description=(payload.description or "").strip() or None,
        department_key="training",
        level=payload.level.strip() or "core",
        duration_minutes=payload.duration_minutes,
        pass_score=payload.pass_score,
        quiz=_normalize_quiz(payload.quiz),
        content=_normalize_content(payload.content),
        active=True,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return _course_dict(course)


@router.patch("/training/courses/{course_id}")
def update_course(
    course_id: int,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(TRAINING_DEPENDENCY),
):
    del session
    course = db.query(TrainingCourse).filter(TrainingCourse.id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found.")
    if payload.title is not None:
        title = payload.title.strip()
        if len(title) < 2:
            raise HTTPException(status_code=422, detail="Course title is too short.")
        course.title = title
    if payload.description is not None:
        course.description = payload.description.strip() or None
    if payload.level is not None:
        course.level = payload.level.strip() or course.level
    if payload.duration_minutes is not None:
        course.duration_minutes = payload.duration_minutes
    if payload.pass_score is not None:
        course.pass_score = payload.pass_score
    if payload.quiz is not None:
        course.quiz = _normalize_quiz(payload.quiz)
    if payload.content is not None:
        course.content = _normalize_content(payload.content)
    if payload.active is not None:
        course.active = bool(payload.active)
    db.commit()
    db.refresh(course)
    return _course_dict(course)


@router.post("/training/records")
def create_training_record(
    payload: TrainingRecordCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(TRAINING_DEPENDENCY),
):
    del session
    course = db.query(TrainingCourse).filter(
        TrainingCourse.id == payload.course_id
    ).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found.")
    employee = None
    if payload.employee_id is not None:
        employee = db.query(HREmployee).filter(
            HREmployee.id == payload.employee_id
        ).first()
        if employee is None:
            raise HTTPException(status_code=404, detail="Employee not found.")
        staff_name = str(employee.full_name or "").strip()
    else:
        staff_name = str(payload.staff_name or "").strip()
        if len(staff_name) < 2:
            raise HTTPException(
                status_code=422,
                detail="Provide an employee or a staff name of at least 2 characters.",
            )
    existing = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.course_id == course.id,
            func.lower(TrainingRecord.staff_name) == staff_name.lower(),
            TrainingRecord.status.in_(list(ACTIVE_RECORD_STATUSES)),
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=422,
            detail="This staff member already has an active assignment for the course.",
        )
    record = TrainingRecord(
        course_id=course.id,
        employee_id=employee.id if employee is not None else None,
        staff_name=staff_name,
        status="assigned",
        answers=[],
        assigned_at=datetime.utcnow(),
        due_on=payload.due_on,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _record_dict(record, business_today())


@router.post("/training/records/{record_id}/complete")
def complete_training_record(
    record_id: int,
    payload: TrainingRecordComplete,
    db: Session = Depends(get_db),
    session: dict = Depends(TRAINING_DEPENDENCY),
):
    del session
    record = db.query(TrainingRecord).filter(
        TrainingRecord.id == record_id
    ).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Training record not found.")
    course = record.course
    if course is None:
        course = db.query(TrainingCourse).filter(
            TrainingCourse.id == record.course_id
        ).first()
    quiz = course.quiz if course is not None and isinstance(course.quiz, list) else []

    if payload.answers is not None and payload.answers and quiz:
        correct = 0
        for index, question in enumerate(quiz):
            if not isinstance(question, dict):
                continue
            if index >= len(payload.answers):
                continue
            if str(payload.answers[index]) == str(question.get("correct_index")):
                correct += 1
        score = _round1(correct / len(quiz) * 100)
        answers = payload.answers
    else:
        if payload.score is None:
            raise HTTPException(
                status_code=422,
                detail="Provide quiz answers or a score.",
            )
        score = float(payload.score)
        if score < 0 or score > 100:
            raise HTTPException(
                status_code=422, detail="Score must be between 0 and 100."
            )
        answers = payload.answers if payload.answers is not None else []

    record.status = "completed"
    record.score = score
    record.answers = answers
    record.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    pass_score = int(course.pass_score or 0) if course is not None else 0
    passed = score >= pass_score
    return {
        "record": _record_dict(record, business_today()),
        "passed": passed,
    }


def _goal_dict(goal: CompanyGoal) -> dict:
    target = float(goal.target_value or 0)
    current = float(goal.current_value or 0)
    progress = (
        _round1(max(0.0, current / target * 100)) if target > 0 else 0.0
    )
    stored_status = goal.status or "active"
    if stored_status == "paused":
        effective_status = "paused"
    elif progress >= 100:
        effective_status = "achieved"
    else:
        effective_status = stored_status
    return {
        "id": goal.id,
        "title": goal.title,
        "description": goal.description,
        "department_key": goal.department_key,
        "owner_staff_id": goal.owner_staff_id,
        "metric": goal.metric,
        "target_value": _round2(target),
        "current_value": _round2(current),
        "unit": goal.unit,
        "progress_pct": progress,
        "status": effective_status,
        "stored_status": stored_status,
        "period": goal.period,
        "start_date": _iso(goal.start_date),
        "end_date": _iso(goal.end_date),
    }


@router.get("/goals")
def list_goals(
    period: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(GOAL_DEPENDENCY),
):
    del session
    query = db.query(CompanyGoal)
    if period:
        query = query.filter(CompanyGoal.period == period)
    goals = query.order_by(CompanyGoal.id.desc()).all()
    items = [_goal_dict(goal) for goal in goals]
    if status:
        items = [row for row in items if row["status"] == status]
    summary = {
        "total": len(items),
        "active": sum(1 for row in items if row["status"] == "active"),
        "achieved": sum(1 for row in items if row["status"] == "achieved"),
        "at_risk": sum(
            1
            for row in items
            if row["status"] != "achieved" and row["progress_pct"] < 40
        ),
        "total_target": _round2(sum(row["target_value"] for row in items)),
        "total_current": _round2(sum(row["current_value"] for row in items)),
    }
    return {"items": items, "summary": summary}


@router.post("/goals")
def create_goal(
    payload: GoalCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(GOAL_DEPENDENCY),
):
    del session
    if (
        payload.start_date is not None
        and payload.end_date is not None
        and payload.end_date < payload.start_date
    ):
        raise HTTPException(
            status_code=422,
            detail="End date must be on or after the start date.",
        )
    goal = CompanyGoal(
        title=payload.title.strip(),
        department_key=payload.department_key.strip() or "executive",
        description=(payload.description or "").strip() or None,
        owner_staff_id=(payload.owner_staff_id or "").strip() or None,
        metric=payload.metric.strip() or "revenue",
        target_value=payload.target_value,
        current_value=payload.current_value,
        unit=payload.unit.strip() or "₹",
        period=payload.period.strip() or "monthly",
        start_date=payload.start_date,
        end_date=payload.end_date,
        status="active",
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return _goal_dict(goal)


@router.patch("/goals/{goal_id}")
def update_goal(
    goal_id: int,
    payload: GoalUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(GOAL_DEPENDENCY),
):
    del session
    goal = db.query(CompanyGoal).filter(CompanyGoal.id == goal_id).first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found.")
    if payload.title is not None:
        title = payload.title.strip()
        if len(title) < 2:
            raise HTTPException(status_code=422, detail="Title is too short.")
        goal.title = title
    if payload.department_key is not None:
        goal.department_key = payload.department_key.strip() or goal.department_key
    if payload.description is not None:
        goal.description = payload.description.strip() or None
    if payload.owner_staff_id is not None:
        goal.owner_staff_id = payload.owner_staff_id.strip() or None
    if payload.metric is not None:
        goal.metric = payload.metric.strip() or goal.metric
    if payload.target_value is not None:
        goal.target_value = payload.target_value
    if payload.current_value is not None:
        goal.current_value = payload.current_value
    if payload.unit is not None:
        goal.unit = payload.unit.strip() or goal.unit
    if payload.period is not None:
        goal.period = payload.period.strip() or goal.period
    if payload.start_date is not None:
        goal.start_date = payload.start_date
    if payload.end_date is not None:
        goal.end_date = payload.end_date
    if payload.status is not None:
        goal.status = payload.status.strip() or goal.status
    if (
        goal.start_date is not None
        and goal.end_date is not None
        and goal.end_date < goal.start_date
    ):
        raise HTTPException(
            status_code=422,
            detail="End date must be on or after the start date.",
        )
    db.commit()
    db.refresh(goal)
    return _goal_dict(goal)


def _franchise_dict(site: FranchiseSite, today: date) -> dict:
    investment = _round2(site.expected_investment)
    probability = int(site.probability or 0)
    next_action_due = (
        site.next_action_on is not None
        and site.next_action_on <= today + timedelta(days=7)
    )
    return {
        "id": site.id,
        "name": site.name,
        "city": site.city,
        "state": site.state,
        "contact_name": site.contact_name,
        "contact_phone": site.contact_phone,
        "contact_email": site.contact_email,
        "stage": site.stage,
        "expected_investment": investment,
        "probability": probability,
        "weighted_value": _round2(investment * probability / 100),
        "owner_staff_id": site.owner_staff_id,
        "next_step": site.next_step,
        "next_action_on": _iso(site.next_action_on),
        "next_action_due": bool(next_action_due),
        "notes": site.notes,
        "created_at": _iso(site.created_at),
        "updated_at": _iso(site.updated_at),
    }


def _franchise_summary(items: list[dict]) -> dict:
    open_sites = [row for row in items if row["stage"] != "lost"]
    won = sum(1 for row in items if row["stage"] == "open")
    lost = sum(1 for row in items if row["stage"] == "lost")
    closed = won + lost
    return {
        "total": len(items),
        "open_sites": len(open_sites),
        "pipeline_value": _round2(
            sum(row["expected_investment"] for row in open_sites)
        ),
        "weighted_value": _round2(
            sum(row["weighted_value"] for row in open_sites)
        ),
        "open_count": won,
        "won": won,
        "conversion_rate": _round1(won / closed * 100) if closed else 0.0,
        "next_actions_due": sum(
            1 for row in items if row["next_action_due"]
        ),
    }


@router.get("/franchise")
def list_franchise_sites(
    stage: Optional[str] = None,
    db: Session = Depends(get_db),
    session: dict = Depends(FRANCHISE_DEPENDENCY),
):
    del session
    today = business_today()
    query = db.query(FranchiseSite)
    if stage:
        query = query.filter(FranchiseSite.stage == stage)
    sites = query.order_by(FranchiseSite.id.desc()).all()
    items = [_franchise_dict(site, today) for site in sites]
    return {"items": items, "summary": _franchise_summary(items)}


@router.post("/franchise/sites")
def create_franchise_site(
    payload: FranchiseSiteCreate,
    db: Session = Depends(get_db),
    session: dict = Depends(FRANCHISE_DEPENDENCY),
):
    del session
    stage = payload.stage.strip().lower()
    if stage not in FRANCHISE_STAGES:
        raise HTTPException(
            status_code=422,
            detail=(
                "Stage must be lead, qualified, site_visit, negotiation, "
                "agreement, construction, open or lost."
            ),
        )
    site = FranchiseSite(
        name=payload.name.strip(),
        city=payload.city.strip(),
        state=(payload.state or "").strip() or None,
        contact_name=(payload.contact_name or "").strip() or None,
        contact_phone=(payload.contact_phone or "").strip() or None,
        contact_email=(payload.contact_email or "").strip() or None,
        stage=stage,
        expected_investment=payload.expected_investment,
        probability=payload.probability,
        owner_staff_id=(payload.owner_staff_id or "").strip() or None,
        next_step=(payload.next_step or "").strip() or None,
        next_action_on=payload.next_action_on,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return _franchise_dict(site, business_today())


@router.patch("/franchise/sites/{site_id}")
def update_franchise_site(
    site_id: int,
    payload: FranchiseSiteUpdate,
    db: Session = Depends(get_db),
    session: dict = Depends(FRANCHISE_DEPENDENCY),
):
    del session
    site = db.query(FranchiseSite).filter(FranchiseSite.id == site_id).first()
    if site is None:
        raise HTTPException(status_code=404, detail="Franchise site not found.")
    if payload.stage is not None:
        stage = payload.stage.strip().lower()
        if stage not in FRANCHISE_STAGES:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Stage must be lead, qualified, site_visit, negotiation, "
                    "agreement, construction, open or lost."
                ),
            )
        site.stage = stage
    if payload.name is not None:
        name = payload.name.strip()
        if len(name) < 2:
            raise HTTPException(status_code=422, detail="Name is too short.")
        site.name = name
    if payload.city is not None:
        city = payload.city.strip()
        if len(city) < 2:
            raise HTTPException(status_code=422, detail="City is too short.")
        site.city = city
    if payload.state is not None:
        site.state = payload.state.strip() or None
    if payload.contact_name is not None:
        site.contact_name = payload.contact_name.strip() or None
    if payload.contact_phone is not None:
        site.contact_phone = payload.contact_phone.strip() or None
    if payload.contact_email is not None:
        site.contact_email = payload.contact_email.strip() or None
    if payload.expected_investment is not None:
        site.expected_investment = payload.expected_investment
    if payload.probability is not None:
        site.probability = payload.probability
    if payload.owner_staff_id is not None:
        site.owner_staff_id = payload.owner_staff_id.strip() or None
    if payload.next_step is not None:
        site.next_step = payload.next_step.strip() or None
    if payload.next_action_on is not None:
        site.next_action_on = payload.next_action_on
    if payload.notes is not None:
        site.notes = payload.notes.strip() or None
    db.commit()
    db.refresh(site)
    return _franchise_dict(site, business_today())
