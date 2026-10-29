# Pizza Blitz — Final Delivery Report

**Status:** local/staging delivery complete through the Company OS and conversion program;
production launch depends on the provider and deployment gates below.
**Master access:** `admin` / `admin123` at `/login` (development defaults).
**Verification:** 364 backend tests (87 subtests), 176 browser proofs + portal smoke,
OpenAPI 428 paths / 510 operations, migration `9f8e7d6c5b4a`, production build green.
**Handover:** [HANDOVER.md](HANDOVER.md). Plain-language tour:
[docs/BEGINNER_GUIDE.md](docs/BEGINNER_GUIDE.md).

---

## 1. What was delivered

Pizza Blitz is a working multi-surface restaurant company platform:

| Surface | Route(s) | Purpose |
|---|---|---|
| Marketing landing page | `/` | Conversion-first brand page, live menu/offers, Blaze 3D concierge, FAQ, hours, JSON-LD |
| Customer ordering | `/order`, `/checkout`, `/confirmation`, `/track`, `/account`, `/account/login` | Channel-aware menu, customisation, persisted cart, coupons/gift cards, tips, scheduled slots, payment proof, live tracking, reorder, loyalty, saved addresses, feedback |
| Staff counter/POS | `/counter`, `/orders`, `/kds` | Walk-in orders, table service, payments, receipt/refund, kitchen tickets, item-level bump/recall |
| Kitchen display | `/kds`, `/kitchen-ticket/[id]` | Station board, SLAs, per-line start/bump/recall, print tickets |
| Rider app | `/rider/[token]` | Assigned deliveries, GPS, proof of delivery |
| Owner/admin portal | 70 catalogued routes under `/dashboard`, `/departments`, `/menu`, `/inventory`, … | Sales, finance, inventory, purchasing, vendors, waste, recipes, workforce, CRM, marketing hub, journeys, reports, stores, departments/HR, Media Studio, landing CMS, tax/billing, providers, messaging, hardware, integrations, deployment, feedback |
| Company OS | `/departments`, `/departments/{key}`, `/work` | 16 department specs, 70 modules, KPI workspaces, tasks/approvals, scorecard |
| New department tools | 11 routes under `/departments/...` | Checklists, assets/work orders, menu engineering, stocktake, quality audits, licences, training, gift cards, goals, franchise pipeline, data platform |
| Public operational pages | `/receipt/[id]`, `/customer-display`, `/login`, `/careers`, `/support`, `/offer/[token]` | Receipts, second-screen display, portal login, hiring, support, offer acceptance |

**Current inventory:** 510 API operations across 428 paths, 97 page files (70 catalogued
portal routes plus public/dynamic pages), 119 database tables, 364 backend tests, 176 browser
proof scripts.

### Core capabilities

- **Conversion & ordering:** guest-first CTAs, persisted/revalidated cart, inline checkout
  recovery, confirmation with ETA, delivery/pickup/dine-in, customisations, coupons, gift
  cards, tips, scheduled orders, channel prices/availability/visibility, GST, invoices,
  refunds, voids, receipts.
- **AI concierge:** the 3D Blaze chef greets every landing visitor on its own after a few
  seconds in a dismissible bubble (once per browser session) and opens the chat when tapped;
  with a verified guest signed in the greeting is personal ("Welcome back. Want the usual?",
  naming saved allergies). Blaze answers from the live menu, recommends items and offers, adds
  or removes cart lines, and hands the cart to checkout; text and browser speech, responsive
  product cards. A verified guest's allergies and dietary preferences persist across visits;
  conflicting recommendations are withheld and explicit adds carry a visible warning. A
  consented memory also surfaces the latest order summary and usual fulfilment from the
  guest's own order history, so Blaze can offer the same order again. The same proof also
  unlocks "where is my order?": Blaze names the guest's newest live order with its state and
  ETA and opens that exact order on the tracking page, without retyping an id and phone.
  "Repeat my usual" rebuilds the guest's own last order in the cart at today's live prices,
  with its saved sizes and options, skipping anything that is gone or hidden and keeping the
  saved-allergy warning; nothing has to be retyped and nothing is charged until checkout.
  The saved allergy follows the guest to `/order` too: the checkout panel repeats it above
  Place Order and flags any cart item whose menu allergens match, and placing the order writes
  it onto the ticket, where the KDS card shows a red "Allergy · confirm before serving" strip.
  Memory therefore reaches both the payment moment and the kitchen, not just the chat.
- **POS & kitchen:** quick counter, table state, split payments, cash drawer, KOT, station
  routing, per-line readiness, KDS timers/SLA, print bridge, customer display.
- **Delivery:** zones and fees, rider assignment, mission control, GPS trail, proof of
  delivery, retry queue, delivery-vs-pickup pricing, and a live Leaflet/OpenStreetMap rider
  map on customer tracking (15-second refresh while live, no map API key required). The
  tracking page counts down to a due time from the zone's ETA ("Arriving in ~35 min · Due
  by 3:24 PM"), switches to "Arriving any moment" near the end, and flags a genuinely late
  delivery after a ten-minute grace; delivered orders drop the countdown.
- **Menu & inventory:** categories, option groups, allergens/nutrition, media, recipes,
  stock movements, stocktakes with variance, purchase orders, vendors, waste, low-stock
  alerts, invoice scans, menu engineering.
- **CRM & marketing:** customer profiles/consent, segments, loyalty/referrals/redemption,
  gift cards, campaigns, consent suppression, offers, social scheduling, attribution,
  feedback/NPS.
- **Workforce:** shifts, weekly roster, attendance command, leave, labour-vs-sales,
  payroll preview, granular staff permissions, training and certification.
- **Finance & reporting:** daily close, expenses, P&L/breakeven, outlet P&L, GST accounting,
  saved and scheduled reports, CSV exports, consolidated multi-store reporting.
- **Company OS:** department registry and navigation, department workspaces, tasks,
  comments, approvals, unread notices, company scorecard, audit tags, operations
  checklists, facilities assets/work orders, quality audits/CAPA, temperature logs, licence
  register, company goals, franchise pipeline, data-platform exports.
- **Platform:** JWT/portal HMAC sessions, TOTP 2FA, rate limits, security headers, request
  IDs, audit trail, backups/restore rehearsal, deployment checklist, stores, hardware,
  aggregator intake/status/menu sync.

## 2. Master access and end-to-end path

| Role | ID | Password | Entry |
|---|---|---|---|
| Master admin | `admin` | `admin123` | `/dashboard` |
| Counter staff | `staff` | `staff123` | `/orders` |
| Customer | phone + OTP (or recent order ID) | — | `/account` |

Verified end-to-end by the audit suite: landing → Blaze concierge or menu → customer order →
gift-card/coupon payment → KDS item bump → delivery/rider → close → receipt → reports →
feedback. Admin credentials are development defaults and are rejected in production unless
configured.

Full details: [docs/ACCESS.md](docs/ACCESS.md).

## 3. Enterprise benchmark

Compared with Domino’s-style ordering, POS, KDS, delivery, CRM, workforce and reporting
platforms. Built in this repository:

| Area | Enterprise expectation | Pizza Blitz |
|---|---|---|
| Web + mobile ordering | Channel menus, promos, live tracking | Built, responsive |
| Conversational ordering | Assistant that answers and builds a cart | Built; deterministic over live data, optional LLM gated |
| POS | Counter, tables, payments, receipts | Built |
| KDS | Station routing, bump/recall, SLAs | Built, item-level |
| Delivery | Zones, dispatch, rider proof | Built |
| CRM | Profiles, consent, segments, loyalty, gift cards | Built |
| Marketing | Campaigns, offers, attribution | Built; external send providers gated |
| Workforce | Roster, labour %, payroll preview, training | Built; SSO/biometrics later |
| Reporting | P&L, GST, outlet P&L, saved/scheduled reports | Built |
| Multi-store | Store registry, consolidated and outlet reporting | Built; per-store menus later |
| Company OS | Departments, modules, work, approvals, scorecard | Built for 16 department specs |
| Integrations | Aggregator orders/status/menu | Built, signed; partner approval gated |
| Observability | Error tracking, metrics, traces | Request IDs/logs/client-error monitor; external APM gated |

The complete row-by-row inventory and remaining gaps:
[FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) and [GAP_AUDIT.md](docs/GAP_AUDIT.md)
(59 closed gaps).

## 4. UI/UX, accessibility and responsive delivery

- Mobile-first public site and portal; desktop dashboard/sidebar; KDS dark high-contrast
  board; rider mobile view; customer display for a second screen.
- The landing page and Blaze concierge were proofed at desktop and 390px mobile, including
  product cards and cart hand-off.
- Proofs cover landing/conversion, portal shell, responsive tables, interactive control
  labels, safe action buttons, navigation link health, visual polish and action feedback.
- Accessibility hygiene: labelled controls, keyboard-visible focus, semantic headings,
  status text alongside colour, reduced-motion-safe avatar.

## 5. Landing page, concierge and Instagram

The public `/` page includes the brand hero, live menu categories, offers, order steps,
kitchen standards, a food-safety/pizza-craft explainer, FAQ, hours/location, restaurant
JSON-LD and the Blaze concierge entry. It adapts at mobile/tablet/desktop breakpoints.

Blaze is a 3D talking avatar backed by `/api/v1/assistant/chat`. It answers menu, offer,
hours and delivery questions, recommends items, adds/removes cart lines and hands the cart
to checkout. Speech uses browser synthesis/recognition; text works everywhere.

Instagram was requested as inspiration. No accessible Pizza Blitz profile/content was
found, so **no Instagram copy, imagery or captions were used**. Mobbin's connected plan
returned no content, so the design direction is original, based on public pizza/restaurant
landing conventions; no Mobbin or Instagram assets were copied.

## 6. Verification evidence

Run from the repository root:

```powershell
cd backend
python -W error::FutureWarning -m unittest discover -s tests -v   # 364 backend tests
alembic upgrade head
alembic check                                                      # no pending operations
ruff check .

cd ..\frontend
npm run typecheck
npm run lint
npm run build                                                      # API offline
npm run verify:audit                                               # 176 proofs + audit
npm run test:e2e                                                   # portal smoke
```

Latest recorded results:

- backend suite: **364 passed, 87 subtests**;
- migrations: `9f8e7d6c5b4a` applies on a copy of the database and creates all 15 workspace
  tables plus `customer_memories`; `alembic check` clean;
- production build: **compiled successfully** with the backend stopped;
- Company OS proofs: company OS, 11 department workspaces, gift-card checkout/refund,
  landing conversion and Blaze concierge all pass against the production build;
- navigation link health: 85 links across 35 source routes, plus 2362 labelled controls and
  35 safe action clicks;
- working tree: contains the uncommitted Company OS/conversion program on `main`.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for every proof and command.

## 7. Known limits / production gates

These are provider or deployment decisions, not hidden stubs:

1. **Live deployment** needs a verified host/account. No valid hosting token or Pizza Blitz
   cloud project was available, so no live URL was claimed. See
   [DEPLOY_REQUEST.md](DEPLOY_REQUEST.md).
2. **Live payments** require Cashfree/Razorpay keys and webhook secrets; manual and
   pay-at-counter flows work locally, and gift cards work end to end.
3. **Email/SMS/WhatsApp** sends need provider credentials; the console channel is used in
   development and delivery is recorded honestly.
4. **Aggregator partnerships** need platform approval and URLs; signed intake, status and
   menu sync are implemented and tested against local receivers.
5. **Physical ESC/POS printing** needs a local bridge; browser print and ESC/POS drawer
   bytes work today.
6. **External monitoring** (Sentry/APM) needs a DSN/endpoint; request IDs, structured logs
   and the admin client-error monitor are in place.
7. **Optional LLM answers** need a provider key; the assistant's deterministic path works
   without one. Hosted TTS/telephony, per-store menus, PWA/offline, multi-language,
   reservations, route optimisation and biometric attendance remain later.
8. **Company OS scope**: department tools are operational, not a double-entry ERP; gift
   cards are stored-value records, not card-network issuance.

## 8. Run locally

```powershell
# terminal 1
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010

# terminal 2
cd frontend
npm run dev -- --hostname 127.0.0.1 --port 3011
```

Open `http://localhost:3011/login`, sign in as `admin` / `admin123`, then use
`/settings/deployment` for launch gates and `/roadmap` for the delivery board.
