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
| Backend unit suite | `cd backend; python -W error::FutureWarning -m unittest discover -s tests -v` | 195 tests covering sales math, comparisons, POS lifecycle, invoices, recipes, waste, payments, refunds, promotions, readiness, access control, rate limiting, the business clock, store profile/hours, scheduled orders, tips, KDS, item-level line status, order notifications, menu media, the shared media library, storefront landing content, configurable tax/billing, provider credentials, payment provider registry, messaging inbox/webhooks/templates, marketing journeys, marketing calendar/reels, HR recruitment, public careers, menu allergens/nutrition, channel pricing/visibility, customer OTP, saved addresses, loyalty/referrals and redemption, rider GPS/proof, custom/scheduled reports, 2FA and granular permissions, department registry/membership, HR people directory, HR leave/holidays, HR attendance, HR payroll, HR onboarding, HR documents/letters, HR exits, HR department-scoped permissions, HR analytics, multi-store consolidation, GST accounting, aggregator intake/outbound status/menu sync, shift scheduling/labour, security headers/client errors, POS hardware, deployment checklist, feedback/NPS, sheet-import URL safety, production secret guards, and health probes. |
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
| Live audit | `cd frontend; npm run verify:audit:live` | Action feedback, portal shell, landing page, store profile (including pause enforcement), scheduled orders, tips, responsive tables, refunds, KDS, order notifications, menu media, menu nutrition, customer OTP login, saved addresses, loyalty/referrals, points redemption, rider app/GPS/proof, report builder, 2FA/security, multi-store, accounting, aggregators (intake + status/menu sync), shift scheduling, channel pricing, security headers/client errors, POS hardware, deployment checklist, feedback/NPS, role gates, restaurant readiness, and the roadmap proof board. |
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

Points redemption: `POST /customers/me/loyalty/redemptions` reserves 100+ points
(10 points = ₹1) for 15 minutes and returns a token. Order creation accepts
`loyalty_redemption_token`, verifies it belongs to the ordering phone, applies
the reward before tax, debits points into the `redeem` ledger row, marks the
token used, and rejects reuse/sharing/over-spending. The order page shows a
Slice Club panel and a "Points reward" total line. Covered by
`backend/tests/test_loyalty.py` and
`frontend/e2e/verify-loyalty-redemption.cjs`.

## Rider app, GPS, proof of delivery

Admin/staff `GET /delivery/orders/{id}/rider-link` issues a bearer token and
`/rider/{token}` path for the assigned rider. The public rider endpoints are
scoped to that token: view the delivery, start it, post GPS coordinates, capture
photo/signature/OTP proof with a reference, and mark delivered or failed. Proof
is mandatory before delivered and failed requires a reason. Order tracking now
includes rider name, status, last coordinates/proof flag. The rider page is a
mobile-first screen at `/rider/[token]`; admin order cards have a Rider link
button. Covered by `backend/tests/test_rider.py` and
`frontend/e2e/verify-rider.cjs`.

## Custom and scheduled reports

`POST /reports/custom` accepts a business-day date range, metrics (revenue,
orders, average order value, tax, discount, tips, refunds), dimensions (day,
order type, payment method, status) and equality filters, and returns rows,
columns and totals for non-cancelled orders. Saved reports (`/reports/saved`)
store the definition plus a rolling day range, schedule (daily/weekly/monthly)
and recipients; they support run, CSV export, send-now and delete, and record
`last_run_at`/delivery status. A scheduler job checks every five minutes and
emails due reports through `send_campaign_message`, marking them sent, skipped
(provider not configured) or failed. The reports page embeds the builder with a
responsive table, totals and saved-report cards. Covered by
`backend/tests/test_report_builder.py` and
`frontend/e2e/verify-report-builder.cjs`.

## Two-factor authentication and staff permissions

`POST /auth/admin/login`, `/auth/staff/login`, and the portal-verify endpoints
return a five-minute `challenge_token` instead of a session when the account has
2FA enabled. `POST /auth/2fa/verify` accepts that challenge plus a TOTP code or
one-time recovery code and issues a normal token; challenge tokens carry
`purpose=2fa` and are rejected as bearer sessions. Setup/confirm/disable live
under `/auth/2fa/*` and the portal UI is `/settings/security`, which also shows
the eight hashed recovery codes once.

`role_permissions` stores staff overrides for orders, kitchen, delivery,
refunds, reports, settings and staff management. `require_permission` allows
admins and enabled staff; reports and refund endpoints use it with
least-privilege defaults. Admins manage toggles at `/settings/security` via
`GET/PUT /auth/permissions`. Covered by `backend/tests/test_security.py` and
`frontend/e2e/verify-security.cjs`.

## Multi-store and consolidated reporting

A `stores` registry is seeded with MAIN. `GET/POST/PATCH /restaurant/stores`
lists stores with 30-day metrics, creates locations and updates/pauses them; the
last active store cannot be paused. Orders accept `store_id` (default 1 and
validated active), and `GET /restaurant/stores/consolidated` returns per-store
and group revenue/orders/AOV/tips/refunds over a business-day range plus the best
store. The admin UI is `/settings/stores`. Covered by
`backend/tests/test_stores.py` and `frontend/e2e/verify-stores.cjs`.

## Accounting and GST export

`GET /restaurant/accounting/summary` aggregates non-cancelled orders over a
business-day range (optionally by store) into gross sales, discounts, 5% GST
split into CGST/SGST, tips, refunds, net collected, AOV, payment mix and store
totals. `GET /restaurant/accounting/export` streams a CSV with one row per order
(business date, store, payment, subtotal, discount, CGST/SGST, tip, refund, net)
for import into Tally/Zoho/QuickBooks. The `/accounting` page provides the date
range, cards, payment/store tables and download. Covered by
`backend/tests/test_accounting.py` and
`frontend/e2e/verify-accounting.cjs`.

## Aggregator integration intake

Admins connect a platform per store (`POST /restaurant/integrations/aggregators`)
and receive a token-scoped webhook URL. `POST .../webhook/{platform}` validates
the `X-Aggregator-Token`, maps payload items to the menu (falling back to the
sent price for unmapped items), creates a delivery order with customer/address/
payment state and store, and records an `aggregator_orders` row. Replaying the
same `external_order_id` returns the original order; invalid, rotated or paused
tokens are rejected. `/settings/integrations` shows copyable URL/token, pause,
rotate and order counts. Covered by `backend/tests/test_aggregators.py` and
`frontend/e2e/verify-aggregators.cjs`.

## Shift scheduling and labour

`GET/POST/PATCH/DELETE /restaurant/shifts/schedule` manage a forward roster with
staff, role, date, start/end, hourly rate and status. `GET
/restaurant/shifts/labour-summary` returns scheduled hours, wage cost, sales and
labour percentage with day and role breakdowns. The admin page
`/shifts/schedule` offers weekly navigation, add/confirm/delete and dashboard
cards. Covered by `backend/tests/test_shift_schedule.py` and
`frontend/e2e/verify-shift-schedule.cjs`.

## Menu allergens and nutrition

Menu items store `allergens`, `dietary_tags`, `calories`, `protein_g`, `carbs_g`
and `fat_g` (migration). `POST /restaurant/menu/menu` accepts them (trimmed and
deduped), both `/menu` and `/menu-with-customizations` return them, and the
customer menu renders dietary chips, kcal and “Contains:” allergens. The admin
menu modal edits allergens as a comma list, tag toggles and macros. Covered by
`backend/tests/test_menu_nutrition.py` and
`frontend/e2e/verify-menu-nutrition.cjs`.

## Channel-specific pricing

`menu_item_channel_prices` stores optional price/availability/visibility
overrides for `dine-in`, `takeaway`, `delivery` and `aggregator`. The menu save
endpoint syncs them; both menu APIs return them; the customer menu uses the
active channel price, hides unavailable or hidden channels and reprices the cart
when switching pickup/delivery; order creation enforces the same channel price
and rejects an unavailable/hidden channel. Covered by
`backend/tests/test_channel_pricing.py` and
`frontend/e2e/verify-channel-pricing.cjs`.

## Security headers and error monitoring

Next sends CSP (default/script/style/img/connect/frame rules), HSTS,
X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy. FastAPI adds
API CSP plus the same hardening headers, echoes/generates `X-Request-ID`, logs
unhandled exceptions with the ID, and returns a JSON 500 fallback. Client error
boundaries report to `POST /restaurant/ops/client-errors`; admins read recent
reports via the API and the Production Ops monitor. Covered by
`backend/tests/test_security_headers.py` and
`frontend/e2e/verify-security-headers.cjs` (including a CSP-violation check).

## POS hardware

`pos_hardware_configs` stores per-store printer name, 58/80mm paper, auto-print,
receipt header/footer, cash-drawer pin/state and customer-display URL.
`GET/PUT /restaurant/hardware/{store_id}` manage it; `POST .../test-print`
returns printable HTML/text; `POST .../drawer-pulse` returns the ESC/POS byte
sequence. `/settings/hardware` configures and tests them, and `/customer-display`
is a branded idle screen. Covered by `backend/tests/test_hardware.py` and
`frontend/e2e/verify-pos-hardware.cjs`.

## Aggregator outbound status sync

Integrations store an outbound URL, HMAC secret and enabled flag. Order status,
close, cancel and delivery transitions queue an idempotent `aggregator_events`
row; `deliver_aggregator_events` POSTs the JSON with `X-Pizza-Signature` (and
event header), marks sent, or retries with backoff (1/5/15/60/180 minutes, five
attempts) and records the error. A one-minute scheduler drains the queue; admins
can list events. Covered by `backend/tests/test_aggregator_outbound.py` using a
local HTTP receiver.

## Aggregator menu sync

Integrations store a menu-sync URL/enabled flag. `POST
/restaurant/integrations/aggregators/{id}/menu-sync` builds the full menu (item
price, availability, allergens, dietary tags, macros and channel
price/availability/visibility) and POSTs a signed `menu.sync` payload. The result
(`sent`/`failed`, item count, HTTP status/error) is returned to the operator and
shown in the integrations UI. Covered by
`backend/tests/test_aggregator_menu_sync.py`.

## Deployment readiness

`GET /restaurant/ops/deployment-checklist` (admin) returns ready/warn/blocked
checks for database reachability, Alembic head, auth-secret strength, master
admin, CORS origins, media writability, live payment provider and security
headers, with remediation text, summary counts and verification commands.
`/settings/deployment` renders it. Covered by
`backend/tests/test_deployment_checklist.py` and
`frontend/e2e/verify-deployment-checklist.cjs`.

## Feedback and NPS

Completed orders can submit one phone-verified feedback row (`order_feedback`
migration): 1–5 stars, 0–10 NPS, up to five tags and a comment. The tracking page
shows the form once and thanks the guest after submission; duplicates, wrong
phones and incomplete orders are rejected. `/feedback` shows NPS, average
rating, response rate, rating distribution, top tags and low-rating follow-up.
Covered by `backend/tests/test_feedback.py` and
`frontend/e2e/verify-feedback.cjs`.

## Departments

`GET/POST /restaurant/departments`, department detail/update/delete, membership and the
module catalogue let admins create business units without schema changes. Operations and
People & HR are seeded; HR's people/leave/payroll/onboarding/documents/exits modules stay
`planned` until the Euron pilot is connected, and the external-system panel never reports a
fake link. Covered by `backend/tests/test_departments.py` and
`frontend/e2e/verify-departments.cjs`.

## HR People directory

`GET/POST /restaurant/hr/employees`, `PATCH /employees/{id}` and `GET /summary` manage a
local employee mirror under the People & HR department: code, designation, employment
type/status, joining date, store, reporting line, notes and an optional POS staff link.
`/departments/hr/people` provides search/filter, summary cards and create/edit. The model
also carries external system/id fields for the future Euron sync. Covered by
`backend/tests/test_hr.py` and the departments proof.

## HR leave and holidays

`/restaurant/hr/leave` provides leave types, per-employee/year balances, requests,
approve/reject/cancel, balances overview, summary and holiday CRUD. Default types are
casual, sick, earned and unpaid; earned leave carries forward up to its cap. Requests
validate date order, overlap and remaining paid balance; approvals reserve days and
cancellation restores them. `/departments/hr/leave` exposes Requests, Balances, Holidays
and Leave types. Covered by `backend/tests/test_hr_leave.py` and
`frontend/e2e/verify-hr-leave.cjs`.

## HR attendance

`/restaurant/hr/attendance` records one row per employee/day with clock-in/out, worked
minutes, status and note. The day roster merges active employees, attendance and approved
leave (`on_leave`), blocks clock-in on approved leave, detects half-days under four hours,
and supports HR regularisation plus monthly history. `/departments/hr/attendance` shows the
roster, summary cards and clock/regularise actions. Covered by
`backend/tests/test_hr_attendance.py` and `frontend/e2e/verify-hr-attendance.cjs`.

## HR payroll

`/restaurant/hr/payroll` stores salary structures and generates one draft pay run per
month: attendance/unpaid leave prorate basic/HRA/allowances, PF is 12% of basic up to the
Rs 15,000 cap, ESI applies only up to Rs 21,000 gross, professional tax is the configured
flat amount and TDS is HR-entered. Draft runs can be recalculated, finalized runs lock, and
each payslip carries earnings/deductions, employer contributions and a printable view.
`/departments/hr/payroll` exposes pay runs and salary structures. Covered by
`backend/tests/test_hr_payroll.py` and `frontend/e2e/verify-hr-payroll.cjs`.

## HR onboarding

`/restaurant/hr/onboarding` manages candidates with auto codes, statuses and six default
tasks (ID/address, bank, offer, emergency contact, orientation). Tasks can be completed or
reopened; conversion creates an `hr_employees` row and links it only when every task is done
(or `force` is explicitly requested), and marks the candidate `joined`. The page exposes the
pipeline, checklist and guarded convert action. Covered by
`backend/tests/test_hr_onboarding.py` and `frontend/e2e/verify-hr-onboarding.cjs`.

## HR documents and letters

`/restaurant/hr/documents` stores PDF/JPEG/PNG/DOCX files under private
`MEDIA_ROOT/hr_private` (not the public media mount), with employee, category, title,
visibility, expiry and notes, plus authenticated download/delete. `/restaurant/hr/letters`
issues offer, confirmation, experience and relieving letters with a `PBL-` verification
code; `/restaurant/hr/verify-letter/{code}` is public and returns only disclosed fields.
`/departments/hr/documents` provides the vault and letter UI. Covered by
`backend/tests/test_hr_documents.py` and `frontend/e2e/verify-hr-documents.cjs`.

## HR exits and settlement

`/restaurant/hr/exits` creates resignation/termination/absconding/retirement records with
notice days, six clearance tasks and a settlement preview: pending salary to the last
working date, earned-leave encashment at basic/30, gratuity at 5+ years, and notice
recovery for the shortfall. Settlement requires all clearance tasks (or an explicit force)
and then sets the employee to exited and deactivates the linked staff credential.
`/departments/hr/exits` exposes creation, clearance toggles and settlement. Covered by
`backend/tests/test_hr_exits.py` and `frontend/e2e/verify-hr-exits.cjs`.

## HR department access

HR staff must be members of the People & HR department (role head/manager/member) and have
the matching staff permission (`hr.view`, `hr.people`, `hr.leave`, `hr.attendance`,
`hr.payroll`, `hr.onboarding`, `hr.documents`, `hr.exits`). Admins bypass. HR members see
only the HR department; unpermitted modules are locked in the UI. `/restaurant/hr/access`
describes the caller. Covered by `backend/tests/test_hr_permissions.py` and
`frontend/e2e/verify-hr-permissions.cjs`.

## HR analytics

`/restaurant/hr/overview` (requires `hr.view`) aggregates headcount, new joiners, workforce
mix, today's attendance rate, on-leave count, leave liability, latest/YTD/trend payroll,
onboarding funnel, attrition, exit counts and document expiry. `/departments/hr` renders
the command center with module links. Covered by `backend/tests/test_hr_analytics.py` and
`frontend/e2e/verify-hr-analytics.cjs`.

## Media Studio

`/settings/media` is the shared image library. Uploads are validated by magic bytes (JPEG,
PNG, WebP; 5 MB), stored under `media/library`, searchable by name/tag and guarded against
deletion while a menu item, social post or ad campaign uses the URL. Menu uploads register
automatically, and one picker is reused in menu, social and ad forms. Covered by
`backend/tests/test_media_library.py` and `frontend/e2e/verify-media-studio.cjs`.

## Landing page CMS

`/settings/content` edits hero headline/highlight/subtitle, the kitchen-story title and body,
hero/story images and six category images through Media Studio. Saves write
`storefront_content` and call an authenticated on-demand revalidation hook for `/` and
`/menu`; restore defaults deletes the row. Covered by
`backend/tests/test_storefront_content.py` and `frontend/e2e/verify-landing-cms.cjs`.

## Tax and billing

`/settings/billing` controls the tax rate/label, invoice footer and customer tip presets.
Order creation, coupon validation and aggregator intake use the configured rate; invoices
split the collected tax into equal CGST/SGST; the public checkout and POS estimates fetch
the same public setting. Covered by `backend/tests/test_billing_settings.py` and
`frontend/e2e/verify-billing-settings.cjs`.

## Provider credentials

`/settings/providers` stores email, SMS, WhatsApp, Meta social and Meta ads credentials
encrypted with a Fernet key derived from `AUTH_SECRET_KEY`. Reads mask secrets; saves merge
non-empty fields; reset removes the override. Campaign, social and ads readiness/send paths
resolve the stored config with per-field environment fallback, so existing deployments keep
working. Validation checks required fields only and does not send a live message. Covered by
`backend/tests/test_provider_settings.py` and `frontend/e2e/verify-provider-settings.cjs`.

## Messaging inbox

`/messaging` is the shared conversation inbox. Inbound WhatsApp/Twilio/email payloads hit
`POST /restaurant/messaging/webhook/{channel}` with `MESSAGING_WEBHOOK_TOKEN` (query
`token` or `X-Webhook-Token`); Meta's GET verification is supported. Threads can be read,
marked read, put on pending/closed and replied to through the configured provider; delivery
status and provider errors are stored on each outbound message. Templates are reusable per
channel. Covered by `backend/tests/test_messaging_inbox.py` and
`frontend/e2e/verify-messaging-inbox.cjs`.

## Marketing journeys

`/journeys` creates active sequences with a trigger (`order_completed`, `order_delivered`,
`feedback_low`, `manual`), delay/send steps and optional templates. Order completion/delivery
and low-feedback hooks enroll contacts; a one-minute APScheduler job processes due steps and
records each step result. Enrollment is unique per journey/trigger reference, and provider
failures are stored as failed/skipped events rather than blocking the sequence. Covered by
`backend/tests/test_marketing_journeys.py` and `frontend/e2e/verify-marketing-journeys.cjs`.

## HR recruitment

`/departments/hr/recruitment` creates jobs, adds applicants, moves them through
applied → screening → interview → offer → hired/rejected with enforced transitions, schedules
interviews and records stage history. Marking a candidate hired creates a linked onboarding
candidate and carries the job title into the onboarding record. Covered by
`backend/tests/test_recruitment.py` and `frontend/e2e/verify-recruitment.cjs`.

## Public careers

`/careers` lists open jobs and `/careers/{id}` collects an application with name, email/phone,
expected salary and notes. The public API (`/restaurant/careers/jobs`) exposes only open roles;
applications are rate-limited and write directly into the recruitment pipeline with source
`Careers page`. Draft/closed jobs return 404 publicly. Covered by
`backend/tests/test_careers.py` and `frontend/e2e/verify-careers.cjs`.

## Marketing Hub and reels

`/marketing` aggregates social posts, promotions and ad campaigns into a month calendar with
kind filters and an upcoming list. The composer schedules image, video or reel posts; reels
require a public `video_url` and optional cover image. Instagram reels publish through the
Graph `REELS` container flow; Facebook video/reels are explicitly skipped. Covered by
`backend/tests/test_marketing_hub.py` and `frontend/e2e/verify-marketing-hub.cjs`.

## Payment provider credentials

Cashfree, Razorpay and direct-bank cards join the encrypted provider registry. A merged
`payment_values()` resolver feeds checkout status, session creation, direct-bank instructions,
Cashfree/Razorpay request credentials and webhook signature secrets. Stored values override
environment field by field; direct bank accepts either UPI or complete bank account details.
Covered by `backend/tests/test_payment_provider_registry.py` and
`frontend/e2e/verify-payment-providers.cjs`.

## Item-level KDS

`PATCH /restaurant/orders/{id}/items/{line_index}/status` moves one line
between open/preparing/ready. Recalling to preparing/open clears the ready/
started timestamps, the ticket status is aggregated from all lines, and each
change is audited with line index/name. The KDS board exposes Start/Bump/Recall
per line. Covered by `backend/tests/test_kds_item_status.py` and the existing
`verify:kds` proof.

## Health endpoints

- `GET /health` returns process status.
- `GET /ready` runs `SELECT 1` against the configured database and returns
  `503` when it is unreachable, so a load balancer does not route traffic to a
  broken instance.

## Known non-blocking warnings

- `react-hooks/exhaustive-deps` warnings where a loader intentionally runs once
  on mount.
- `<img>` usage on marketing surfaces instead of `next/image`.
