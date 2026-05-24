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

const progressCards = [
  {
    label: "Overall Product",
    value: "92%",
    note: "Internal beta with provider sync, owner reporting, beta review and DB path command now visible",
  },
  {
    label: "Marketing Engine",
    value: "92%",
    note: "Campaigns, consent, queues, ROI, messaging, social readiness, ads and provider sync are largely working",
  },
  {
    label: "Production Readiness",
    value: "78%",
    note: "Provider readiness, comparison proofs, DB migration path and backup/restore drill are now tracked",
  },
  {
    label: "Target Date",
    value: "20 Jun",
    note: "28-day push from 24 May 2026",
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
];

const immediateRemaining: RoadmapItem[] = [
  {
    title: "Live gateway credentials and bank settlement activation",
    status: "planned",
    value: "Add real Cashfree or Razorpay credentials, run live low-value checkout and compare provider payout reports.",
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
    status: "planned",
    value: "Provision managed DB credentials, secure secrets, verify restore, deploy, monitor and rehearse rollback.",
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
        value: "Database path is defined; credentials, restore proof, environment secrets, deployment checks and monitoring remain.",
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
    focus: "Real WhatsApp/SMS/email readiness",
    status: "done",
    planned: [
      "Provider setup panels",
      "Template compliance states",
      "Safe test-send workflow",
    ],
    output: "Provider readiness, template compliance, dry-run-only safe test sends and masked receipts were completed.",
  },
  {
    date: "4 Jun 2026",
    focus: "Social publishing readiness",
    status: "done",
    planned: [
      "Live token setup visibility",
      "Schedule and retry posting",
      "Delivery audit improvements",
    ],
    output: "Social token readiness, schedule blockers, retry dry-run controls and delivery audit proof were completed.",
  },
  {
    date: "5 Jun 2026",
    focus: "Ad provider sync",
    status: "done",
    planned: [
      "Provider launch controls",
      "External campaign id handling",
      "Pause/resume guardrails",
    ],
    output: "Ad provider sync command, external ID dry-run/apply, pause/resume guardrails and browser/API proof were completed.",
  },
  {
    date: "6 Jun 2026",
    focus: "Reporting comparison depth",
    status: "done",
    planned: [
      "Same day last week",
      "Same month last year",
      "Channel and product comparisons",
    ],
    output: "Owner comparison command, same-day/month baselines, product/category movers and browser/API proof were completed.",
  },
  {
    date: "7 Jun 2026",
    focus: "Weekly beta review",
    status: "done",
    planned: [
      "Run E2E proofs",
      "Review remaining blockers",
      "Refresh roadmap page status",
    ],
    output: "Proof audit, remaining blocker list, beta review command and production database handoff were completed.",
  },
  {
    date: "8 Jun 2026",
    focus: "Production database path",
    status: "done",
    planned: [
      "Define production DB choice",
      "Confirm migration steps",
      "Add backup verification",
    ],
    output: "Managed PostgreSQL target, migration checklist, backup/restore drill, blockers and browser/API proof were completed.",
  },
  {
    date: "9 Jun 2026",
    focus: "Environment and secrets security",
    status: "active",
    planned: [
      "List required env vars",
      "Mask sensitive settings",
      "Add missing setup checks",
    ],
    output: "Production setup becomes safer and easier to validate.",
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
    output: "Release process becomes repeatable.",
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
    output: "Customer web order flow is proved in the browser.",
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
    output: "In-store staff order workflow is proved end to end.",
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
    output: "Delivery order workflow is demo-ready.",
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
    output: "Portal becomes more professional and presentable.",
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
    output: "Daily operator visibility improves.",
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
    output: "Marketing features are ready for credential-based testing.",
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
    output: "Business data can be moved and audited more safely.",
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
    output: "Release candidate becomes stable enough for final review.",
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
    output: "Final gaps are visible before the June 20 target.",
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
    output: "Beta milestone delivered with clear known gaps and next production plan.",
  },
];

const stabilizationMetrics: StabilizationMetric[] = [
  {
    label: "Critical Proofs",
    value: "14",
    note: "Checkout, order flow, customization, delivery, payment, messaging, social, ad sync, reporting, beta review, DB path, production ops, visual audit and roadmap.",
  },
  {
    label: "Route / View Audit",
    value: "29 x 2",
    note: "Public, admin and roadmap routes checked on desktop and mobile viewports.",
  },
  {
    label: "Stability State",
    value: "Green",
    note: "Production database path is defined and environment/secrets hardening is now active.",
  },
  {
    label: "Next Risk",
    value: "Secrets",
    note: "Credential storage, deployment env vars, session secrets and restore proof are now the active track.",
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
    area: "Production operations",
    proof: "verify-production-ops-readiness.cjs",
    status: "passed",
    value: "Production blockers, deployment checklist and environment readiness stay visible.",
    artifact: "visible-production-ops-readiness.png",
  },
  {
    area: "Visual polish suite",
    proof: "verify-visual-polish-suite.cjs",
    status: "passed",
    value: "Public, admin and roadmap pages are audited for blank screens, overflow and browser errors.",
    artifact: "visible-visual-audit-desktop.png",
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
    value: "14 / 14",
    note: "Critical browser and API proofs now have named artifacts on the roadmap.",
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
    value: "Secrets",
    note: "The next work slice should harden credentials, deployment env vars and restore proof.",
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
    status: "active",
    value: "Next slice should lock credentials, deployment env vars, session secrets and rollback-ready restore proof.",
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
    value: "Path is defined; managed credentials, scheduled snapshots and restore rehearsal still need production proof.",
  },
  {
    title: "Deployment and secret security",
    status: "planned",
    value: "Lock environment variables, session secrets, logging, rollback path and monitoring before open beta.",
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
              {june20Push.map((day) => {
                const Icon = statusIcon(day.status);
                return (
                  <tr key={day.date} className="border-b border-slate-100 align-top">
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
          text="Environment and secrets security: lock production env vars, session secrets, credential storage and restore proof."
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
