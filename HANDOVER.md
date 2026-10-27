# Pizza Blitz — Handover & Freeze

**Status:** feature work frozen for delivery.
**Date:** 2026-10-27
**Final code commit:** `4cbd122` — *Add pad/crop merge framing and retry failed pager resolves*
**Handover:** this document (committed with the freeze).
**Verification:** 276 backend tests, 168 browser proofs + portal smoke, full audit green.

This is the document to read first. It explains what exists, how to run it, what is
verified, what is honestly not finished, and where a future project should start.

---

## 1. What this is

Pizza Blitz is a working restaurant platform with three connected surfaces:

1. **Customer website** — landing page, menu, cart, pickup/delivery checkout, payments,
   order tracking, loyalty, addresses, feedback.
2. **Staff/owner portal** — POS, kitchen display, delivery dispatch, inventory, purchasing,
   recipes, workforce, finance, marketing, support, HR, media, reports.
3. **HR department end to end** — recruitment → resumes/scorecards → offer templates and
   approvals → offer letters/e-signature → onboarding → attendance/leave → payroll preview
   → documents → exits → department-scoped permissions → HR analytics.

The original HR objective is complete. Later rounds added supporting platform depth. The
platform is **not deployed to a live production environment** and **does not fake third-party
integrations**; provider-backed features stay gated until real credentials are supplied.

---

## 2. Start here — 15-minute orientation

Read in this order:

1. `HANDOVER.md` (this file)
2. `CURRENT_STATUS.md` — plain-language state of each module
3. `DELIVERY_REPORT.md` — what was delivered and how it was verified
4. `docs/FEATURE_MATRIX.md` — complete feature inventory and gaps
5. `docs/GAP_AUDIT.md` — numbered gap history with what remains
6. `docs/VERIFICATION.md` — every gate and proof
7. `ACCESS.md` — logins and role entry points

Do not start by reading 435 endpoints. Start with the modules you care about in
`CURRENT_STATUS.md`, then open the matching page in the portal and the proof script in
`frontend/e2e/`.

---

## 3. Run it locally

Prerequisites: Python 3.11+, Node 20+, npm, ffmpeg/ffprobe on `PATH` for video features.

### Backend

```powershell
cd backend
python -m pip install -r requirements.txt
$env:SQLALCHEMY_DATABASE_URI = "sqlite:///./pizza_blitz.db"
$env:PIZZA_BLITZ_ADMIN_ID = "admin"
$env:PIZZA_BLITZ_ADMIN_PASSWORD = "admin123"
$env:PIZZA_BLITZ_STAFF_ID = "staff"
$env:PIZZA_BLITZ_STAFF_PASSWORD = "staff123"
$env:BACKEND_CORS_ORIGINS = "http://localhost:3011,http://127.0.0.1:3011"
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

On startup the backend creates missing tables, seeds baseline data (tables, menu, vendors,
delivery zones, store, departments, leave types) and starts the in-process scheduler.
`PIZZA_BLITZ_BOOTSTRAP_ON_STARTUP=false` disables that; `PIZZA_BLITZ_SCHEDULER_ENABLED=false`
disables background jobs.

### Frontend

```powershell
cd frontend
npm install
npm run build
npm start -- -H 127.0.0.1 -p 3011
```

For development instead of a production build:

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3011
```

### URLs and access

| Item | Value |
|---|---|
| Portal | `http://localhost:3011` |
| Admin login | `http://localhost:3011/login` |
| API docs | `http://localhost:8010/docs` |
| Master admin | `admin` / `admin123` |
| Counter staff | `staff` / `staff123` |
| Customer | phone + OTP, or recent order lookup |

Development defaults are rejected in production unless explicitly configured.

### Prove it works

```powershell
cd backend
python -W error::FutureWarning -m unittest discover -s tests -v   # 276 tests

cd ..\frontend
npm run lint
npm run typecheck
npm run build
$env:E2E_BASE_URL = "http://localhost:3011"
$env:E2E_API_URL = "http://localhost:8010"
$env:E2E_ADMIN_ID = "admin"
$env:E2E_ADMIN_PASSWORD = "admin123"
npm run test:e2e
npm run verify:audit
```

The audit requires a **fresh backend** before each run because the aggregator proof fixture
is not fully idempotent. Restart the backend, then run `verify:audit`.

---

## 4. Current verified inventory

| Measure | Value |
|---|---|
| API endpoints | 435 |
| Frontend routes | 73 (57 portal, 1 KDS, 15 public) |
| Database tables | 96 |
| Backend tests | 276 |
| Browser proofs | 168 + portal smoke |
| Full audit | green (`AUDIT=0`, `SMOKE=0`) |
| Production build | green, including API-offline build |
| Migrations | fresh upgrade + `alembic check` clean |
| Last verified commit | `4cbd122` |

The audit exercises every major module, including HR leave/attendance/payroll/onboarding/
documents/exits/permissions/analytics, recruitment, offer letters, support, journeys, media,
accounting, aggregators, deployment readiness and the full order-to-KDS path.

---

## 5. Architecture

```text
frontend/  Next.js 14 App Router, React 18, TypeScript strict, Tailwind
backend/   FastAPI + SQLAlchemy 2 + Alembic, SQLite for local, Postgres for production
docs/      feature inventory, gap audit, verification, operations
```

- JWT admin/staff sessions plus portal HMAC cookie sessions.
- APScheduler runs in-process: SLA alerts, retries, journey sends, social publish,
  offer reminders, backups.
- Media is local by default (`backend/media`, `backend/private_media`), with optional
  S3-compatible storage and CDN URLs.
- Provider credentials are encrypted with Fernet derived from `AUTH_SECRET_KEY`, with
  per-field environment fallback.
- `frontend/next.config` proxies `/server` and `/media` to the API.

---

## 6. External integrations — real vs gated

These are **not faked**. They work when configured and stay visibly gated when not.

| Area | Local behavior | Needs real configuration |
|---|---|---|
| Payments | Cash/manual proof and test provider flows | Razorpay/Stripe live keys, webhook secrets |
| WhatsApp/email/SMS | Console/test dispatch where enabled | Meta WhatsApp, Resend, SMS provider credentials |
| S3/CDN media | Local disk fallback | Bucket, keys, CDN base URL |
| PagerDuty | Webhook trigger/resolve with retries | PagerDuty routing key and service |
| Aggregators | Intake simulator and outbound status | Real Swiggy/Zomato credentials/endpoints |
| Maps/GPS | Stored rider coordinates and tracking UI | Maps key for live map tiles/geocoding |
| Auth | Local admin/staff accounts | SSO/identity provider if required |
| Deployment | Local production build | Postgres, host, TLS, backups, worker topology |

`docs/VERIFICATION.md` marks provider-gated proofs. The audit reports five live-provider/
environment gates remaining; that is intentional and honest.

---

## 7. Known limitations (frozen as-is)

### Media
- Captions are local-file only; S3 captions are skipped for re-timing/merge.
- One caption track per asset; no multi-language tracks or styling/positioning.
- Merge captions use rounded clip durations; long chains can drift slightly.
- Crossfade supports 2–10 clips but one shared fade duration; no per-boundary control,
  wipes or custom curves.
- Mixed resolution uses pad or crop to the largest even canvas; frame rate is fixed at 30fps.
- Audio presence must match across clips; silent clips are not injected.
- No burned-in captions, no transition preview.

### Support/paging
- Pager is a PagerDuty-compatible webhook only; no acknowledgement sync or on-call schedules.
- Resolve failures are retried, but only while the backend scheduler runs.
- Business-hour SLA calendars and a knowledge base are not built.

### Marketing
- Journey suppression requires a matched customer; phone-only manual enrollments bypass it.
- Suppression is permanent once recorded; no automatic retry after the window.
- No global per-customer cap across every channel/campaign.
- Link-level analytics and view/video engagement are not built.
- Journey branch canvas is form-based, not a visual drag-and-drop editor.

### Platform/operations
- The in-process scheduler assumes a single backend worker. Multiple workers require an
  external scheduler or leader election.
- Local SQLite is for evaluation; production should use Postgres and run Alembic.
- No live deployment, TLS, WAF, managed backups or on-call runbook has been provisioned.
- Rate limiting is in-process; horizontal scaling needs a shared limiter.
- Some provider flows are proven with mocks/simulators, not live accounts.

### HR
- Payroll is a preview/calculation flow, not a statutory filing or bank-disbursement engine.
- E-signature is an in-app typed signature flow, not a certified e-sign vendor.
- Biometric attendance hardware is not integrated; attendance is manual/import-based.

---

## 8. What is intentionally not done

Feature work stopped here by decision. The following are future phases, not defects:

1. Live production deployment and provider onboarding.
2. Pager acknowledgement/two-way sync.
3. Multi-language caption tracks and caption styling.
4. Link-level analytics and video-view engagement.
5. Global cross-channel frequency caps.
6. Visual journey branch canvas.
7. Certified e-signature and statutory payroll integrations.
8. Horizontal scheduler/worker topology.

---

## 9. Where a future project should start

If this becomes a new project, do **not** restart from a blank page.

**Recommended first week:**

1. Run the backend, frontend, 276 tests and full audit. Confirm all green.
2. Pick one production target: local staging with Postgres, or a real host.
3. Configure the smallest provider set that matters (payments + messaging + storage).
4. Run the provider-gated proofs with real credentials.
5. Fix deployment topology: Postgres, Alembic, single scheduler or external worker,
   TLS, backups, secrets, monitoring.
6. Only then pick feature work from Section 8.

**Files to open first:**

- `backend/app/main.py` — app wiring, bootstrap, scheduler toggle
- `backend/app/core/config.py` — every environment variable
- `backend/app/models/domain.py` — 96-table domain model
- `backend/app/api/api_v1/router.py` — endpoint map
- `frontend/src/app/(dashboard)/layout.tsx` — portal shell/navigation
- `frontend/e2e/verify-audit.cjs` — audit orchestration
- `docs/VERIFICATION.md` — what each gate proves

**Definition of done for the next phase:** a real deployment URL, real provider credentials
exercised end to end, Postgres migrations applied, backups/restore rehearsed, and the audit
run against that deployment — not another feature count.

---

## 10. Operational cautions

- Back up `backend/media`, `backend/private_media`, the database and `AUTH_SECRET_KEY`.
  Losing `AUTH_SECRET_KEY` makes stored provider credentials unreadable.
- Do not run multiple scheduler-enabled workers without a shared job lock.
- Keep `RATE_LIMIT_ENABLED=true` outside proof runs.
- Do not use `admin/admin123` in production; production secret guards reject defaults.
- Restart the backend before `verify:audit`; the aggregator fixture is not idempotent.
- `backend/media/` and `backend/private_media/` are gitignored; they are runtime data.

---

## 11. Freeze declaration

- Feature work: **frozen**.
- Code state: committed on `main`, working tree clean at handover.
- Verification: **276 tests, 168 proofs, audit green, build green**.
- Goal: closed as delivered for local/staging evaluation with the limitations above.

If work resumes, treat this document and the green audit as the baseline. Do not reopen
closed gaps without a concrete production requirement.
