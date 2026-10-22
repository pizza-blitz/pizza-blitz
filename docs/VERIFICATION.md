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
| Backend unit suite | `cd backend; python -W error::FutureWarning -m unittest discover -s tests -v` | 114 tests covering sales math, comparisons, POS lifecycle, invoices, recipes, waste, payments, refunds, promotions, readiness, access control, rate limiting, the business clock, store profile/hours, scheduled orders, tips, KDS, order notifications, menu media, customer OTP, saved addresses, loyalty/referrals, sheet-import URL safety, production secret guards, and health probes. |
| Backend lint | `cd backend; python -m ruff check .` | No pyflakes/bugbear/bandit findings (E4/E7/E9/F/B/S). |
| ESLint | `cd frontend; npm run lint` | No blocking lint errors. `no-explicit-any` is a warning while the remaining response-typing debt is paid down. |
| TypeScript | `cd frontend; npm run typecheck` | The whole frontend type-checks. |
| Production build | `cd frontend; npm run build` | Compiles, lints, and type-checks. `next.config.mjs` no longer bypasses either check. |
| Database schema | `cd backend; alembic upgrade head; alembic check` | Builds all 38 model tables from an empty database and confirms there is no pending schema drift. Point `SQLALCHEMY_DATABASE_URI` at a scratch SQLite file when testing locally. |
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

## Abuse protection

`RATE_LIMIT_ENABLED` (default true) throttles the customer-login proof, order
creation, payment verification, and login routes per client IP and per
instance. Limits are generous for normal service (30 login attempts, 120 order
creations, and 30 order-history lookups per minute). For a horizontally scaled
deployment, add a shared limiter (Redis) or an edge WAF rate rule as well; this
in-process guard is defense in depth, not a global quota.

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
| Live audit | `cd frontend; npm run verify:audit:live` | Action feedback, portal shell, landing page, store profile (including pause enforcement), scheduled orders, tips, responsive tables, refunds, KDS, order notifications, menu media, customer OTP login, saved addresses, loyalty/referrals, role gates, restaurant readiness, and the roadmap proof board. |
| Full suite | `cd frontend; npm run verify:quality` | Typecheck, build, and every audit above. |

Browser proofs write JSON artifacts to `frontend/e2e/artifacts/`.

`scripts/verify-local.ps1 -E2E` runs the backend suite, the production build,
and the browser smoke in one command when both servers are already running.

## Production-only proofs

These prove the deployed system and only pass against a real deployment:

- `npm run verify:live` (login loop and simple POS against `E2E_BASE_URL`)
- `npm run verify:deployment` (live deployment proof: public API health,
  checkout DB readiness, CORS origin lock, and public order page)

They are deliberately **not** part of `verify:audit`, so the local suite can be
green without a deployment. Set `E2E_BASE_URL`, `E2E_API_URL`, `E2E_ADMIN_ID`,
and `E2E_ADMIN_PASSWORD` before running them. See `docs/LAUNCH_RUNBOOK.md` for
the deployment sequence.

Production behavior is fail-closed: the backend refuses to start with
repository-default secrets, and a production frontend rejects `admin/admin123`
unless `PIZZA_BLITZ_ADMIN_ID` and `PIZZA_BLITZ_ADMIN_PASSWORD` are configured.
When serving a production build locally for smoke checks
(`npm start` sets `NODE_ENV=production`), export the admin ID and password
first, otherwise login is refused by design.

## Store hours and ordering pause

The store profile is stored in the `store_profile` table and edited at
`/settings/store` (admin only). Hours are per weekday and support overnight
windows; `null` hours mean "24/7 until configured", while an empty map means
"closed every day". The public storefront profile and checkout readiness expose
the resulting state, and order creation returns HTTP 503 while paused/closed.
Covered by `backend/tests/test_store_profile.py` and
`frontend/e2e/verify-store-profile.cjs`.

## Scheduled orders

`GET /api/v1/restaurant/orders/scheduled-slots?date=YYYY-MM-DD` returns
15-minute slots for the next 14 days, capacity-checked at six orders per slot.
`POST /api/v1/restaurant/orders/` accepts `scheduled_for` with an ISO timestamp;
the backend converts it to the restaurant timezone, validates the slot, opening
hours and lead time, then stores naive UTC in `orders.scheduled_for`. Scheduled
orders are allowed while the store is closed but not while online ordering is
paused. Covered by `backend/tests/test_scheduled_orders.py` and
`frontend/e2e/verify-scheduled-orders.cjs`.

## Tips

`orders.tip_amount` is non-negative (0–2000) and included in totals, receipts,
tracking and the POS card. Customer checkout offers 0/5/10/15% presets plus a
custom amount; POS has Rs 0/20/50/100 presets plus a custom field. The
admin/staff `GET /api/v1/restaurant/orders/tips-summary?days=30` endpoint returns
total/today/average/penetration. Covered by `backend/tests/test_order_tips.py`
and `frontend/e2e/verify-order-tips.cjs`.

## Refunds

`POST /api/v1/restaurant/orders/{id}/refunds` (admin only) records a full or
partial refund with a reason, method, optional provider reference and notes. It
writes `order_refunds`, increments `orders.refunded_amount`, moves payment
status to `partially_refunded`/`refunded`, and records an audit event. Unpaid
orders are rejected (409), over-refunds are rejected (422), and staff receive
403. `GET /{id}/refunds` returns the ledger; `GET /refunds/summary?days=30`
returns period totals by method. The gateway call itself is not faked — record
the provider reference, then perform the provider refund in the provider
dashboard until that integration is wired. Covered by
`backend/tests/test_order_refunds.py` and
`frontend/e2e/verify-order-refunds.cjs`.

## Kitchen Display (KDS)

Staff open `/kds` for a full-screen board backed by
`GET /api/v1/restaurant/orders/kds` (admin/staff only). It returns active orders
with station-routed lines, item status, age/SLA priority, scheduled due time and
metrics. Bump/recall calls the existing
`PATCH /orders/{id}/stations/{station}/status`, which recomputes the order
status. The page refreshes every 8 seconds, highlights overdue tickets, chimes
on new orders when enabled, filters by station and supports fullscreen. Covered
by `backend/tests/test_kds.py` and `frontend/e2e/verify-kds.cjs`.

## Order notifications

Set `ORDER_NOTIFICATIONS_ENABLED=true` and `ORDER_NOTIFICATION_CHANNEL` to
`sms`, `whatsapp`, `email`, or `console`. The channel reuses the campaign
provider settings (`TWILIO_*`, `WHATSAPP_*`, `RESEND_*`). Status updates,
station bumps, cancellation, close and delivery assignment changes write one
`order_notifications` row per order+event; skipped/failed sends never block the
order update. The tracking page lists sent updates. `console` records a sent
notification without a provider, which is what the local proof uses. Covered by
`backend/tests/test_order_notifications.py` and
`frontend/e2e/verify-order-notifications.cjs`.

## Menu media

Admins upload item images with
`POST /api/v1/restaurant/menu/menu/{id}/image` (multipart `file`, optional
`alt`); files must be JPEG, PNG or WebP and at most 5 MB. Files are written to
`MEDIA_ROOT/menu` (default `backend/media`) and served from `/media`; the
frontend rewrites `/media/*` to the API so relative URLs work in the browser.
`DELETE /menu/menu/{id}/image` removes the file and clears the fields. The
public menu payload exposes `image_url`/`image_alt`; the admin menu, customer
catalog and landing page fall back to curated photography when no upload exists.
Covered by `backend/tests/test_menu_media.py` and
`frontend/e2e/verify-menu-media.cjs`.

## Customer OTP login

`POST /api/v1/auth/customer/otp/request` creates a six-digit code hashed with
`AUTH_SECRET_KEY`, valid for `CUSTOMER_OTP_TTL_SECONDS` (default 300), delivered
over `CUSTOMER_OTP_CHANNEL` (`sms`, `whatsapp`, or `console`) and rate limited.
`POST /api/v1/auth/customer/otp/verify` allows five attempts and returns a
customer token. Outside production a `debug_code` is returned when the console
channel is used, which local proofs consume. The legacy
`/auth/customer/login` now requires a matching `order_id`; phone-only sign-in
returns 401. The account login page posts either `{phone, otp}` or
`{phone, order_id}` to `/api/customer-session`, which sets the HMAC customer
cookie. Covered by `backend/tests/test_customer_otp.py` and
`frontend/e2e/verify-customer-otp.cjs`.

## Saved addresses

`GET/POST /api/v1/restaurant/customers/me/addresses` and
`PATCH/DELETE /me/addresses/{id}` are scoped to the authenticated customer token
(customer role). Each customer can store up to 10 addresses; the first becomes
the default, setting another clears the old default, and deleting the default
promotes the newest remaining address. The Next session route stores the backend
customer token in an httpOnly `pb_customer_api_token` cookie and the
`/api/customer-addresses` routes proxy address calls with it. The account page
manages addresses and checkout shows chips that fill the delivery address.
Covered by `backend/tests/test_customer_addresses.py` and
`frontend/e2e/verify-saved-addresses.cjs`.

## Loyalty and referrals

`GET /api/v1/restaurant/customers/me/loyalty` returns points, lifetime points,
tier progress, referral code/count and recent transactions for the authenticated
customer. Closing an order awards one point per rupee in an idempotent
`loyalty_transactions` row; repeated closes do not double-award. A first order
with another customer's `referral_code` credits 100 points to both sides and
records `referred_by_customer_id`; invalid codes, self-referrals and returning
customers are rejected with 422. The account page renders a loyalty card and
checkout has an optional referral field. Covered by
`backend/tests/test_loyalty.py` and `frontend/e2e/verify-loyalty.cjs`.

## Health endpoints

- `GET /health` returns process status.
- `GET /ready` runs `SELECT 1` against the configured database and returns
  `503` when it is unreachable, so a load balancer does not route traffic to a
  broken instance.

## Known non-blocking warnings

- `react-hooks/exhaustive-deps` warnings where a loader intentionally runs once
  on mount.
- `<img>` usage on marketing surfaces instead of `next/image`.
