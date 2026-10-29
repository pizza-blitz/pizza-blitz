# Pizza Blitz Current Status

Last Updated: 2026-10-29
Status: local/staging complete through the Company OS program. Production launch is
blocked on hosting and provider credentials, not on code. See
[HANDOVER.md](HANDOVER.md) for the runbook, verified state and honest limitations.

## Source Of Truth

Standalone workspace:

`D:\Development\pizza Blitz`

This project was copied from `D:\Development\EduEcosystem\restaurant-portal`.
The standalone copy excludes generated dependency and build folders
(`node_modules`, `.next`, `venv`, `__pycache__`).

## What Exists

- Backend: FastAPI app with 510 operations across 428 paths — auth, sales, stats,
  menu, inventory, expenses, orders/POS, invoices, delivery, promotions, social,
  ads, customers, shifts, vendors, purchase orders, recipes, waste, imports,
  feedback, support, messaging, journeys, departments, company work, HR,
  finance, aggregators, hardware, assistant and production ops.
- Frontend: Next.js 14 app with the public customer website (landing, order
  menu, cart, checkout, confirmation, tracking, account, careers, support,
  offers, receipts, rider and customer display) and the internal portal
  (70 catalogued routes: dashboard, POS/counter, KDS, operations, reports,
  marketing, finance, HR, 11 department workspaces, settings and ops).
- Departments: 16 department specs — 10 functional departments plus Company
  shared services, with five sub-departments (Guest Experience, Facilities,
  Legal, Training, Franchise) grouped under their parents. 70 catalogued
  modules, 101 active module definitions after shared services are resolved.
- Data layer: SQLAlchemy models for every flow, 119 application tables,
  Alembic migrations through `9f8e7d6c5b4a`, SQLite for local development,
  PostgreSQL support for production.
- Automation: 364 backend tests (87 subtests), 176 browser proof
  scripts plus portal smoke, backend Ruff, frontend lint, TypeScript and
  production build gates, and a GitHub Actions workflow that runs them.

## Company OS Program (2026-10-27 → 2026-10-28)

The follow-on program turned the platform into a department-organized company
operating system and rebuilt the customer entry path for conversion. Plan and
audit: [docs/COMPANY_OS_BLUEPRINT.md](docs/COMPANY_OS_BLUEPRINT.md).

**Conversion rescue (Phase 0)**

- Landing and menu CTAs route guests to `/order`; offer cards deep-link with the
  coupon code; `/menu` stays a staff menu manager.
- Cart, fulfilment mode, coupon and schedule persist across reloads and reprice
  on restore; checkout failures show inline errors instead of failing silently.
- A dedicated confirmation page shows order number, ETA and tracking, and
  tracking refreshes automatically.
- Customer-facing privacy/trust fixes: no staff panels on the customer page,
  marketing consent off by default, labelled inputs and mobile keyboards.
- Landing facts come from the store profile; no address, phone, FSSAI number,
  analytics ID or review was invented.

**Company OS foundation (Phase 1)**

- 16 department specs and 70 catalogued modules with exact portal route
  coverage; department parent/head/cost-centre/store fields; scoped roles,
  permissions and membership; navigation generated from the registry.
- `/departments` company scorecard and `/departments/{key}` workspaces with KPI
  strip, needs-you queue, team, modules and quick actions.
- Generic work items, comments, approvals and unread notices at `/work`;
  expenses, purchase orders, HR leave and social posts create approvals.
- Department/store tags on audit events; anonymous sessions no longer default
  to the admin shell.

**Department depth (Phase 2)**

- Operations checklists (templates, runs, per-item state, sign-off) at
  `/departments/operations/checklists`.
- Facilities asset register, preventive maintenance and breakdown work orders at
  `/departments/facilities/assets`.
- Menu engineering matrix with margin/popularity quadrants and actions at
  `/departments/kitchen/engineering`.
- Stocktakes with variance valuation and stock corrections at
  `/departments/supply/stocktake`.
- Food-safety audits with CAPA and temperature/CCP logs at
  `/departments/quality/audits`; licence and contract register with expiries at
  `/departments/legal/licences`.
- Training courses, records and certification expiry at
  `/departments/training/lms`.
- Gift cards: issue, reload, redeem, void, public balance check, checkout debit,
  refund credit-back and liability summary at
  `/departments/revenue/gift-cards`.
- Company goals and franchise site pipeline at
  `/departments/executive/budget` and `/departments/franchise/pipeline`.
- Data-platform overview and exports at `/departments/technology/data`.
- Finance outlet P&L and store dimensions; store pickers across ledgers.

**AI concierge and landing**

- `/api/v1/assistant/chat` answers menu, offer, hours and delivery questions,
  adds/removes cart lines and returns a checkout hand-off. It is deterministic
  over live data; an optional LLM answer path stays provider-gated.
- Blaze, the 3D talking avatar, supports text and browser speech, quick replies
  and product cards, and can build the customer's cart before checkout.
- Verified guests can save allergies and dietary preferences to a customer
  memory (table `customer_memories`). Blaze greets returning guests with what it
  remembers, filters recommendations that conflict with a saved allergen, warns
  when an explicitly added item lists one, and the customer can forget the
  memory. The saved allergy also follows the guest out of the chat: the checkout
  panel reads the same proof-gated memory and shows a "Saved from your last
  visit" reminder above Place Order, and flags any cart item whose menu
  allergens match the saved words. When the guest places that order, the saved
  allergy is written onto the order and the Kitchen Display card shows a red
  "Allergy · confirm before serving" strip, so the kitchen receives it without
  the guest repeating it. Forgetting deletes the row, hides the recap strip, and replaces the
  saved chat transcript on the device so the old allergy greeting does not
  remain on screen (the cart is kept). A guest who has consented also sees the
  latest order summary, usual fulfilment and recent favourites, read from their
  own order history only after the same phone proof, so the next greeting can
  offer the same order again. An order alone never creates a memory row.
  Anonymous chat still works but never stores an unproved phone number.
- A proved guest can also ask **"where is my order?"** without retyping
  anything. The same session or order-id proof resolves that phone's newest live
  order (under a day old, not closed, cancelled, or already delivered), and
  Blaze answers with the guest-facing state, ETA window and rider, plus a Track
  action that opens `/track?order=…&phone=…` on that exact order. The greeting
  names the live order too, so the first message is already current. A guest
  with no live order still gets the id-and-phone lookup form, and a different
  customer's session never sees someone else's order.
- The same proof makes **"repeat my usual"** work. Blaze reads the guest's
  newest real order (under 90 days, not cancelled), re-prices every line against
  the live menu and channel, reapplies the saved sizes and options, and rebuilds
  the cart without the guest retyping a thing. Gone or channel-hidden items are
  named and skipped, a customisation that no longer exists falls back to the
  standard build with a note, a saved-allergy conflict still carries the visible
  warning, and the greeting offers Repeat my usual as a quick reply. An
  anonymous visitor is asked to confirm their phone first, and another customer's
  phone never supplies the items.
- Customer tracking includes a live rider map (Leaflet + OpenStreetMap, no API
  key) with a pulsing rider marker that glides to each new fix, a 15 second
  refresh while a rider is assigned or out for delivery, and an "Open in maps"
  fallback for the delivery address.
- A rider can put the page in **live mode** while out for delivery: the browser
  streams a GPS fix every 20 seconds (and immediately on movement), so the
  customer map stays warm without repeated taps. The rider can publish a
  call-back number; the customer sees a Call rider button only during assigned
  and out-for-delivery states, and the number disappears once the handoff is
  complete.
- The operations page carries the same live data for the store team: every rider
  on an assigned or out-for-delivery order is plotted on one keyless Leaflet
  dispatch map, refreshed every 15 seconds, with a last-fix age that turns amber
  after three minutes, a per-order rider list, and a Call rider link. The
  `verify-rider` proof asserts the customer map, the dispatch marker and row,
  and the staff call link in the same run.
- The landing page shows live menu, offers, delivery areas, kitchen standards,
  FAQ, JSON-LD/OG metadata and a concierge entry, responsive to 390px.

**Cross-check fixes (2026-10-28)**

- `/ai-insights` no longer fails when the optional AI key is absent. The endpoint
  returns HTTP 200 with `status: "fallback"` and a summary/tips calculated from
  the same 30-day sales, expense and low-stock figures the model would have
  read, and the page shows them as an amber notice with an honest model status.
  The invented "Potential Monthly Yield Rs 4,500+" panel and the always-"Active"
  Gemini badge were removed.
- Backend lint had silently drifted to 11 ruff findings (unused imports in the new
  Company OS services, an `md5` cart-line key, an unused loop variable). All fixed;
  `ruff check .` is green and the suite grew with
  `backend/tests/test_ai_insights.py`.
- `npm run verify:ai-insights` now covers all four page states (success, resync,
  no-provider fallback, provider failure) and is wired into
  `npm run verify:audit:live`, which previously skipped it.
- The launch path got two real safety nets. Production now refuses to start on a
  SQLite URL: the API default is `sqlite:///:memory:`, so a deploy that forgot
  `SQLALCHEMY_DATABASE_URI` used to boot green and hold the restaurant's orders in
  RAM until the process was recycled. The deployment checklist also gained a
  separate "Database survives a restart" row, because "reachable" and "durable" are
  different promises. And `backend/tests/test_migration_chain.py` renders the whole
  Alembic history as Postgres SQL for the first time — until now no test had ever
  touched a migration, even though `alembic upgrade head` is the only thing that
  creates the tables in a real deployment. The chain has one head, reaches
  `9f8e7d6c5b4a`, and renders the generated `daily_sales.profit` expression that
  SQLite drops. The suite grew with these additions.
- The launch is now aimed at **Supabase** rather than Google Cloud: plain Postgres, one
  connection string, no service accounts. `backend/check_database_uri.py` is the first
  command to run with that string — it rejects SQLite, warns about Supabase's transaction
  pooler and a missing `sslmode`, connects with a timeout, takes the same advisory lock the
  bootstrap needs, compares `alembic_version` with the head and lists missing tables. It
  prints the URL with the password replaced, and
  `backend/.env.deploy.local.example` lists every value to fill in. Twelve tests cover the
  checker's pure logic; the live connection path runs the moment a real URL exists.
- The local address is now one name everywhere: `http://localhost:3011`. A frontend
  started with `--hostname 127.0.0.1` answers both loopback spellings with `localhost`,
  so links and proofs that used `127.0.0.1` were crossing origin on every sign-in
  redirect. That broke the surface audit with a blocked prefetch and would do the same
  for a person who typed the other spelling. Generated links, proof defaults in 173
  files, `.env.example` and the operator docs now agree, links from public pages into
  the customer area no longer prefetch a page that redirects, and the browser policy
  allows both loopback names only while the site address is loopback. The full surface
  audit passes on the rebuilt bundle.

**Audit reliability and final green run (2026-10-29)**

- The latest full run, on the build that carries the saved allergy onto the
  order record and the Kitchen Display, measured **65/65 in 6.6 minutes**
  against `http://localhost:3011` and build `FwJA3-Y0izweWvL60Hp_T`, with no
  step needing the runner's retry. `verify:role-gates`, at step 63, waited out
  the sign-in bucket inside its own first attempt (7 s, 7 s, 5 s, then a full
  62 s window after a second 429) and passed; the proof now escalates to a
  one-minute wait instead of spending its retries on short hops. The preceding
  run, on build `DOQhssetzwvE976yCNrUe` with the checkout allergy reminder,
  measured 65/65 in 7.4 minutes and retried `verify:finance-pnl` and
  `verify:restaurant-ready-audit` once each, both passing.
- The 65-step live audit now runs through `e2e/verify-audit-live.cjs`, which
  names the step in progress, retries a failed step once, and preloads a
  sign-in-only throttle retry. An earlier run, on the build with the
  proof-gated "where is my order?" answer, the repeat-my-usual rebuild and the
  payment-provider proof fix, measured **65/65 in 7.9 minutes** against
  `http://localhost:3011` and build `q4F1QOsTCY9NG9FcBRFHq`, from a cold
  backend. `verify:role-gates` waited out its own sign-in throttle and passed,
  as it does by design. The runner retried two steps once each and both passed:
  `verify:recruitment-resume` and `verify:support-tickets`; the closing summary
  named both. The preceding run measured 65/65 in 6.0 minutes on the same build
  with no retried step. The run before that, on the build with the tracking
  countdown and its UTC clock fix, measured 65/65 in 6.9 minutes on
  `aoBXW8tALLb64iQB615xf` and used the runner's one retry for
  `verify:role-gates`; before that, 6.3 minutes on `dpbIX6o3R8E2GjsAnSQGs` with
  no retried step, and 7.4 minutes on `uc8ZjSN_HX5gl-4btzECH` with one
  `verify:payment-providers` retry after a 20-second wait for the "Required
  fields are present" message. An earlier run of the same 65 steps measured 5.5
  minutes with no retried step. The retry stays as a safety net; the closing
  summary always names any retried step.
- The payment-provider proof no longer races its own save. It waited for the
  word "Payments" after clicking Save, but that is the group heading and was
  already on screen, so Validate could run before the save finished and its
  message was then overwritten by the save response. An intermediate audit run
  failed that step twice for this reason. The proof now waits for "saved with
  encrypted credentials"; the step passed alone, then inside the full run.
- `/api/admin-session` now passes a throttled sign-in through as 429 with
  `Retry-After`, returns 401 for rejected credentials, and reserves 503 for a
  role with no credential at all, instead of reporting every failure as
  "credentials are not configured". A staff sign-in is judged by the staff check,
  never by the admin probe.
- `verify:role-gates` now waits out the throttle on its two Playwright browser
  logins; it stays outside the preload because it asserts the throttle itself.
- Customer memory now has browser proof, not only API tests. The new
  `verify:customer-memory` step signs one customer in twice in two fresh browser
  contexts: the first visit tells Blaze "I'm allergic to peanuts" and the stored
  row appears in the "Remembered from last visit" strip; the second visit is
  greeted with "I remember you avoid: peanuts" without repeating it; Forget
  deletes the row and clears the strip. The same step places a real pickup
  order, checks the greeting names it, follows "Where is my order?" to the live
  countdown, and asks "Repeat my usual" — asserting the reply names the saved
  item at a live price and the cart footer reads "1 item · ₹…". The same
  session then opens `/order`, where the saved allergy appears above Place
  Order as "Saved from your last visit: allergic to peanuts" (screenshot
  `checkout-allergy-memory.png`), proving memory reaches the payment moment,
  not just the chat. It is step 7 of
  the ordered audit, directly after the Blaze proof; the memory rules and the
  three repeat-order tests stay in the normal backend suite.
- Blaze now greets a landing visitor instead of waiting to be found. A
  dismissible speech bubble appears after 4.2 seconds, once per browser
  session, opens the concierge when tapped, and personalises itself from a
  signed-in guest's memory ("Welcome back. Want the usual? I remember: no
  peanuts."). The Blaze proof asserts the greeting opens the concierge and
  stays gone after a reload; the memory proof asserts the personalised line in
  a fresh second session. Screenshots: `blaze-landing-invite.png`,
  `blaze-landing-invite-mobile.png`, `customer-memory-landing-invite.png`.
- The rider proof now carries a second GPS fix end to end: with the customer's
  tracking page already open, the rider posts a new position and the page's
  15-second live poll updates the map coordinates without a reload
  (`visible-rider-live-refresh.png`). The live map, rider marker, call button,
  automatic streaming, proof capture and post-delivery privacy remain covered
  in the same proof.
- Tracking now promises a clock, not only a window. The tracking payload adds
  `eta_at` (order accepted time plus the delivery zone's maximum ETA, 45
  minutes when no zone is attached; pickup uses 25) and the customer page
  counts down against it: "Arriving in ~35 min · Due by 3:24 PM", "Arriving any
  moment" inside the last minute, and a red "Running late" only after a
  ten-minute grace. Delivered, closed, cancelled and scheduled orders carry no
  countdown. The countdown exposed an older clock bug: naive UTC timestamps
  were read as local time, so a 2:49 PM order displayed as 9:19 AM.
  `parseServerTime` now normalises every tracking timestamp - placed-at,
  timeline steps, notification times, the rider map label and last-fix line.
  `verify:rider` and the delivery E2E proof assert the countdown while out for
  delivery and its absence after delivery
  (`visible-delivery-order-e2e-countdown.png`).
- `verify:offer-letter` stops with a direct message when the generated public
  offer URL points at a different origin than `E2E_BASE_URL`, naming
  `PIZZA_BLITZ_PUBLIC_URL` as the setting to align. The landing-conversion proof
  now writes a screenshot and the cart summary/draft if the restored cart loses a
  quick-added line.

No new commit was made; changes are in the working tree on `main`.

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

Wave 4 (complete):

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
- HR Attendance is live: daily clock-in/out, leave-aware roster, worked minutes,
  regularisation and day summary; new `verify:hr-attendance` proof and three backend tests.
- HR Payroll is live: salary structures, draft/finalized monthly runs, attendance/leave
  proration, PF/ESI/professional-tax/TDS deductions, employer cost and printable payslips;
  new `verify:hr-payroll` proof and two backend tests.
- HR Onboarding is live: candidate pipeline, six-task document/verification checklist and
  guarded conversion to an employee; new `verify:hr-onboarding` proof and two backend tests.
- HR Documents & Letters is live: private PDF/JPEG/PNG/DOCX vault with categories, visibility,
  expiry and downloads, plus offer/confirmation/experience/relieving letters with public
  verification codes; new `verify:hr-documents` proof and two backend tests.
- HR Exits & Settlement is live: resignation/termination, clearance checklist, settlement
  estimate, employee exit and POS access revocation; new `verify:hr-exits` proof and two
  backend tests.
- HR access is department-scoped: staff must be People & HR members with the matching
  module permission; admins bypass; new `verify:hr-permissions` proof and two backend tests.
- HR Analytics is live: headcount/new joiners, workforce mix, attendance, leave liability,
  payroll trend/YTD, onboarding funnel, attrition, exits and document expiry at
  `/departments/hr`; new `verify:hr-analytics` proof and two backend tests.
- Media Studio is live: a shared image/video library at `/settings/media`, uploads with
  search/tags, usage-guarded delete, menu uploads registering automatically, one picker reused
  in menu, social and ad forms; reels are transcoded to H.264 MP4 with an extracted poster and
  duration metadata. A Record reel modal captures camera/mic in the browser and pushes the
  WebM through the same transcode pipeline. VTT/SRT captions can be attached to videos, with
  SRT converted to WebVTT and a caption track on the player. Video clips can be trimmed to a
  start/end range and saved as a new asset with its own poster/duration, carrying clipped and
  re-timed captions from the source; 2–10 ordered clips with matching dimensions/audio can be
  merged into one stitched clip whose source captions are offset onto the merged timeline;
  two or more clips can use a chained video/audio crossfade that shortens the result by one
  fade per boundary. Mixed resolutions are scaled/padded or cropped to a common canvas (with
  fps=30 normalization) before hard-cut concat or crossfade. Filter presets (grayscale, sepia,
  warm, cool, brighten, vignette) render new assets. A storage-status badge reports local disk
  or S3/CDN; S3-compatible uploads/deletes use CDN URLs with local fallback.
- Private recruitment documents (resumes and offer letters) now live outside the public
  `/media` mount under `PRIVATE_MEDIA_ROOT`; only authenticated HR routes or offer tokens can
  read them.
- Landing page CMS is live: `/settings/content` edits hero copy, story copy, hero/story images
  and category imagery with live preview, Media Studio picker, on-demand revalidation and
  restore defaults; new `verify:landing-cms` proof and two backend tests.
- Tax & billing is live: `/settings/billing` controls tax rate/label, invoice footer and tip
  presets; orders, coupon quotes, aggregator intake, POS estimates and invoice CGST/SGST use
  the configured rate; new `verify:billing-settings` proof and two backend tests.
- Providers is live: encrypted email/SMS/WhatsApp/social/ads credentials at
  `/settings/providers`, masked reads, validation, reset to environment fallback, and live
  readiness wiring; new `verify:provider-settings` proof and three backend tests.
- Messaging inbox is live: shared WhatsApp/SMS/email/Instagram threads, inbound webhooks,
  replies with delivery status, read/close/pending and templates at `/messaging`; new
  `verify:messaging-inbox` proof and three backend tests.
- Marketing journeys are live: completed/delivered order, low-feedback and manual triggers;
  delay/condition/branch/stop/send steps, templates, durable runner, enrollment/event history,
  pause/activate and attributed revenue at `/journeys`; branches route to forward steps with
  explicit stop paths, send steps support 50/50 A/B variants with variant-level results, and
  journeys enforce per-customer send caps. Journey cards also show send-level attribution:
  successful sends, unique customers, orders after first send, conversion rate and revenue by
  channel. Journey sends now carry tracked click links and email open pixels, with clicks,
  opens and per-step conversions in the API (cards show aggregate engagement). Per-step
  first-touch, last-touch and linear credit is also returned, with the best step surfaced on
  each card. New `verify:journey-branches` proof and five tests. Journeys can reserve a
  deterministic 0–100% enrollment holdout; holdouts receive no sends and treated-vs-holdout
  conversion, lift and incremental revenue appear on the journey card, with a two-proportion
  p-value/significance readout. Per-journey suppression windows block overlapping enrollment
  when the same customer is already in another journey, recording `suppressed` enrollments.
- HR recruitment is live: jobs, applicant board, stage moves, interviews, offers and automatic
  onboarding handoff at `/departments/hr/recruitment`; new `verify:recruitment` proof and two
  backend tests.
- Recruitment resumes and scorecards are live: public PDF/DOCX/TXT upload with parsed
  contact/skills, private authenticated download, and interview 1–5 score/recommendation;
  new `verify:recruitment-resume` proof and three backend tests.
- Pricing is configurable: tax-inclusive menu prices, service charge and subtotal tax slabs
  apply to new orders, quotes, aggregator intake and the billing preview; the billing proof
  covers service charge/slab math.
- Offer letters are live: admins generate a PDF letter at the offer stage, choose reusable
  defaultable offer templates, and candidates use a secure `/offer/{token}` link with the
  template terms, PDF download and electronic accept/decline; acceptance marks the candidate
  hired with an onboarding handoff. Jobs can require a People lead + Finance approval chain,
  and generation stays blocked until every step is approved. Offers can be emailed through
  Resend, countersigned by the company, and receive automatic expiry reminders.
- Public careers is live: `/careers` lists open roles and `/careers/{id}` accepts applications
  straight into the recruitment pipeline; new `verify:careers` proof and one backend test.
- Marketing Hub is live: a month calendar for social posts/reels/campaigns/ads with filters,
  upcoming list and a schedule-content composer; Instagram video/reel publishing is wired;
  new `verify:marketing-hub` proof and two backend tests.
- Campaign performance now includes lift versus the prior 30-day baseline and linear
  channel credit across outreach, social, ads and coupon channels; new
  `verify:campaign-attribution` proof. Campaign performance now also reports person-level
  first-touch, last-touch and linear credit by matching sent campaign deliveries to coupon
  orders within a 30-day window; unmatched orders fall back to the coupon channel. Campaigns
  can reserve a deterministic 0–50% holdout that receives no send, with treated-vs-holdout
  conversion, lift and incremental revenue, plus a two-proportion z-test, p-value, 95%
  confidence interval and required per-group sample size in the same panel. Each campaign
  delivery gets a tracked `/track/{token}` link; clicks redirect to the coupon order page with
  UTM parameters and feed click counts and click-through rate in the performance panel. Email
  sends also embed a per-delivery open pixel that records opens and open rate.
- Social/reel approvals are live: staff can submit posts for review, admins approve or reject
  with a note, and pending/rejected posts are blocked from live publishing and auto-publish;
  new `verify:social-approvals` proof and three backend tests.
- Payment provider credentials are in the encrypted registry: Cashfree, Razorpay and direct
  bank now drive checkout status, session credentials and webhook secrets; new
  `verify:payment-providers` proof and two backend tests.
- Active payment routing is admin-selectable in Tax & billing; new payment sessions and
  checkout status follow it, while existing orders keep their recorded provider.
- Back-office support is live: guests open tickets at `/support`, follow a private
  conversation link, and admin/staff triage them at `/support-inbox` with internal notes,
  priority, assignment, resolution status and priority-based SLAs (urgent 2h, high 8h, normal
  24h, low 48h) including first-response timestamps, overdue/due-soon counts, average response
  and resolution time, and breach counts. SLA policies are editable per priority from the
  inbox (response and resolution minutes) and apply to new tickets. A 15-minute job creates
  deduplicated in-app SLA alerts (resolution overdue, first reply overdue, due soon), with
  unread counts, mark-read and a manual run check. Alerts are also delivered to Slack when
  `SUPPORT_SLACK_WEBHOOK_URL` is set and to `SUPPORT_ALERT_EMAIL` through Resend when
  configured; otherwise the notification records an honest `skipped` delivery status and an
  admin can retry delivery from the inbox. Failed sends schedule automatic retries with 5/15
  minute backoff (up to three attempts) on a 5-minute job. Resolution breaches (and first-reply
  breaches on high/urgent tickets) also trigger a PagerDuty-compatible webhook when configured,
  and resolving/closing the ticket sends a matching `resolve` event for each paged alert.
  Failed resolves are retained and retried by the five-minute support job.
  New `verify:support-tickets` proof and seventeen backend tests.
- Next: per-clip video transitions/filters, journey step-level models and pager escalation.

## Verified State (2026-10-29)

- `python -W error::FutureWarning -m unittest discover -s tests -v`: **364 backend tests pass**
  (no failures, no skips; 87 of the assertions run as subtests).
- `ruff check .`: zero findings across the backend (re-verified after the cleanup in
  `docs/GAP_AUDIT.md`).
- `npm run lint`: passes; only pre-existing hook-dependency and `<img>` style
  warnings remain.
- `npm run typecheck`: passes.
- `npm run build`: passes with lint and type checking enabled.
- `npm run test:e2e`: portal browser smoke passes.
- Company OS proofs: `verify-company-os`, `verify-blaze-concierge`,
  `verify-landing-conversion`, `verify-department-workspace-tools` (11 pages) and
  `verify-gift-card-checkout` (checkout and refund UI) pass against a production
  build.
- Navigation link health: 85 same-site links across 35 source routes pass, together with
  2362 labelled controls and 35 safe action clicks.
- API smoke: all 15 new workspace GET endpoints return 200; OpenAPI has 428
  paths and 510 operations.
- Migrations: `9f8e7d6c5b4a` upgrades a copy of the database and creates all 15
  workspace tables plus `customer_memories`; 120 SQLite tables including `alembic_version`.
- Health probes: `/health` returns process status; `/ready` checks the database
  and returns 503 when it is unreachable.
- Secret scan of tracked files: clean.

## Recent Hardening

- Sensitive public endpoints (customer-login proof, order creation, payment
  verification, login and assistant chat) are throttled per instance,
  configurable with `RATE_LIMIT_ENABLED`; horizontally scaled deployments should
  add a shared limiter at the edge.
- Production fails closed on security: the backend refuses to start with
  repository-default secrets, and a production frontend rejects
  `admin/admin123` unless admin credentials are configured.
- The Google Sheets importer only fetches Google-hosted HTTPS URLs, closing an
  SSRF path that could reach arbitrary or internal hosts.
- Business dates come from one configurable restaurant timezone
  (`RESTAURANT_TIMEZONE`, default `Asia/Kolkata`).
- Customer order history and detail require a verified session or a phone+order
  ownership proof instead of trusting a phone number or sequential order id.
- The Alembic chain builds the complete schema, including the 15 tables added by
  `9f8e7d6c5b4a`; `alembic check` reports no drift on a fresh upgrade.
- Backend runtime dependencies are bounded; a Ruff gate and a CI workflow cover
  backend lint/tests/migrations and frontend lint/typecheck/build.
- The scheduled Google Sheets job is a real, env-gated refresh.

## Remaining Before Launch

1. Create the Supabase project and connect its Postgres URL, then run migrations.
2. Configure production secrets and rotate local defaults.
3. Deploy backend and frontend to a verified host, then run the production-only
   proofs and smoke. **Blocked:** no valid Vercel token and no Supabase project
   yet; nothing was faked. The hosting decision is Supabase for the database and
   Vercel or Render for the app — Google Cloud is not the plan. See
   [DEPLOY_REQUEST.md](DEPLOY_REQUEST.md).
4. Add real payment, WhatsApp, SMS, email, social, and ads provider
   credentials, keeping the send/launch flags off until each is verified.
5. Add a maps key for live rider map tiles and an APM DSN for external error
   monitoring.
