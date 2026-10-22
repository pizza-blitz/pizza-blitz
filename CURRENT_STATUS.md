# Pizza Blitz Current Status

Last Updated: 2026-10-22

## Source Of Truth

Standalone workspace:

`D:\Development\pizza Blitz`

This project was copied from `D:\Development\EduEcosystem\restaurant-portal`.
The standalone copy excludes generated dependency and build folders
(`node_modules`, `.next`, `venv`, `__pycache__`).

## What Exists

- Backend: FastAPI app with 208 endpoints across auth, sales, stats, menu,
  inventory, expenses, orders/POS, invoices, delivery, promotions, social,
  ads, customers, shifts, vendors, purchase orders, recipes, waste, imports,
  OCR, insurance-style readiness probes, and production ops.
- Frontend: Next.js 14 app with the public customer website (menu, cart,
  checkout, tracking, account) and the internal portal (dashboard, POS/counter,
  operations, reports, marketing, ops readiness, settings).
- Data layer: SQLAlchemy models for every flow, Alembic scaffolding, SQLite for
  local development, PostgreSQL support for production.
- Automation: 70 backend tests, 120 browser proof scripts, a backend Ruff
  lint gate, a lint gate, a TypeScript gate, a production build gate, and a
  GitHub Actions workflow that runs them all.

## Enterprise Completion Program

The full feature inventory, enterprise benchmark, gap register, and wave plan
live in [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md). Access IDs and roles
are in [docs/ACCESS.md](docs/ACCESS.md).

Wave 1 is complete:

- Public landing page rebuilt with live menu and offer data, kitchen standards,
  delivery areas, FAQ, Restaurant/FAQ JSON-LD, Open Graph metadata, and a
  responsive mobile/desktop layout.
- Portal navigation rebuilt: grouped, searchable, collapsible desktop sidebar
  with active states and role badge; mobile drawer plus a five-tab bottom bar;
  desktop top bar with the current section.
- Master access verified: `admin` / `admin123` (admin portal) and
  `staff` / `staff123` (counter portal) locally; production setup documented.
- Stopped leaking menu `cost_price` through the public storefront payload.
- Added `verify:landing` and `verify:portal-shell` browser proofs, both wired
  into `verify:audit`.

Wave 2 (in progress):

- Added a database-backed store profile with name, tagline, phone, email,
  address, map link, Instagram, weekly opening hours (overnight supported),
  online-ordering pause/message, and prep time.
- Built the admin editor at `/settings/store`, linked from Settings and the
  portal navigation.
- Public storefront profile/status endpoints, landing page contact/hours/status,
  dynamic metadata/JSON-LD, checkout readiness, and order creation all read the
  same profile. Paused or closed stores return HTTP 503 and show a customer
  banner instead of accepting orders.
- New `verify:store-profile` browser proof and eight backend tests.
- Still next in W2: scheduled orders, tips, and dense-page mobile polish.

## Verified State (2026-10-22)

- `python -W error::FutureWarning -m unittest discover -s tests -v`: 70 tests
  pass, including a clean-venv run installed from `requirements-dev.txt`.
- `ruff check .`: zero findings across the backend.
- `npm run lint`: passes with zero `no-explicit-any` findings; only the
  existing hook-dependency and `<img>` style warnings remain.
- `npm run typecheck`: passes.
- `npm run build`: passes with lint and type checking enabled (the previous
  `ignoreDuringBuilds` / `ignoreBuildErrors` bypasses are removed).
- `npm run test:e2e`: portal browser smoke passes.
- Audit suite: `npm run verify:audit` passes end to end (preflight, link
  health, control labels, safe actions, feature coverage, route inventory,
  placeholder hygiene, action feedback, role gates, restaurant readiness, and
  the roadmap board). The deployment-only proof is `npm run verify:deployment`
  and runs against a deployed URL.
- Health probes: `/health` returns process status; `/ready` checks the database
  and returns 503 when it is unreachable.
- Secret scan of tracked files: clean.

## Recent Hardening

- Sensitive public endpoints (customer-login proof, order creation, payment
  verification, and login routes) are throttled per instance, configurable
  with `RATE_LIMIT_ENABLED`; horizontally scaled deployments should add a
  shared limiter at the edge.
- Production now fails closed on security: the backend refuses to start with
  repository-default secrets, a production frontend rejects `admin/admin123`
  unless admin credentials are configured, and both deploy scripts pass the
  required admin, session, API, and payment-return variables to each service.
- The Google Sheets importer only fetches Google-hosted HTTPS URLs, closing an
  SSRF path that could reach arbitrary or internal hosts.
- Every business date (sales days, order "today" filters, promotions, shifts,
  readiness) now comes from one configurable restaurant timezone
  (`RESTAURANT_TIMEZONE`, default `Asia/Kolkata`) instead of mixing UTC and
  host-local dates. This fixed the dashboard dropping the current day's sales
  after local midnight.
- Customer order history and order detail endpoints now require a verified
  session or a phone+order ownership proof instead of trusting a phone number
  or a sequential order id.
- The Alembic chain now builds the complete schema: all 38 model tables from a
  fresh database, with `alembic check` reporting no drift.
- Backend runtime dependencies were reduced from 206 unbounded packages to the
  14 the code actually uses, with bounded versions.
- The scheduled Google Sheets job is a real, env-gated refresh instead of a
  placeholder.
- Build and deploy configuration was corrected (npm lockfile install, real
  API URL defaults, no stale Vercel fallback, Python 3.11 alignment,
  `.dockerignore` for both images).
- A Ruff lint gate and a GitHub Actions workflow now cover backend lint,
  tests, migrations, and the frontend lint/typecheck/build gates.
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
