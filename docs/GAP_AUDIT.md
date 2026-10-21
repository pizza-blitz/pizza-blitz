# Pizza Blitz Gap Audit

Date: 2026-10-21

This file records the whole-project gap review: what was inspected, what was
broken or missing, what was fixed, and what remains blocked on people or
external accounts. Every "fixed" entry lists the evidence that proves it.

## How the review was done

- Read the project docs, roadmap, handoff notes, env examples, Dockerfiles, and
  deployment configs.
- Walked all 207 API endpoints in `backend/app/api/api_v1/endpoints/` with a
  static scanner that flags endpoints without an auth dependency, then checked
  each hit by hand against the router-level guards and the frontend callers.
- Listed all 34 frontend routes, the 139 browser proof scripts in
  `frontend/e2e/`, and the 43 backend tests.
- Ran every gate the project claims: backend unit suite, ESLint, TypeScript,
  the production build, the local-server audit suite (link health, control
  labels, safe action buttons, feature coverage, route action inventory,
  action placeholder hygiene, action feedback, role gates, restaurant ready
  audit, roadmap board), and the portal browser smoke.
- Scanned tracked files for hardcoded secrets and checked the dependency list
  against the modules the code actually imports.
- Installed the trimmed backend requirements into a clean virtual environment
  and re-ran the full test suite there.

## Fixed in this pass

| # | Area | Gap | Evidence it was real | Fix |
|---|------|-----|----------------------|-----|
| 1 | Security | `GET /orders/customer-history/{phone}` returned customer name, email, delivery address, spend, and the last 25 orders to any anonymous caller who supplied a phone number. | Static endpoint scan plus source read; no dependency on the 66-line handler. | Handler now requires an admin/staff session, a customer session whose subject matches the phone, or a real `order_id` belonging to that phone. Cross-customer reads return 403. New tests in `backend/tests/test_order_access_control.py`. |
| 2 | Security | `GET /orders/{order_id}` returned the full serialized order (customer name, phone, address, payment state) for any sequential id without authentication. | Static endpoint scan plus source read. | Requires `admin` or `staff`. The kitchen ticket and staff receipt page already send the portal cookie; the customer receipt path keeps using the phone+order proof. |
| 3 | Security | Customer account page fetched history without credentials, so the flow broke as soon as the API was cross-origin or protected. | Source read of `account/page.tsx` and the `/server` proxy. | Added `credentials: "include"`; the customer login proof route now passes `?order_id=` so the backend can verify ownership without a session yet. |
| 4 | Quality gate | `npm run lint` failed with 122 errors, and `next.config.mjs` hid both ESLint and TypeScript failures during `next build`. | Running `npm run lint` and reading `next.config.mjs`. | Removed unused imports/variables, replaced unused catch bindings, escaped raw JSX quotes/apostrophes, and turned the remaining 86 `no-explicit-any` findings into warnings (tracked below). `ignoreDuringBuilds` and `ignoreBuildErrors` are gone, so the build now lints and type-checks. |
| 5 | Quality gate | The safe-action-button audit failed on `/orders`: the "Express Walk-in" button's accessible name included its description, so it could not be found by role, and the route-action inventory audit then failed too. | `npm run verify:actions` and `verify:route-actions` output. | Added an explicit `aria-label="Express Walk-in"`, matching the button's visible label. |
| 6 | Dependencies | `backend/requirements.txt` listed 206 unbounded packages (Flask, Celery, OpenCV, matplotlib, locust, Stripe, …) while the application imports 11 third-party libraries. Builds were slow and non-reproducible. | Import scan across `backend/app`; comparison with `pyproject.toml`. | Replaced with 14 bounded runtime dependencies plus a `requirements-dev.txt` that adds `httpx` for the test client. Verified by a clean venv install and a full 43-test run. |
| 7 | Dependencies | `pyproject.toml` declared `requires-python >=3.12` while the workstation and the backend Docker image both run Python 3.11; `uvicorn` was missing from the declared dependencies. | `python --version`, `backend/Dockerfile`, `pyproject.toml`. | Range corrected to `>=3.11,<3.15`; `uvicorn[standard]` added; stale Dockerfile comment removed. |
| 8 | Deployment | Frontend Docker build used `npm install --frozen-lockfile`, which is not an npm flag and does not produce reproducible installs. | `frontend/Dockerfile`. | Changed to `npm ci` against the committed lockfile. |
| 9 | Deployment | Cloud Build baked `http://localhost:8000` in as the public API URL; local docs and env examples pointed at port 3000 while every other local URL uses 3011; the backend kept a stale `https://pizza-blitz.vercel.app` fallback for public links. | `frontend/cloudbuild.yaml`, `backend/.env.example`, `frontend/.env.example`, `backend/app/core/config.py`, `backend/app/services/ops_service.py`. | Local/dev defaults now consistently use `127.0.0.1:3011` / `127.0.0.1:8010`; the Vercel URL fallback was removed so a deployment must configure the real public URL; `.env.example` now documents `PIZZA_BLITZ_PUBLIC_URL` and `PIZZA_BLITZ_PUBLIC_API_PREFIX`. |
| 10 | Operations | There was no database-aware readiness probe, so a deployment could report healthy with a dead database. | Source read of `backend/app/main.py`. | Added `GET /ready`, which runs `SELECT 1` and returns 503 when the database is unreachable, plus `backend/tests/test_health_endpoints.py`. |
| 11 | Documentation | `CURRENT_STATUS.md` (2026-05-21) still listed the `google.generativeai` migration as outstanding, described the public site as future work, and did not match the current code. `HANDOFF.md` still said the public website should not be started. `README.md` claimed `docs/` contained operational handoff and verification notes that did not exist. | Reading all three files against the code. | Status, handoff, and README rewritten to the current state; added `docs/VERIFICATION.md` (how to run every gate) and this gap audit. |
| 12 | Repo hygiene | `scratch/` held roughly 10 MB of throwaway logs, SQLite files, and probe scripts and was untracked but not ignored, so it polluted `git status`. | `git status --porcelain` and a directory listing. | Added `/scratch/` to `.gitignore` and removed this session's probe files and verification venv. |
| 13 | Database | The Alembic chain stopped after four revisions and created only 10 of the 37 model tables, so `alembic upgrade head` on a production database would leave most of the app broken. | `alembic upgrade head` plus `alembic check` against a throwaway SQLite database; table counts compared with `__tablename__` entries. | Generated and reviewed `2e2f3f35678d_sync_remaining_model_tables`, which creates the remaining 27 tables and corrects the inventory name index. A fresh database now migrates to all 37 tables and `alembic check` reports no drift. |
| 14 | Backend | The daily Google Sheets scheduler job was a `pass` placeholder that logged "(Placeholder)" every run. | `backend/app/core/scheduler.py`. | Implemented a real refresh of the most recently linked sheet, behind the new `SHEET_AUTO_SYNC_ENABLED` flag (default off) so it never surprises an installation. |
| 15 | Deployment | Neither app had a `.dockerignore`, so `COPY . .` pulled the host's `node_modules`, stale `.next` output, SQLite files, and logs into the images. On Windows that can replace the container's Linux dependencies with host binaries. | `backend/Dockerfile`, `frontend/Dockerfile`, directory listing. | Added `.dockerignore` for both applications. |
| 16 | Proof scripts | Hardening the order endpoints broke 11 browser proofs that relied on the old public reads (anonymous order detail or phone-only history). | Audit run failures in `verify-customer-web-checkout`, `verify-customer-account-lifecycle`, and peers. | Updated them to use an admin cookie, the customer receipt proof, or the history `order_id` proof, and fixed one pre-existing strict-locator bug in `verify-delivery-zone-assignment`. All 11 now pass. |
| 17 | Reporting | Analytics used `datetime.utcnow().date()` while orders, daily entry, and promotions used server-local `date.today()`. With India at UTC+5:30, the dashboard dropped the current day's sales for the first five and a half hours of every local day. | The backend suite failed once the clock crossed local midnight (`800.0 != 1800` in `test_sales_comparison_pos_invoice_recipes_and_waste`). | Added `app/core/clock.py` with a configurable `RESTAURANT_TIMEZONE` (default `Asia/Kolkata`) and routed every business-date read in stats, orders, promotions, shifts, expenses, purchase orders, storefront, ads, readiness, sheets, and the tests through `business_today()`. Added clock tests and the `tzdata` runtime dependency. |
| 18 | Automation | There was no CI: lint, tests, builds, and the migration check all ran by hand, so a regression could land unnoticed. | No `.github` directory in the repository. | Added `.github/workflows/verify.yml`, which runs backend lint + tests + `alembic upgrade head`/`alembic check` and frontend lint + typecheck + production build on pushes and pull requests. |
| 19 | Backend quality | The backend had no static lint gate, and a focused scan found 34 real issues: unused imports, a bare `except`, raises without exception chaining, one-line `if` bodies, and an unguarded equality comparison. | Ruff scan with `E4,E7,E9,F,B,S`. | Added `[tool.ruff]` configuration to `pyproject.toml`, fixed every finding (including the bare except in the historical import script), added `ruff` to `requirements-dev.txt`, and documented the gate. The backend is now clean with zero findings. |
| 20 | Security | The Google Sheets importer fetched any URL that contained `export?format=csv`, so an admin-supplied value could make the server request arbitrary hosts, including cloud metadata endpoints (SSRF). | Source read of `fetch_public_csv_rows`/`_fetch_public_text`; no host or scheme validation existed. | Fetches are now limited to HTTPS on `docs.google.com`/`docs.googleusercontent.com`, and seven regression tests cover foreign hosts, plain HTTP, metadata IPs, and safe URL normalization. |
| 21 | Security | A production frontend started without `PIZZA_BLITZ_ADMIN_*` environment variables still accepted the repository defaults `admin/admin123`: the cloud guard treated a default-credential match as a master login. The backend already failed closed, but the frontend route answered first. | Source read of `admin-session/route.ts`, then a live proof against a production build. | Unconfigured credentials no longer count in a cloud runtime. Verified live: production build returns `503` for `admin/admin123` and `200` for the configured strong password; the backend returns `401`/`200` respectively. |
| 22 | Deployment | `deploy-gcp.ps1`/`.sh` passed only `NEXT_PUBLIC_API_URL` to the frontend service, so a deployment had no configured admin credentials, API URL for server routes, or session secret; the backend also lacked the shared `PIZZA_BLITZ_*` values and the payment return URL. | Script read. | Both scripts now require `PIZZA_BLITZ_SESSION_SECRET` and `PAYMENT_RETURN_URL`, pass admin credentials (both spellings), API URL, session secret, and optional staff/site/timezone values to the correct service, and pass ShellCheck with no findings. |
| 23 | Startup safety | Production could boot with repository-default secrets (token signing key, admin password), which would make admin tokens forgeable even though readiness flagged it. | Defaults in `config.py` and the readiness report. | Added `validate_production_settings()` to the lifespan: production refuses to start when `AUTH_SECRET_KEY`, admin passwords, or the session secret are weak or missing. Covered by three tests, and the production integration run boots only with strong values. |
| 24 | Proof scripts | Two browser proofs defaulted to the deployed `pizza-blitz.vercel.app` URL instead of the local app, so a local run silently reached the public internet and timed out (one of them failed during this pass). | Running `verify-reporting-action-board.cjs` locally. | Both default to `http://127.0.0.1:3011` now and keep `E2E_BASE_URL` as the override for deployed runs. The script passes locally. |
| 25 | Frontend types | 18 pages carried 86 explicit-`any` annotations at their API boundaries, which hid response-shape mistakes from the compiler. | ESLint `no-explicit-any` warnings. | Added typed payload interfaces and removed every shortcut: dashboard, daily, CEO, break-even, AI insights, inventory, sales, purchase-orders, operations, ops, recipes, and the reports page (all 86 sites retired). Reports got explicit models for comparison cards and daily/weekday rows, owner comparison, campaign performance with nested outreach/redemption/ad blocks, customer segments, order-channel mixes, forecast, target pacing, and break-even. `no-explicit-any` now reports zero findings. |
| 26 | Abuse protection | Sensitive public endpoints (customer-login proof, order creation, payment verification, admin/staff/customer login) had no throttle, so phone+order-id enumeration or credential brute force was only bounded by network speed. | Endpoint inventory and the earlier idor review. | Added a per-instance sliding-window limiter (`app/core/rate_limit.py`) wired into those endpoints, enabled by default and configurable with `RATE_LIMIT_ENABLED`. Covered by five tests (limit, bucket isolation, proxy header, disable switch, endpoint wiring). Docs note that horizontal deployments should add a shared Redis limiter or edge WAF rule. |

## Still open

These are real gaps, but they cannot be closed from inside the repository.

| # | Area | Gap | Why it is open |
|---|------|-----|----------------|
| 1 | Launch | Production database has not been connected; local runs use in-memory SQLite. | Needs the production database URL and a migration run. See `docs/LAUNCH_RUNBOOK.md`. |
| 2 | Launch | Backend and frontend are not deployed, so the live deployment proof and production smoke scripts have nothing to run against. | Needs a Google Cloud / Vercel project and credentials (`deploy-gcp.ps1`). |
| 3 | Providers | Payment gateway, WhatsApp, SMS, email, Meta social, and Meta ads credentials are not configured. | Needs real provider accounts. The features stay gated behind `CAMPAIGN_SEND_ENABLED`, `SOCIAL_PUBLISH_ENABLED`, and `ADS_LAUNCH_ENABLED`, which is the intended safe default. |
| 4 | Browser proofs | A handful of the 139 proof scripts assert against a deployed URL (live deployment proof, production launch, live environment). They are expected to fail locally until item 2 is done. `verify:audit` used to include the deployment proof, so the documented local quality gate could never pass. | They require the deployed environment; the deployment-only proof was split into `npm run verify:deployment` and removed from `verify:audit`, so the local suite is fully green and the deployed check stays explicit. |

## Current gate results

- Backend unit suite: 62 tests, all pass (in a clean venv built from
  `backend/requirements-dev.txt`).
- Backend lint: `ruff check .` reports zero findings.
- `npm run lint`: 0 errors and 0 `no-explicit-any` findings; 19 hook
  dependency and 6 `<img>` warnings remain.
- `npm run typecheck`: pass.
- `npm run build`: pass, with lint and type checking enabled.
- `npm run test:e2e`: pass.
- `npm run verify:audit` (preflight, surface, inventory, live): pass end to end.
  The deployment-only proof is now the separate `npm run verify:deployment`.
- Audit surface, inventory, action feedback, role gates, restaurant ready
  audit, and roadmap proofs: pass.
- The 11 order/customer proof scripts touched by the auth hardening: pass.
- `alembic upgrade head` on an empty database: 37 tables, and `alembic check`
  reports no drift.
- GitHub Actions workflow parses and covers both apps.
- Production credential behavior: default `admin/admin123` is rejected by a
  production frontend and backend; configured strong credentials are accepted.
- Deploy scripts pass ShellCheck with no findings.
- Secret scan of tracked files: no findings.
