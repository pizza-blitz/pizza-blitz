from fastapi import APIRouter
from app.api.api_v1.endpoints import sync, inventory, stats, daily, menu, expenses, insights, reports, purchase_orders, import_data, ocr, shifts, orders, vendors, promotions

api_router = APIRouter()
api_router.include_router(sync.router, prefix="/restaurant/sync", tags=["sync"])
api_router.include_router(inventory.router, prefix="/restaurant/inventory", tags=["inventory"])
api_router.include_router(stats.router, prefix="/restaurant/stats", tags=["stats"])
api_router.include_router(daily.router, prefix="/restaurant/sales", tags=["sales"])
api_router.include_router(menu.router, prefix="/restaurant/menu", tags=["menu"])
api_router.include_router(expenses.router, prefix="/restaurant/expenses", tags=["expenses"])
api_router.include_router(insights.router, prefix="/restaurant/insights", tags=["insights"])
api_router.include_router(reports.router, prefix="/restaurant/reports", tags=["reports"])
api_router.include_router(purchase_orders.router, prefix="/restaurant/purchase-orders", tags=["purchase-orders"])
api_router.include_router(import_data.router, prefix="/restaurant/import", tags=["import"])
api_router.include_router(ocr.router, prefix="/restaurant/ocr", tags=["ocr"])
api_router.include_router(shifts.router, prefix="/restaurant/shifts", tags=["shifts"])
api_router.include_router(orders.router, prefix="/restaurant/orders", tags=["orders"])
api_router.include_router(vendors.router, prefix="/restaurant/vendors", tags=["vendors"])
api_router.include_router(promotions.router, prefix="/restaurant/promotions", tags=["promotions"])
