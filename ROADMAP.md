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
- [x] Record the full gap audit and verification guide in `docs/`.
- [ ] Replace remaining explicit `any` response types with per-endpoint models.
