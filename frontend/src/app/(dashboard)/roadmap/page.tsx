import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  Flag,
  ListChecks,
  Rocket,
  ShieldCheck,
  Target,
} from "lucide-react";

type Status = "done" | "active" | "planned" | "blocked";

type RoadmapItem = {
  title: string;
  status: Status;
  value: string;
};

type TimelinePhase = {
  title: string;
  dateRange: string;
  goal: string;
  items: RoadmapItem[];
};

type DailyPlan = {
  date: string;
  focus: string;
  status: Status;
  planned: string[];
  output: string;
};

type ProofStatus = "passed" | "watch";

type StabilizationMetric = {
  label: string;
  value: string;
  note: string;
};

type StabilizationProof = {
  area: string;
  proof: string;
  status: ProofStatus;
  value: string;
  artifact: string;
};

type DeliveryPhase = {
  phase: string;
  title: string;
  status: Status;
  target: string;
  goal: string;
  shipTogether: string[];
  proof: string;
};

const progressCards = [
  {
    label: "Overall Product",
    value: "94%",
    note: "Live implementation score is 94%: portal, POS, kitchen, delivery, CRM, reporting and proof boards are working; the remaining gap is external production proof.",
  },
  {
    label: "Order Operations",
    value: "100%",
    note: "Counter POS, customer checkout, kitchen/KOT, delivery assignment, receipt and tracking proofs are green on the live production system.",
  },
  {
    label: "Production Readiness",
    value: "73%",
    note: "Live readiness score is 73 with no blocked modules; restore rehearsal proof and real payment/growth provider credentials remain the production gates.",
  },
  {
    label: "Execution Mode",
    value: "10 Feature Audit",
    note: "Production Ops now exposes the 10-feature restaurant readiness audit with 8 pass, 2 warning, and clear next actions.",
  },
];

const deliveryPhases: DeliveryPhase[] = [
  {
    phase: "Phase 1",
    title: "Data, Reporting And Access Foundation",
    status: "done",
    target: "Now",
    goal: "Make owner numbers trustworthy and lock the portal behind correct roles before deeper automation.",
    shipTogether: [
      "Upload and reconcile 2023-2026 month-wise sales from Google Sheets",
      "Advanced sales comparisons: same day, week, month and year",
      "Proper admin, counter, kitchen, delivery and customer roles",
      "Production database, backups, environment security and E2E gates",
    ],
    proof: "Sales totals match source sheet, role navigation works, build passes and browser E2E covers protected paths.",
  },
  {
    phase: "Phase 2",
    title: "Ordering Engine",
    status: "done",
    target: "Next",
    goal: "Make website, counter, kitchen and delivery behave like one order system.",
    shipTogether: [
      "Customer website ordering: catalog, cart, checkout, pickup/delivery, ETA and tracking",
      "Counter POS final polish: fast touch workflow, KOT, receipt printing and mixed payments",
      "Kitchen display system: alerts, prep timers, KOT view and auto-refresh hardening",
      "Delivery zones, charges, address validation, rider assignment and live tracking",
    ],
    proof: "One order can move from website or counter to kitchen, delivery/pickup, bill, receipt and closed state.",
  },
  {
    phase: "Phase 3",
    title: "Revenue And Payment Completion",
    status: "active",
    target: "After Phase 2",
    goal: "Make every menu, coupon and payment rule correct enough for real customer money.",
    shipTogether: [
      "Real UPI/card payment gateway and webhook integration",
      "Refund, failed payment and settlement reconciliation",
      "Product customization: sizes, toppings, add-ons, combos and admin pricing controls",
      "Coupons, flash sales, prepaid checks and checkout discount proof",
    ],
    proof: "Low-value live payment succeeds, webhook updates order, receipt matches settlement and customized pricing is correct.",
  },
  {
    phase: "Phase 4",
    title: "Growth, Marketing And Launch Ops",
    status: "active",
    target: "Final launch batch",
    goal: "Turn the portal into a growth system with real sending, social posting, ads and launch operations.",
    shipTogether: [
      "Customer contact repository and consent-safe segments",
      "Real WhatsApp, SMS and email campaign sending",
      "Social media auto-posting and scheduled post audit",
      "Ad campaign management, budget tracking, monitoring, visual polish and full E2E coverage",
    ],
    proof: "Owner can launch an approved offer, send/post/sync it through real providers and see delivery plus sales impact.",
  },
];

const completedValue: RoadmapItem[] = [
  {
    title: "Internal restaurant portal foundation",
    status: "done",
    value: "Admin can see sales, reports, menu, customers, vendors, inventory and operations areas in one portal.",
  },
  {
    title: "Promotion and coupon engine",
    status: "done",
    value: "Campaigns can be created, scheduled, linked to coupon redemptions and measured through ROI reports.",
  },
  {
    title: "Marketing send queue",
    status: "done",
    value: "Campaign sending has queue visibility, dry-run proof, delivery history, suppression and retry handling.",
  },
  {
    title: "Customer segmentation and hygiene",
    status: "done",
    value: "Customer lists can be grouped for repeat buyers, high spenders, opt-ins and campaign readiness checks.",
  },
  {
    title: "Social and ads handoff",
    status: "done",
    value: "Promotions can create social posts and Meta ad campaign shells with provider readiness checks.",
  },
  {
    title: "Ad budget pacing command",
    status: "done",
    value: "Ad campaigns show spend pace, expected spend, remaining budget, ROAS signal and next actions.",
  },
  {
    title: "Ad operational controls",
    status: "done",
    value: "Ads can now be paused, resumed, completed, duplicated and audited through action history.",
  },
  {
    title: "Payment production command pass",
    status: "done",
    value: "Settings now shows gateway readiness, provider setup, unsettled prepaid orders, recent settlements and manual webhook proof.",
  },
  {
    title: "Customer web checkout pass",
    status: "done",
    value: "Customer order page now shows checkout progress, stricter contact and delivery checks, coupon proof and pickup/delivery/payment readiness.",
  },
  {
    title: "Delivery charges and zone economics",
    status: "done",
    value: "Delivery rules now show fee range, minimum-order protection, ETA promise, live queue exposure and customer minimum-gap messaging.",
  },
  {
    title: "Address validation and delivery assignment",
    status: "done",
    value: "Staff now see address score, review warnings, dispatch next action, payment blocks and rider assignment state in the live operations board.",
  },
  {
    title: "Product customization depth",
    status: "done",
    value: "Sizes, crusts, toppings, add-ons, combos and sauces are now tracked through readiness, server pricing, cart, POS, operations and receipts.",
  },
  {
    title: "Order flow polish",
    status: "done",
    value: "Customers now get receipt handoff after order placement, while staff see close-ready orders, payment blockers, receipt readiness and status trails.",
  },
  {
    title: "Payment, delivery, roles and production proofs",
    status: "done",
    value: "E2E proof files exist for payment readiness, delivery zones, role gates and production operations.",
  },
  {
    title: "Weekly stabilization and proof suite",
    status: "done",
    value: "Roadmap now exposes a QA command board, visual route audit, critical flow proofs and the next active risk for the June 20 push.",
  },
  {
    title: "Authentication and role hardening",
    status: "done",
    value: "Security overview is now admin-only, Settings shows role gates, account recovery controls and audit controls, and browser/API proof covers admin, staff and customer boundaries.",
  },
  {
    title: "Customer account lifecycle",
    status: "done",
    value: "Customer account now has editable profile/contact preferences, consent ledger, visible order history, loyalty context and a signed profile update path.",
  },
  {
    title: "Real WhatsApp/SMS/email readiness",
    status: "done",
    value: "Promotions now show channel credential checks, template compliance states, dry-run-only safe test sends and masked readiness receipts.",
  },
  {
    title: "Social publishing readiness",
    status: "done",
    value: "Social now shows hidden-token readiness, scheduled post blockers, delivery issue audit and retry dry-run controls.",
  },
  {
    title: "Ad provider sync",
    status: "done",
    value: "Ads now show provider credentials, external campaign ID audit, safe dry-run/apply sync and pause/resume guardrails.",
  },
  {
    title: "Reporting comparison depth",
    status: "done",
    value: "Reports now show same weekday last week, same month last year, product movers, category movers and channel/product decisions.",
  },
  {
    title: "Weekly beta review",
    status: "done",
    value: "Roadmap now shows proof audit, remaining beta blockers, production handoff and the next database-readiness path.",
  },
  {
    title: "Production database path",
    status: "done",
    value: "Production Ops now shows managed PostgreSQL target, migration checklist, backup/restore drill and DB blockers.",
  },
  {
    title: "Environment and secrets security",
    status: "done",
    value: "Production Ops now shows required env coverage, secret masking, credential checks, rotation drill and security blockers.",
  },
  {
    title: "Deployment pipeline",
    status: "done",
    value: "Production Ops now shows build gate, release steps, rollback/log inspection, production smoke and deployment blockers.",
  },
  {
    title: "Production launch integrations command",
    status: "done",
    value: "Production Ops now combines live credentials, managed database, backup/restore, deployment secrets and production smoke into one launch command board.",
  },
  {
    title: "Live environment execution command",
    status: "done",
    value: "Production Ops now shows credential cutover, managed database migration, secret sync, restore rehearsal, public-host smoke and go/no-go signoff in one execution board.",
  },
  {
    title: "Credential activation command",
    status: "done",
    value: "Production Ops now shows gateway, messaging, social and ad credential readiness, low-value smoke plan, blockers and provider go/no-go signoff.",
  },
  {
    title: "Full customer order E2E",
    status: "done",
    value: "Customer order journey now proves menu, customization, checkout, receipt link, tracking link and backend order handoff.",
  },
  {
    title: "Counter order E2E",
    status: "done",
    value: "Staff POS now proves customized order creation, bill/receipt, kitchen status handoff, close action and paid payment state.",
  },
  {
    title: "Delivery order E2E",
    status: "done",
    value: "Delivery orders now prove charge, zone, rider assignment, dispatch, delivered close, payment state and customer tracking.",
  },
  {
    title: "Dashboard visual polish",
    status: "done",
    value: "Mobile navigation now has active state, dashboard cards are denser on mobile, currency formatting is consistent and chart empty states are explicit.",
  },
  {
    title: "Operational dashboards",
    status: "done",
    value: "Dashboard now exposes today's orders, kitchen state, delivery handoff and owner alerts from live order-flow and delivery queue data.",
  },
  {
    title: "Marketing live-readiness command",
    status: "done",
    value: "Promotions now show one live-readiness board for campaign sender, social posting and Meta ads handoff from existing provider APIs.",
  },
  {
    title: "Data quality and export command",
    status: "done",
    value: "Production Ops now shows customer export, report export, import readiness and backup/restore checks in one command board.",
  },
  {
    title: "Launch candidate hardening command",
    status: "done",
    value: "Production Ops now shows critical route coverage, E2E proof ownership, production blockers and release decision in one launch command board.",
  },
  {
    title: "Final acceptance walkthrough command",
    status: "done",
    value: "Production Ops now shows admin, staff/POS and customer walkthrough lanes with acceptance gates before the June 20 checkpoint.",
  },
  {
    title: "Beta delivery checkpoint command",
    status: "done",
    value: "Production Ops now shows final build, smoke proof queue, known gaps and next production plan for the June 20 checkpoint.",
  },
  {
    title: "Frontend typecheck quality gate",
    status: "done",
    value: "The frontend now has explicit typecheck, live smoke and quality verification scripts so future slices can be checked before release.",
  },
  {
    title: "Logical database export proof",
    status: "done",
    value: "Production Ops now has a one-click logical export proof that checks live database table readability and records a checksum without exposing secrets.",
  },
];

const immediateRemaining: RoadmapItem[] = [
  {
    title: "Live gateway credentials and bank settlement activation",
    status: "planned",
    value: "Add Direct Bank, Cashfree, or Razorpay settlement proof, run live low-value checkout and compare payout reports.",
  },
  {
    title: "Customer account lifecycle and consent",
    status: "done",
    value: "Customer profile, order history, contact preferences and consent states are now visible and updateable after checkout.",
  },
  {
    title: "Real WhatsApp/SMS/email readiness",
    status: "done",
    value: "Provider setup panels, template compliance and safe test-send workflow are visible in the promotions command board.",
  },
  {
    title: "Social publishing readiness",
    status: "done",
    value: "Token setup visibility, schedule blockers, retry controls and social delivery audit are visible in the social command board.",
  },
  {
    title: "Ad provider sync",
    status: "done",
    value: "Meta provider credentials, external campaign IDs, pause/resume guardrails and launch audit are now visible.",
  },
  {
    title: "Marketing live-readiness command",
    status: "done",
    value: "The promotions page now combines campaign sender, social posting and ad launch readiness into one visible decision board.",
  },
  {
    title: "Data quality and export command",
    status: "done",
    value: "Customer CSV export, report export checks, import readiness and backup/restore proof are now visible in Production Ops.",
  },
  {
    title: "Launch candidate hardening command",
    status: "done",
    value: "Critical route stability, proof queue, blocker review and release decision are now visible in Production Ops.",
  },
  {
    title: "Final acceptance walkthrough command",
    status: "done",
    value: "Admin, staff/POS and customer walkthrough lanes plus beta checkpoint gates are now visible in Production Ops.",
  },
  {
    title: "Beta delivery checkpoint command",
    status: "done",
    value: "Final build, smoke/core proof queue, known-gap documentation and production next steps are now visible in Production Ops.",
  },
  {
    title: "Reporting comparison depth",
    status: "done",
    value: "Owner reports now show same-day, same-month, product, category and channel comparison signals.",
  },
  {
    title: "Weekly beta review",
    status: "done",
    value: "Proof audit, blocker correction list and next production database path are now visible on the roadmap.",
  },
  {
    title: "Production database path",
    status: "done",
    value: "Managed PostgreSQL target, SQLALCHEMY_DATABASE_URI handoff, Alembic migration steps and restore rehearsal are now visible.",
  },
  {
    title: "Environment and secrets security",
    status: "done",
    value: "Required env vars, masked sensitive values, auth/session secrets, CORS and rotation recovery checks are now visible.",
  },
  {
    title: "Deployment pipeline",
    status: "done",
    value: "Build gate, release checklist, rollback/log inspection and production smoke path are now visible in Production Ops.",
  },
  {
    title: "Production launch integrations command",
    status: "done",
    value: "Live credentials, managed database, backup/restore, deployment secrets and production smoke are now visible as one production launch lane board.",
  },
  {
    title: "Live environment execution",
    status: "done",
    value: "Credential cutover, DB migration, secret sync, restore rehearsal, cutover windows and go/no-go evidence are now visible in Production Ops.",
  },
  {
    title: "Real credential activation and provider smoke",
    status: "done",
    value: "Gateway, webhook, WhatsApp/SMS/email, social publishing and Meta Ads activation readiness are now visible with smoke steps and blockers.",
  },
  {
    title: "Compact production readiness summary",
    status: "done",
    value: "Production Ops now shows built percentage, restaurant-ready percentage, module counts, requirement counts and remaining external gates in one owner-facing panel.",
  },
  {
    title: "Logical database export proof",
    status: "done",
    value: "Ops can now run a software-verifiable table-count and checksum proof for the live database; managed Supabase snapshot/pg_dump and restore rehearsal remain separate external gates.",
  },
  {
    title: "Live provider smoke pilot",
    status: "planned",
    value: "Use real credentials to execute low-value checkout, signed webhook, owner-approved campaign sends, social publish and paused ad sync against the live host.",
  },
  {
    title: "Delivery live tracking and assignment refinement",
    status: "planned",
    value: "Add customer-facing tracking, rider capacity, delivery exceptions and more granular dispatch history.",
  },
  {
    title: "Real provider sending and sync",
    status: "planned",
    value: "Use live WhatsApp, SMS, email, social and ad provider tokens with compliance-aware sending and provider-state sync.",
  },
  {
    title: "Deployment, backups and environment security",
    status: "active",
    value: "Pipeline is mapped; live host credentials, real deployment, log access and restore proof still need production proof.",
  },
];

const timeline: TimelinePhase[] = [
  {
    title: "Next 30 Days",
    dateRange: "24 May 2026 - 22 Jun 2026",
    goal: "Reach a strong beta that can run internal operations and controlled customer ordering demos.",
    items: [
      {
        title: "Finish live order flow",
        status: "active",
        value: "Counter order, customer web order, payment state, receipt and delivery/pickup status should connect end to end.",
      },
      {
        title: "Harden marketing operations",
        status: "active",
        value: "Campaign pause, resume, duplicate, completion, real provider setup and safer sending controls.",
      },
      {
        title: "Production readiness pass",
        status: "active",
        value: "Database, secrets and deployment pipeline are defined; live deploy, monitoring and restore proof remain.",
      },
      {
        title: "Browser proof suite",
        status: "done",
        value: "Weekly stabilization now tracks critical browser proofs, visual route health and roadmap proof artifacts.",
      },
    ],
  },
  {
    title: "Next 60 Days",
    dateRange: "24 May 2026 - 22 Jul 2026",
    goal: "Move from beta to pilot-ready software for real restaurant staff and selected customers.",
    items: [
      {
        title: "Operational staff workflows",
        status: "planned",
        value: "Kitchen status, delivery assignment, order edits, refunds, cancellation and shift accountability.",
      },
      {
        title: "Customer retention system",
        status: "planned",
        value: "Customer accounts, offer targeting, wallet/loyalty basics and automated win-back playbooks.",
      },
      {
        title: "Finance and inventory discipline",
        status: "planned",
        value: "Food cost tracking, recipe usage, purchase orders, waste log and margin reports tied to sales.",
      },
    ],
  },
  {
    title: "Next 90 Days",
    dateRange: "24 May 2026 - 21 Aug 2026",
    goal: "Become a mature restaurant operating system with analytics, automation and growth tooling.",
    items: [
      {
        title: "Multi-channel growth engine",
        status: "planned",
        value: "Coordinated website, social, ads, WhatsApp, SMS and email campaigns with revenue attribution.",
      },
      {
        title: "Owner command center",
        status: "planned",
        value: "Same-day, last-week, last-month, last-year and goal-vs-actual comparisons for every key metric.",
      },
      {
        title: "Scale and reliability",
        status: "planned",
        value: "Secure deployment, monitoring, backups, performance checks and operator runbooks.",
      },
    ],
  },
];

const june20Push: DailyPlan[] = [
  {
    date: "23 May 2026",
    focus: "Marketing system baseline",
    status: "done",
    planned: [
      "Stabilize campaign scheduling and sending",
      "Add delivery recovery and retry visibility",
      "Improve ad campaign management",
    ],
    output: "Send queue, targeted delivery retry, ad pacing, and multiple E2E proofs were completed.",
  },
  {
    date: "24 May 2026",
    focus: "Roadmap and ad operations",
    status: "done",
    planned: [
      "Create a visible roadmap page",
      "Show 30/60/90 day direction",
      "Complete ad pause, resume, complete, duplicate and action history controls",
    ],
    output: "Roadmap command board and ad operational controls were completed with build and browser proofs.",
  },
  {
    date: "25 May 2026",
    focus: "Payment gateway production pass",
    status: "done",
    planned: [
      "Finalize provider configuration checks",
      "Harden webhook verification",
      "Connect payment state to order status",
    ],
    output: "Payment production control, settlement queue, provider config guard and manual webhook proof were completed.",
  },
  {
    date: "26 May 2026",
    focus: "Customer web checkout",
    status: "done",
    planned: [
      "Improve cart and checkout steps",
      "Apply coupons cleanly",
      "Show pickup and delivery options",
    ],
    output: "Customer checkout progress, coupon handoff, delivery quote guard and browser proof were completed.",
  },
  {
    date: "27 May 2026",
    focus: "Delivery charges and zones",
    status: "done",
    planned: [
      "Add zone-based delivery charges",
      "Add minimum order rules",
      "Surface delivery promise time",
    ],
    output: "Delivery economics command, minimum-order gap messaging and customer/admin proof were completed.",
  },
  {
    date: "28 May 2026",
    focus: "Address validation and delivery assignment",
    status: "done",
    planned: [
      "Validate customer address fields",
      "Assign delivery work from admin",
      "Show delivery queue status",
    ],
    output: "Delivery queue intelligence, address review, next action and assignment readiness were completed.",
  },
  {
    date: "29 May 2026",
    focus: "Product customization depth",
    status: "done",
    planned: [
      "Size and topping pricing rules",
      "Add-ons and combo pricing",
      "Kitchen-safe order line display",
    ],
    output: "Customization command board, server-priced options, grouped cart labels and kitchen/receipt option lines were completed.",
  },
  {
    date: "30 May 2026",
    focus: "Order flow polish",
    status: "done",
    planned: [
      "Clean order status transitions",
      "Polish receipts",
      "Improve staff order ergonomics",
    ],
    output: "Order-flow watch, receipt handoff, ready-to-close visibility and status trails were completed.",
  },
  {
    date: "31 May 2026",
    focus: "Weekly stabilization",
    status: "done",
    planned: [
      "Run browser proof suite",
      "Fix UI overflow or broken flows",
      "Update roadmap status",
    ],
    output: "QA command board, route audit matrix, broader browser suite and visual stability checks were completed.",
  },
  {
    date: "1 Jun 2026",
    focus: "Authentication and role hardening",
    status: "done",
    planned: [
      "Review admin, staff and customer route gates",
      "Add missing role-specific states",
      "Plan account recovery and audit needs",
    ],
    output: "Admin-only security overview, role gate command board, recovery controls, audit controls and browser/API proof were completed.",
  },
  {
    date: "2 Jun 2026",
    focus: "Customer account lifecycle",
    status: "done",
    planned: [
      "Customer profile polish",
      "Order history visibility",
      "Contact and consent management",
    ],
    output: "Customer profile editing, contact preferences, consent ledger, order history visibility and browser proof were completed.",
  },
  {
    date: "3 Jun 2026",
    focus: "Payment, Ops and Growth proof audit",
    status: "done",
    planned: [
      "Fix payment production settlement proof",
      "Run restaurant-ready and growth production audits",
      "Refresh roadmap status from live readiness",
    ],
    output: "Payment production, direct-bank proof, webhook duplicate handling, Ops readiness, daily close, proof-order cleanup, readiness summary, campaign sending, social posting and ad proofs were verified on production.",
  },
  {
    date: "4 Jun 2026",
    focus: "Social publishing readiness",
    status: "planned",
    planned: [
      "Live token setup visibility",
      "Schedule and retry posting",
      "Delivery audit improvements",
    ],
    output: "Planned next: keep the social board current and wire real Facebook/Instagram credentials when business accounts are ready.",
  },
  {
    date: "5 Jun 2026",
    focus: "Ad provider sync",
    status: "planned",
    planned: [
      "Provider launch controls",
      "External campaign id handling",
      "Pause/resume guardrails",
    ],
    output: "Planned next: connect real Meta Ads credentials, run paused sync proof, and compare provider state against the portal.",
  },
  {
    date: "6 Jun 2026",
    focus: "Reporting comparison depth",
    status: "planned",
    planned: [
      "Same day last week",
      "Same month last year",
      "Channel and product comparisons",
    ],
    output: "Planned next: load/clean more real sales and expense data, then recheck owner comparison dashboards with live numbers.",
  },
  {
    date: "7 Jun 2026",
    focus: "Weekly beta review",
    status: "planned",
    planned: [
      "Run E2E proofs",
      "Review remaining blockers",
      "Refresh roadmap page status",
    ],
    output: "Planned next: rerun the proof suite, review the two remaining warnings, and update the release decision.",
  },
  {
    date: "8 Jun 2026",
    focus: "Production database path",
    status: "planned",
    planned: [
      "Define production DB choice",
      "Confirm migration steps",
      "Add backup verification",
    ],
    output: "Planned next: record real Supabase backup or pg_dump proof and document the clean restore target.",
  },
  {
    date: "9 Jun 2026",
    focus: "Environment and secrets security",
    status: "planned",
    planned: [
      "List required env vars",
      "Mask sensitive settings",
      "Add missing setup checks",
    ],
    output: "Planned next: confirm production-only secrets, session rotation, CORS, and provider credential masking.",
  },
  {
    date: "10 Jun 2026",
    focus: "Deployment pipeline",
    status: "planned",
    planned: [
      "Build verification",
      "Deployment checklist",
      "Rollback and log inspection steps",
    ],
    output: "Planned next: rerun build, deployment, rollback/log inspection, and live smoke after the next production change.",
  },
  {
    date: "11 Jun 2026",
    focus: "Full customer order E2E",
    status: "planned",
    planned: [
      "Browse product catalog",
      "Customize item",
      "Checkout and receipt",
    ],
    output: "Planned next: run one fresh public pickup and delivery order proof with live menu/pricing.",
  },
  {
    date: "12 Jun 2026",
    focus: "Counter order E2E",
    status: "planned",
    planned: [
      "Staff creates order",
      "Bill/receipt generated",
      "Kitchen and payment state update",
    ],
    output: "Planned next: run one real counter-practice bill through Quick Counter, KOT, receipt and close.",
  },
  {
    date: "13 Jun 2026",
    focus: "Delivery order E2E",
    status: "planned",
    planned: [
      "Delivery charge applied",
      "Assignment and status update",
      "Customer tracking proof",
    ],
    output: "Planned next: confirm real delivery addresses, delivery charges, staff assignment and tracking handoff.",
  },
  {
    date: "14 Jun 2026",
    focus: "Visual polish review",
    status: "planned",
    planned: [
      "Mobile and desktop screenshots",
      "Text overflow cleanup",
      "Navigation and empty-state polish",
    ],
    output: "Planned next: rerun mobile/desktop visual proof and fix any text overflow or route polish gaps.",
  },
  {
    date: "15 Jun 2026",
    focus: "Operational dashboards",
    status: "planned",
    planned: [
      "Today command board",
      "Kitchen and delivery state",
      "Owner alerts",
    ],
    output: "Planned next: review owner dashboard, kitchen state, delivery state and alerts with fresh real orders.",
  },
  {
    date: "16 Jun 2026",
    focus: "Marketing live-readiness review",
    status: "planned",
    planned: [
      "Campaign sender checklist",
      "Social posting checklist",
      "Ad launch checklist",
    ],
    output: "Planned next: run an owner-approved campaign dry run and, if credentials are ready, one live low-risk send.",
  },
  {
    date: "17 Jun 2026",
    focus: "Data quality and import/export",
    status: "planned",
    planned: [
      "Customer import/export checks",
      "Report exports",
      "Backup/restore proof",
    ],
    output: "Planned next: export customer/report data, reconcile imports, and attach backup/restore evidence.",
  },
  {
    date: "18 Jun 2026",
    focus: "Launch candidate hardening",
    status: "planned",
    planned: [
      "Fix E2E failures",
      "Review production blockers",
      "Stabilize critical routes",
    ],
    output: "Planned next: fix any failed E2E, review blockers, and freeze the launch candidate.",
  },
  {
    date: "19 Jun 2026",
    focus: "Final acceptance walkthrough",
    status: "planned",
    planned: [
      "Admin walkthrough",
      "Staff walkthrough",
      "Customer order walkthrough",
    ],
    output: "Planned next: run admin, staff/POS and customer walkthroughs with the owner.",
  },
  {
    date: "20 Jun 2026",
    focus: "Beta delivery checkpoint",
    status: "planned",
    planned: [
      "Run final build",
      "Run smoke and core E2E proofs",
      "Document remaining production integrations",
    ],
    output: "Planned next: final build, smoke/core proof queue, known-gap review and beta decision.",
  },
  {
    date: "20 Jun 2026",
    focus: "Production launch integrations",
    status: "planned",
    planned: [
      "Group live credential readiness",
      "Group database, backup and secrets lanes",
      "Expose production smoke execution",
    ],
    output: "Planned next: confirm live credentials, managed database backup/restore, deployment secrets and production smoke evidence.",
  },
  {
    date: "20 Jun 2026",
    focus: "Live environment execution",
    status: "planned",
    planned: [
      "Credential cutover phases",
      "Cutover window and rollback plan",
      "Go/no-go evidence",
    ],
    output: "Planned next: execute credential cutover, DB restore proof, secret sync, public-host smoke and go/no-go signoff.",
  },
  {
    date: "20 Jun 2026",
    focus: "Credential activation",
    status: "planned",
    planned: [
      "Gateway and webhook activation",
      "Messaging/social/ad provider readiness",
      "Provider smoke go/no-go",
    ],
    output: "Planned next: activate gateway, webhook, campaign send, social publish and ad sync credentials when real accounts are ready.",
  },
];

const stabilizationMetrics: StabilizationMetric[] = [
  {
    label: "Critical Proofs",
    value: "30",
    note: "Checkout, customer E2E, counter E2E, delivery E2E, typecheck gate, dashboard polish, operational command board, launch candidate, final acceptance, beta delivery, production launch, live environment, credential activation, order flow, customization, delivery, payment, messaging, social, ad sync, marketing live-readiness, data quality export, reporting, beta review, DB path, secrets, deploy, production ops, visual audit and roadmap.",
  },
  {
    label: "Route / View Audit",
    value: "29 x 2",
    note: "Public, admin and roadmap routes checked on desktop and mobile viewports.",
  },
  {
    label: "Stability State",
    value: "Green",
    note: "Typecheck, build, live smoke, credential activation, live environment execution, production launch integrations, beta delivery, final acceptance, launch candidate hardening and operational command board are now proof-backed.",
  },
  {
    label: "Next Risk",
    value: "Live Provider Smoke",
    note: "The next track is executing real low-value payment, signed webhook, owner-approved campaign sends, social publish and paused ad sync on the live host.",
  },
];

const stabilizationProofs: StabilizationProof[] = [
  {
    area: "Customer checkout",
    proof: "verify-customer-web-checkout.cjs",
    status: "passed",
    value: "Catalog, cart, coupons, pickup/delivery checks and receipt handoff stay testable.",
    artifact: "visible-customer-web-checkout.png",
  },
  {
    area: "Full customer order E2E",
    proof: "verify-full-customer-order-e2e.cjs",
    status: "passed",
    value: "Catalog, customization, delivery checkout, receipt route, tracking route and backend handoff stay connected.",
    artifact: "visible-full-customer-order-e2e.png",
  },
  {
    area: "Counter order E2E",
    proof: "verify-counter-order-e2e.cjs",
    status: "passed",
    value: "Staff POS creation, bill route, kitchen status, close action and paid payment state stay connected.",
    artifact: "visible-counter-order-e2e.png",
  },
  {
    area: "Delivery order E2E",
    proof: "verify-delivery-order-e2e.cjs",
    status: "passed",
    value: "Delivery charge, rider assignment, dispatch, delivered close and customer tracking stay connected.",
    artifact: "visible-delivery-order-e2e.png",
  },
  {
    area: "Order flow polish",
    proof: "verify-order-flow-polish.cjs",
    status: "passed",
    value: "Receipt readiness, close-ready orders, blockers and status trail remain visible.",
    artifact: "visible-order-flow-polish.png",
  },
  {
    area: "Product customization",
    proof: "verify-product-customization.cjs",
    status: "passed",
    value: "Sizes, toppings, add-ons, combo pricing and kitchen-safe option lines remain connected.",
    artifact: "visible-product-customization.png",
  },
  {
    area: "Delivery assignment",
    proof: "verify-delivery-assignment-readiness.cjs",
    status: "passed",
    value: "Address score, delivery queue, rider assignment and payment blocks remain operationally clear.",
    artifact: "visible-delivery-assignment-readiness.png",
  },
  {
    area: "Payment readiness",
    proof: "verify-payment-production-pass.cjs",
    status: "watch",
    value: "Provider setup, webhook proof and settlement visibility are ready for real credentials.",
    artifact: "visible-payment-production-pass.png",
  },
  {
    area: "Frontend typecheck gate",
    proof: "npm run typecheck",
    status: "passed",
    value: "Invoices, promotions and public checkout now pass the full TypeScript gate before release.",
    artifact: "typecheck terminal proof",
  },
  {
    area: "Messaging readiness",
    proof: "verify-messaging-readiness.cjs",
    status: "passed",
    value: "WhatsApp, SMS and email provider setup, template compliance and safe test-send receipts are visible.",
    artifact: "visible-messaging-readiness.png",
  },
  {
    area: "Social readiness",
    proof: "verify-social-publishing-readiness.cjs",
    status: "passed",
    value: "Meta token readiness, schedule blockers, retry dry-run controls and delivery recovery actions are visible.",
    artifact: "visible-social-publishing-readiness.png",
  },
  {
    area: "Ad provider sync",
    proof: "verify-ad-provider-sync.cjs",
    status: "passed",
    value: "Meta credentials, external campaign IDs, dry-run/apply sync and pause/resume guardrails are visible.",
    artifact: "visible-ad-provider-sync.png",
  },
  {
    area: "Marketing live-readiness",
    proof: "verify-marketing-live-readiness-command.cjs",
    status: "passed",
    value: "Campaign sender, social posting and Meta ads readiness are visible in one promotions command board.",
    artifact: "visible-marketing-live-readiness-command.png",
  },
  {
    area: "Reporting comparison",
    proof: "verify-reporting-comparison-dashboard.cjs",
    status: "passed",
    value: "Same weekday, same month last year, product movers, category movers and channel decisions are visible.",
    artifact: "visible-reporting-comparison-dashboard.png",
  },
  {
    area: "Weekly beta review",
    proof: "verify-weekly-beta-review.cjs",
    status: "passed",
    value: "Proof audit, blocker list, beta decision and production database handoff are visible.",
    artifact: "visible-weekly-beta-review.png",
  },
  {
    area: "Production database path",
    proof: "verify-production-database-path.cjs",
    status: "passed",
    value: "Managed DB target, migration checklist, backup/restore drill and blockers are visible.",
    artifact: "visible-production-database-path.png",
  },
  {
    area: "Environment secrets security",
    proof: "verify-environment-secrets-security.cjs",
    status: "passed",
    value: "Required env coverage, masked secrets, rotation drill and security blockers are visible.",
    artifact: "visible-environment-secrets-security.png",
  },
  {
    area: "Deployment pipeline",
    proof: "verify-deployment-pipeline.cjs",
    status: "passed",
    value: "Build gate, release steps, rollback/log inspection and production smoke path are visible.",
    artifact: "visible-deployment-pipeline.png",
  },
  {
    area: "Production operations",
    proof: "verify-production-ops-readiness.cjs",
    status: "passed",
    value: "Production blockers, deployment checklist and environment readiness stay visible.",
    artifact: "visible-production-ops-readiness.png",
  },
  {
    area: "Daily close command",
    proof: "verify-daily-close-command.cjs",
    status: "passed",
    value: "Cash drawer close, zero open-order blockers and daily close proof now pass on production.",
    artifact: "visible-daily-close-command.png",
  },
  {
    area: "Proof order hygiene",
    proof: "cleanup-open-proof-orders.cjs",
    status: "passed",
    value: "Production E2E orders are cancelled through the normal API after proof so they do not block daily close.",
    artifact: "terminal proof: active_order_count_after 0",
  },
  {
    area: "Data quality export command",
    proof: "verify-data-quality-export-command.cjs",
    status: "passed",
    value: "Customer CSV export, sales export, import readiness and backup/restore proof stay visible in Production Ops.",
    artifact: "visible-data-quality-export-command.png",
  },
  {
    area: "Launch candidate hardening",
    proof: "verify-launch-candidate-hardening.cjs",
    status: "passed",
    value: "Critical routes, E2E proof ownership, blocker review and release decision stay visible in Production Ops.",
    artifact: "visible-launch-candidate-hardening-command.png",
  },
  {
    area: "Final acceptance walkthrough",
    proof: "verify-final-acceptance-walkthrough.cjs",
    status: "passed",
    value: "Admin, staff/POS and customer walkthrough lanes plus acceptance gates stay visible in Production Ops.",
    artifact: "visible-final-acceptance-walkthrough-command.png",
  },
  {
    area: "Beta delivery checkpoint",
    proof: "verify-beta-delivery-checkpoint.cjs",
    status: "passed",
    value: "Final build, smoke/core proof queue, known gaps and next production plan stay visible in Production Ops.",
    artifact: "visible-beta-delivery-checkpoint-command.png",
  },
  {
    area: "Production launch integrations",
    proof: "verify-production-launch-integrations.cjs",
    status: "passed",
    value: "Live credentials, managed database, backup/restore, deployment secrets, blockers and production smoke stay visible in Production Ops.",
    artifact: "visible-production-launch-integrations-command.png",
  },
  {
    area: "Live environment execution",
    proof: "verify-live-environment-execution.cjs",
    status: "passed",
    value: "Credential cutover, DB migration, secret sync, restore rehearsal, public-host smoke and go/no-go evidence stay visible in Production Ops.",
    artifact: "visible-live-environment-execution-command.png",
  },
  {
    area: "Credential activation",
    proof: "verify-credential-activation-command.cjs",
    status: "passed",
    value: "Gateway, webhook, campaign, social and ad provider activation readiness plus smoke go/no-go stay visible in Production Ops.",
    artifact: "visible-credential-activation-command.png",
  },
  {
    area: "Visual polish suite",
    proof: "verify-visual-polish-suite.cjs",
    status: "passed",
    value: "Public, admin and roadmap pages are audited for blank screens, overflow and browser errors.",
    artifact: "visible-visual-audit-desktop.png",
  },
  {
    area: "Dashboard visual polish",
    proof: "verify-dashboard-visual-polish.cjs",
    status: "passed",
    value: "Mobile active navigation, two-column dashboard cards, desktop shell behavior and visual screenshots stay proof-backed.",
    artifact: "visible-dashboard-visual-polish-mobile.png",
  },
  {
    area: "Operational dashboard command",
    proof: "verify-operational-dashboard-command.cjs",
    status: "passed",
    value: "Today's orders, kitchen state, delivery handoff and owner alerts stay connected to live order-flow data.",
    artifact: "visible-operational-dashboard-command-board.png",
  },
  {
    area: "Roadmap command board",
    proof: "verify-roadmap-command-board.cjs",
    status: "passed",
    value: "The day tracker, current next step and stabilization command board remain visible.",
    artifact: "visible-roadmap-command-board.png",
  },
];

const betaReviewMetrics: StabilizationMetric[] = [
  {
    label: "Proof Audit",
    value: "32 / 32",
    note: "Critical browser, API, typecheck and production proof-order hygiene checks now have named artifacts on the roadmap.",
  },
  {
    label: "Known Blockers",
    value: "5",
    note: "Live credentials, production DB, backups, deployment secrets and live delivery tracking remain production blockers.",
  },
  {
    label: "Beta Decision",
    value: "Controlled",
    note: "The portal is fit for internal demo and controlled beta, not open public launch.",
  },
  {
    label: "Next Handoff",
    value: "Live Provider Smoke",
    note: "The next work slice should run real low-value payment, signed webhook, campaign send, social publish and paused ad sync smoke against the live host.",
  },
];

const betaReviewOutcomes: RoadmapItem[] = [
  {
    title: "Proof audit completed",
    status: "done",
    value: "Build, roadmap, reporting, weekly stabilization, and visual route proofs are green after the latest reporting and provider-sync work.",
  },
  {
    title: "Remaining blocker list refreshed",
    status: "done",
    value: "Real payment credentials, provider tokens, delivery live tracking, production DB, backups and deployment secrets are now called out as production blockers.",
  },
  {
    title: "Controlled beta decision",
    status: "done",
    value: "The system is suitable for internal operations demo and controlled staff/customer walkthroughs while live integrations remain guarded.",
  },
  {
    title: "Production database handoff",
    status: "done",
    value: "Production Ops now exposes the managed DB choice, migration path, backup verification and restore drill before deployment work.",
  },
  {
    title: "Environment secrets handoff",
    status: "done",
    value: "Production Ops now exposes required env coverage, masked sensitive values, session/auth secrets and rotation recovery work.",
  },
  {
    title: "Deployment pipeline handoff",
    status: "done",
    value: "Production Ops now exposes build gate, release steps, rollback/log inspection and production smoke readiness.",
  },
  {
    title: "Customer order E2E handoff",
    status: "done",
    value: "Customer catalog, customization, checkout, receipt, tracking and backend handoff are now proved from the browser.",
  },
  {
    title: "Counter order E2E handoff",
    status: "done",
    value: "Staff order creation, bill/receipt, kitchen handoff and payment state are now proved from the counter workflow.",
  },
  {
    title: "Delivery order E2E handoff",
    status: "done",
    value: "Delivery charge, rider assignment, status update and customer tracking are now proved from order to delivery.",
  },
  {
    title: "Visual polish handoff",
    status: "done",
    value: "Mobile and desktop screenshots, active mobile navigation, dashboard density and empty states are now proof-backed.",
  },
  {
    title: "Operational dashboards handoff",
    status: "done",
    value: "Today command board, kitchen state, delivery handoff and owner alerts are now visible from live order-flow data.",
  },
  {
    title: "Marketing live-readiness handoff",
    status: "done",
    value: "Campaign sender checklist, social posting checklist and ad launch checklist are now visible together from the promotions command board.",
  },
  {
    title: "Data quality handoff",
    status: "done",
    value: "Customer CSV export, report exports, import readiness and backup/restore proof are now visible in Production Ops.",
  },
  {
    title: "Launch candidate hardening handoff",
    status: "done",
    value: "Critical route stability, E2E proof ownership, blocker review and release decision are now visible in Production Ops.",
  },
  {
    title: "Final acceptance walkthrough handoff",
    status: "done",
    value: "Admin, staff/POS and customer walkthrough lanes plus beta checkpoint gates are now visible in Production Ops.",
  },
  {
    title: "Beta delivery checkpoint handoff",
    status: "done",
    value: "Final build, smoke/core proof queue, known-gap documentation and production next steps are now visible in Production Ops.",
  },
  {
    title: "Post-beta production integrations handoff",
    status: "done",
    value: "Production Ops now groups live credentials, managed database, backups, deployment secrets and production smoke in one command board.",
  },
  {
    title: "Live environment execution handoff",
    status: "done",
    value: "Production Ops now shows the real provider, managed database, backup restore, deployment secret and public-host smoke execution sequence.",
  },
  {
    title: "Credential activation handoff",
    status: "done",
    value: "Production Ops now shows real provider credential readiness and payment/webhook, campaign, social and ad smoke checks.",
  },
  {
    title: "Frontend typecheck handoff",
    status: "done",
    value: "Package scripts now expose typecheck, live smoke and quality verification so each future release can run the same gate.",
  },
  {
    title: "Live provider smoke handoff",
    status: "active",
    value: "Next slice should execute real low-value checkout, signed webhook, test campaign sends, social publish and paused ad sync on the live host.",
  },
];

const betaBlockers: RoadmapItem[] = [
  {
    title: "Live payment and bank settlement",
    status: "planned",
    value: "Add real gateway credentials, run low-value payment proof and reconcile settlement reports.",
  },
  {
    title: "Live provider sending",
    status: "planned",
    value: "Switch WhatsApp, SMS, email, social and ad flows from safe dry-run/readiness into token-backed live sending.",
  },
  {
    title: "Production database and backups",
    status: "active",
    value: "Path and logical export proof are defined; managed credentials, scheduled snapshots and restore rehearsal still need production proof.",
  },
  {
    title: "Deployment and secret security",
    status: "active",
    value: "Pipeline is mapped; live host credentials, real deploy, log access, monitoring and restore proof remain production blockers.",
  },
  {
    title: "Customer-facing delivery tracking",
    status: "planned",
    value: "Expose rider state, delivery exceptions and clearer customer tracking for live delivery orders.",
  },
];

function statusLabel(status: Status) {
  if (status === "done") return "Done";
  if (status === "active") return "In Progress";
  if (status === "blocked") return "Blocked";
  return "Planned";
}

function statusClass(status: Status) {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "active") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function statusIcon(status: Status) {
  if (status === "done") return CheckCircle2;
  if (status === "active") return CircleDot;
  if (status === "blocked") return Flag;
  return Clock3;
}

function proofStatusLabel(status: ProofStatus) {
  if (status === "passed") return "Passed";
  return "Watch";
}

function proofStatusClass(status: ProofStatus) {
  if (status === "passed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function RoadmapPage() {
  const doneDays = june20Push.filter((day) => day.status === "done").length;
  const activeDays = june20Push.filter((day) => day.status === "active").length;
  const plannedDays = june20Push.filter((day) => day.status === "planned").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-orange-600">Pizza Blitz Build Plan</p>
          <h1 className="mt-1 text-3xl font-black text-slate-950">Roadmap Command Board</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Status of what we built from the May 23 plan, what remains, and the daily push toward the
            20 June 2026 beta checkpoint.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <MiniCounter label="Done" value={doneDays} />
          <MiniCounter label="Active" value={activeDays} />
          <MiniCounter label="Planned" value={plannedDays} />
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {progressCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">{card.label}</p>
            <p className="mt-3 text-3xl font-black text-slate-950">{card.value}</p>
            <p className="mt-2 text-sm leading-5 text-slate-500">{card.note}</p>
          </div>
        ))}
      </section>

      <section data-testid="twelve-gap-delivery-program" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-orange-600" />
              <h2 className="text-xl font-black text-slate-950">12 Gap Delivery Program</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              The remaining work is now grouped into four larger delivery phases. Each phase should ship as a coherent
              business slice with build, deploy and browser evidence.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black uppercase text-orange-700">
            <Target className="h-3.5 w-3.5" />
            Batch Execution
          </span>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-4">
          {deliveryPhases.map((phase) => {
            const Icon = statusIcon(phase.status);
            return (
              <article key={phase.phase} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-orange-600">{phase.phase}</p>
                    <h3 className="mt-1 text-lg font-black text-slate-950">{phase.title}</h3>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-black uppercase ${statusClass(phase.status)}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {statusLabel(phase.status)}
                  </span>
                </div>
                <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-400">{phase.target}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{phase.goal}</p>
                <div className="mt-4 space-y-2">
                  {phase.shipTogether.map((item) => (
                    <p key={item} className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold leading-5 text-slate-700">
                      {item}
                    </p>
                  ))}
                </div>
                <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">
                  <span className="font-black uppercase">Proof: </span>
                  {phase.proof}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-orange-600" />
              <h2 className="text-xl font-black text-slate-950">Weekly Stabilization Command</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              This is the proof tracker for the May 31 stabilization slice: what has been checked, where the
              evidence lives, and which risk becomes active next.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Week Stabilized
          </span>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {stabilizationMetrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">{metric.label}</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{metric.value}</p>
              <p className="mt-2 text-sm leading-5 text-slate-500">{metric.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-black">Area</th>
                <th className="px-4 py-3 font-black">Proof Command</th>
                <th className="px-4 py-3 font-black">Status</th>
                <th className="px-4 py-3 font-black">Business Value</th>
                <th className="px-4 py-3 font-black">Artifact</th>
              </tr>
            </thead>
            <tbody>
              {stabilizationProofs.map((proof) => (
                <tr key={proof.proof} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-4 font-black text-slate-950">{proof.area}</td>
                  <td className="px-4 py-4 font-mono text-xs font-bold text-slate-700">{proof.proof}</td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black uppercase ${proofStatusClass(proof.status)}`}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {proofStatusLabel(proof.status)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{proof.value}</td>
                  <td className="px-4 py-4 font-mono text-xs font-bold text-slate-500">{proof.artifact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section data-testid="weekly-beta-review-command" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-orange-600" />
              <h2 className="text-xl font-black text-slate-950">Weekly Beta Review Command</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Proof audit, remaining blockers, beta decision and production database handoff.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black uppercase text-orange-700">
            <Target className="h-3.5 w-3.5" />
            Controlled Beta
          </span>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {betaReviewMetrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">{metric.label}</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{metric.value}</p>
              <p className="mt-2 text-sm leading-5 text-slate-500">{metric.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div>
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-md bg-emerald-50 p-2 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-950">Review Outcomes</h3>
                <p className="mt-1 text-sm text-slate-500">What we can confidently say after the proof pass.</p>
              </div>
            </div>
            <div className="space-y-3">
              {betaReviewOutcomes.map((item) => (
                <RoadmapRow key={item.title} item={item} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-4 flex items-start gap-3">
              <div className="rounded-md bg-orange-50 p-2 text-orange-600">
                <Flag className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-950">Remaining Beta Blockers</h3>
                <p className="mt-1 text-sm text-slate-500">What still prevents a fully open production launch.</p>
              </div>
            </div>
            <div className="space-y-3">
              {betaBlockers.map((item) => (
                <RoadmapRow key={item.title} item={item} />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <h3 className="font-black text-emerald-950">Beta Decision</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-emerald-800">
              Controlled internal beta: the portal is ready for owner/staff walkthroughs and guarded customer demos.
            </p>
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-orange-700" />
              <h3 className="font-black text-orange-950">Production Database Path</h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-orange-800">
              Define DB choice, migration checklist, backup verification and restore drill.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <StatusList
          icon={CheckCircle2}
          title="Value Already Built"
          subtitle="Working modules and proof-backed value from the plan so far."
          items={completedValue}
        />
        <StatusList
          icon={Target}
          title="Remaining Production Work"
          subtitle="The work that decides whether this becomes production mature."
          items={immediateRemaining}
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-orange-600" />
              <h2 className="text-xl font-black text-slate-950">30 / 60 / 90 Day Direction</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Broad phases after 24 May 2026, with the 20 June checkpoint inside the first 30-day push.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {timeline.map((phase) => (
            <div key={phase.title} className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-orange-600">{phase.dateRange}</p>
              <h3 className="mt-2 text-lg font-black text-slate-950">{phase.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{phase.goal}</p>
              <div className="mt-4 space-y-3">
                {phase.items.map((item) => (
                  <RoadmapRow key={item.title} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-orange-600" />
              <h2 className="text-xl font-black text-slate-950">Daily Execution Plan To 20 June</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              This is the working day-by-day track. As we complete each day, this page should be updated with output.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase">
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">Done</span>
            <span className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-orange-700">In Progress</span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">Planned</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-black">Date</th>
                <th className="px-4 py-3 font-black">Focus</th>
                <th className="px-4 py-3 font-black">Status</th>
                <th className="px-4 py-3 font-black">Plan For The Day</th>
                <th className="px-4 py-3 font-black">Expected / Actual Output</th>
              </tr>
            </thead>
            <tbody>
              {june20Push.map((day, index) => {
                const Icon = statusIcon(day.status);
                return (
                  <tr key={`${day.date}-${day.focus}-${index}`} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-4 py-4 font-bold text-slate-800">{day.date}</td>
                    <td className="px-4 py-4">
                      <p className="font-black text-slate-950">{day.focus}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black uppercase ${statusClass(day.status)}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {statusLabel(day.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1.5 text-slate-600">
                        {day.planned.map((item) => (
                          <p key={item}>{item}</p>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{day.output}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BottomPanel
          icon={ShieldCheck}
          title="June 20 Success Definition"
          text="A demo-ready beta where admin, staff and customer paths are testable, marketing is operationally visible, and remaining production integrations are clearly documented."
        />
        <BottomPanel
          icon={BarChart3}
          title="Daily Update Rule"
          text="Every development slice should update this page with done work, proof links or screenshots, and the next planned day."
        />
        <BottomPanel
          icon={ListChecks}
          title="Current Next Step"
          text="Live provider smoke: execute real low-value checkout, signed webhook, test campaign sends, social publish and paused ad sync on the live host."
        />
      </section>
    </div>
  );
}

function MiniCounter({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded-md bg-slate-50 px-4 py-3 text-center">
      <p className="text-2xl font-black text-slate-950">{value}</p>
      <p className="text-xs font-black uppercase text-slate-400">{label}</p>
    </div>
  );
}

function StatusList({
  icon: Icon,
  title,
  subtitle,
  items,
}: {
  icon: typeof CheckCircle2;
  title: string;
  subtitle: string;
  items: RoadmapItem[];
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md bg-orange-50 p-2 text-orange-600">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <RoadmapRow key={item.title} item={item} />
        ))}
      </div>
    </section>
  );
}

function RoadmapRow({ item }: { item: RoadmapItem }) {
  const Icon = statusIcon(item.status);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="font-black text-slate-950">{item.title}</h3>
        <span className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1 text-xs font-black uppercase ${statusClass(item.status)}`}>
          <Icon className="h-3.5 w-3.5" />
          {statusLabel(item.status)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{item.value}</p>
    </div>
  );
}

function BottomPanel({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5 text-orange-600" />
        <h3 className="font-black text-slate-950">{title}</h3>
      </div>
      <p className="text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}
