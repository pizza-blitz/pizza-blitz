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

Open. These steps need a Google Cloud project, credentials, and a production
database; the repository side is ready (`deploy-gcp.ps1`, Dockerfiles, `/ready`
probe, runbook).

- Deploy backend to Cloud Run.
- Deploy frontend to Cloud Run or another selected host.
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
- [ ] Deploy backend and frontend. (Open: needs the cloud project.)
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
- [ ] Multi-path journey branching, campaign-level attribution, object storage/CDN.
- [ ] Custom report builder and scheduled exports.
- [ ] 2FA, SSO and granular permissions.
