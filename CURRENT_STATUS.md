# Pizza Blitz Current Status

Last Updated: 2026-05-21

## Source Of Truth

Standalone workspace:

`D:\Development\pizza Blitz`

This project was copied from:

`D:\Development\EduEcosystem\restaurant-portal`

The standalone copy excludes generated dependency/build folders such as `node_modules`, `.next`, `venv`, and `__pycache__`.

## Current State

- Backend exists as a FastAPI app.
- Frontend exists as a Next.js app.
- Internal restaurant portal pages already exist for dashboard, daily entry, sales, reports, menu, inventory, recipes, waste, expenses, settings, AI insights, CEO command, orders, shifts, invoices, vendors, promotions, purchase orders, and breakeven.
- Backend endpoints already exist for sales, stats, menu, inventory, expenses, OCR, imports, reports, purchase orders, shifts, orders, vendors, promotions, and sync.
- Deployment URLs checked on 2026-05-21 returned 404 or deployment-not-found responses, so production deployment is not currently trusted.
- Hardcoded copied secrets were removed from the standalone project.
- Runtime config now uses environment variables.
- Local git repository has been initialized.
- Backend `/health` check passes through FastAPI test client: `200 {"status": "ok", "project": "Restaurant Portal API"}`.
- Frontend production build passes with Next.js.
- Remaining known warning: Recharts reports a non-fatal container width/height warning during prerender.
- Remaining cleanup debt: backend imports `google.generativeai`, which now emits a deprecation warning and should eventually move to `google.genai`.
- Frontend pages now use the shared API URL helper instead of stale hardcoded production backend URLs.
- Backend now uses an in-memory SQLite dev DB by default because file-backed SQLite writes produced disk I/O errors in this workspace. Production should still use `SQLALCHEMY_DATABASE_URI` for PostgreSQL.
- POS/order tables, invoices, recipes, waste log, and fixed costs now have backend models.
- Existing frontend pages for POS orders, invoices, recipes, and waste now have matching backend API contracts.
- POS lifecycle verified through FastAPI test client: create order, generate invoice, close order, and update dashboard sales.
- Analytics endpoints verified after formula portability fixes:
  - dashboard stats
  - monthly breakdown
  - lifetime summary
  - same-period comparison
  - target status

## Immediate Priority

Make the internal restaurant portal locally stable first:

1. Confirm backend imports and `/health` works.
2. Confirm frontend builds.
3. Continue validating formulas with realistic historical data.
4. Run browser verification once local server startup is approached again.
5. Only after the internal portal is reliable, build the public customer ordering website.
