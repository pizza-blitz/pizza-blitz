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
- Create a dedicated GitHub repository when repo name and visibility are confirmed.

## Phase 1 - Internal Restaurant Portal Stability

- Run backend locally.
- Run frontend locally.
- Verify all existing dashboard pages.
- Fix broken frontend/backend API contracts. Initial pass completed for POS, invoices, recipes, and waste.
- Validate formulas:
  - daily sale
  - total expense
  - cash collected
  - profit
  - weekly comparison
  - monthly comparison
  - same day last week
  - same month last year
  - breakeven
- Add automated validation for realistic historical data and POS-to-sales flow. Initial backend suite completed.
- Confirm reports and exports.

## Phase 2 - Deployment

- Deploy backend to Cloud Run.
- Deploy frontend to Cloud Run or another selected host.
- Use runtime environment variables instead of hardcoded URLs.
- Verify `/health`, dashboard, daily entry, menu, orders, and reports.

## Phase 3 - Counter POS

- Staff login.
- Create dine-in/takeaway orders.
- Add menu items and quantities.
- Apply discount or coupon.
- Record payment method.
- Generate printable bill.
- Push completed sale into dashboard calculations.

## Phase 4 - Public Customer Website

- Homepage.
- Full catalog/menu listing.
- Product detail pages.
- Cart.
- Customer login/signup.
- Checkout.
- Pickup/delivery selection.
- Order confirmation and history.

## Phase 5 - Payments And Fulfillment

- Online payment integration.
- Prepaid order support.
- Cash/payment status.
- Tentative pickup/delivery time.
- Order status flow: placed, preparing, ready, completed, cancelled.

## Phase 6 - Marketing And CRM

- Customer phone/email repository.
- Coupon builder.
- Flash sale builder.
- One-click promotional message workflow.
- Campaign history.
- Future WhatsApp/SMS/email/social integration.
