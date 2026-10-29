# Pizza Blitz — Company Operating System & Conversion Blueprint

**Date:** 2026-10-27
**Baseline:** `d6e921e` (feature freeze + delivery handover), working tree clean.
**Purpose:** Turn Pizza Blitz from a feature-rich restaurant platform into a company operating
system organized around departments, and lift completed orders on the customer site.
**Status:** Phase 0 conversion rescue, Phase 1 company foundation and Phase 2 department
depth are implemented and verified locally (2026-10-28), including all 11 department
workspaces and the Blaze concierge. Phase 3 production readiness is blocked on hosting and
provider credentials. No commit was made; changes are in the working tree.

---

## 1. Executive summary

Pizza Blitz has a strong transaction layer and a genuinely complete HR department. It is not yet
a company operating system.

- Only **two departments** are seeded: Restaurant Operations and People & HR.
- **16 catalogue modules** exist against **57 portal routes**; accounting, customers and
- marketing are catalogued but assigned to no department.
- Only HR is department-scoped and has a real department dashboard. Every other department is a
  module list.
- Navigation is a hardcoded six-group list, not generated from the department registry.
- Operational data is not owned by a department, and most cost/stock tables have no `store_id`.

The customer site has a solid visual base, but five verified P0 conversion leaks are losing
orders: the public menu CTA goes to an admin login, the cart is lost on refresh, order
submission has no failure path or confirmation page, offer cards are not clickable, and tracking
does not refresh.

**Target:** 10 departments plus shared services, six company primitives, and a conversion-first
customer experience. **Sequence:** conversion rescue → company foundation → department depth →
production readiness. The first two workstreams can run in parallel with separate file ownership.

---

## 2. Current state (verified against code)

### 2.1 Department model

| Fact | Evidence |
|---|---|
| Two departments are seeded: `operations` and `hr` | `backend/app/services/department_service.py:152-183` |
| 16 catalogue modules; 3 are assigned to no department (`accounting`, `customers`, `marketing`) | `department_service.py:20-150, 152-183` |
| 57 portal routes exist; most have no module entry | `frontend/src/app/(dashboard)/**/page.tsx`; `HANDOVER.md:130` |
| Only HR enforces department membership plus permission | `backend/app/api/deps.py:128-179` |
| `DepartmentMember.role` (head/manager/member) is stored but never checked | `deps.py:176`; `domain.py:906-918` |
| Departments have no parent, head, cost centre or store scope | `domain.py:881-903` |
| Module assignment is add-only; route/status cannot be changed after creation | `department_service.py:369-377` |
| HR routes are hardcoded and force-activated at startup | `department_service.py:460-483` |
| The generic department page hardcodes an HR permission map and an HR external-system panel | `frontend/src/app/(dashboard)/departments/[key]/page.tsx:256-271, 493-571` |
| `/departments` is absent from middleware access prefixes | `frontend/src/lib/access.ts:3-30` |
| Dashboard layout defaults a missing session to the admin shell | `frontend/src/app/(dashboard)/layout.tsx:10-25` |

### 2.2 Portal information architecture

- Six navigation groups and **41 links** for **57 portal routes**; 16 routes are not in the
  sidebar (`frontend/src/lib/portal-navigation.ts:58-130`).
- One group ("Menu & stock") holds 15 links across five unrelated domains
  (`portal-navigation.ts:79-98`).
- `/settings/page.tsx` is **3,810 lines** and contains access control, staff credentials,
  payments, cash drawer, delivery zones, Google Sheets import and admin credentials.
- Five settings pages (`deployment`, `hardware`, `integrations`, `security`, `stores`) are
  reachable only through header tiles, creating a second navigation system.
- Duplicated surfaces: `/operations` vs `/kds`; `/orders` vs `/counter`; `/shifts` vs
  `/shifts/schedule` vs HR attendance; `/marketing` vs `/communications` vs `/promotions` vs
  `/social` vs `/ads` vs `/journeys`; Dashboard vs CEO Command vs Reports vs AI Insights vs
  Production Ops.
- Staff see the Departments link, but the API returns only HR; `/shifts` is admin-only. Staff
  hit dead ends.

### 2.3 Store and cost data

| Fact | Evidence |
|---|---|
| Orders carry `store_id` | `backend/app/models/domain.py:522-532` |
| `daily_sales` has no `store_id` | `domain.py:6-16` |
| `inventory_items` and `inventory_transactions` have no `store_id` | `domain.py:93-116` |
| `expenses` has no `store_id` | `domain.py:124-132` |
| `purchase_orders` has no `store_id` | `domain.py:134-143` |
| No operational table carries `department_id` | model scan |
| Multi-store reporting is revenue-only; there is no outlet P&L | `HANDOVER.md`, `docs/FEATURE_MATRIX.md` |

### 2.4 Customer funnel

Verified P0 issues:

| # | Finding | Evidence | Business impact |
|---|---|---|---|
| P0-1 | Public "View the menu" (landing) and "Menu" (careers footer) point to admin-only `/menu`, which redirects guests to login | `frontend/src/app/page.tsx:491-495`; `frontend/src/app/careers/page.tsx:62-64`; `access.ts:16`; `middleware.ts:92-105` | High-intent menu traffic hits a login wall and abandons |
| P0-2 | Active cart exists only in React state; only customer profile and reorder are persisted | `frontend/src/app/order/page.tsx:294`; persistence at `511, 672, 1219` | Refresh, back-navigation or login loses the basket |
| P0-3 | Order POST has no try/catch; a network failure leaves the button stuck on "Placing order…"; no confirmation page or redirect | `order/page.tsx:1170-1211, 1296-1300` | Lost orders, duplicate submissions, support calls |
| P0-4 | Offer cards are non-clickable `<div>`s, although `/order?coupon=` works | `frontend/src/app/page.tsx:669-715`; `order/page.tsx:455-462` | Promotional demand leaks and cannot be attributed |

Verified P1 issues:

| # | Finding | Evidence |
|---|---|---|
| P1-1 | Tracking fetches once; no polling or refresh | `frontend/src/app/track/page.tsx:107` |
| P1-2 | Marketing consent is pre-checked | `order/page.tsx:315` |
| P1-3 | Landing says "Cash or prepaid" unconditionally; prepaid is hidden unless a gateway is ready | `page.tsx:544-547`; `order/page.tsx:2463-2482` |
| P1-4 | Menu search/category only; unavailable items silently disappear; no dietary filter | `order/page.tsx:471, 785-788, 889-899` |
| P1-5 | Mobile first screen shows staff/internal panels before the menu | `order/page.tsx:1386-1532`; `frontend/e2e/artifacts/visible-order-mobile.png` |
| P1-6 | No analytics, sitemap or robots | `frontend/package.json`; `frontend/src/app/layout.tsx`; no `app/sitemap.ts` / `app/robots.ts` |
| P1-7 | OTP `debug_code` is returned outside production; `ENVIRONMENT` defaults to development | `backend/app/services/customer_otp_service.py:60-94`; `backend/app/core/config.py:8` |
| P1-8 | Account forces login and exposes an "Admin Portal" link | `frontend/src/app/account/page.tsx:156-169`; `middleware.ts:116-125` |
| P1-9 | Null opening hours render "Open 24/7"; hero ETAs are hardcoded | `page.tsx:148, 254-285, 499-500` |

**Important positives to preserve:** guest checkout and server-side repricing are implemented
(`backend/app/api/api_v1/endpoints/orders.py:1817-1894`), coupon deep links already work, and
the landing page already has live menu/offers, JSON-LD, responsive layout and a store status
panel.

---

## 3. Target company model

### 3.1 Ten departments

| # | Department | Sub-functions | Primary KPIs | Owned modules (current or new) |
|---|---|---|---|---|
| 1 | **Executive Office** | Strategy, board pack, capex, expansion/franchise | Revenue vs plan, four-wall EBITDA, same-store sales, payback | `/dashboard`, `/ceo`, `/reports`, `/roadmap`, new goals/budget |
| 2 | **Operations** | Multi-outlet ops, front of house, delivery, guest support, facilities | Sales vs LY, AOV, ticket time, on-time delivery, labour %, audit score | `/counter`, `/orders`, `/operations`, `/kds`, `/shifts`, `/shifts/schedule`, `/support-inbox`, `/messaging`, `/feedback`, new checklists/incidents |
| 3 | **Kitchen & Menu** | Production, recipes, menu engineering, waste, 86 board, NPD | Food cost %, usage variance, make time, waste %, 86 rate | `/menu`, `/recipes`, `/waste`, menu nutrition/allergens, new batch/portion tools |
| 4 | **Supply Chain & Inventory** | Procurement, vendors, POs, receiving, stock, transfers | Price variance, OTIF/fill rate, stock accuracy, inventory days | `/inventory`, `/inventory/scan`, `/purchase-orders`, `/vendors`, new GRN/stocktake/transfers |
| 5 | **Quality, Safety & Compliance** | Food safety, audits, CAPA, licences, legal, insurance | Temp compliance, audit score, critical violations, licence renewals | New: CCP/temp logs, audits, CAPA, licence/contract register |
| 6 | **Finance & Accounts** | GL, AP/AR, GST/TDS, cash, payroll accounting, outlet P&L | Prime cost, outlet EBITDA, cash variance, close days, DSO/DPO | `/accounting`, `/sales`, `/daily`, `/invoices`, `/expenses`, `/breakeven`, `/settings/billing`, new budgets/store P&L |
| 7 | **People & HR** | HR ops, recruitment, payroll, training, IR, compliance | Attrition, absenteeism, labour %, overtime %, time-to-hire | Existing HR suite plus new LMS/skills matrix |
| 8 | **Marketing & Brand** | Brand, campaigns, social/content, ads, PR, local store kits | Reach, engagement, CAC, ROAS, new-customer % | `/marketing`, `/communications`, `/social`, `/ads`, `/journeys`, `/settings/media`, `/settings/content` |
| 9 | **Revenue & CRM** | Pricing, promotions, loyalty, CRM, aggregators, delivery mix | AOV, repeat rate, active members, redemption, LTV, discount % | `/customers`, `/promotions`, loyalty, `/settings/integrations`, channel pricing, new gift cards/LTV |
| 10 | **Technology & Data** | Platform, integrations, BI, security, deployment | Uptime, sync success, data freshness, incident MTTR, backup success | `/ops`, `/settings`, `/settings/deployment`, `/settings/hardware`, `/settings/integrations`, `/settings/providers`, `/settings/security` |

### 3.2 Sub-departments (use `parent_id`, not new top-level clutter)

- **Guest Experience & Support** under Operations: support inbox, messaging, feedback/NPS, SLA,
  knowledge base.
- **Facilities & Maintenance** under Operations: asset register, preventive maintenance, work
  orders, breakdowns.
- **Training & Certification** under People & HR: courses, skill matrix, certification expiry,
  FoSTaC records.
- **Legal & Compliance** under Quality, Safety & Compliance: licences, contracts, statutory
  calendar, POSH/DPDP.
- **Franchise & Expansion** under Executive Office: site pipeline, proforma, capex, opening
  playbook, royalties.

### 3.3 Shared services (not departments)

Reports/BI, Media Studio, global search, notifications, approvals inbox, audit log, org
directory, and company settings.

---

## 4. Company OS primitives

1. **Department workspace** at `/departments/{key}`: header, 4–6 KPI strip, "Needs you" queue,
   tasks/checklists, team, module grid, activity and handoffs.
2. **Scoped RBAC**: `department_roles` and `department_role_permissions`; membership role
   enforced (head/manager/member); admin bypass; legacy global staff permissions kept as a
   fallback so POS toggles keep working.
3. **Department + outlet dimension**: `department_id` on work objects; `store_id` on
   `daily_sales`, `inventory_items`, `inventory_transactions`, `expenses`, `purchase_orders`;
   cost centres and outlet P&L.
4. **Generic tasks and approvals**: `work_items`, `work_item_comments`, `approvals`,
   `approval_steps`; amount/store/role thresholds, chains, delegation and SLA. Existing offer
   approvals and HR tasks remain domain-specific and can be adapted later.
5. **Scorecards**: 3–5 KPIs per department with a named owner, target, cadence and roll-up to
   the CEO health score.
6. **Org and audit**: parent departments, heads, reporting lines, org chart; every audit event
   tagged with department and store.

### 4.1 Data model changes

**Extend existing tables**

- `business_departments`: `parent_id`, `head_staff_id`, `kind` (executive/functional/store),
  optional `store_id`, `cost_center`.
- `department_modules`: `permission_key`, `nav_group`, `is_owner`, `is_shared`; one owner per
  module, shared assignments allowed for overview/reports/media.
- `department_members`: `title`, `reports_to_staff_id` or `employee_id`, `department_role_id`,
  `store_id`, effective dates.

**New tables**

- `department_roles`, `department_role_permissions`
- `work_items`, `work_item_comments`
- `approvals`, `approval_steps`
- `staff_notifications`
- `kpi_snapshots` (only if trend history is needed; live aggregation first)

**Compatibility**

- Keep `/hr/*` routes and `hr.*` permission keys as aliases during migration.
- Add nullable columns first, backfill, then enforce.
- Stop `ensure_departments()` mutating routes at startup; move seeding to an idempotent data
  migration/CLI.

---

## 5. Missing capabilities, ranked

| # | Capability | Why it matters | Current coverage | Phase |
|---|---|---|---|---|
| 1 | Department workspace + scoped RBAC | Without it, new departments are only nav labels | Only HR | 1 |
| 2 | Generic approvals and delegation | Owner cannot delegate spend, discounts, refunds, POs, capex safely | Offer approvals only | 1 |
| 3 | Outlet P&L and daily flash | Revenue is visible, but cost, stock and expenses are global | Store-tagged ledgers + `/finance/pnl` P&L | 2 |
| 4 | Recurring tasks/checklists/audits | Daily operating system is checklists, temperatures and sign-offs | HR onboarding tasks only | 2 |
| 5 | Inventory truth | Food cost is won on portion, waste and stock accuracy | Global stock, no stocktake/transfers/expiry | 2 |
| 6 | Procurement control loop | Requisition → PO → GRN → invoice match → payment | POs and OCR only | 2 |
| 7 | Compliance and licence register | FSSAI, FoSTaC, labour codes, contracts and renewals | GST config only | 2 |
| 8 | Company → department → outlet scorecard | Accountability, not just dashboards | Static owner pages | 1–2 |
| 9 | Learning and certification | Pizza quality and FoSTaC compliance depend on certification | Onboarding checklist only | 2 |
| 10 | Asset and maintenance work orders | Ovens/chillers/HVAC are revenue-critical | POS hardware settings only | 2 |

---

## 6. Customer experience direction (for maximum orders)

Mobbin is connected and authorized. Its tools become available after a chat/session refresh; the
first Mobbin-backed design pass will benchmark the patterns below against current restaurant and
commerce flows.

### Landing page

- One primary CTA above the fold: **Order now**, with delivery/pickup toggle and postcode/address
  entry.
- Live offers as actionable cards, each linking to `/order?coupon=CODE`.
- Menu preview with real photos, prices and "Add" actions; not just a link.
- Social proof: real ratings, order count, FSSAI licence, hygiene rating, kitchen story.
- Locality: store address, map link, accurate hours, real prep/delivery windows.
- Three-step "how it works" strip and a sticky mobile order bar.
- Reduce hero copy; make the food and the order action the hero.

### Menu

- Category-first navigation with Pizza first; search across name, description, category.
- Dietary/allergen filters; explicit "Sold out" state; no silent removal.
- Quick add from card; customisation sheet with defaults and price clarity.
- Combo/upsell suggestions and "frequently ordered together".

### Cart and checkout

- Persist cart, fulfilment mode, coupon and schedule in localStorage; restore and revalidate.
- Guest-first checkout, three steps, visible labels, autocomplete and input modes.
- Explicit delivery zone/address resolution; server-side fee validation.
- Readiness-driven payment copy; no "prepaid" promise when no gateway is configured.
- Inline validation, retry, idempotency key, timeout and a real error state.
- Order summary with fees, taxes, tip and ETA before submit.

### Confirmation and retention

- Success page/receipt with order number, ETA, live tracking and one-tap add-on.
- Poll tracking every 30–60 seconds; show rider stage and proof.
- Reorder, loyalty balance, referral and feedback on the same page.
- Support prefill from the order; FAQ and phone path.
- Analytics events for menu view, add-to-cart, checkout start, order placed, payment success,
  reorder and feedback; sitemap/robots.

### Portal

- Department-first navigation with a department switcher and global search.
- Department home as a scorecard and work queue, not a module grid.
- Approvals inbox and "My work" for staff; role-aware quick actions.
- Company settings separated from department settings.

---

## 7. Phased plan

### Phase 0 — Conversion rescue (high ROI, low risk)

**Goal:** stop the verified leaks before structural work.

1. Point landing/careers menu CTAs to `/order`; redirect guests from `/menu` to `/order`; add a
   logged-out link-health proof.
2. Persist active cart, fulfilment mode, coupon and schedule; restore on load with revalidation.
3. Wrap order submission and payment-session creation in try/catch/finally; add timeout,
   idempotency key, retry and inline error state.
4. Add a dedicated confirmation page/receipt redirect with order number, ETA and tracking.
5. Make offer cards link to `/order?coupon=CODE`; show applied state.
6. Remove staff/internal panels from the customer order page; hide "Admin Portal" on account;
   uncheck marketing consent; add labels/autocomplete/input modes; fix success styling.
7. Poll tracking every 30–60 seconds; show rider stage.
8. Landing truth pass: real hours/address/ETAs, readiness-driven payment copy, FSSAI/trust
   signals; add sitemap/robots and funnel events.
9. Security gate: fail closed on OTP `debug_code` unless an explicit local flag is set;
   document `ENVIRONMENT=production` in the launch checklist.

**Acceptance:** typecheck, lint, build; existing customer e2e proofs plus new logged-out CTA and
checkout-resilience proofs; mobile screenshot review; no P0 in the funnel audit.

**Implementation status (2026-10-27):** done except server-side idempotency keys and third-party
analytics (no property ID available, so nothing was invented). Verified with typecheck, lint,
production build, 16 backend OTP/portal tests, landing, link-health, OTP, checkout, full customer
E2E, and the new confirmation/cart-restore proof. Funnel proofs run on `http://localhost:3011`
because Next normalizes loopback redirects to `localhost`. `/menu` now sends guests to `/order`;
staff keep the menu manager. Remaining Phase 0 follow-ups: an idempotency-key column on orders,
and a funnel-event sink once an analytics property/warehouse is chosen.

### Phase 1 — Company foundation

**Goal:** make departments real operating units.

1. Expand `MODULE_CATALOG` to cover all 57 portal routes; seed 10 departments and shared
   services; add ownership, permission and nav metadata.
2. Add department parent/head/kind/store/cost centre; module permission/nav fields; member
   title/reporting/role; new department role tables.
3. Generalize HR access into `require_department_permission` and department role checks; keep
   HR aliases.
4. Generate portal navigation from the department registry; add department switcher and
   "My work"; protect all portal prefixes; stop defaulting anonymous sessions to admin.
5. Build `/departments/{key}` v1 for all departments: KPI strip, needs-you queue, team, modules,
   quick actions. Start with Operations, Finance, Marketing, HR; then the rest.
6. Add generic work items and approvals; wire expenses, purchase orders, leave and social
   approvals as the first consumers.
7. Add department/store audit tagging and a company scorecard roll-up.

**Acceptance:** backend suite plus new department/permission tests; migration on a fresh
database; department access proofs for admin/head/member/staff; no hardcoded HR map; existing
HR proofs still green.

**Phase 1 delivery (implemented locally, 2026-10-27):**

- Registry: 16 department specs (10 core, 5 sub-departments, shared services) and a 68-module
  catalogue whose route templates cover the portal route set exactly; `/departments/{key}` is
  the single dynamic workspace route. Seeding is idempotent; membership, scoped roles and
  role permissions live in `department_roles` / `department_role_permissions`.
- Access: department-scoped permission checks with an admin bypass and a legacy global-staff
  fallback; a plain member added without a scoped role joins the seeded default Member role,
  while heads and managers without one keep the legacy fallback. `/departments/navigation`,
  `/departments/access` and `/departments/scorecard` are registry-driven; every portal path is
  protected and anonymous sessions no longer default to the admin shell.
- Workspace: `/departments/{key}` renders live KPIs, a "Needs you" merge of work items and
  approvals, permission-filtered quick actions, modules with status and routes, team roster,
  scoped roles, sub-departments and the external-system panel. The literal `/departments/hr`
  page remains for the HR module suite and now shows its own approval/work queue.
- Work engine: `/work` inbox with tasks, comments, statuses, filters, unread notices and
  approval decisions; create flows for tasks and approvals. Staff-created tasks default to the
  creator as owner; admin-created tasks stay department-owned. Expenses, purchase orders,
  leave and social approvals are mirrored automatically.
- Scorecard and audit: `/departments` shows the company scorecard with each department's
  primary KPI and attention count; audit events carry department and store tags.
- Verification: `286 passed, 87 subtests` in the backend suite (excluding the unrelated
  `tests/test_sheets_key.py` sheet-key script), `npm run typecheck`, `npm run lint`,
  `npm run build`, and the `verify:company-os`, `verify:departments`, `verify:portal-shell`,
  `verify:hr-permissions` and `verify:hr-analytics` browser proofs.

### Phase 2 — Department depth (parallel workstreams)

**Delivered: Finance foundation**

- Store dimensions on daily sales, expenses, purchase orders and waste
  (`b7c41f2a9d10`), backfilled to MAIN with a unique `(store_id, date)` daily ledger.
- Outlet pickers on daily entry, expense capture, sales history and purchase-order
  history/drafting. Stats, day close and shift totals aggregate across outlets instead of
  reading the first store row.
- `/finance/pnl` outlet P&L: ledger revenue, COGS/opex/waste/untracked split, POS billed
  cross-check, flags, daily trend and cost mix. The planned `finance-budgets` module is
  active through `c3e52a7b1f04`.
- Verification: `286 passed, 87 subtests`, typecheck, lint, build, `verify:finance-pnl`,
  `verify:stores`, `verify:accounting`, `verify:company-os`, `verify:portal-shell`,
  `verify:role-gates`, `verify:links`, `verify-daily-close-command`, the expense
  audit/approval proofs and `verify:vendor-waste`.
- Still open in Finance: budgets vs actual, cash reconciliation beyond day close, AP/AR
  and GST/TDS posting.

**Phase 2 delivery (implemented locally, 2026-10-28):**

- Operations: opening/closing/weekly checklist templates with run state, required-item
  sign-off and completion gate.
- Facilities: asset register with status/criticality/service dates and breakdown work orders.
- Kitchen: menu-engineering matrix (star/plough-horse/puzzle/dog) with actions, guarding
  historical order lines against reused menu IDs.
- Supply: stocktake sessions with counted quantities, variance valuation and completion that
  posts inventory corrections.
- Quality/legal: audits with findings/CAPA, temperature/CCP logs with out-of-range flags and
  a licence/contract register with expiry alerts.
- Training: seeded and custom courses, assignment, completion, scores and certification
  expiry.
- Revenue: gift cards end to end — issue/reload/redeem/void, public validation, checkout
  debit inside the order transaction, refund credit-back, liability summary.
- Executive: company goals with progress, and a franchise pipeline with stages/proforma and
  opening playbook.
- Technology: data-platform overview (freshness/quality/exports) and CSV export.
- Finance: the earlier finance slice (store dimensions, outlet P&L) is included.
- Customer: the ordering assistant and 3D avatar were added beyond the original table; see
  the Phase 10 entries in [ROADMAP.md](../ROADMAP.md) and the assistant proof in
  [VERIFICATION.md](VERIFICATION.md).

The Phase 2 workstream table below is retained as the original plan and is now delivered at
the depth described above, not as a full ERP.

| Workstream | First deliverables |
|---|---|
| Finance | Store dimensions on expenses/daily sales/POs; outlet P&L; budgets; cash reconciliation; AP/AR basics |
| Supply | Store-scoped inventory; stocktake; transfers; GRN and 3-way match; vendor scorecards |
| Kitchen & Menu | Menu engineering; theoretical vs actual usage; portion/yield; 86 board; batch plan |
| Quality & Compliance | Temperature/CCP logs; hygiene audits; CAPA; licence/contract register; compliance calendar |
| Operations | Open/close checklists; store visits; incidents; facilities asset register and work orders |
| HR | LMS/skills matrix; certification expiry; FoSTaC records; Labour Code registers; biometric gate |
| Marketing & Revenue | Brand kit; local store kits; review response; LTV/segments; gift cards; aggregator commission accounting |
| Technology | Integration monitoring; BI/warehouse; SSO; department audit log; data freshness |

### Phase 3 — Production readiness and design pass

- Mobbin-backed redesign of landing, menu, cart, checkout, confirmation and department homes.
- Postgres deployment, migrations, secrets, TLS, backups/restore rehearsal, monitoring.
- Provider onboarding: payments, messaging, storage, aggregators, pager.
- Run the full audit against the deployment; definition of done is a live URL with real
  credentials exercised, not another feature count.

**Phase 3 status (2026-10-28):** the conversion-first landing, menu, cart, checkout,
confirmation and 11 department homes are implemented and proofed locally. The redesign uses
original work because Mobbin's connected plan returned no content. Deployment is **blocked,
not faked**: the available Vercel token was invalid and the active GCP project has no Pizza
Blitz service. Postgres/provider onboarding therefore remains open; see
[DEPLOY_REQUEST.md](../DEPLOY_REQUEST.md) and [LAUNCH_RUNBOOK.md](LAUNCH_RUNBOOK.md).

---

## 8. Parallel execution model

| Agent | Scope | File ownership | Depends on |
|---|---|---|---|
| Main | Architecture, integration, review, final verification | Shared contracts, migrations review | — |
| Agent A | Conversion rescue (public site) | `frontend/src/app/page.tsx`, `order/page.tsx`, `track/page.tsx`, `account/**`, customer e2e | — |
| Agent B | Department foundation (backend) | `domain.py`, new Alembic revision, `department_service.py`, `deps.py`, `permission_service.py`, department endpoints | — |
| Agent C | Department-first portal IA | `portal-navigation.ts`, `PortalShell.tsx`, `(dashboard)/layout.tsx`, `departments/**`, settings split | B (registry contract) |
| Agent D | Verification and department module specs | Tests, e2e proofs, docs, QA/compliance design | A/B/C checkpoints |

**Integration checkpoints**

1. Contract freeze: module keys, routes, permission keys, department seeds.
2. Backend migration + tests green before frontend nav consumes the registry.
3. Conversion branch merged only after logged-out CTA and checkout-resilience proofs pass.
4. Full regression: backend suite, typecheck, lint, build, e2e, audit with a fresh backend.
5. Mobile review at 390px and desktop review at 1440px.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Department refactor breaks HR access | Keep `/hr/*` routes and `hr.*` keys as aliases; add compatibility tests |
| `store_id` backfill corrupts existing data | Nullable columns, default store, explicit migration and reconciliation report |
| Navigation generated from registry drifts from routes | Add a route-coverage test that fails on unowned routes |
| Conversion changes break existing proofs | Add new proofs first; run the full customer suite before merge |
| Mobbin tools not loaded in the current session | Refresh/new chat; connector is already authorized |
| Scope expands beyond one release | Phase gates; ship Phase 0 and Phase 1 separately with green audits |
| Production defaults leak OTP/debug data | Fail closed; add a deployment test for `ENVIRONMENT=production` |

---

## 10. Success metrics

**Customer conversion**

- Menu view → add-to-cart rate
- Cart → checkout-start rate
- Checkout-start → order-placed rate
- Order completion rate and failed-submission count
- Average order value and attach rate (sides/drinks/desserts)
- Repeat-order rate within 30 days
- Mobile abandonment and page performance
- Offer click-through and coupon redemption
- Support contacts per 100 orders

**Company OS**

- Departments with a live home and 3–5 KPIs: 10/10
- Portal routes with a named owning department: 59/59
- Approval cycle time and overdue approvals
- Checklist completion and audit scores
- Store P&L completeness and close days
- Staff weekly active use by department

**Technical**

- Backend tests green (276 + new), typecheck, lint, build
- 168+ browser proofs plus new department/conversion proofs
- Full audit green against the documented baseline
- No P0 conversion or access defects open

---

## 11. Decisions needed

1. Start with the conversion rescue, the company foundation, or both in parallel?
2. Does "go live" mean deploy to a real URL now, or build and verify locally/staging first?
3. Approve the 10-department model (with sub-departments) or reduce the initial set?
4. How deep should Phase 2 go in this engagement (all workstreams vs a first slice)?

Once these are decided, the first two workstreams can start in parallel with the agent split in
Section 8.
