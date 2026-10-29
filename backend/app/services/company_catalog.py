"""Company operating model: departments, modules and scoped permission presets.

This module is the single source of truth for the department registry. It is
data-only so it can be imported by the seeder, the migration backfill and tests
without creating a dependency cycle.

Every portal route must appear exactly once as a module. Modules can be shared
with other departments, but one department owns the route and its navigation
group. Dynamic detail routes are present in the catalogue but hidden from
navigation.
"""

from __future__ import annotations

MODULE_KIND_ROUTE = "route"
MODULE_KIND_PLANNED = "planned"


def _module(
    key: str,
    label: str,
    description: str,
    owner: str,
    *,
    route: str | None,
    permission: str,
    icon: str,
    status: str = "active",
    shared_with: tuple[str, ...] = (),
    member_access: bool = False,
    legacy_permission: str | None = None,
    nav_group: str | None = None,
) -> dict:
    return {
        "key": key,
        "label": label,
        "description": description,
        "owner": owner,
        "shared_with": list(shared_with),
        "route_template": route,
        "permission_key": permission,
        "icon": icon,
        "default_status": status,
        "member_access": member_access,
        "legacy_permission": legacy_permission,
        "nav_group": nav_group,
    }


MODULE_CATALOG: list[dict] = [
    # Shared overview card, resolved to /departments/{key} per department.
    _module(
        "overview",
        "Department overview",
        "KPIs, needs-you queue, team and modules for this department.",
        "company",
        route="/departments/{key}",
        permission="shared.directory",
        icon="building",
        nav_group="Shared services",
    ),
    # Executive Office
    _module(
        "dashboard",
        "Company dashboard",
        "Revenue, orders, alerts and today's pulse across the company.",
        "executive",
        route="/dashboard",
        permission="executive.dashboard",
        icon="layout-dashboard",
        legacy_permission="reports.view",
    ),
    _module(
        "ceo",
        "CEO command",
        "Weekly owner summary, company health and priority directives.",
        "executive",
        route="/ceo",
        permission="executive.strategy",
        icon="crown",
    ),
    _module(
        "roadmap",
        "Roadmap & readiness",
        "Launch readiness, proof board and delivery plan.",
        "executive",
        route="/roadmap",
        permission="executive.strategy",
        icon="calendar-days",
        shared_with=("technology",),
    ),
    _module(
        "ai-insights",
        "AI insights",
        "AI-generated operating summary and recommended actions.",
        "executive",
        route="/ai-insights",
        permission="executive.insights",
        icon="sparkles",
    ),
    _module(
        "reports",
        "Reports & BI",
        "Company reports, comparisons, audit log and exports.",
        "executive",
        route="/reports",
        permission="executive.reports",
        icon="bar-chart",
        shared_with=(
            "operations",
            "kitchen",
            "supply",
            "quality",
            "finance",
            "hr",
            "marketing",
            "revenue",
            "technology",
        ),
        legacy_permission="reports.view",
        nav_group="Shared services",
    ),
    _module(
        "budget",
        "Budget & goals",
        "Company goals, capex requests and budget vs actual.",
        "executive",
        route="/departments/executive/budget",
        permission="executive.budget",
        icon="target",
    ),
    # Operations
    _module(
        "counter",
        "Quick counter",
        "One-tap walk-in and takeaway orders.",
        "operations",
        route="/counter",
        permission="operations.counter",
        icon="zap",
        member_access=True,
        legacy_permission="orders.manage",
    ),
    _module(
        "orders",
        "POS orders",
        "Create, pay, close and void orders.",
        "operations",
        route="/orders",
        permission="operations.orders",
        icon="shopping-cart",
        member_access=True,
        legacy_permission="orders.view",
    ),
    _module(
        "operations",
        "Kitchen operations",
        "Station board, dispatch and handoff.",
        "operations",
        route="/operations",
        permission="operations.kitchen",
        icon="flame",
        member_access=True,
        legacy_permission="kitchen.manage",
    ),
    _module(
        "kds",
        "KDS board",
        "Full-screen kitchen display with timers.",
        "operations",
        route="/kds",
        permission="operations.kds",
        icon="monitor-play",
        member_access=True,
        legacy_permission="kitchen.manage",
    ),
    _module(
        "shifts",
        "Shift log",
        "Attendance, handover and payroll preview.",
        "operations",
        route="/shifts",
        permission="operations.shifts",
        icon="activity",
        legacy_permission="reports.view",
    ),
    _module(
        "shifts-schedule",
        "Shift schedule",
        "Weekly roster and labour planning.",
        "operations",
        route="/shifts/schedule",
        permission="operations.shifts",
        icon="calendar-days",
        legacy_permission="reports.view",
    ),
    _module(
        "checklists",
        "Daily checklists",
        "Opening, closing and shift sign-off checklists.",
        "operations",
        route="/departments/operations/checklists",
        permission="operations.checklists",
        icon="clipboard-list",
        member_access=True,
    ),
    # Guest Experience (under Operations)
    _module(
        "support-inbox",
        "Support inbox",
        "Guest tickets, replies and resolution status.",
        "guest-experience",
        route="/support-inbox",
        permission="operations.support",
        icon="headphones",
        member_access=True,
    ),
    _module(
        "messaging",
        "Messaging inbox",
        "Customer conversations, replies and templates.",
        "guest-experience",
        route="/messaging",
        permission="operations.messaging",
        icon="message-circle",
    ),
    _module(
        "feedback",
        "Feedback & NPS",
        "Ratings, NPS and guest comments.",
        "guest-experience",
        route="/feedback",
        permission="operations.feedback",
        icon="message-heart",
        member_access=True,
    ),
    _module(
        "facilities-assets",
        "Assets & maintenance",
        "Asset register, preventive maintenance and breakdown work orders.",
        "facilities",
        route="/departments/facilities/assets",
        permission="operations.facilities",
        icon="wrench",
        member_access=True,
    ),
    # Kitchen & Menu
    _module(
        "menu",
        "Menu intelligence",
        "Items, modifiers, combos and margins.",
        "kitchen",
        route="/menu",
        permission="kitchen.menu",
        icon="utensils",
    ),
    _module(
        "recipes",
        "Recipes & costing",
        "Ingredients, cost and prep forecast.",
        "kitchen",
        route="/recipes",
        permission="kitchen.recipes",
        icon="clipboard-list",
    ),
    _module(
        "waste",
        "Waste log",
        "Record and analyse kitchen waste.",
        "kitchen",
        route="/waste",
        permission="kitchen.waste",
        icon="trash",
        member_access=True,
    ),
    _module(
        "menu-engineering",
        "Menu engineering",
        "Star, plough-horse, puzzle and dog analysis with action list.",
        "kitchen",
        route="/departments/kitchen/engineering",
        permission="kitchen.engineering",
        icon="chart-no-axes-column",
    ),
    # Supply Chain & Inventory
    _module(
        "inventory",
        "Inventory",
        "Stock, movements and low-stock queue.",
        "supply",
        route="/inventory",
        permission="supply.inventory",
        icon="package",
        member_access=True,
        legacy_permission="reports.view",
    ),
    _module(
        "inventory-scan",
        "Invoice scan",
        "Scan supplier invoices into stock items.",
        "supply",
        route="/inventory/scan",
        permission="supply.inventory",
        icon="scan-line",
        legacy_permission="reports.view",
    ),
    _module(
        "purchase-orders",
        "Purchase orders",
        "Supplier requisitions, drafts, send and receive.",
        "supply",
        route="/purchase-orders",
        permission="supply.procurement",
        icon="truck",
        legacy_permission="reports.view",
    ),
    _module(
        "purchase-order-detail",
        "Purchase order detail",
        "Open a purchase order and receive its lines.",
        "supply",
        route="/purchase-orders/[orderId]",
        permission="supply.procurement",
        icon="truck",
        legacy_permission="reports.view",
    ),
    _module(
        "vendors",
        "Vendors",
        "Pricing history, alerts and cheapest vendor.",
        "supply",
        route="/vendors",
        permission="supply.vendors",
        icon="users",
        legacy_permission="reports.view",
    ),
    _module(
        "stocktake",
        "Stocktake",
        "Physical counts, variance valuation and stock corrections.",
        "supply",
        route="/departments/supply/stocktake",
        permission="supply.stocktake",
        icon="clipboard-check",
        member_access=True,
    ),
    # Quality, Safety & Compliance
    _module(
        "quality-audits",
        "Audits & CAPA",
        "Food safety audits, temperature logs and corrective actions.",
        "quality",
        route="/departments/quality/audits",
        permission="quality.audits",
        icon="shield-check",
        member_access=True,
    ),
    _module(
        "quality-licences",
        "Licences & contracts",
        "FSSAI, FoSTaC, insurance and statutory renewals.",
        "legal",
        route="/departments/legal/licences",
        permission="quality.licences",
        icon="file-text",
        member_access=True,
    ),
    # Finance & Accounts
    _module(
        "accounting",
        "Accounting & GST",
        "GST summary, expenses and Tally-ready exports.",
        "finance",
        route="/accounting",
        permission="finance.accounting",
        icon="landmark",
        legacy_permission="reports.view",
    ),
    _module(
        "sales",
        "Sales history",
        "Daily ledger and reconciliation.",
        "finance",
        route="/sales",
        permission="finance.sales",
        icon="dollar-sign",
        legacy_permission="reports.view",
    ),
    _module(
        "daily",
        "Daily entry",
        "Log sales, cash and expenses.",
        "finance",
        route="/daily",
        permission="finance.daily",
        icon="plus-circle",
        legacy_permission="reports.view",
    ),
    _module(
        "invoices",
        "Invoices",
        "Paid invoices and receipts.",
        "finance",
        route="/invoices",
        permission="finance.invoices",
        icon="file-text",
        legacy_permission="reports.view",
    ),
    _module(
        "expenses",
        "Expenses",
        "Categories, approvals and audit.",
        "finance",
        route="/expenses",
        permission="finance.expenses",
        icon="receipt",
        legacy_permission="reports.view",
    ),
    _module(
        "breakeven",
        "Breakeven",
        "Fixed costs and daily target.",
        "finance",
        route="/breakeven",
        permission="finance.breakeven",
        icon="target",
        legacy_permission="reports.view",
    ),
    _module(
        "billing-settings",
        "Tax & billing",
        "Tax rate, invoice footer and tip presets.",
        "finance",
        route="/settings/billing",
        permission="finance.billing",
        icon="receipt",
        legacy_permission="settings.manage",
    ),
    _module(
        "finance-budgets",
        "Budgets & outlet P&L",
        "Outlet P&L, cost centres and budget vs actual.",
        "finance",
        route="/finance/pnl",
        permission="finance.budgets",
        icon="bar-chart",
    ),
    # People & HR
    _module(
        "people",
        "People directory",
        "Employee master, org chart and documents.",
        "hr",
        route="/departments/hr/people",
        permission="hr.people",
        icon="users",
        legacy_permission="hr.people",
    ),
    _module(
        "leave",
        "Leave & holidays",
        "Balances, requests, approvals and holiday calendar.",
        "hr",
        route="/departments/hr/leave",
        permission="hr.leave",
        icon="calendar-days",
        legacy_permission="hr.leave",
    ),
    _module(
        "attendance",
        "HR attendance",
        "Geofenced clock-in/out and regularisation.",
        "hr",
        route="/departments/hr/attendance",
        permission="hr.attendance",
        icon="clock",
        legacy_permission="hr.attendance",
    ),
    _module(
        "payroll",
        "Payroll & payslips",
        "Salary structures, statutory deductions and payslips.",
        "hr",
        route="/departments/hr/payroll",
        permission="hr.payroll",
        icon="circle-dollar",
        legacy_permission="hr.payroll",
    ),
    _module(
        "recruitment",
        "Recruitment",
        "Job requisitions, applicants, interviews and offers.",
        "hr",
        route="/departments/hr/recruitment",
        permission="hr.recruitment",
        icon="user-plus",
        legacy_permission="hr.recruitment",
    ),
    _module(
        "onboarding",
        "Onboarding",
        "Candidate forms, reminders and HR review.",
        "hr",
        route="/departments/hr/onboarding",
        permission="hr.onboarding",
        icon="user-plus",
        legacy_permission="hr.onboarding",
    ),
    _module(
        "documents",
        "HR documents",
        "Document vault, templates and letters.",
        "hr",
        route="/departments/hr/documents",
        permission="hr.documents",
        icon="file-text",
        legacy_permission="hr.documents",
    ),
    _module(
        "exits",
        "Exits & settlement",
        "Resignation, clearance and full-and-final settlement.",
        "hr",
        route="/departments/hr/exits",
        permission="hr.exits",
        icon="briefcase",
        legacy_permission="hr.exits",
    ),
    _module(
        "training-lms",
        "Training & certification",
        "Courses, skill matrix, certification expiry and FoSTaC records.",
        "training",
        route="/departments/training/lms",
        permission="hr.training",
        icon="graduation-cap",
        member_access=True,
    ),
    # Marketing & Brand
    _module(
        "marketing",
        "Marketing hub",
        "Content calendar, reels and cross-channel campaign view.",
        "marketing",
        route="/marketing",
        permission="marketing.campaigns",
        icon="megaphone",
    ),
    _module(
        "communications",
        "Comms center",
        "WhatsApp, SMS and email campaigns.",
        "marketing",
        route="/communications",
        permission="marketing.communications",
        icon="message-circle",
    ),
    _module(
        "social",
        "Social publishing",
        "Post to Instagram and Facebook with approvals.",
        "marketing",
        route="/social",
        permission="marketing.social",
        icon="share-2",
    ),
    _module(
        "ads",
        "Ad campaigns",
        "Budgets, launch, pacing and ROI.",
        "marketing",
        route="/ads",
        permission="marketing.ads",
        icon="target",
    ),
    _module(
        "journeys",
        "Journeys",
        "Triggered marketing sequences and enrollment history.",
        "marketing",
        route="/journeys",
        permission="marketing.journeys",
        icon="workflow",
    ),
    _module(
        "media-studio",
        "Media studio",
        "Shared images for menu, social, ads and landing.",
        "marketing",
        route="/settings/media",
        permission="marketing.media",
        icon="image",
        shared_with=("kitchen", "revenue"),
        legacy_permission="settings.manage",
    ),
    _module(
        "landing-content",
        "Landing page content",
        "Hero, story and category content for the storefront.",
        "marketing",
        route="/settings/content",
        permission="marketing.content",
        icon="sparkles",
        legacy_permission="settings.manage",
    ),
    # Revenue & CRM
    _module(
        "customers",
        "Customers & CRM",
        "Profiles, consent and retention.",
        "revenue",
        route="/customers",
        permission="revenue.customers",
        icon="users",
        legacy_permission="reports.view",
    ),
    _module(
        "promotions",
        "Promotions",
        "Coupons, flash sales and scheduling.",
        "revenue",
        route="/promotions",
        permission="revenue.promotions",
        icon="megaphone",
        legacy_permission="settings.manage",
    ),
    _module(
        "integrations",
        "Integrations & channels",
        "Aggregators, channel pricing and delivery mix.",
        "revenue",
        route="/settings/integrations",
        permission="revenue.integrations",
        icon="workflow",
        shared_with=("technology",),
        legacy_permission="settings.manage",
    ),
    _module(
        "stores",
        "Stores & outlets",
        "Multi-store setup, outlet scope and channel availability.",
        "revenue",
        route="/settings/stores",
        permission="revenue.stores",
        icon="store",
        shared_with=("executive", "finance"),
        legacy_permission="settings.manage",
    ),
    _module(
        "loyalty",
        "Loyalty & gift cards",
        "Points, referrals, tiers and stored value.",
        "revenue",
        route="/departments/revenue/gift-cards",
        permission="revenue.loyalty",
        icon="sparkles",
    ),
    # Technology & Data
    _module(
        "ops",
        "Production ops",
        "Readiness, backups and launch checks.",
        "technology",
        route="/ops",
        permission="technology.ops",
        icon="shield-check",
    ),
    _module(
        "settings",
        "Company settings",
        "Store, payments, staff and imports.",
        "technology",
        route="/settings",
        permission="technology.settings",
        icon="settings",
        nav_group="Shared services",
    ),
    _module(
        "deployment",
        "Deployment",
        "Deployment readiness, environment and release checks.",
        "technology",
        route="/settings/deployment",
        permission="technology.deployment",
        icon="shield-check",
    ),
    _module(
        "hardware",
        "POS hardware",
        "Printers, drawers, displays and device health.",
        "technology",
        route="/settings/hardware",
        permission="technology.hardware",
        icon="monitor-play",
    ),
    _module(
        "providers",
        "Providers",
        "Encrypted messaging, social, ads and payment credentials.",
        "technology",
        route="/settings/providers",
        permission="technology.providers",
        icon="key-round",
        shared_with=("marketing",),
        legacy_permission="settings.manage",
    ),
    _module(
        "security",
        "Security & 2FA",
        "Security headers, sessions and two-factor authentication.",
        "technology",
        route="/settings/security",
        permission="technology.security",
        icon="shield-check",
    ),
    _module(
        "data-platform",
        "Data & BI",
        "Warehouse freshness, exports and data quality checks.",
        "technology",
        route="/departments/technology/data",
        permission="technology.data",
        icon="database",
    ),
    # Sub-department expansion (under Executive Office)
    _module(
        "franchise-pipeline",
        "Franchise pipeline",
        "Site pipeline, proforma, capex and opening playbook.",
        "franchise",
        route="/departments/franchise/pipeline",
        permission="executive.franchise",
        icon="building",
    ),
    # Shared services and company directory
    _module(
        "departments",
        "Departments",
        "Company directory, teams and department workspaces.",
        "company",
        route="/departments",
        permission="shared.directory",
        icon="building",
        nav_group="Shared services",
    ),
    _module(
        "store-profile",
        "Store profile",
        "Identity, hours and online ordering.",
        "company",
        route="/settings/store",
        permission="shared.store_profile",
        icon="store",
        nav_group="Shared services",
        legacy_permission="settings.manage",
    ),
    _module(
        "work",
        "My work",
        "Tasks, requests and approvals assigned to you.",
        "company",
        route="/work",
        permission="shared.work",
        icon="list-checks",
        nav_group="Shared services",
        status="active",
    ),
]
MODULE_BY_KEY = {item["key"]: item for item in MODULE_CATALOG}

# Planned modules that have no route yet still need a home in the workspace.
PLANNED_MODULE_KEYS = {
    item["key"] for item in MODULE_CATALOG if item["default_status"] == "planned"
}

# Every route that exists in the portal today. The catalogue test checks this
# list so a new page cannot be added without an owner, permission and nav home.
# Dynamic pages use the catalogue's `{param}` convention; `/departments/{key}`
# covers the department workspace (including the legacy literal /departments/hr).
PORTAL_ROUTES = {
    "/accounting",
    "/ads",
    "/ai-insights",
    "/breakeven",
    "/ceo",
    "/communications",
    "/counter",
    "/customers",
    "/daily",
    "/dashboard",
    "/departments",
    "/departments/{key}",
    "/departments/executive/budget",
    "/departments/facilities/assets",
    "/departments/franchise/pipeline",
    "/departments/hr/attendance",
    "/departments/hr/documents",
    "/departments/hr/exits",
    "/departments/hr/leave",
    "/departments/hr/onboarding",
    "/departments/hr/payroll",
    "/departments/hr/people",
    "/departments/hr/recruitment",
    "/departments/kitchen/engineering",
    "/departments/legal/licences",
    "/departments/operations/checklists",
    "/departments/quality/audits",
    "/departments/revenue/gift-cards",
    "/departments/supply/stocktake",
    "/departments/technology/data",
    "/departments/training/lms",
    "/expenses",
    "/feedback",
    "/finance/pnl",
    "/inventory",
    "/inventory/scan",
    "/invoices",
    "/journeys",
    "/kds",
    "/marketing",
    "/menu",
    "/messaging",
    "/operations",
    "/ops",
    "/orders",
    "/promotions",
    "/purchase-orders",
    "/purchase-orders/[orderId]",
    "/recipes",
    "/reports",
    "/roadmap",
    "/sales",
    "/settings",
    "/settings/billing",
    "/settings/content",
    "/settings/deployment",
    "/settings/hardware",
    "/settings/integrations",
    "/settings/media",
    "/settings/providers",
    "/settings/security",
    "/settings/store",
    "/settings/stores",
    "/shifts",
    "/shifts/schedule",
    "/social",
    "/support-inbox",
    "/vendors",
    "/waste",
    "/work",
}


DEPARTMENT_SPECS: list[dict] = [
    {
        "key": "executive",
        "name": "Executive Office",
        "description": "Strategy, board pack, capex, expansion and company health.",
        "color": "#7c3aed",
        "icon": "crown",
        "sort_order": 10,
        "kind": "executive",
        "cost_center": "CC-EXEC",
    },
    {
        "key": "operations",
        "name": "Operations",
        "description": "Service floor, kitchen flow, delivery and daily restaurant execution.",
        "color": "#f97316",
        "icon": "utensils",
        "sort_order": 20,
        "kind": "functional",
        "cost_center": "CC-OPS",
    },
    {
        "key": "guest-experience",
        "name": "Guest Experience & Support",
        "description": "Support inbox, messaging, feedback and guest recovery.",
        "color": "#fb923c",
        "icon": "headphones",
        "sort_order": 25,
        "kind": "functional",
        "parent": "operations",
        "cost_center": "CC-OPS",
    },
    {
        "key": "facilities",
        "name": "Facilities & Maintenance",
        "description": "Assets, preventive maintenance, work orders and breakdowns.",
        "color": "#fdba74",
        "icon": "wrench",
        "sort_order": 26,
        "kind": "functional",
        "parent": "operations",
        "cost_center": "CC-OPS",
    },
    {
        "key": "kitchen",
        "name": "Kitchen & Menu",
        "description": "Production, recipes, menu engineering, waste and new product development.",
        "color": "#dc2626",
        "icon": "chef-hat",
        "sort_order": 30,
        "kind": "functional",
        "cost_center": "CC-KITCHEN",
    },
    {
        "key": "supply",
        "name": "Supply Chain & Inventory",
        "description": "Procurement, vendors, purchase orders, receiving and stock accuracy.",
        "color": "#0d9488",
        "icon": "package",
        "sort_order": 40,
        "kind": "functional",
        "cost_center": "CC-SUPPLY",
    },
    {
        "key": "quality",
        "name": "Quality, Safety & Compliance",
        "description": "Food safety, audits, corrective actions, licences and insurance.",
        "color": "#16a34a",
        "icon": "shield-check",
        "sort_order": 50,
        "kind": "functional",
        "cost_center": "CC-QA",
    },
    {
        "key": "legal",
        "name": "Legal & Compliance",
        "description": "Licences, contracts, statutory calendar, POSH and DPDP.",
        "color": "#22c55e",
        "icon": "scale",
        "sort_order": 55,
        "kind": "functional",
        "parent": "quality",
        "cost_center": "CC-QA",
    },
    {
        "key": "finance",
        "name": "Finance & Accounts",
        "description": "GL, AP/AR, GST, cash, payroll accounting and outlet P&L.",
        "color": "#2563eb",
        "icon": "landmark",
        "sort_order": 60,
        "kind": "functional",
        "cost_center": "CC-FIN",
    },
    {
        "key": "hr",
        "name": "People & HR",
        "description": "Employee records, leave, attendance, payroll and HR compliance.",
        "color": "#0f766e",
        "icon": "users",
        "sort_order": 70,
        "kind": "functional",
        "cost_center": "CC-PEOPLE",
        "external_system": "Euron Open HRMS",
        "integration_status": "pilot",
    },
    {
        "key": "training",
        "name": "Training & Certification",
        "description": "Courses, skill matrix, certification expiry and FoSTaC records.",
        "color": "#14b8a6",
        "icon": "graduation-cap",
        "sort_order": 75,
        "kind": "functional",
        "parent": "hr",
        "cost_center": "CC-PEOPLE",
    },
    {
        "key": "marketing",
        "name": "Marketing & Brand",
        "description": "Brand, campaigns, social, content, ads and local store kits.",
        "color": "#db2777",
        "icon": "megaphone",
        "sort_order": 80,
        "kind": "functional",
        "cost_center": "CC-MKT",
    },
    {
        "key": "revenue",
        "name": "Revenue & CRM",
        "description": "Pricing, promotions, loyalty, CRM and aggregator mix.",
        "color": "#9333ea",
        "icon": "trending-up",
        "sort_order": 90,
        "kind": "functional",
        "cost_center": "CC-REV",
    },
    {
        "key": "technology",
        "name": "Technology & Data",
        "description": "Platform, integrations, BI, security and deployment.",
        "color": "#475569",
        "icon": "server",
        "sort_order": 100,
        "kind": "functional",
        "cost_center": "CC-TECH",
    },
    {
        "key": "franchise",
        "name": "Franchise & Expansion",
        "description": "Site pipeline, proforma, capex, opening playbook and royalties.",
        "color": "#a855f7",
        "icon": "building",
        "sort_order": 15,
        "kind": "functional",
        "parent": "executive",
        "cost_center": "CC-EXEC",
    },
    {
        "key": "company",
        "name": "Shared services",
        "description": "Company directory, approvals inbox, media and shared settings.",
        "color": "#64748b",
        "icon": "building",
        "sort_order": 5,
        "kind": "executive",
        "cost_center": "CC-CORP",
    },
]
DEPARTMENT_BY_KEY = {item["key"]: item for item in DEPARTMENT_SPECS}

# Sub-departments are real departments but roll their navigation and workspace
# into the parent's group. This mirrors how teams are organised in the business.
SUB_DEPARTMENTS = {
    "guest-experience",
    "facilities",
    "training",
    "legal",
    "franchise",
}

SHARED_SERVICE_KEYS = {"company"}

ROLE_PRESETS = (
    {
        "key": "head",
        "name": "Head",
        "level": "head",
        "description": "Owns the department, approves work and manages the team.",
    },
    {
        "key": "manager",
        "name": "Manager",
        "level": "manager",
        "description": "Runs daily work and approves requests.",
    },
    {
        "key": "member",
        "name": "Member",
        "level": "member",
        "description": "Works on assigned modules and tasks.",
    },
)


def department_root(key: str) -> str:
    """Return the top-level department key for navigation grouping."""
    seen: set[str] = set()
    current = DEPARTMENT_BY_KEY.get(key)
    while current and current.get("parent") and current["key"] not in seen:
        seen.add(current["key"])
        current = DEPARTMENT_BY_KEY.get(current["parent"])
    return current["key"] if current else key


def nav_group_for(module: dict) -> str:
    if module.get("nav_group"):
        return module["nav_group"]
    owner = DEPARTMENT_BY_KEY.get(module["owner"])
    if owner is None:
        return "Shared services"
    root = DEPARTMENT_BY_KEY[department_root(owner["key"])]
    if owner["key"] in SHARED_SERVICE_KEYS:
        return "Shared services"
    return root["name"]


def modules_for_department(key: str) -> list[dict]:
    if key in SHARED_SERVICE_KEYS:
        return [
            module
            for module in MODULE_CATALOG
            if module["owner"] == key or module["key"] == "overview"
        ]
    return [
        module
        for module in MODULE_CATALOG
        if module["key"] == "overview"
        or module["owner"] == key
        or key in module["shared_with"]
    ]


def permission_keys_for_department(key: str) -> list[str]:
    keys = {"shared.directory", "shared.work"}
    for module in modules_for_department(key):
        if module["permission_key"]:
            keys.add(module["permission_key"])
    for suffix in ("approve", "manage_team", "manage_modules"):
        keys.add(f"{key}.{suffix}")
    keys.add(f"{key}.view")
    return sorted(keys)


def role_permission_keys(key: str, role_key: str) -> list[str]:
    department_permissions = permission_keys_for_department(key)
    if role_key == "head":
        return department_permissions
    if role_key == "manager":
        return [
            permission
            for permission in department_permissions
            if not permission.endswith(".manage_modules")
        ]
    member_permissions = {"shared.directory", "shared.work", f"{key}.view"}
    for module in modules_for_department(key):
        if module["permission_key"] and module.get("member_access"):
            member_permissions.add(module["permission_key"])
    return sorted(member_permissions)


LEGACY_PERMISSION_MAP = {
    module["permission_key"]: module.get("legacy_permission")
    for module in MODULE_CATALOG
    if module.get("legacy_permission")
}

# Modules that are useful to every department but should not clutter the
# department's own workspace card grid.
SHARED_MODULE_KEYS = {"reports", "media-studio", "providers", "stores", "integrations"}
