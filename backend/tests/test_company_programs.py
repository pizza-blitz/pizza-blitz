"""Programs workspace: training, goals and franchise pipeline."""

import os
import unittest
from datetime import timedelta

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

from fastapi.testclient import TestClient

from app.core.clock import business_today
from app.core.config import settings
from app.db.session import SessionLocal
from app.main import app
from app.models.domain import CompanyGoal, FranchiseSite, TrainingRecord

BASE = "/api/v1/restaurant/company/programs"


class CompanyProgramsApiTest(unittest.TestCase):
    def setUp(self):
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        login = self.client.post(
            "/api/v1/auth/admin/login",
            json={
                "id": settings.PIZZA_BLITZ_ADMIN_ID,
                "password": settings.PIZZA_BLITZ_ADMIN_PASSWORD,
            },
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.headers = {
            "Authorization": f"Bearer {login.json()['access_token']}"
        }
        self.today = business_today()
        self.record_ids: list[int] = []
        self.goal_ids: list[int] = []
        self.site_ids: list[int] = []

    def tearDown(self):
        db = SessionLocal()
        try:
            if self.record_ids:
                db.query(TrainingRecord).filter(
                    TrainingRecord.id.in_(self.record_ids)
                ).delete(synchronize_session=False)
            if self.goal_ids:
                db.query(CompanyGoal).filter(
                    CompanyGoal.id.in_(self.goal_ids)
                ).delete(synchronize_session=False)
            if self.site_ids:
                db.query(FranchiseSite).filter(
                    FranchiseSite.id.in_(self.site_ids)
                ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
            self._ctx.__exit__(None, None, None)

    def _training(self) -> dict:
        response = self.client.get(f"{BASE}/training", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_training_courses_are_seeded_once(self):
        first = self._training()
        courses = first["courses"]
        keys = {course["key"] for course in courses}
        self.assertTrue(
            {"pizza-standards", "food-safety-basics", "allergen-awareness"}
            .issubset(keys)
        )
        self.assertEqual(first["summary"]["courses"], len(courses))
        for course in courses:
            self.assertEqual(course["quiz_count"], 3)
            self.assertEqual(course["content_count"], 3)
            self.assertTrue(course["active"])

        second = self._training()
        self.assertEqual(len(second["courses"]), len(courses))

    def test_training_completion_and_duplicate_assignment(self):
        training = self._training()
        course = next(
            row
            for row in training["courses"]
            if row["key"] == "food-safety-basics"
        )
        quiz = course["quiz"]

        created = self.client.post(
            f"{BASE}/training/records",
            json={
                "course_id": course["id"],
                "staff_name": "Asha Rao",
                "due_on": (self.today + timedelta(days=7)).isoformat(),
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        record = created.json()
        self.record_ids.append(record["id"])
        self.assertEqual(record["status"], "assigned")
        self.assertEqual(record["course_title"], "Food safety basics")
        self.assertFalse(record["overdue"])

        duplicate = self.client.post(
            f"{BASE}/training/records",
            json={
                "course_id": course["id"],
                "staff_name": "Asha Rao",
            },
            headers=self.headers,
        )
        self.assertEqual(duplicate.status_code, 422, duplicate.text)

        answers = [question["correct_index"] for question in quiz]
        completed = self.client.post(
            f"{BASE}/training/records/{record['id']}/complete",
            json={"answers": answers},
            headers=self.headers,
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        result = completed.json()
        self.assertTrue(result["passed"])
        self.assertEqual(result["record"]["score"], 100.0)
        self.assertEqual(result["record"]["status"], "completed")
        self.assertIsNotNone(result["record"]["completed_at"])

        created = self.client.post(
            f"{BASE}/training/records",
            json={
                "course_id": course["id"],
                "staff_name": "Ravi Kumar",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        wrong_record = created.json()
        self.record_ids.append(wrong_record["id"])
        wrong_answers = [
            (question["correct_index"] + 1) % len(question["options"])
            for question in quiz
        ]
        failed = self.client.post(
            f"{BASE}/training/records/{wrong_record['id']}/complete",
            json={"answers": wrong_answers},
            headers=self.headers,
        )
        self.assertEqual(failed.status_code, 200, failed.text)
        self.assertFalse(failed.json()["passed"])
        self.assertEqual(failed.json()["record"]["score"], 0.0)
        self.assertLess(
            failed.json()["record"]["score"], course["pass_score"]
        )

    def test_goals_progress_and_achieved_status(self):
        created = self.client.post(
            f"{BASE}/goals",
            json={
                "title": "Grow catering revenue",
                "target_value": 100,
                "current_value": 50,
                "period": "monthly",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        goal = created.json()
        self.goal_ids.append(goal["id"])
        self.assertEqual(goal["progress_pct"], 50.0)
        self.assertEqual(goal["status"], "active")
        self.assertEqual(goal["stored_status"], "active")
        self.assertEqual(goal["unit"], "₹")

        listed = self.client.get(
            f"{BASE}/goals?period=monthly", headers=self.headers
        )
        self.assertEqual(listed.status_code, 200, listed.text)
        payload = listed.json()
        self.assertIn(goal["id"], {row["id"] for row in payload["items"]})
        self.assertGreaterEqual(payload["summary"]["total_target"], 100)
        self.assertGreaterEqual(payload["summary"]["total_current"], 50)

        updated = self.client.patch(
            f"{BASE}/goals/{goal['id']}",
            json={"current_value": 120},
            headers=self.headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        result = updated.json()
        self.assertEqual(result["progress_pct"], 120.0)
        self.assertEqual(result["status"], "achieved")
        self.assertEqual(result["stored_status"], "active")

        achieved = self.client.get(
            f"{BASE}/goals?status=achieved", headers=self.headers
        )
        self.assertEqual(achieved.status_code, 200, achieved.text)
        self.assertIn(
            goal["id"], {row["id"] for row in achieved.json()["items"]}
        )

    def test_franchise_weighted_pipeline_and_conversion(self):
        created = self.client.post(
            f"{BASE}/franchise/sites",
            json={
                "name": "Koregaon Park site",
                "city": "Pune",
                "expected_investment": 1000000,
                "probability": 50,
                "next_step": "Share fit-out plan",
                "next_action_on": (
                    self.today + timedelta(days=3)
                ).isoformat(),
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        site = created.json()
        self.site_ids.append(site["id"])
        self.assertEqual(site["stage"], "lead")
        self.assertEqual(site["weighted_value"], 500000.0)
        self.assertTrue(site["next_action_due"])

        lost = self.client.post(
            f"{BASE}/franchise/sites",
            json={
                "name": "Viman Nagar site",
                "city": "Pune",
                "expected_investment": 200000,
                "probability": 40,
                "stage": "lost",
            },
            headers=self.headers,
        )
        self.assertEqual(lost.status_code, 200, lost.text)
        self.site_ids.append(lost.json()["id"])

        listed = self.client.get(f"{BASE}/franchise", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        summary = listed.json()["summary"]
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["open_sites"], 1)
        self.assertEqual(summary["pipeline_value"], 1000000.0)
        self.assertEqual(summary["weighted_value"], 500000.0)
        self.assertEqual(summary["open_count"], 0)
        self.assertEqual(summary["won"], 0)
        self.assertEqual(summary["conversion_rate"], 0.0)
        self.assertEqual(summary["next_actions_due"], 1)

        opened = self.client.patch(
            f"{BASE}/franchise/sites/{site['id']}",
            json={"stage": "open"},
            headers=self.headers,
        )
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.json()["stage"], "open")

        listed = self.client.get(f"{BASE}/franchise", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text)
        summary = listed.json()["summary"]
        self.assertEqual(summary["open_count"], 1)
        self.assertEqual(summary["won"], 1)
        self.assertEqual(summary["open_sites"], 1)
        self.assertEqual(summary["conversion_rate"], 50.0)
        self.assertEqual(summary["weighted_value"], 500000.0)


if __name__ == "__main__":
    unittest.main()
