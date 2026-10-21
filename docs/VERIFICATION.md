# Pizza Blitz Verification Guide

This is the complete list of gates for the project, in the order they are cheap
to run. Anything that needs a running server says so.

## One-time setup

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env
```

`requirements-dev.txt` is the runtime list plus `httpx`, which Starlette's test
client needs. `requirements.txt` intentionally contains only what the FastAPI
app imports at runtime so the Docker image stays small and reproducible.

Frontend:

```powershell
cd frontend
npm ci
copy .env.example .env.local
```

## Static gates (no servers needed)

| Gate | Command | What it proves |
|------|---------|----------------|
| Backend unit suite | `cd backend; python -W error::FutureWarning -m unittest discover -s tests -v` | 47 tests covering sales math, comparisons, POS lifecycle, invoices, recipes, waste, payments, promotions, readiness, access control, the business clock, and health probes. |
| Backend lint | `cd backend; python -m ruff check .` | No pyflakes/bugbear/bandit findings (E4/E7/E9/F/B/S). |
| ESLint | `cd frontend; npm run lint` | No blocking lint errors. `no-explicit-any` is a warning while the remaining response-typing debt is paid down. |
| TypeScript | `cd frontend; npm run typecheck` | The whole frontend type-checks. |
| Production build | `cd frontend; npm run build` | Compiles, lints, and type-checks. `next.config.mjs` no longer bypasses either check. |
| Database schema | `cd backend; alembic upgrade head; alembic check` | Builds all 37 model tables from an empty database and confirms there is no pending schema drift. Point `SQLALCHEMY_DATABASE_URI` at a scratch SQLite file when testing locally. |
| Source audits | `cd frontend; npm run verify:audit:inventory` | Feature action coverage, route action inventory, and placeholder hygiene (no `alert()`, inert `#` links, `javascript:` URLs, or "coming soon" copy). |

Shortcut for the backend suite plus the production build:

```powershell
.\scripts\verify-local.ps1
```

## Continuous integration

`.github/workflows/verify.yml` runs the same gates on every push and pull
request: backend lint, backend tests, `alembic upgrade head` + `alembic check`,
frontend lint, typecheck, and production build. Nothing else needs to be
configured beyond a GitHub remote.

## Business timezone

`RESTAURANT_TIMEZONE` (default `Asia/Kolkata`) defines the restaurant calendar:
the same value drives sales days, order "today" filters, promotions, shifts,
and readiness. Set it explicitly on the deployment host; the API does not rely
on the host's clock or `TZ` setting.

## Live gates (servers needed)

Start the backend on 8010 and the frontend on 3011:

```powershell
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010

cd frontend
npm run dev -- --hostname 127.0.0.1 --port 3011
```

Then:

| Gate | Command | What it proves |
|------|---------|----------------|
| Audit preflight | `cd frontend; npm run verify:audit:preflight` | Both targets answer, and production runs have credentials configured. |
| Browser smoke | `cd frontend; npm run test:e2e` | Public site, customer order, tracking, admin login, and core dashboard pages work in a browser. |
| Surface audit | `cd frontend; npm run verify:audit:surface` | Every same-site link resolves; every visible control has a label; non-destructive buttons can be found by role and clicked without errors. |
| Live audit | `cd frontend; npm run verify:audit:live` | Action feedback, role gates, restaurant readiness, and the roadmap proof board. |
| Full suite | `cd frontend; npm run verify:quality` | Typecheck, build, and every audit above. |

Browser proofs write JSON artifacts to `frontend/e2e/artifacts/`.

`scripts/verify-local.ps1 -E2E` runs the backend suite, the production build,
and the browser smoke in one command when both servers are already running.

## Production-only proofs

These prove the deployed system and only pass against a real deployment:

- `npm run verify:live` (login loop and simple POS against `E2E_BASE_URL`)
- `npm run verify:audit:live` deployment proof scripts (`verify-live-deployment-proof.cjs`)

Set `E2E_BASE_URL`, `E2E_API_URL`, `E2E_ADMIN_ID`, and `E2E_ADMIN_PASSWORD`
before running them. See `docs/LAUNCH_RUNBOOK.md` for the deployment sequence.

## Health endpoints

- `GET /health` returns process status.
- `GET /ready` runs `SELECT 1` against the configured database and returns
  `503` when it is unreachable, so a load balancer does not route traffic to a
  broken instance.

## Known non-blocking warnings

- `no-explicit-any` warnings in older dashboard pages. They are tracked in
  `docs/GAP_AUDIT.md`.
- `react-hooks/exhaustive-deps` warnings where a loader intentionally runs once
  on mount.
- `<img>` usage on marketing surfaces instead of `next/image`.
