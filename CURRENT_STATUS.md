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
- Automation: 159 backend tests, 144 browser proof scripts plus portal smoke, a backend Ruff
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
- Scheduled pickup/delivery orders: 15-minute slots up to 14 days ahead,
  capacity-checked, validated against opening hours, and shown in checkout,
  tracking, POS, kitchen cards, tickets and receipts. Closed stores still accept
  future orders; paused stores do not.
- New `verify:scheduled-orders` browser proof and seven backend tests.
- Tips at customer checkout (presets and custom amount) and POS, persisted on
  the order, included in totals and receipts, with a tips summary endpoint and a
  "Tips Today" POS tile.
- New `verify:order-tips` browser proof and six backend tests.
- Mobile polish: reports, menu and inventory now render card lists instead of
  horizontally scrolling tables at 390px (0 wide tables), menu action targets
  are 40px, and icon-only controls get a 40px mobile hit area.
- New `verify:responsive-tables` browser proof; W2 is complete.

Wave 3 (in progress):

- Refunds and voids: admin-only full/partial refunds with amount, reason,
  method, reference, ledger and audit event; refunded/refundable totals on the
  order; POS refund dialog and badge; receipt/tracking refund lines; refund
  summary endpoint. Gateway-initiated refund calls remain a provider step.
- New `verify:order-refunds` browser proof and five backend tests.
- Dedicated KDS: full-screen `/kds` board for staff with Incoming/Preparing/Ready
  columns, station filters, live timers, overdue highlighting, per-station
  bump/recall, chime, fullscreen and 8-second refresh.
- New `verify:kds` browser proof and four backend tests.
- Order status notifications: preparing, ready, out-for-delivery, delivered,
  completed and cancelled events over the configured SMS/WhatsApp/email
  provider, gated by `ORDER_NOTIFICATIONS_ENABLED`, recorded per order with
  sent/skipped/failed status, and listed on customer tracking.
- New `verify:order-notifications` browser proof and six backend tests.
- Menu media: admin uploads (JPEG/PNG/WebP, ≤5 MB, magic-byte validated), alt
  text, replace/remove, thumbnails in the admin menu and customer catalog, and
  uploaded images on the landing page. Files are served from `/media` through a
  Next rewrite; `MEDIA_ROOT` selects the storage directory.
- New `verify:menu-media` browser proof and four backend tests; W3 is complete.

Wave 4 (in progress):

- Customer OTP login: six-digit hashed codes with five-minute expiry, attempt
  limits and rate limits; delivered via SMS/WhatsApp/console. Phone-only
  `/auth/customer/login` now returns 401 and requires a matching recent order.
- Account login page has "One-time code" and "Order details" tabs; the Next
  session route sets the customer cookie after backend OTP verification.
- New `verify:customer-otp` browser proof and four backend tests.
- Saved addresses: up to 10 per customer with default handling, edit/delete,
  customer-token scoping, account-page management, and checkout chips that fill
  the delivery address.
- New `verify:saved-addresses` browser proof and four backend tests.
- Loyalty: 1 point per ₹1 on completed orders (idempotent ledger), tiers,
  referral codes with a 100-point two-sided bonus, account-page loyalty card
  with points/tier/progress/referrals/activity, and a checkout referral field.
- New `verify:loyalty` browser proof and four backend tests.
- Points redemption at checkout: 10 points = ₹1, 100-point minimum, 15-minute
  reserved reward token validated against the customer, pre-tax discount,
  points debited with a redeem ledger row, single-use enforcement.
- New `verify:loyalty-redemption` browser proof and two backend tests.
- Rider app: tokenized `/rider/{token}` mobile page, start delivery, GPS sharing,
  photo/signature/OTP proof required before delivered, failed reasons, admin
  Rider link button, and rider status/location on customer tracking.
- New `verify:rider` browser proof and two backend tests.
- Custom report builder: metrics × dimensions, date range, filters, saved views,
  CSV export, daily/weekly/monthly schedules with recipients, email delivery
  through the provider layer, and a 5-minute scheduler for due reports.
- New `verify:report-builder` browser proof and four backend tests.
- Security: TOTP 2FA with hashed one-time recovery codes and a two-step login
  challenge in the portal and API; granular staff permissions enforced on
  reports and refunds; `/settings/security` for setup, recovery codes and
  toggles.
- New `verify:security` browser proof and two backend tests.
- Multi-store: stores registry (MAIN seeded), add/pause/activate locations,
  order `store_id`, and a consolidated business-day report with group totals and
  best store at `/settings/stores`.
- New `verify:stores` browser proof and three backend tests.
- Accounting/GST: summary with CGST/SGST, tips/refunds, payment and store mix,
  plus a Tally/Zoho-ready order CSV at `/accounting`.
- New `verify:accounting` browser proof and two backend tests.
- Aggregators: token-scoped inbound webhooks for Swiggy, Zomato, Uber Eats and
  DoorDash with idempotent external order IDs, store mapping, pause/rotate and
  `/settings/integrations`.
- New `verify:aggregators` browser proof and three backend tests.
- Workforce: weekly shift scheduling with hourly rates, confirmation, roster,
  and a labour-versus-sales dashboard at `/shifts/schedule`.
- New `verify:shift-schedule` browser proof and two backend tests.
- Menu allergens/nutrition: per-item allergens, dietary tags, calories and
  macros with admin editing and customer-menu badges.
- New `verify:menu-nutrition` browser proof and two backend tests.
- Channel pricing: per-channel price/availability for dine-in, takeaway, delivery
  and aggregator; customer menu/cart and order totals follow the active channel.
- New `verify:channel-pricing` browser proof and two backend tests.
- Security headers/CSP and error monitoring: CSP/HSTS/nosniff/frame/referrer/
  permissions headers, request IDs, server exception logging, client error
  boundaries and the Production Ops monitor.
- New `verify:security-headers` browser proof and two backend tests.
- POS hardware: per-store printer/paper/receipt settings, test-print
  HTML/text, ESC/POS drawer pulse, customer-display URL and a branded display
  screen at `/customer-display`.
- New `verify:pos-hardware` browser proof and two backend tests.
- Aggregator outbound status sync: HMAC-signed partner webhooks, per-order/status
  idempotency, retries/backoff, event log and a one-minute scheduler.
- Two backend tests (signed delivery, retry/validation); existing aggregator
  proof covers the new outbound settings section.
- Channel item visibility: per-channel visible flag so an item can be priced but
  hidden from a channel; admin toggles and order enforcement.
- Existing channel-pricing proof now checks a delivery-hidden item disappears.
- Aggregator menu sync: signed full-menu push (pricing, channel prices,
  allergens, nutrition) with menu URL/enable settings and push result.
- Two backend tests with a local receiver; integrations UI exposes menu sync.
- Deployment checklist: DB/migrations/secret/admin/CORS/media/payments/headers
  with ready/warn/blocked states, remediation and verification commands at
  `/settings/deployment`.
- New `verify:deployment-checklist` proof and two backend tests.
- Fixed a store-profile singleton race that could 500 concurrent first requests.
- Feedback & NPS: one-time post-order rating/NPS/tags/comment on tracking and an
  admin dashboard with NPS, response rate, distribution and low-rating follow-up.
- New `verify:feedback` proof and two backend tests.
- Item-level KDS: independent start/bump/recall per line, timestamp clears on
  recall, aggregate ticket status and per-line audit.
- Two backend tests; the existing KDS proof now bumps a single line.
- Department registry: Operations and People & HR seeded; create departments from a
  shared module catalogue, assign staff and track an external HR system.
- People & HR shows its planned people/leave/payroll/onboarding/documents/exits modules
  and the Euron Open HRMS pilot without faking a connection.
- Three backend tests and `verify:departments`; HR is now a department under the admin
  domain, not a separate product.
- HR People directory is live: employee code/designation/type/status/joining date/store,
  optional POS staff link, search/filter and summary; two backend tests and the
  departments proof.
- HR Leave & holidays is live: leave types, per-employee/year balances, request/approve/
  reject/cancel, holidays and summary; new `verify:hr-leave` proof and two backend tests.
- Next: HR attendance, payroll, onboarding/documents/exits, department permissions.

## Verified State (2026-10-22)

- `python -W error::FutureWarning -m unittest discover -s tests -v`: 159 tests
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
