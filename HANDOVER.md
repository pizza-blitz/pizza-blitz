# Pizza Blitz — Handover & Freeze

**Status:** feature work frozen for delivery; the Company OS and conversion program is
complete in the working tree.
**Date:** 2026-10-28
**Last code commit:** `d6e921e` — *Freeze feature work and add delivery handover*
**Uncommitted work:** the Company OS, conversion and AI-concierge program described in
[ROADMAP.md](ROADMAP.md) Phase 10 (no commit was made).
**Handover:** this document.
**Verification:** 364 backend tests (87 subtests), 176 browser proofs + portal smoke,
OpenAPI 428 paths / 510 operations, migration `9f8e7d6c5b4a`, production build green.

This is the document to read first. It explains what exists, how to run it, what is
verified, what is honestly not finished, and where a future project should start.

---

## 1. What this is

Pizza Blitz is a working restaurant platform with four connected surfaces:

1. **Customer website** — conversion-first landing page, menu, cart, pickup/delivery
   checkout, gift-card and coupon support, confirmation, tracking with a live Leaflet
   rider map, loyalty, addresses, feedback, plus Blaze, a 3D talking ordering concierge
   that remembers a verified guest's allergies and dietary preferences.
2. **Staff/owner portal** — POS, kitchen display, delivery dispatch, inventory, purchasing,
   recipes, workforce, finance, marketing, support, HR, media and reports.
3. **Company OS** — 16 department specs (10 departments + Company shared services + five
   sub-departments), 70 catalogued modules, department workspaces, a shared work/approval
   inbox, and 11 new operating tools (checklists, assets, menu engineering, stocktake,
   quality audits, licences, training, gift cards, goals, franchise pipeline, data platform).
4. **HR department end to end** — recruitment → resumes/scorecards → offer templates and
   approvals → offer letters/e-signature → onboarding → attendance/leave → payroll preview
   → documents → exits → department-scoped permissions → HR analytics.

The platform is **not deployed to a live production environment** and **does not fake
third-party integrations**; provider-backed features stay gated until real credentials are
supplied. Deployment is blocked on a verified host and account, not on code.

**Latest capability pass (2026-10-29):** verified customer memory for Blaze end to end — chat,
checkout and the kitchen ticket — plus a live rider
map on `/track`. Memory is proof-gated — it is only stored when the phone number is proved by
a signed customer session or a real order id, and anonymous chat never saves a number. A
consented memory also shows the latest order summary, usual fulfilment and recent favourites
from the guest's own order history, read only after that same proof, so the next greeting can
offer the same order; an order alone never creates a memory row. The saved allergy also
reaches checkout: `/order` reads the same proof-gated memory and shows "Saved from your last
visit" above Place Order, flagging any cart item whose menu allergens match the saved words.
Placing that order writes the allergy onto the order, and the Kitchen Display card shows a red
"Allergy · confirm before serving" strip, so the cook sees it without the guest retyping it.

The landing page now lets Blaze start the conversation: a dismissible speech bubble appears
after a few seconds, once per browser session, and opens the full concierge. For a signed-in
guest it uses the same proof-gated memory to say "Welcome back. Want the usual?" and to name a
saved allergy, so the memory is visible before anyone types. The Blaze and memory browser
proofs cover the greeting, its personalisation and its dismissal.

The rider app now has a **live mode**: while a delivery is out, it streams a GPS fix every 20
seconds (and on movement) so the customer map stays current without repeated taps. A rider can
publish a call-back number; the customer's tracking card shows **Call rider** only while the
delivery is assigned or out for delivery, and the number is withdrawn once the handoff ends.
The map pin glides between fixes instead of jumping. The operations page plots the same fixes
on one dispatch map for the store team, refreshed every 15 seconds, with a last-fix age that
turns amber after three minutes and per-order call links.

Tracking now shows a **clock, not just a window**: the API returns `eta_at` (accepted time plus
the zone's maximum ETA) and the customer page counts down against it, says "Arriving any
moment" near the end and turns red "Running late" only after a ten-minute grace, so a quiet
late order is visible without a phone call. The same work fixed a real clock bug: naive UTC
timestamps were displayed as local time, so a 2:49 PM order read 9:19 AM on the tracking page.
Every tracking timestamp (placed-at, timeline, notifications, map label) now normalises to UTC
first. Both the rider and delivery E2E proofs assert the live countdown and its removal after
delivery.

Blaze can now answer **"where is my order?"** for the same proved guest. The chat endpoint
reuses the session/order-id proof to resolve that phone's newest live order (under a day old,
not closed, cancelled, or already delivered) and hands the service only what may be said out
loud: order id, guest-facing state, ETA window, rider name and a tracking link. The greeting
names the live order, the answer carries a Track action that opens
`/track?order=…&phone=…` on that exact order, and a guest with no live order still gets the
id-and-phone lookup form. Another customer's session never sees the order; the browser proof
signs in twice, places a real pickup order, checks the named status and follows the Track
action to the live countdown.

The same proof now makes **"repeat my usual"** real. The endpoint reads the guest's newest
non-cancelled order from the last 90 days and gives the service only its item ids, quantities
and saved customisations — never the old price, address or total. Every line is re-priced
against today's menu and the chosen channel, so an old price cannot come back; items that are
gone or hidden for that channel are named and skipped, and a customisation that no longer
exists falls back to the standard build with a note. The reply rebuilds the server-priced cart
and the greeting offers Repeat my usual as a quick reply. An anonymous visitor is asked to
confirm their phone first, and another customer's phone never supplies the items. The memory
proof asks for the repeat, asserts the reply names the item and the price, and reads the cart
footer ("1 item · ₹…") rendered from the server-priced cart.

---

## 2. Start here — 15-minute orientation

Read in this order:

1. `HANDOVER.md` (this file)
2. `CURRENT_STATUS.md` — plain-language state of each module
3. `DELIVERY_REPORT.md` — what was delivered and how it was verified
4. `docs/BEGINNER_GUIDE.md` — the system explained without jargon
5. `docs/COMPANY_OS_BLUEPRINT.md` — department model and conversion plan
6. `docs/FEATURE_MATRIX.md` — complete feature inventory and gaps
7. `docs/GAP_AUDIT.md` — numbered gap history with what remains
8. `docs/VERIFICATION.md` — every gate and proof
9. `docs/ACCESS.md` — logins and role entry points

Do not start by reading 510 API operations. Start with the modules you care about in
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

**Shared session secret:** the browser cookie is signed by Next and verified again by
FastAPI. In production set the same strong `PIZZA_BLITZ_SESSION_SECRET` in both processes.
Locally the backend also accepts its admin-password defaults for compatibility, which is why
a development login works without extra setup; a token signed with any other secret is
rejected. If customer memory or customer API calls look anonymous after a deployment, compare
this variable first — Next verifies the cookie before it forwards it.

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
python -W error::FutureWarning -m unittest discover -s tests -v   # 364 backend tests

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
| API operations | 510 across 428 paths |
| Frontend routes | 97 page files (70 catalogued portal routes + public/dynamic pages) |
| Departments | 16 specs; 11 top-level including Company shared services; 5 sub-departments |
| Catalogued modules | 70 (101 active definitions after shared services) |
| Database tables | 119 application tables |
| Backend tests | 364 (87 subtests) |
| Browser proofs | 176 + portal smoke |
| OpenAPI | 428 paths / 510 operations |
| Migrations | `9f8e7d6c5b4a`; fresh upgrade creates all 15 workspace tables |
| Production build | green, including API-offline build |
| Last code commit | `d6e921e`; Company OS program is uncommitted working-tree work |

The audit exercises every major module, including the Company OS department workspaces,
conversion funnel, Blaze concierge, gift-card checkout/refund, HR leave/attendance/payroll/
onboarding/documents/exits/permissions/analytics, recruitment, offer letters, support,
journeys, media, accounting, aggregators, deployment readiness and the full order-to-KDS
path.

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
- The department registry (`backend/app/services/company_catalog.py`) is the single source
  of truth for departments, modules, permissions and navigation; 118 application tables.
- The ordering assistant (`backend/app/services/assistant_service.py`) is deterministic over
  the live menu with an optional LLM answer path; it never invents prices or offers.
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
| Maps/GPS | Keyless OpenStreetMap tiles on customer tracking and the operations dispatch board; the rider app auto-streams a fix every 20 seconds while out for delivery | A maps key only if you add geocoding or routing |
| Auth | Local admin/staff accounts | SSO/identity provider if required |
| AI concierge | Deterministic cart/menu answers locally; optional LLM path off | An LLM API key if the optional answer path is wanted |
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

### Company OS
- Department workspaces are operational tools, not a full ERP; there is no double-entry
  general ledger, AP/AR subledger or bank reconciliation.
- Gift cards are stored-value records with a liability summary; no external card-network
  authorisation or physical card production.
- The assistant answers from live menu/store data. Its optional LLM answer path requires a
  provider key; without one it uses deterministic routing.
- The 3D avatar and speech use browser capabilities; there is no hosted voice/TTS vendor.
- Goals, franchise proforma and outlet P&L are planning tools, not audited financial
  statements.

### Deployment
- No live URL exists yet. A Vercel token in the environment was invalid and no Supabase
  project exists yet; deployment was not faked. The chosen shape is Supabase Postgres plus
  Vercel or Render — Google Cloud is only a later option, so its unusable project no longer
  blocks anything. See [DEPLOY_REQUEST.md](DEPLOY_REQUEST.md).
- The backend scheduler assumes one worker; production needs Postgres, TLS, backups and a
  shared rate limiter/job lock.

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
9. Double-entry accounting, AP/AR subledgers and bank reconciliation.
10. Hosted TTS/voice provider and telephony ordering.

---

## 9. Where a future project should start

If this becomes a new project, do **not** restart from a blank page.

**Recommended first week:**

1. Run the backend, frontend, 364 tests and full audit. Confirm all green. Start with
   `cd frontend; npm run verify:audit:preflight` — it proves the port serves the current
   build and that the messaging webhook token is configured, both of which otherwise fail
   late in the 65-step `npm run verify:audit:live` chain. That chain is one ordered script
   running against an in-memory database, so after any backend restart, rerun it from
   step one instead of resuming where it stopped.
2. Pick one production target: local staging with Postgres, or a real host.
3. Configure the smallest provider set that matters (payments + messaging + storage).
4. Run the provider-gated proofs with real credentials.
5. Fix deployment topology: Postgres, Alembic, single scheduler or external worker,
   TLS, backups, secrets, monitoring.
6. Only then pick feature work from Section 8.

**Files to open first:**

- `backend/app/main.py` — app wiring, bootstrap, scheduler toggle
- `backend/app/core/config.py` — every environment variable
- `backend/app/services/company_catalog.py` — departments, modules, permissions, navigation
- `backend/app/models/domain.py` — 118-table domain model
- `backend/app/api/api_v1/api.py` — endpoint map
- `frontend/src/app/(dashboard)/layout.tsx` — portal shell/navigation
- `frontend/src/components/blaze/blaze-concierge.tsx` — the customer ordering avatar
- `frontend/e2e/verify-audit.cjs` — audit orchestration
- `docs/VERIFICATION.md` — what each gate proves
- `docs/BEGINNER_GUIDE.md` — plain-language tour

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
- Code state: `main` at `d6e921e`; the Company OS/conversion program is uncommitted
  working-tree work, because no commit was requested.
- Verification: **364 backend tests (87 subtests), 176 proofs, production build green**.
- Deployment: **blocked and not faked** — no valid hosting token or Pizza Blitz cloud
  project; see [DEPLOY_REQUEST.md](DEPLOY_REQUEST.md).
- Goal: delivered for local/staging evaluation with the limitations above.

If work resumes, treat this document and the green verification as the baseline. Do not
reopen closed gaps without a concrete production requirement.
