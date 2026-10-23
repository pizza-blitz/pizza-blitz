from fastapi import APIRouter, Depends
from app.api.deps import require_roles
from app.api.api_v1.endpoints import auth, sync, inventory, stats, daily, menu, expenses, insights, reports, purchase_orders, import_data, ocr, shifts, orders, vendors, promotions, recipes, customers, delivery, social, ads, ops, storefront, stores, accounting, aggregators

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
api_router.include_router(ops.router, prefix="/restaurant/ops", tags=["ops"])
api_router.include_router(storefront.router, prefix="/restaurant/storefront", tags=["storefront"])
api_router.include_router(stores.router, prefix="/restaurant/stores", tags=["stores"])
api_router.include_router(accounting.router, prefix="/restaurant/accounting", tags=["accounting"])
api_router.include_router(
    aggregators.router,
    prefix="/restaurant/integrations/aggregators",
    tags=["aggregators"],
)
