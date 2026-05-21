## DEPLOY REQUEST
Date: 2026-03-29
Project: Pizza Blitz
Changed Files:
- backend/app/api/api_v1/api.py
- backend/app/api/api_v1/endpoints/shifts.py
- backend/app/api/api_v1/endpoints/orders.py
- backend/app/api/api_v1/endpoints/stats.py
- backend/app/api/api_v1/endpoints/vendors.py
- backend/app/api/api_v1/endpoints/promotions.py
- backend/app/api/api_v1/endpoints/menu.py
- frontend/src/app/(dashboard)/ceo/page.tsx
- frontend/src/app/(dashboard)/shifts/page.tsx
- frontend/src/app/(dashboard)/orders/page.tsx
- frontend/src/app/(dashboard)/breakeven/page.tsx
- frontend/src/app/(dashboard)/invoices/page.tsx
- frontend/src/app/(dashboard)/vendors/page.tsx
- frontend/src/app/(dashboard)/promotions/page.tsx

New Endpoints Added:
- GET /api/v1/restaurant/shifts/
- POST /api/v1/restaurant/shifts/
- GET /api/v1/restaurant/shifts/performance
- POST /api/v1/restaurant/orders/
- GET /api/v1/restaurant/orders/tables
- GET /api/v1/restaurant/orders/invoices
- GET /api/v1/restaurant/stats/insights/health-score
- GET /api/v1/restaurant/stats/target/status
- GET /api/v1/restaurant/stats/ceo-summary
- GET /api/v1/restaurant/stats/weekly-summary/whatsapp
- GET /api/v1/restaurant/stats/breakeven
- POST /api/v1/restaurant/stats/breakeven/setup
- GET /api/v1/restaurant/vendors/
- POST /api/v1/restaurant/vendors/prices
- GET /api/v1/restaurant/vendors/prices/alerts/increases
- GET /api/v1/restaurant/vendors/intelligence/cheapest/{item}
- POST /api/v1/restaurant/promotions/
- GET /api/v1/restaurant/promotions/active
- GET /api/v1/restaurant/menu/profitability

Services Needing Redeploy:
- [x] backend
- [x] frontend

Test After Deploy:
- GET https://pizza-blitz-backend-503001969959.us-central1.run.app/api/v1/restaurant/stats/insights/health-score should return 200 with JSON health data.
- GET https://pizza-blitz-dashboard.vercel.app/ceo should display the new Intelligence Hub with charts.
