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

## Immediate Priority

Make the internal restaurant portal locally stable first:

1. Confirm backend imports and `/health` works.
2. Confirm frontend builds.
3. Audit API route contracts between frontend and backend.
4. Validate sales, expense, profit, breakeven, and comparison formulas.
5. Only after the internal portal is reliable, build the public customer ordering website.
