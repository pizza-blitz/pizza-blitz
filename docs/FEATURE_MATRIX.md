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

Numbers in this snapshot: **217 API endpoints**, **38 routes/pages** (29 portal,
1 KDS, 8 public), **125 browser proof scripts**, **92 backend tests**, **39
database tables**, **19 integration points**.

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
| Landing page | Full landing page: live menu previews, offers, story, kitchen standards, delivery areas, FAQ, JSON-LD, responsive | Built | Brand story, offers, menu preview, service area, trust, FAQ, SEO, store info | Store profile is admin-editable; menu imagery still remote |
| Menu browsing | `/order` catalog with categories/search | Built | Fast filtered catalog, sold-out states, images | Media library missing |
| Product customization | Sizes, crusts, toppings, add-ons, combos with server-side pricing | Built | Same | — |
| Cart and checkout | Cart, coupon, pickup/delivery, address, contact, payment choice, tips, scheduling | Built | Guest + saved checkout, tips, scheduling | Saved-cart recovery missing |
| Coupons and offers | Validate/apply server-side, promotion engine | Built | Public offers page, auto-apply best offer | Offers surface on landing page missing |
| Pickup / delivery | Delivery quote by zone, fees, minimums, ETAs | Built | Address autocomplete + geocoding | Keyword zones only |
| Order tracking | Phone + order-id tracking with status steps | Built | Live status + notifications + map | No push/SMS/WhatsApp status events |
| Customer account | Phone + recent order login, order history, profile/consent | Built | Password/OTP, saved addresses, saved payments | No OTP/password, weak proof of identity |
| Scheduled orders | 15-minute slots up to 14 days ahead, capacity-checked, validated against opening hours, stored on the order and shown in tracking/POS/kitchen/receipt | Built | Order for later time/date, slot capacity | Slot capacity is fixed at 6; no per-day holiday calendar |
| Store hours / order pause | Weekly opening hours, pause toggle, prep time, public open/closed status, checkout + order enforcement | Built | Per-day hours, overnight windows, holiday closures, pause with message, prep capacity | Holiday calendar and per-slot capacity missing |
| Tips | Preset/custom tip at checkout and POS, persisted on the order, included in totals/receipts, tips summary API | Built | Preset/custom tip, tip reporting | Tip pooling and payout missing |
| Order notifications | — | Missing | Confirmation, ready, out-for-delivery, delivered via WhatsApp/SMS/email | Must build |
| Allergens / nutrition | — | Missing | Allergen flags, vegetarian/vegan, nutrition per item | Must build (menu metadata) |
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
| Receipts | Receipt page + print-ready kitchen ticket | Partial | Thermal printer, reprints, email receipt | Hardware integration missing |
| Refunds | Admin-only full/partial refunds with reason, method, reference, ledger and audit event; order tracks refunded/refundable totals | Built | Full/partial refund with provider and ledger | Gateway refund API call not wired |
| Tips | Captured on orders; summary endpoint (total/today/average); shown on the POS header | Partial | Tip entry, tip pool, payout report | Pooling/payout missing |
| Gift cards / store credit | — | Missing | Issue/redeem/balance | Later |
| Customer display | — | Missing | Second screen / pole display | Out of scope |
| Offline mode | — | Missing | Local queue + sync | Later |

## 3. Kitchen (KDS)

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Kitchen board | Operations page with kitchen state and queue | Built | Dedicated full-screen KDS per station | — |
| Kitchen display (KDS) | `/kds` full-screen board: Incoming/Preparing/Ready columns, per-station filters, live timers, overdue highlight, item bump/recall, order start/ready/recall, sound + fullscreen, 8s polling | Built | Full-screen timers, bump/recall, sound, station routing | Printer/hardware integration missing |
| Station routing | Item/category → kitchen station, per-station status | Built | Configurable routing + filters | Good |
| Kitchen ticket | Printable ticket per order | Built | Ticket routing, reprint | Printer routing missing |
| SLA / priority | Age, priority, next action per line | Built | Timers, overdue alerts, sound | Timers/sound missing |
| Item-level readiness | Station-level only | Partial | Per-item bump/recall | Must build |
| Courses / sequencing | — | Missing | Fire/hold courses | Later |
| Capacity / throttling | — | Missing | Order throttling when kitchen is saturated | With store ops |
| Kitchen display device mode | Responsive full-screen `/kds` with station filters, chime and fullscreen toggle | Built | Locked full-screen mode | Kiosk/lockdown is browser-level |

## 4. Delivery and dispatch

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Zones and fees | Zones, fees, minimums, ETAs, keyword validation | Built | Polygon/geocoded zones | Geocoding later |
| Dispatch | Assignment, rider, status queue, mission control | Built | Rider app, live map, auto-assign | Rider app/map missing |
| Delivery economics | Fee, cost, margin view, retry queue proofs | Built | Cost per delivery, batching | Batching missing |
| Proof of delivery | — | Missing | Photo/signature/OTP at door | Must build |
| Third-party delivery | — | Missing | DoorDash/Uber/Swiggy/Zomato integration | Later |
| Route optimisation | — | Missing | Multi-drop routing | Later |

## 5. Menu and product management

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Item CRUD | Create/update/delete, availability | Built | Same + media + channels | Media/channels missing |
| Modifier groups | Groups, options, min/max, pricing | Built | Same | — |
| Combos / quick builds | Combo groups, quick builds | Built | Same | — |
| Profitability | Per-item margin/profitability view | Built | Margin by channel | Partial |
| Menu media | — | Missing | Images, alt text, thumbnails | Must build |
| Scheduled availability | — | Missing | Breakfast/late-night/weekend menus | Later |
| Channel pricing | — | Missing | Different price for delivery/aggregator | Later |
| Sold-out toggle | Availability flag exists | Partial | One-tap sold-out across channels | UI polish |
| Allergens/nutrition | — | Missing | Per-item flags and nutrition | With public site |

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
| Loyalty | — | Missing | Points, tiers, rewards, referrals | Must build |
| Store credit / gift cards | — | Missing | Issue/redeem/balance | Later |
| Feedback / NPS / reviews | — | Missing | Post-order feedback, review routing | Must build |
| Customer auth | Phone + recent order id | Partial | OTP login, saved sessions | OTP must build |

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
| Exports | CSV for sales/customers/campaigns | Built | Scheduled reports, email delivery | Scheduling missing |
| Custom reports | Curated pages only | Missing | Report builder, saved views | Later |
| Multi-store consolidation | — | Missing | Group/franchise reporting | Later |

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
| Tax | 5% split CGST/SGST in invoice | Partial | Configurable tax rules, GST reports | Must improve |
| Gift cards | — | Missing | Issue/redeem | Later |

## 12. Workforce

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Shift log | Log shifts, performance, by date | Built | Scheduling, clock in/out | Scheduling missing |
| Leave | Request + approve/reject | Built | Accruals, calendar | Partial |
| Attendance | Attendance command | Built | Biometric/PIN clock, geofence | Partial |
| Payroll preview | Hours × rate preview | Built | Full payroll, tips, statutory | Partial |
| Staff credentials | Managed staff login | Built | Granular permissions | Permissions partial |
| Labour vs sales | — | Missing | Labour cost % dashboard | Later |

## 13. Admin, platform, security, integrations

| Capability | What exists today | Status | Enterprise expectation | Gap |
|---|---|---|---|---|
| Authentication | Admin/staff/customer sessions, HMAC cookies, rate limits | Built | 2FA, SSO, OTP | 2FA/SSO missing |
| Roles | admin / staff / customer | Built | Granular permission sets | Partial |
| Audit | Operational audit events, payment events | Built | Full audit log search/export | Partial |
| Backups | Run tracking, logical proof, restore rehearsal | Built | Automated schedule + offsite | Partial |
| Readiness | Production ops, launch candidate, acceptance | Built | Uptime/alerting/monitoring | Monitoring missing |
| Health probes | `/health`, `/ready` (DB) | Built | Same | — |
| Rate limiting | Per-instance sliding window | Built | Shared/edge limiter | Documented upgrade |
| Config | Env-based, timezone, secrets guard | Built | Feature flags, per-store settings | Partial |
| Multi-store / franchise | — | Missing | Tenant hierarchy, per-store config | Later |
| API keys / webhooks | — | Missing | Public API + outbound webhooks | Later |
| Observability | Logs only | Missing | Error tracking, metrics, traces | Later |
| Security headers | Next defaults | Partial | CSP, HSTS, frame options | Quick win |
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
| No brand media assets in the repo (all imagery is remote Unsplash) | `frontend/public` only has `.gitkeep` | Medium: media library (W2) |

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
9. **Order notifications** — WhatsApp/SMS status events (confirmation, ready,
   out for delivery, delivered), respecting the existing provider gates.
10. **Menu media** — item images uploaded/stored, alt text, responsive rendering.
11. ~~**Store profile settings**~~ — done in W2: name, tagline, phone, email,
    address, map, Instagram, hours and ordering controls are editable in
    `/settings/store` and feed the landing page, metadata, JSON-LD and checkout.

### P1 — enterprise depth

11. Loyalty points/tiers and referrals.
12. Customer OTP login + saved addresses.
13. Split tender / partial payments; gift cards and store credit.
14. Rider app/PWA with GPS and proof of delivery.
15. Custom report builder + scheduled email reports.
16. 2FA/SSO and granular permissions.
17. Allergens/nutrition and channel-specific menus/pricing.
18. Labour vs sales dashboard and shift scheduling.
19. Security headers/CSP and error monitoring.
20. Hardware: thermal printer + cash drawer + customer display integration.

### P2 — scale and ecosystem

21. Aggregator integrations (DoorDash/Uber/Swiggy/Zomato).
22. Multi-store/franchise hierarchy and consolidated reporting.
23. Demand forecasting, auto-reorder, batch/expiry inventory.
24. Accounting integrations (Tally/Zoho/QuickBooks), tax/GST reporting.
25. Public API keys + outbound webhooks; i18n/multi-currency.

---

## Implementation waves

| Wave | Contents | Exit criteria |
|---|---|---|
| W1 (done) | Landing page, portal shell/nav, master access, brand tokens, metadata, storefront cost-price leak | Landing + portal-shell proofs pass, build + audit suite green |
| W2 (done) | Store profile + weekly hours/order pause + prep time; scheduled orders with slot capacity; tips at checkout/POS with reporting; mobile card layouts for reports/menu/inventory and icon hit areas | Backend tests + proof scripts for each |
| W3 (in progress) | Refunds/voids with ledger + audit (done); full-screen KDS (done); order notifications, menu media (next) | Payment + kitchen proofs |
| W4 | Menu media, loyalty, OTP, saved addresses | Public + account proofs |
| W5 | Rider PWA, reports builder, 2FA, hardware | Deployment-ready checklist |
| W6 | Aggregators, multi-store, forecasting, accounting | Integration proofs |

Each wave ships with backend tests, a browser proof, responsive screenshots, and
updated documentation. The gap register above is the single source of truth for
what remains.
