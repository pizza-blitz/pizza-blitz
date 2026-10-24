# Pizza Blitz — Feature Inventory & Enterprise Gap Analysis

Date: 2026-10-22
Scope: the entire platform — public ordering site, counter POS, kitchen operations,
delivery, inventory, procurement, CRM, marketing, reporting, payments, workforce,
admin/security, and the UI/UX layer.

This is the working benchmark document. It lists **what exists today**, compares it
with the capabilities of enterprise restaurant platforms, records the gaps, and
defines the build order. Status values:

- **Built** — works end to end and is covered by tests or browser proofs.
- **Partial** — a usable version exists but falls short of the enterprise bar.
- **Missing** — not implemented.

Numbers in this snapshot: **292 API endpoints**, **52 routes/pages** (41 portal,
1 KDS, 10 public), **143 browser proof scripts** plus portal smoke, **157 backend
tests**, **61 database tables**, **19 integration points**.

## Benchmark set

Category-level reference, not a claim about any single vendor's current roadmap:

- **Ordering + delivery**: Domino's digital ordering, Olo, DoorDash Drive, Uber Direct.
- **POS + KDS + payments**: Toast, Square for Restaurants, Clover.
- **Inventory + procurement + ops**: MarketMan, Crunchtime.
- **Workforce**: 7shifts, Homebase.
- **CRM + loyalty + marketing**: Punchh, Paytronix, Toast Marketing.
- **Analytics**: enterprise restaurant reporting suites and BI warehouses.

Domino's is the inspiration for the *customer journey* (fast ordering, coupons,
scheduled delivery, live tracking, store locator), not a template to copy.

---

## 1. Public website, ordering, and customer journey

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Landing page | Full landing page: live menu previews, offers, story, kitchen standards, delivery areas, FAQ, JSON-LD, responsive | Built | Brand story, offers, menu preview, service area, trust, FAQ, SEO, store info | Uploaded item images supported; brand hero assets still remote |
| Menu browsing | `/order` catalog with categories/search and item images (uploaded or curated fallback) | Built | Fast filtered catalog, sold-out states, images | Channel-specific menus missing |
| Product customization | Sizes, crusts, toppings, add-ons, combos with server-side pricing | Built | Same | — |
| Cart and checkout | Cart, coupon, pickup/delivery, address, contact, payment choice, tips, scheduling | Built | Guest + saved checkout, tips, scheduling | Saved-cart recovery missing |
| Coupons and offers | Validate/apply server-side, promotion engine | Built | Public offers page, auto-apply best offer | Offers surface on landing page missing |
| Pickup / delivery | Delivery quote by zone, fees, minimums, ETAs | Built | Address autocomplete + geocoding | Keyword zones only |
| Order tracking | Phone + order-id tracking with status steps, rider status/last GPS link and proof-captured flag | Built | Live status + notifications + embedded map | Map is link-out only |
| Customer account | OTP login (or phone + recent order), order history, profile/consent, saved addresses, loyalty points, feedback after completed orders | Built | Password/OTP, saved addresses, loyalty, feedback | Saved payments missing |
| Scheduled orders | 15-minute slots up to 14 days ahead, capacity-checked, validated against opening hours, stored on the order and shown in tracking/POS/kitchen/receipt | Built | Order for later time/date, slot capacity | Slot capacity is fixed at 6; no per-day holiday calendar |
| Store hours / order pause | Weekly opening hours, pause toggle, prep time, public open/closed status, checkout + order enforcement | Built | Per-day hours, overnight windows, holiday closures, pause with message, prep capacity | Holiday calendar and per-slot capacity missing |
| Tips | Preset/custom tip at checkout and POS, persisted on the order, included in totals/receipts, tips summary API | Built | Preset/custom tip, tip reporting | Tip pooling and payout missing |
| Order notifications | Transactional status events (preparing, ready, out for delivery, delivered, completed, cancelled) over SMS/WhatsApp/email via the configured provider, gated by `ORDER_NOTIFICATIONS_ENABLED`, logged per order and exposed on tracking | Built | Confirmation, ready, out-for-delivery, delivered via WhatsApp/SMS/email | Email needs an email on the order; provider credentials required |
| Allergens / nutrition | Per-item allergens, dietary tags (vegetarian/vegan/gluten-free), calories, protein/carbs/fat; admin editing and customer-menu badges | Built | Allergen flags, vegetarian/vegan, nutrition per item | Channel-specific menus missing |
| PWA / installable | — | Missing | Installable app, offline menu, push | Later |
| Multi-language | — | Missing | Localisation (English/Hindi) | Later |
| Table reservation | — | Missing | Booking + table availability | Out of scope for now |

## 2. Counter POS

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Order creation | Dine-in, takeaway, pickup, delivery, walk-in | Built | Same + multi-terminal sessions | Device registry missing |
| Table service | Dining table list, occupancy, table order | Built | Table map, merge/move tables | Partial |
| Quick builds | One-tap popular builds, express walk-in | Built | Same | — |
| Customization | Full modifier pricing server-side | Built | Same | — |
| Discounts / coupons | Manual discount + coupon codes | Built | Manager-approved discounts, comps | Permissions/audit weak |
| Payments | Cash, UPI, card (manual), Razorpay/Cashfree, direct bank | Built | Split tender, partial payments, refunds | Split tender missing |
| Invoicing | Invoice generation, numbering, tax split | Built | GST-compliant fields, e-invoice | Tax configuration partial |
| Close / cancel | Close order, cancel with reason | Built | Void with approval + stock reversal | Void workflow needs audit |
| Cash drawer | Drawer command, close, variance | Built | Cash drops, shift handover | Partial |
| Receipts | Receipt page + print-ready kitchen ticket; browser print with configurable header/footer/paper width | Built | Thermal printer, reprints, email receipt | Thermal output needs a local ESC/POS bridge |
| Refunds | Admin-only full/partial refunds with reason, method, reference, ledger and audit event; order tracks refunded/refundable totals | Built | Full/partial refund with provider and ledger | Gateway refund API call not wired |
| Tips | Captured on orders; summary endpoint (total/today/average); shown on the POS header | Partial | Tip entry, tip pool, payout report | Pooling/payout missing |
| Gift cards / store credit | — | Missing | Issue/redeem/balance | Later |
| Customer display | Branded full-screen `/customer-display` idle screen, configurable URL per store | Built | Second screen / pole display | Live cart push from POS missing |
| Offline mode | — | Missing | Local queue + sync | Later |

## 3. Kitchen (KDS)

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Kitchen board | Operations page with kitchen state and queue | Built | Dedicated full-screen KDS per station | — |
| Kitchen display (KDS) | `/kds` full-screen board: Incoming/Preparing/Ready columns, per-station filters, live timers, overdue highlight, item bump/recall, order start/ready/recall, sound + fullscreen, 8s polling | Built | Full-screen timers, bump/recall, sound, station routing | Printer/hardware integration missing |
| Station routing | Item/category → kitchen station, per-station status | Built | Configurable routing + filters | Good |
| Kitchen ticket | Printable ticket per order | Built | Ticket routing, reprint | Printer routing missing |
| SLA / priority | Age, priority, next action per line | Built | Timers, overdue alerts, sound | Timers/sound missing |
| Item-level readiness | Per-line start/bump/recall with independent line statuses and aggregate ticket status | Built | Per-item bump/recall | — |
| Courses / sequencing | — | Missing | Fire/hold courses | Later |
| Capacity / throttling | — | Missing | Order throttling when kitchen is saturated | With store ops |
| Kitchen display device mode | Responsive full-screen `/kds` with station filters, chime and fullscreen toggle | Built | Locked full-screen mode | Kiosk/lockdown is browser-level |

## 4. Delivery and dispatch

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Zones and fees | Zones, fees, minimums, ETAs, keyword validation | Built | Polygon/geocoded zones | Geocoding later |
| Dispatch | Assignment, rider, status queue, mission control, tokenized rider app with status/GPS/proof | Built | Rider app, live map, auto-assign | Auto-assign/batching missing |
| Delivery economics | Fee, cost, margin view, retry queue proofs | Built | Cost per delivery, batching | Batching missing |
| Proof of delivery | Rider-captured photo/signature/OTP reference with notes, required before delivered, shown on tracking | Built | Photo/signature/OTP at door | Photo is a reference string; file upload not wired |
| Third-party delivery | Token-scoped inbound webhooks for Swiggy, Zomato, Uber Eats and DoorDash; idempotent by external order id; signed outbound status sync with retries; signed menu sync payload | Built | DoorDash/Uber/Swiggy/Zomato integration | Per-store menus are global |
| Route optimisation | — | Missing | Multi-drop routing | Later |

## 5. Menu and product management

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Item CRUD | Create/update/delete, availability, image upload/removal, alt text, allergens/dietary tags/nutrition | Built | Same + media + channels | Channel pricing missing |
| Modifier groups | Groups, options, min/max, pricing | Built | Same | — |
| Combos / quick builds | Combo groups, quick builds | Built | Same | — |
| Profitability | Per-item margin/profitability view | Built | Margin by channel | Partial |
| Menu media | Upload JPEG/PNG/WebP (≤5 MB, magic-byte validated), alt text, thumbnails in admin/order/landing, delete/replace, served at `/media` | Built | Images, alt text, thumbnails | No cropping/resizing variants; files live on local disk/volume |
| Scheduled availability | — | Missing | Breakfast/late-night/weekend menus | Later |
| Channel pricing | Per-channel price/availability/visibility for dine-in, takeaway, delivery and aggregator; order pricing and customer menu follow the active channel | Built | Different price for delivery/aggregator | — |
| Sold-out toggle | Availability flag exists | Partial | One-tap sold-out across channels | UI polish |
| Allergens/nutrition | Per-item allergens, dietary tags, calories and macros shown on the customer menu | Built | Per-item flags and nutrition | With public site |

## 6. Inventory, procurement, supply chain

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Stock | Items, units, stock, minimums, movements | Built | Batch/expiry, stocktake | Batch/stocktake missing |
| Low stock | Summary, reorder queue, PO creation | Built | Auto-reorder rules | Auto rules missing |
| Purchase orders | Create, send, receive, reconcile items | Built | Supplier portal, approvals | Supplier portal missing |
| Vendors | Vendor list, price log, increase alerts, cheapest vendor | Built | Contracts, lead times | Partial |
| Invoice capture | OCR (Gemini) extract invoice items | Built | Supplier invoice match to PO | PO matching partial |
| Waste | Waste log + summary | Built | Waste reasons/analytics by station | Partial |
| Multi-location stock | — | Missing | Location transfers, central kitchen | Later |
| Demand forecasting | Next-day recipe prediction | Partial | Item-level forecast, seasonality | Later |

## 7. Recipes and production

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Recipes | CRUD, ingredients, cost | Built | Versioning, yield | Versioning missing |
| Prep prediction | Tomorrow's prep from sales | Built | Prep list by station/shift, batch scaling | Station prep list missing |
| Yield / waste factors | — | Missing | Trim/yield loss, portion control | Later |

## 8. Customers, CRM, loyalty

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Customer database | Profiles, phone/email, consent, order totals | Built | Unified profile + addresses | Addresses partial |
| Segments | Segment report, retention view, segment campaigns | Built | RFM automation, lifecycle journeys | Automation partial |
| Import/export | CSV import validation, export | Built | Same | — |
| Order history | Customer history, tracking, receipts | Built | Same | — |
| Loyalty | Points ledger (1/₹ on completed orders), tiers, referral codes with two-sided bonuses, points redemption at checkout (10 points = ₹1, 100-point minimum), account card and transactions | Built | Points, tiers, rewards, referrals | Redemption is checkout-only; no gift catalog |
| Store credit / gift cards | — | Missing | Issue/redeem/balance | Later |
| Feedback / NPS / reviews | Post-order star rating, 0–10 NPS, tags and comments; admin NPS/average/response-rate dashboard with low-rating follow-up | Built | Post-order feedback, review routing | Public review-site routing missing |
| Customer auth | Six-digit OTP (hashed, 5-minute expiry, attempt limit) or phone + recent order id; saved addresses scoped by customer token | Built | OTP login, saved sessions | Saved payment methods missing |

## 9. Marketing, communications, social, ads

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Coupons / flash sales | Builder, audience, channel, schedule | Built | Same + auto-apply | — |
| Campaign dispatch | WhatsApp/SMS/email, logs, retries, suppression | Built | Drip journeys, A/B tests | Journeys/A-B missing |
| Segment campaigns | One-click per segment with cleanup guard | Built | Same | — |
| Social publishing | Post creation, delivery logs, auto-publish gated | Built | Multi-platform scheduling, media | Media library missing |
| Ad campaigns | Create, launch, pause, budgets, metrics, ROI | Built | Provider sync depth, attribution | Attribution partial |
| Templates | Message text fields | Partial | Rich template editor with variables/preview | Later |
| Reputation / reviews | — | Missing | Review collection and response | Later |

## 10. Reporting and analytics

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Executive dashboard | KPIs, comparisons, targets, health score | Built | Real-time refresh, alerts | Auto-refresh partial |
| Sales analytics | Daily/monthly/lifetime, weekday, forecast, trends | Built | Drill-through to orders | Drill-through missing |
| Product/channel | Movers, category, channel, payment mix | Built | Margin by channel | Partial |
| Customer analytics | Segments, retention, value leaders | Built | Cohort curves, LTV | LTV/cohorts partial |
| Marketing analytics | Campaign ROI, conversion, budget pacing | Built | Multi-touch attribution | Later |
| Breakeven | Fixed costs, daily target, gap | Built | Scenario modelling | Partial |
| Exports | CSV for sales/customers/campaigns; saved-report CSV download; scheduled email delivery via the provider layer | Built | Scheduled reports, email delivery | Provider credentials required for delivery |
| Custom reports | Report builder for revenue/orders/AOV/tax/discount/tips/refunds grouped by day/order type/payment/status; saved views with schedule, recipients, run/export/send | Built | Report builder, saved views | Joins/cohorts and embedded charts missing |
| Multi-store consolidation | Store registry, per-store open/pause, order store tagging, consolidated revenue/orders/AOV/tips/refunds by store and group totals | Built | Group/franchise reporting | Menu/pricing per store missing |

## 11. Payments and finance

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Payment modes | Cash, UPI, card, prepaid, direct bank | Built | Split tender, partials | Split missing |
| Gateways | Razorpay + Cashfree sessions, webhooks, signatures | Built | Refunds, settlement import | Gateway refund API call not wired |
| Verification | Signature verification, manual staff confirmation | Built | Automated reconciliation | Partial |
| Reconciliation | Payment reconciliation page + events | Built | Provider settlement matching | Partial |
| Cash management | Drawer open/close, variance, daily close | Built | Cash drops, handover | Partial |
| Expenses | Categories, add, audit command | Built | Approval workflow depth | Partial |
| Refunds / voids | Void unpaid orders via cancel; refund captured payments with a reason, method, reference, ledger and audit trail | Built | Refund with reason/audit/provider call | Provider-initiated refund call not wired |
| Tips | Captured per order, included in totals, receipts and the tips summary | Partial | Tip pool, payout report | Payout missing |
| Tax | 5% split CGST/SGST, GST-ready accounting summary and order CSV | Built | Configurable tax rules, GST reports | Tax rates are fixed at 5% |
| Gift cards | — | Missing | Issue/redeem | Later |

## 12. Workforce

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Shift log | Log shifts, performance, by date, plus a weekly schedule with confirmation and hourly rates | Built | Scheduling, clock in/out | Clock in/out missing |
| Labour vs sales | Weekly labour cost, hours, sales and labour % with day/role breakdown | Built | Labour cost % dashboard | Overtime/statutory rules missing |
| Leave | Request + approve/reject | Built | Accruals, calendar | Partial |
| Attendance | Attendance command | Built | Biometric/PIN clock, geofence | Partial |
| Payroll preview | Hours × rate preview | Built | Full payroll, tips, statutory | Partial |
| Staff credentials | Managed staff login plus granular staff permission toggles (orders, kitchen, delivery, refunds, reports, settings, staff) | Built | Granular permissions | Per-user permission sets missing (role-level only) |
| HR department | People & HR as a department with a working People directory and staff/POS links; people, leave, attendance, payroll, onboarding, documents and exits modules listed with Euron pilot status | Partial | Full HRMS and payroll | Leave/payroll/onboarding/exits still planned; external HRMS connection pending |

## 13. Admin, platform, security, integrations

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Authentication | Admin/staff/customer sessions, HMAC cookies, rate limits, customer OTP, TOTP 2FA with recovery codes | Built | 2FA, SSO, OTP | SSO missing |
| Roles | admin / staff / customer, enforced granular permission sets for staff | Built | Granular permission sets | Per-user overrides missing |
| Audit | Operational audit events, payment events | Built | Full audit log search/export | Partial |
| Backups | Run tracking, logical proof, restore rehearsal | Built | Automated schedule + offsite | Partial |
| Readiness | Production ops, launch candidate, acceptance and a deployment checklist (DB, migrations, secret, admin, CORS, media, payments, headers) with commands | Built | Uptime/alerting/monitoring | External Sentry-style monitoring missing |
| Health probes | `/health`, `/ready` (DB) | Built | Same | — |
| Rate limiting | Per-instance sliding window | Built | Shared/edge limiter | Documented upgrade |
| Config | Env-based, timezone, secrets guard | Built | Feature flags, per-store settings | Partial |
| Department registry | Operations and People & HR seeded; departments own modules and members | Built | Department/module extensibility | Per-department permissions later |
| HR people directory | Employee mirror with code, designation, employment type/status, joining date, store, reporting line and optional POS staff link; search/filter and summary | Built | Employee master + org chart | Payroll/leave/onboarding/exits still planned |
| Multi-store / franchise | Store registry, per-store profile/hours, store-scoped orders/stock, consolidated reporting and POS hardware | Built | Tenant hierarchy, per-store config | Per-store menus/overrides missing |
| API keys / webhooks | Aggregator HMAC tokens, signed inbound order webhooks, signed outbound status/menu webhooks | Built | Public API + outbound webhooks | General public API keys missing |
| Observability | Request IDs, structured exception/error logs, client error monitor, health probes | Partial | Error tracking, metrics, traces | External APM/Sentry and metrics missing |
| Security headers | CSP, HSTS, nosniff, frame-deny, referrer and permissions policies on Next and API; request IDs and structured error logs | Built | CSP, HSTS, frame options | Nonce-based strict CSP missing |
| Error monitoring | Backend request IDs/exception logs, client error boundary reporting, admin monitor on Production Ops | Built | Error tracking integration | External provider (Sentry) missing |
| Localisation | INR, English only | Partial | Per-store currency/locale | Later |

## 14. UI/UX and accessibility (measured)

Audit at **390×844 (mobile)** and **1440×900 (desktop)**, all pages logged in:
no page-level horizontal overflow, but concrete issues:

| Finding | Evidence | Impact |
|---|---|---|
| Mobile portal navigation is a horizontally scrolling strip of 26 links | **Resolved in W1** — replaced with a 5-item bottom bar + grouped drawer | — |
| Desktop sidebar is a flat 26-item list with no active state or grouping | **Resolved in W1** — grouped, searchable, collapsible sidebar with active state and role badge | — |
| Tap targets under 40px are common on dense pages | **Improved in W2** — settings 49 → 42, menu 21 → 0, reports 14 → 7, operations 12 → 10 (390px audit); icon-only controls now get a 40px mobile hit area | Low: remaining settings density (W3) |
| Data tables rely on horizontal scrolling on mobile | **Resolved in W2** — reports (6), menu (1) and inventory (1) render mobile card lists instead; 0 wide tables across the audit | — |
| Public landing page was shallow (676 characters of above-the-fold text) | **Resolved in W1** — 4.5k characters, live menu/offers, FAQ, JSON-LD | — |
| Public site and portal use different visual languages | Landing rebuilt around charcoal/cream/red; portal keeps orange accents intentionally | Low (design tokens W2) |
| Page metadata is generic ("Pizza Blitz Portal") | **Resolved in W1** — template metadata, OG/Twitter, Restaurant + FAQ JSON-LD | — |
| No brand media assets in the repo (all imagery is remote Unsplash) | Item images can now be uploaded; hero/brand assets remain remote | Low: brand asset pack |

W1 measured results at 390×844 and 1440×900: landing text 676 → 4,500+
characters, zero page-level overflow on every audited page, zero browser
errors, mobile nav reduced from 26 scrolling links to 4 quick tabs + drawer,
and the full local audit suite (now including landing and portal-shell proofs)
passes.

W2 measured results: the store profile and opening hours are now database-backed
and editable at `/settings/store`; the public profile, landing page metadata,
JSON-LD, checkout readiness, and order creation all read the same source.
Pausing online ordering returns HTTP 503 on order creation and shows an
"Ordering paused" banner at `/order`. Scheduled orders use 15-minute slots up to
14 days ahead, enforce opening hours and a six-order slot capacity, and show the
scheduled time in checkout, tracking, POS cards, kitchen cards, tickets and
receipts. Tips can be set as presets or a custom amount at customer checkout and
POS, are stored on the order, included in totals and receipts, and summarised by
`/orders/tips-summary` and the POS “Tips Today” tile. On mobile, the dense
reports/menu/inventory tables are replaced by card lists (zero wide tables at
390px), menu action targets are 40px, and icon-only controls get a 40px hit
area. Covered by 23 backend tests and four new browser proofs
(`verify:store-profile`, `verify:scheduled-orders`, `verify:order-tips`,
`verify:responsive-tables`).

W3 measured results (refunds): admin-only refunds create a ledger row and audit
event, update `orders.refunded_amount` and move payment status through
`partially_refunded` to `refunded`. Refunds cannot exceed the captured amount,
unpaid orders are rejected, staff are forbidden, and the POS dialog, badge,
receipt and tracking all show the refund. Covered by five backend tests and
`verify:order-refunds`.

W3 measured results (KDS): staff open `/kds` to a full-screen board fed by
`GET /orders/kds` (active tickets, station line status, age, SLA priority,
scheduled due time). Station bump/recall uses the existing station status API
and moves the order status automatically; the board refreshes every 8 seconds,
highlights overdue tickets, chimes on new orders, filters by station, and offers
fullscreen. Covered by four backend tests and `verify:kds`.

W3 measured results (notifications): order status changes enqueue exactly one
notification per event (`order_notifications` unique order+event), using the
configured SMS/WhatsApp/email provider. Disabled providers/no phone are recorded
as `skipped` without blocking the order update, and the customer tracking page
lists sent updates. A `console` channel records sent messages without a provider
for development. Covered by six backend tests and
`verify:order-notifications`.

W3 measured results (menu media): menu items carry validated image uploads +
alt text, stored under `MEDIA_ROOT/menu` and served from `/media`, with a Next
rewrite so the frontend can render them. Admin thumbnails, customer catalog and
landing previews use the uploaded image when present and fall back to curated
imagery otherwise. Covered by four backend tests and `verify:menu-media`.

W4 measured results (customer OTP): customer sign-in now requires either a
six-digit OTP or phone + matching recent order. Codes are hashed, expire in five
minutes, allow five attempts, are rate limited, and are never returned in
production. Phone-only `/auth/customer/login` now returns 401. The account login
page has OTP and order-detail tabs, and the Next session route mints the customer
cookie after backend verification. Covered by four backend tests and
`verify:customer-otp`.

W4 measured results (saved addresses): customers can store up to 10 addresses
with a default, edit labels/lines/default, delete (with automatic promotion of a
new default), and reuse them at checkout through chips that fill the delivery
address. Address APIs are scoped to the authenticated customer token and the
Next session route now carries a backend customer token for address calls.
Covered by four backend tests and `verify:saved-addresses`.

W4 measured results (loyalty): completed orders earn one point per rupee into an
idempotent ledger, tiers progress from Slice Starter to VIP, and every customer
gets a referral code worth a 100-point bonus to both sides on a first order.
The account page shows points, tier progress, referral code, referral count and
recent activity; checkout accepts a referral code. Covered by four backend tests
and `verify:loyalty`.

W4 measured results (redemption): redeemed points create a 15-minute reserved
reward token, which checkout validates against the ordering customer, applies as
a pre-tax discount and marks used; points are debited with a `redeem` ledger row
and the token cannot be reused. Reusing, sharing or over-spending a token is
rejected. Covered by two backend tests and `verify:loyalty-redemption`.

W4 measured results (rider): `/rider/{token}` is a bearer-token mobile page for
assigned riders. It starts delivery, shares GPS coordinates with freshness, and
captures photo/signature/OTP proof before allowing delivered. Delivered/failed
transitions update the assignment and send customer notifications; tracking shows
rider status, last location link and proof captured. Admin order cards expose a
Rider link button. Covered by two backend tests and `verify:rider`.

W4 measured results (reports): the report builder computes metric totals from
non-cancelled orders over business-day ranges, groups by day/order type/payment/
status, supports filters, and exposes totals alongside rows. Saved views store
metrics/dimensions/range/schedule/recipients; the scheduler emails due reports
through Resend when configured and records sent/skipped/failed delivery state.
Covered by four backend tests and `verify:report-builder`.

W4 measured results (security): admins can enable TOTP 2FA, receive eight
one-time recovery codes, and are challenged for a six-digit code after their
password in both the portal and API login. Recovery codes are hashed, consumed
once, and challenge tokens are rejected as session tokens. Staff permissions are
stored as role overrides and enforced on reports and refunds; admins always pass
and can revoke/grant from `/settings/security`. Covered by two backend tests and
`verify:security`.

W4 measured results (franchise): a `stores` registry seeds a MAIN store, admins
can add locations and pause/activate them (the last active store cannot be
paused), orders carry `store_id`, and `/settings/stores` shows per-store and
group revenue/orders/AOV/tips/refunds over a business-day range with a best
store. Covered by three backend tests and `verify:stores`.

W4 measured results (accounting): `/accounting` shows gross sales, 5% GST split
into CGST/SGST, tips, refunds, net collected, payment mix and per-store totals
over a business-day range. The CSV endpoint emits one row per non-cancelled order
with business date, store, payment, subtotal, discount, CGST/SGST, tip, refund
and net for import into Tally/Zoho/QuickBooks. Covered by two backend tests and
`verify:accounting`.

W4 measured results (aggregators): admins connect Swiggy, Zomato, Uber Eats or
DoorDash per store and receive a token-scoped webhook URL. Inbound orders become
delivery orders with mapped items, customer, address, payment state and store;
replaying `external_order_id` returns the original order, and token rotation or
pausing blocks intake. Covered by three backend tests and `verify:aggregators`.

W4 measured results (workforce): admins schedule shifts by staff/role/date/time/
hourly rate, confirm or delete them, and see weekly hours, wage cost, sales and
labour percentage with day and role breakdowns at `/shifts/schedule`. Covered by
two backend tests and `verify:shift-schedule`.

W4 measured results (allergens): menu items store allergens, dietary tags,
calories and protein/carbs/fat. Admins edit them in the menu modal (comma-
separated allergens + tag toggles), and the customer menu shows vegetarian/vegan/
gluten-free chips, kcal and “Contains:” allergens. Covered by two backend tests
and `verify:menu-nutrition`.

W4 measured results (channel pricing): menu items can override price,
availability and visibility per dine-in/takeaway/delivery/aggregator channel.
The customer menu uses the active channel’s price, hides unavailable/hidden
channels, reprices the cart when switching pickup/delivery, and order creation
enforces the same channel price/availability/visibility. Covered by two backend
tests and `verify:channel-pricing`.

W4 measured results (security headers): Next and the API send CSP, HSTS,
nosniff, frame-deny, referrer and permissions policies. Requests carry an
`X-Request-ID` and server exceptions are logged with it. Client error boundaries
report to `/ops/client-errors`, and Production Ops shows recent browser errors.
Covered by two backend tests and `verify:security-headers`.

W4 measured results (hardware): per-store printer name, 58/80mm paper, auto-print,
receipt header/footer, drawer pin/URL are configurable. Test print returns
printable HTML/text, drawer pulse returns the exact ESC/POS bytes, and the
customer display opens a branded screen. Covered by two backend tests and
`verify:pos-hardware`.

W4 measured results (outbound sync): aggregator integrations can push order
status transitions to a partner URL with HMAC-SHA256 signatures, idempotent
per-order/status events, exponential retry/backoff, delivery logs and a
one-minute scheduler. Failing endpoints are retried with the error recorded.
Covered by two backend tests.

W4 measured results (menu sync): an integration can enable a menu-sync URL and
push the full menu (price, availability, visibility, channel prices, allergens,
dietary tags and macros) as a signed `menu.sync` payload. Success/failure is
returned to the operator. Covered by two backend tests with a local receiver.

W5 measured results (deployment): `/settings/deployment` checks database
reachability, Alembic head, auth-secret strength, master-admin configuration,
CORS origins, media writability, live payment provider and security headers,
with ready/warn/blocked states, remediation text and copyable verification
commands. Covered by two backend tests and `verify:deployment-checklist`.

W4 measured results (feedback): completed orders expose a one-time star/NPS/tag/
comment form on tracking. Admins get NPS, average rating, response rate, rating
distribution, top tags and low-rating follow-up at `/feedback`. Covered by two
backend tests and `verify:feedback`.

W4 measured results (item-level KDS): each order line can start, bump or recall
independently; ticket status is aggregated from all lines and timestamps clear
on recall. The KDS proof now exercises a single-line bump. Covered by two
backend tests.

---

## Enterprise gap register (build order)

### P0 — required to call this enterprise-complete (explicitly requested)

1. ~~**Landing page rebuild**~~ — done in W1 (env-driven store profile; editable
   profile in W2).
2. ~~**Portal shell UX**~~ — done in W1: grouped/searchable nav, active states,
   collapse, mobile drawer + bottom bar, role badge.
3. ~~**Master access**~~ — verified and documented in `docs/ACCESS.md`
   (`admin` / `admin123` locally; production requires configured secrets).
4. ~~**Store hours + online ordering controls**~~ — done in W2: weekly hours
   (including overnight windows), pause toggle with customer message, prep time,
   public status, and checkout/order enforcement.
5. ~~**Scheduled orders**~~ — done in W2: 15-minute pickup/delivery slots up to
   14 days ahead, capacity-checked and validated against opening hours, with the
   time surfaced in checkout, tracking, POS, kitchen cards, tickets and receipts.
6. ~~**Tips**~~ — done in W2: preset/custom tips at customer checkout and
   POS, persisted on the order, included in totals and receipts, with a tips
   summary endpoint and a “Tips Today” POS tile. Tip pooling/payout remains
   future work.
7. ~~**Refunds and voids**~~ — done in W3: voids via cancellation and
   admin-only full/partial refunds with reason, method, reference, ledger,
   audit event and refunded/refundable totals. Gateway refund API calls remain a
   provider integration step.
8. ~~**Dedicated KDS**~~ — done in W3: a full-screen `/kds` board for staff with
   Incoming/Preparing/Ready columns, station filters, live timers, overdue
   highlighting, per-station bump/recall, order start/ready/recall, chime and
   fullscreen.
9. ~~**Order notifications**~~ — done in W3: transactional status events over
   SMS/WhatsApp/email through the existing provider layer, gated by
   `ORDER_NOTIFICATIONS_ENABLED`, recorded per order (sent/skipped/failed) and
   shown on the customer tracking page.
10. ~~**Menu media**~~ — done in W3: admins upload JPEG/PNG/WebP images
    (validated by magic bytes, ≤5 MB), set alt text, replace/remove them, and the
    images render in the admin menu, customer catalog and landing page.
11. ~~**Store profile settings**~~ — done in W2: name, tagline, phone, email,
    address, map, Instagram, hours and ordering controls are editable in
    `/settings/store` and feed the landing page, metadata, JSON-LD and checkout.

### P1 — enterprise depth

11. ~~**Loyalty points/tiers and referrals**~~ — done in W4: points earned on
    completed orders, tiers, referral codes with a 100-point two-sided bonus,
    idempotent ledger, account-page card and checkout redemption
    (10 points = ₹1, minimum 100 points, 15-minute reserved reward).
12. ~~**Customer OTP login + saved addresses**~~ — done in W4: six-digit hashed
    codes with expiry/attempt limits, plus customer-scoped saved addresses
    (default, edit, delete, max 10) reused at checkout.
13. Split tender / partial payments; gift cards and store credit.
14. ~~**Rider app/PWA with GPS and proof of delivery**~~ — done in W4: a
    tokenized mobile rider page for dispatch, live GPS sharing, photo/signature/
    OTP proof capture and delivered/failed handling; tracking shows rider status
    and location link.
15. ~~**Custom report builder + scheduled email reports**~~ — done in W4: an
    ad-hoc builder (metrics × dimensions, date range, filters), saved views with
    range/schedule/recipients, run/CSV/send actions, and a scheduler that emails
    due reports through the provider layer.
16. ~~**2FA/SSO and granular permissions**~~ — done in W4: TOTP 2FA with
    recovery codes, a two-step login challenge (portal and API), and granular
    staff permissions enforced on reports and refunds. SSO remains.
17. ~~**Allergens/nutrition and channel-specific menus/pricing**~~ — done in W4:
    allergens, dietary tags, calories/macros, per-channel prices, availability
    and visibility driving the customer menu/cart and order totals.
18. ~~**Labour vs sales dashboard and shift scheduling**~~ — done in W4: weekly
    scheduled shifts with hourly rates, confirmation, roster and a labour-cost
    versus sales dashboard. Clock-in/out and statutory rules remain.
19. ~~**Security headers/CSP and error monitoring**~~ — done in W4: CSP, HSTS,
    nosniff, frame-deny, referrer/permissions policies, request IDs, backend
    exception logging, client error boundaries and an ops monitor. External
    Sentry-style aggregation remains.
20. ~~**Hardware: thermal printer + cash drawer + customer display**~~ — done in
    W4: per-store printer/paper/receipt settings, test-print HTML/text, ESC/POS
    drawer pulse bytes, customer-display URL and a branded display screen.
    Sending bytes to a physical printer still needs a local bridge.

### P2 — scale and ecosystem

21. ~~**Aggregator integrations (DoorDash/Uber/Swiggy/Zomato)**~~ — done in W4:
    token-scoped inbound webhooks with idempotency/store mapping, signed outbound
    status sync with retries/backoff/event log, and signed on-demand menu sync.
22. ~~**Multi-store/franchise hierarchy and consolidated reporting**~~ — done in
    W4: store registry with pause/activate, orders tagged by store, and a
    consolidated business-day report with group totals and best store. Shared
    menu/pricing per store remains.
23. Demand forecasting, auto-reorder, batch/expiry inventory.
24. ~~**Accounting exports (Tally/Zoho/QuickBooks-ready)**~~ — done in W4:
    GST summary (CGST/SGST, tips, refunds, payment/store mix) and a one-row-per-
    order CSV importable as a sales journal. Direct API connectors remain.
25. Public API keys + outbound webhooks; i18n/multi-currency.

---

## Implementation waves

| Wave | Contents | Exit criteria |
|---|---|---|
| W1 (done) | Landing page, portal shell/nav, master access, brand tokens, metadata, storefront cost-price leak | Landing + portal-shell proofs pass, build + audit suite green |
| W2 (done) | Store profile + weekly hours/order pause + prep time; scheduled orders with slot capacity; tips at checkout/POS with reporting; mobile card layouts for reports/menu/inventory and icon hit areas | Backend tests + proof scripts for each |
| W3 (done) | Refunds/voids with ledger + audit; full-screen KDS; order notifications; menu media uploads | Payment + kitchen proofs |
| W4 (done) | Customer OTP login + saved addresses + loyalty/referrals with redemption + rider app/GPS/proof + custom/scheduled reports + 2FA/granular permissions + multi-store/franchise + accounting/GST + aggregator intake + labour scheduling + allergens/nutrition + channel pricing + CSP/error monitoring + POS hardware | Public + account + rider + reports + security + franchise + accounting + aggregator + workforce + menu + channel + monitoring + hardware proofs |
| W5 (in progress) | Deployment checklist (done); external monitoring, live payment verification | Deployment checklist |
| W6 | Aggregators, multi-store, forecasting, accounting | Integration proofs |

Each wave ships with backend tests, a browser proof, responsive screenshots, and
updated documentation. The gap register above is the single source of truth for
what remains.
