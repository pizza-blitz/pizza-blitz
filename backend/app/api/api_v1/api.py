from fastapi import APIRouter, Depends
from app.api.deps import require_roles
from app.api.api_v1.endpoints import auth, sync, inventory, stats, daily, menu, expenses, insights, reports, purchase_orders, import_data, ocr, shifts, orders, vendors, promotions, recipes, customers, delivery, social, ads, ops, storefront, stores, accounting, aggregators, hardware, feedback, departments, company_work, hr, hr_leave, hr_attendance, hr_payroll, hr_onboarding, hr_documents, hr_exits, hr_analytics, media, storefront_content, billing_settings, provider_settings, messaging, journeys, hr_recruitment, careers, marketing, support, finance, assistant, company_operations, company_quality, company_programs, company_supply, company_kitchen, company_revenue, company_technology

api_router = APIRouter()
admin_only = [Depends(require_roles("admin"))]

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(sync.router, prefix="/restaurant/sync", tags=["sync"], dependencies=admin_only)
api_router.include_router(inventory.router, prefix="/restaurant/inventory", tags=["inventory"], dependencies=admin_only)
api_router.include_router(stats.router, prefix="/restaurant/stats", tags=["stats"], dependencies=admin_only)
api_router.include_router(daily.router, prefix="/restaurant/sales", tags=["sales"], dependencies=admin_only)
api_router.include_router(menu.router, prefix="/restaurant/menu", tags=["menu"])
api_router.include_router(expenses.router, prefix="/restaurant/expenses", tags=["expenses"])
api_router.include_router(insights.router, prefix="/restaurant/insights", tags=["insights"], dependencies=admin_only)
api_router.include_router(reports.router, prefix="/restaurant/reports", tags=["reports"])
api_router.include_router(purchase_orders.router, prefix="/restaurant/purchase-orders", tags=["purchase-orders"], dependencies=admin_only)
api_router.include_router(import_data.router, prefix="/restaurant/import", tags=["import"], dependencies=admin_only)
api_router.include_router(ocr.router, prefix="/restaurant/ocr", tags=["ocr"], dependencies=admin_only)
api_router.include_router(shifts.router, prefix="/restaurant/shifts", tags=["shifts"])
api_router.include_router(orders.router, prefix="/restaurant/orders", tags=["orders"])
api_router.include_router(vendors.router, prefix="/restaurant/vendors", tags=["vendors"], dependencies=admin_only)
api_router.include_router(promotions.router, prefix="/restaurant/promotions", tags=["promotions"])
api_router.include_router(recipes.router, prefix="/restaurant/recipes", tags=["recipes"], dependencies=admin_only)
api_router.include_router(customers.router, prefix="/restaurant/customers", tags=["customers"])
api_router.include_router(delivery.router, prefix="/restaurant/delivery", tags=["delivery"])
api_router.include_router(social.router, prefix="/restaurant/social", tags=["social"])
api_router.include_router(ads.router, prefix="/restaurant/ads", tags=["ads"])
api_router.include_router(media.router, prefix="/restaurant/media", tags=["media"])
api_router.include_router(storefront_content.router, prefix="/restaurant/storefront-content", tags=["storefront-content"])
api_router.include_router(billing_settings.router, prefix="/restaurant/billing-settings", tags=["billing-settings"])
api_router.include_router(provider_settings.router, prefix="/restaurant/provider-settings", tags=["provider-settings"])
api_router.include_router(messaging.router, prefix="/restaurant/messaging", tags=["messaging"])
api_router.include_router(journeys.router, prefix="/restaurant/journeys", tags=["journeys"])
api_router.include_router(hr_recruitment.router, prefix="/restaurant/hr/recruitment", tags=["hr-recruitment"])
api_router.include_router(careers.router, prefix="/restaurant/careers", tags=["careers"])
api_router.include_router(marketing.router, prefix="/restaurant/marketing", tags=["marketing"])
api_router.include_router(support.router, prefix="/restaurant/support", tags=["support"])
api_router.include_router(ops.router, prefix="/restaurant/ops", tags=["ops"])
api_router.include_router(storefront.router, prefix="/restaurant/storefront", tags=["storefront"])
api_router.include_router(
    assistant.router, prefix="/restaurant/assistant", tags=["assistant"]
)
api_router.include_router(stores.router, prefix="/restaurant/stores", tags=["stores"])
api_router.include_router(finance.router, prefix="/restaurant/finance", tags=["finance"])
api_router.include_router(accounting.router, prefix="/restaurant/accounting", tags=["accounting"])
api_router.include_router(
    aggregators.router,
    prefix="/restaurant/integrations/aggregators",
    tags=["aggregators"],
)
api_router.include_router(hardware.router, prefix="/restaurant/hardware", tags=["hardware"])
api_router.include_router(feedback.router, prefix="/restaurant/feedback", tags=["feedback"])
api_router.include_router(departments.router, prefix="/restaurant/departments", tags=["departments"])
api_router.include_router(company_work.router, prefix="/restaurant/work", tags=["company-work"])
api_router.include_router(
    company_operations.router,
    prefix="/restaurant/company/operations",
    tags=["company-operations"],
)
api_router.include_router(
    company_quality.router,
    prefix="/restaurant/company/quality",
    tags=["company-quality"],
)
api_router.include_router(
    company_programs.router,
    prefix="/restaurant/company/programs",
    tags=["company-programs"],
)
api_router.include_router(
    company_supply.router,
    prefix="/restaurant/company/supply",
    tags=["company-supply"],
)
api_router.include_router(
    company_kitchen.router,
    prefix="/restaurant/company/kitchen",
    tags=["company-kitchen"],
)
api_router.include_router(
    company_revenue.router,
    prefix="/restaurant/gift-cards",
    tags=["gift-cards"],
)
api_router.include_router(
    company_revenue.public_router,
    prefix="/restaurant/gift-cards/public",
    tags=["gift-cards-public"],
)
api_router.include_router(
    company_technology.router,
    prefix="/restaurant/company/technology",
    tags=["company-technology"],
)
api_router.include_router(hr.router, prefix="/restaurant/hr", tags=["hr"])
api_router.include_router(hr_leave.router, prefix="/restaurant/hr", tags=["hr-leave"])
api_router.include_router(hr_attendance.router, prefix="/restaurant/hr", tags=["hr-attendance"])
api_router.include_router(hr_payroll.router, prefix="/restaurant/hr", tags=["hr-payroll"])
api_router.include_router(hr_onboarding.router, prefix="/restaurant/hr", tags=["hr-onboarding"])
api_router.include_router(hr_documents.router, prefix="/restaurant/hr", tags=["hr-documents"])
api_router.include_router(hr_documents.public_router, prefix="/restaurant/hr", tags=["hr-documents-public"])
api_router.include_router(hr_exits.router, prefix="/restaurant/hr", tags=["hr-exits"])
api_router.include_router(hr_analytics.router, prefix="/restaurant/hr", tags=["hr-analytics"])
