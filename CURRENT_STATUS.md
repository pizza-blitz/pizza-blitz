# Pizza Blitz Current Status

Last Updated: 2026-10-21

## Source Of Truth

Standalone workspace:

`D:\Development\pizza Blitz`

This project was copied from `D:\Development\EduEcosystem\restaurant-portal`.
The standalone copy excludes generated dependency and build folders
(`node_modules`, `.next`, `venv`, `__pycache__`).

## What Exists

- Backend: FastAPI app with 207 endpoints across auth, sales, stats, menu,
  inventory, expenses, orders/POS, invoices, delivery, promotions, social,
  ads, customers, shifts, vendors, purchase orders, recipes, waste, imports,
  OCR, insurance-style readiness probes, and production ops.
- Frontend: Next.js 14 app with the public customer website (menu, cart,
  checkout, tracking, account) and the internal portal (dashboard, POS/counter,
  operations, reports, marketing, ops readiness, settings).
- Data layer: SQLAlchemy models for every flow, Alembic scaffolding, SQLite for
  local development, PostgreSQL support for production.
- Automation: 43 backend tests, 139 browser proof scripts, a lint gate, a
  TypeScript gate, and a production build gate.

## Verified State (2026-10-21)

- `python -W error::FutureWarning -m unittest discover -s tests -v`: 43 tests
  pass, including a clean-venv run installed from `requirements-dev.txt`.
- `npm run lint`: passes; remaining `no-explicit-any` findings are warnings.
- `npm run typecheck`: passes.
- `npm run build`: passes with lint and type checking enabled (the previous
  `ignoreDuringBuilds` / `ignoreBuildErrors` bypasses are removed).
- `npm run test:e2e`: portal browser smoke passes.
- Audit suite: link health, control labels, safe action buttons, feature
  coverage, route action inventory, placeholder hygiene, action feedback, role
  gates, restaurant ready audit, and the roadmap proof board all pass.
- Health probes: `/health` returns process status; `/ready` checks the database
  and returns 503 when it is unreachable.
- Secret scan of tracked files: clean.

## Recent Hardening

- Customer order history and order detail endpoints now require a verified
  session or a phone+order ownership proof instead of trusting a phone number
  or a sequential order id.
- The Alembic chain now builds the complete schema: all 37 model tables from a
  fresh database, with `alembic check` reporting no drift.
- Backend runtime dependencies were reduced from 206 unbounded packages to the
  14 the code actually uses, with bounded versions.
- The scheduled Google Sheets job is a real, env-gated refresh instead of a
  placeholder.
- Build and deploy configuration was corrected (npm lockfile install, real
  API URL defaults, no stale Vercel fallback, Python 3.11 alignment,
  `.dockerignore` for both images).
- Docs were refreshed, and `docs/VERIFICATION.md` plus `docs/GAP_AUDIT.md` now
  record every gate and every open item.

## Remaining Before Launch

1. Connect the production database and run migrations.
2. Configure production secrets and rotate local defaults.
3. Deploy backend and frontend, then run the production-only proofs and smoke.
4. Add real payment, WhatsApp, SMS, email, social, and ads provider
   credentials, keeping the send/launch flags off until each is verified.

See `docs/LAUNCH_RUNBOOK.md`, `docs/VERIFICATION.md`, and
`docs/GAP_AUDIT.md`.
