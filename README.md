# Pizza Blitz

Standalone restaurant operating system and customer ordering platform for Pizza Blitz.

## What Is Built

Pizza Blitz now contains two connected products:

- Internal restaurant portal: admin login, sales dashboard, POS orders, kitchen operations, daily sales entry, invoices, reports, inventory, recipes, customers, promotions, social publishing, ad campaigns, production ops readiness, vendors, waste, expenses, and AI insights.
- Public customer website: menu/catalog browsing, product customization, cart, pickup/delivery checkout, coupon application, prepaid/cash order flow, customer order tracking, and customer session support.

## Project Layout

- `backend/` - FastAPI backend for restaurant operations, orders, payments, delivery, marketing, reporting, backups, and readiness checks.
- `frontend/` - Next.js customer website and internal dashboard.
- `docs/` - Operational handoff, launch, and verification notes.

## Local Development

Backend:

```powershell
cd backend
copy .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Frontend:

```powershell
cd frontend
copy .env.example .env.local
npm install
npm run dev -- --hostname 127.0.0.1 --port 3011
```

Local URLs:

- Customer site: `http://127.0.0.1:3011`
- Admin login: `http://127.0.0.1:3011/login`
- Backend API: `http://127.0.0.1:8010`

## Verification

Install the backend test dependencies once:

```powershell
cd backend
pip install -r requirements-dev.txt
```

Backend validation:

```powershell
cd backend
python -W error::FutureWarning -m unittest discover -s tests -v
```

Frontend gates:

```powershell
cd frontend
npm run lint
npm run typecheck
npm run build
```

Browser smoke and the full audit suite, with backend on `8010` and frontend on
`3011`:

```powershell
cd frontend
npm run test:e2e
npm run verify:audit
```

Standard local verification:

```powershell
.\scripts\verify-local.ps1
```

Include browser smoke when both local servers are already running:

```powershell
.\scripts\verify-local.ps1 -E2E
```

Every gate, what it proves, and the production-only proofs are documented in
[docs/VERIFICATION.md](docs/VERIFICATION.md). Known gaps and their status are in
[docs/GAP_AUDIT.md](docs/GAP_AUDIT.md). The full feature inventory, enterprise
benchmark, and build plan live in [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md),
and login IDs, roles, and production credential setup are in
[docs/ACCESS.md](docs/ACCESS.md).

## Production Notes

Before live launch, replace all example secrets, use a production database instead of in-memory SQLite, configure provider credentials, and turn on only the channels that are ready for real traffic. `GET /ready` verifies the database connection for load balancers. See [Launch Runbook](docs/LAUNCH_RUNBOOK.md).

## Rule

Do not modify EduEcosystem files for Pizza Blitz work. Treat this folder as the source project.
