# Pizza Blitz Roadmap

## Product Vision

Pizza Blitz has two connected products:

1. Internal restaurant portal for owner/admin/staff operations.
2. Public customer website for catalog browsing, ordering, checkout, pickup/delivery, coupons, and customer retention.

## Phase 0 - Foundation

- Create standalone project folder.
- Remove copied secrets and stale deployment paths.
- Add environment examples and project documentation.
- Initialize clean local git.
- [ ] Create a dedicated GitHub repository when repo name and visibility are confirmed. (Open: no git remote is configured yet.)

## Phase 1 - Internal Restaurant Portal Stability

- [x] Run backend locally.
- [x] Run frontend locally.
- [x] Verify all existing dashboard pages.
- [x] Fix broken frontend/backend API contracts for POS, invoices, recipes, waste, delivery, marketing, and reporting.
- [x] Validate formulas:
  - daily sale
  - total expense
  - cash collected
  - profit
  - weekly comparison
  - monthly comparison
  - same day last week
  - same month last year
  - breakeven
- [x] Add automated validation for realistic historical data, POS-to-sales, payment, delivery, marketing, customization, ops, and reporting flows.
- [x] Fix frontend chart prerender warnings.
- [x] Confirm reports, comparisons, exports, and browser smoke coverage.

## Phase 2 - Deployment

Open. These steps need a Supabase Postgres project, a hosting account, and
credentials; the repository side is ready (Dockerfiles, `/ready` probe, runbook,
`DEPLOY_REQUEST.md` with the Supabase + Render/Railway or Vercel decision). The
`deploy-gcp.ps1`/`.sh` scripts remain as an unused option.

- Deploy the backend to Render or Railway (persistent process).
- Deploy the frontend to Vercel (or the same host).
- Point `SQLALCHEMY_DATABASE_URI` at the Supabase session-pooler URL and run Alembic.
- Use runtime environment variables instead of hardcoded URLs.
- Verify `/health`, `/ready`, dashboard, daily entry, menu, orders, and reports.

## Phase 3 - Counter POS

- [x] Admin/staff portal login.
- [x] Create dine-in, takeaway, pickup, and delivery orders.
- [x] Add menu items, quantities, and customizations.
- [x] Apply discount or coupon.
- [x] Record payment method and payment status.
- [x] Generate invoice/bill.
- [x] Push completed sale into dashboard calculations.

## Phase 4 - Public Customer Website

- [x] Homepage.
- [x] Full catalog/menu listing.
- [x] Product customization on menu cards.
- [x] Cart.
- [x] Customer session/login support by phone.
- [x] Checkout.
- [x] Pickup/delivery selection.
- [x] Order confirmation, tracking, and history.

## Phase 5 - Payments And Fulfillment

- [x] Payment session abstraction and webhook processing for manual/Razorpay/Cashfree-style flows.
- [x] Prepaid order support.
- [x] Cash/payment status.
- [x] Tentative pickup/delivery time.
- [x] Order status flow: placed, preparing, ready, completed, cancelled.
- [x] Delivery zones, fees, address quote, and delivery assignment.

## Phase 6 - Marketing And CRM

- [x] Customer phone/email repository.
- [x] Coupon builder.
- [x] Flash sale builder.
- [x] Promotional message dispatch workflow.
- [x] Campaign history and delivery logs.
- [x] WhatsApp/SMS/email provider integration points.
- [x] Social publishing workflow.
- [x] Ad campaign management workflow.

## Phase 7 - Launch Hardening

- [x] Production ops readiness screen.
- [x] Backup run tracking.
- [x] Environment and security checklist.
- [x] Browser E2E smoke test.
- [x] Launch runbook.
- [x] Database-aware readiness probe (`/ready`).
- [ ] Connect live production database. (Open: needs the production URL.)
- [ ] Add real provider credentials and test with sandbox accounts. (Open: needs provider accounts.)
- [ ] Deploy backend and frontend. (Open: needs a Supabase project URL plus a Vercel or Render account.)
- [ ] Run production smoke test after deploy. (Open: depends on the two items above.)

## Phase 8 - Security And Quality Hardening

- [x] Require a verified session or phone+order proof for customer order history.
- [x] Require staff/admin authentication for order detail reads.
- [x] Restore build-time ESLint and TypeScript enforcement.
- [x] Fix every blocking lint error; track remaining explicit-`any` warnings.
- [x] Trim and bound backend runtime dependencies; add a dev requirements file.
- [x] Align Python version, deploy defaults, and local URL documentation.
- [x] Complete the Alembic chain so a migrated database has every model table.
- [x] Replace the scheduled sheet-sync placeholder with a gated real refresh.
- [x] Add Docker build-context ignores for both apps.
- [x] Unify every business-date read behind one configurable restaurant timezone.
- [x] Add a backend Ruff lint gate and a CI workflow for both apps.
- [x] Remove every explicit-`any` API boundary in the frontend (86 sites, all pages).
- [x] Throttle sensitive public endpoints, with a documented shared-limiter path.
- [x] Block SSRF in the Google Sheets importer.
- [x] Fail closed on default production secrets and complete deploy env wiring.
- [x] Record the full gap audit and verification guide in `docs/`.
- [x] Replace remaining explicit `any` response types with per-endpoint models.

## Phase 9 - Enterprise Feature Completion

Benchmark, feature inventory, and wave plan: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).
Access IDs and roles: [docs/ACCESS.md](docs/ACCESS.md).

### Wave 1 (done)

- [x] Rebuild the public landing page: live menu/offers/zones, food-quality detail, FAQ, JSON-LD, OG metadata, responsive.
- [x] Replace the flat portal navigation with grouped, searchable, collapsible desktop navigation and a mobile drawer + bottom bar.
- [x] Verify and document master admin, staff, and customer access.
- [x] Stop exposing menu cost prices on the public storefront.
- [x] Add `verify:landing` and `verify:portal-shell` proofs to the audit suite.

### Wave 2 (done)

- [x] Store profile settings (name, address, phone, hours, socials) editable in admin and rendered on the landing page.
- [x] Store hours + online ordering pause/capacity controls.
- [x] Scheduled pickup/delivery orders with slot capacity.
- [x] Tips at checkout and POS, with reporting.
- [x] Dense-page tap targets and table-to-card mobile layouts.

### Wave 3 (done)

- [x] Refunds and voids with reason, audit trail and gateway handling.
- [x] Dedicated KDS device view with timers, bump/recall and sound.
- [x] Order status notifications (confirmation, ready, out for delivery, delivered).
- [x] Menu media library (upload, alt text, responsive images).
### Wave 4 (in progress)

- [x] Customer OTP authentication.
- [x] Saved addresses.
- [x] Loyalty and referrals.
- [x] Loyalty points redemption at checkout.
- [x] Rider app with GPS and proof of delivery.
- [x] Custom report builder and scheduled reports.
- [x] 2FA and granular permissions.
- [x] Multi-store/franchise hierarchy.
- [x] Accounting/GST exports.
- [x] Aggregator integrations (inbound webhooks).
- [x] Labour scheduling and labour-vs-sales dashboard.
- [x] Allergens/nutrition.
- [x] Channel-specific pricing.
- [x] Security headers and error monitoring.
- [x] POS hardware integrations.
- [x] Outbound aggregator status sync.
- [x] Channel-specific item visibility.
- [x] Outbound aggregator menu sync.
- [x] Deployment-ready checklist.
- [x] Post-order feedback and NPS.
- [x] Item-level KDS bump/recall.
- [x] Final delivery report ([DELIVERY_REPORT.md](DELIVERY_REPORT.md)).
- [x] Department registry with HR as a department.
- [x] HR People directory.
- [x] HR Leave & holidays.
- [x] HR Attendance & time clock.
- [x] HR Payroll & payslips.
- [x] HR Onboarding pipeline.
- [x] HR Documents & letters.
- [x] HR Exits & settlement.
- [x] Department-scoped HR permissions.
- [x] HR analytics command center.
- [x] Shared Media Studio and image picker.
- [x] Landing page content CMS.
- [x] Configurable tax, invoice footer and tip presets.
- [x] Encrypted provider settings registry.
- [x] Messaging inbox and templates.
- [x] Marketing journeys with order/feedback triggers.
- [x] HR recruitment pipeline and onboarding handoff.
- [x] Public careers page with online applications.
- [x] Marketing Hub calendar and Instagram reel/video publishing.
- [x] Encrypted payment provider credentials (Cashfree, Razorpay, direct bank).
- [x] Admin-selectable active payment provider.
- [x] Journey conditions and revenue attribution.
- [x] Recruitment resumes, parsing and interview scorecards.
- [x] Tax-inclusive prices, service charge and tax slabs.
- [x] Offer letters with secure candidate acceptance.
- [x] Video media library with transcode/posters and private recruitment documents.
- [x] Journey A/B variants, variant results and per-customer frequency caps.
- [x] Social/reel approval workflow with publish blocking.
- [x] Offer email delivery, expiry reminders and company countersignature.
- [x] Multi-path journey branching with explicit stop paths.
- [x] Campaign lift and linear channel attribution.
- [x] S3-compatible media storage with CDN URLs and local fallback.
- [x] Reusable offer templates with snapshot terms.
- [x] Guest support tickets with private threads and staff inbox.
- [x] In-browser reel recording through the media transcode pipeline.
- [x] VTT/SRT video captions with SRT-to-WebVTT conversion.
- [x] Optional multi-step offer approvals that gate letter generation.
- [x] Person-level first/last/linear campaign attribution.
- [x] Deterministic holdout experiments with incremental revenue.
- [x] Priority-based support SLAs with breach reporting.
- [x] Editable per-priority SLA policies with first-response targets.
- [x] Holdout significance testing with confidence intervals and sample sizing.
- [x] Per-delivery tracked links with click-through reporting.
- [x] Video clip trimming into new assets.
- [x] Email open pixels with open-rate reporting.
- [x] Journey-level send attribution with channel revenue.
- [x] Journey click/open tracking with per-step engagement.
- [x] In-app deduplicated SLA alerts on a 15-minute job.
- [x] Ordered multi-clip video merging.
- [x] Provider-gated Slack/email delivery for SLA alerts.
- [x] Video filter presets rendered as new assets.
- [x] Journey first/last/linear step credit.
- [x] Deterministic journey enrollment holdouts.
- [x] Journey significance and SLA alert delivery retry.
- [x] Automatic SLA delivery retries with backoff.
- [x] Caption re-timing on trimmed clips.
- [x] Offset captions for merged clips.
- [x] Cross-journey suppression windows.
- [x] PagerDuty-compatible escalation for urgent SLA breaches.
- [x] Two-clip crossfade with aligned captions.
- [x] Pager resolve events on ticket resolution.
- [x] N-way chained crossfades with caption alignment.
- [x] Mixed-resolution merge with common-canvas normalization.
- [x] Pad/crop framing and retryable pager resolves.

Deferred after the 2026-10-27 handover (future phases, not defects):

- [ ] Pager acknowledgement sync, caption languages, mixed-fps audio normalization.
- [ ] Globally deduplicated multi-channel journey caps.
- [ ] Certified e-signature and statutory payroll filing.

## Phase 10 - Company Operating System And Conversion (2026-10-27 → 2026-10-28)

Plan and audit: [docs/COMPANY_OS_BLUEPRINT.md](docs/COMPANY_OS_BLUEPRINT.md).
Feature inventory: [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md).

### 10A - Conversion rescue

- [x] Landing/menu CTAs send guests to `/order`; `/menu` redirects guests to the order flow.
- [x] Cart, fulfilment mode, coupon and schedule persist across reloads and revalidate prices.
- [x] Order submission and payment-session creation have timeout, retry, inline error state and
  no silent failures.
- [x] Dedicated confirmation page with order number, ETA and a route into live tracking.
- [x] Offer cards deep-link to `/order?coupon=CODE` and show the applied state.
- [x] Guest/privacy defaults fixed (no staff panels on the customer page, consent unchecked,
  labelled and mobile-keyboard-friendly inputs).
- [x] Tracking polls on an interval and shows rider stage.
- [x] Landing truth pass: live hours/address/ETAs from the store profile, readiness-driven
  payment copy, trust signals; sitemap/robots; no invented analytics IDs.
- [x] OTP debug codes fail closed outside explicit local mode.

### 10B - Company OS foundation

- [x] Department registry: 16 department specs (10 core departments plus 5 sub-departments),
  70 catalogued modules whose route templates exactly cover the 70 portal routes.
- [x] Department parent/head/kind/store/cost-centre fields; scoped roles and permissions;
  department membership drives access.
- [x] Department-generated portal navigation, department switcher and `/work` inbox.
- [x] Live `/departments/{key}` workspace with KPI strip, needs-you queue, team, modules,
  quick actions and sub-departments.
- [x] Generic tasks, comments, approvals and unread notices; expenses, purchase orders, HR
  leave and social posts mirror into approvals.
- [x] Company scorecard and department/store-tagged audit events.

### 10C - Department depth

- [x] Operations: opening/closing/shift checklists with templates, per-item state and
  sign-off; facilities asset register, preventive maintenance and breakdown work orders.
- [x] Kitchen: menu-engineering matrix (star / plough-horse / puzzle / dog) with margins,
  popularity and an action list.
- [x] Supply: physical stocktakes with variance valuation and stock corrections.
- [x] Quality/legal: food-safety audits with CAPA items, temperature/CCP logs, and a licence
  and contract register with expiry alerts.
- [x] Training: courses, certification records, expiry and completion tracking.
- [x] Revenue: issued gift cards with reload, redeem, void, public balance check, checkout
  debit, refund credit-back and a liability summary.
- [x] Executive: company goals with progress and franchise site pipeline with proforma and
  opening playbook.
- [x] Technology: data-platform overview (freshness, exports, quality checks) and CSV export.
- [x] Finance: store dimensions on ledgers, outlet P&L with COGS/opex/waste split and
  cross-checks.

### 10D - AI concierge and landing conversion

- [x] Backend ordering assistant: deterministic intent routing over the live menu, cart
  add/remove, offers, store facts and checkout hand-off (optional LLM answer path stays
  provider-gated).
- [x] 3D talking avatar (Blaze) with text and browser speech, quick replies, product cards
  and the ability to build the cart and hand it to checkout.
- [x] Conversion-first landing page: live menu, offers, delivery areas, kitchen standards,
  FAQ, JSON-LD/OG, concierge entry, responsive down to phone.

### 10E - Verification

- [x] Backend suite: 345 passed, 87 subtests.
- [x] Alembic revision `b70420584d8b` adds all 15 workspace tables; fresh upgrade verified.
- [x] 175 browser proof scripts; new proofs for conversion, Blaze concierge, company OS,
  the 11 department workspaces and gift-card checkout/refund.
- [x] OpenAPI: 427 paths / 507 operations; every new workspace endpoint smoke-tested.
- [x] Production build, lint, typecheck and portal smoke green.

### 10F - Remaining

- [ ] Deploy to a verified host with real credentials. **Blocked:** no valid hosting token
  and no Supabase project yet; nothing has been faked. Google Cloud is no longer the plan —
  Supabase is the database, Vercel or Render is the host. See
  [DEPLOY_REQUEST.md](DEPLOY_REQUEST.md) and [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md).
- [ ] Connect live Supabase Postgres, provider accounts, maps key and APM.
- [ ] Mobbin paid-plan reference capture. **Blocked:** the connected Mobbin plan returns no
  content; public UX conventions were used and no Mobbin assets were copied.
