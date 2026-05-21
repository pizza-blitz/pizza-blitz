# Pizza Blitz Handoff

If context is compressed, continue from this file first.

## What Matters

- Pizza Blitz is now a standalone workspace at `D:\Development\pizza Blitz`.
- Do not continue working inside `D:\Development\EduEcosystem\restaurant-portal`.
- The immediate target is internal portal stability, not the public ordering website yet.
- Production URLs seen earlier were stale or broken, so do not trust deployment status until rechecked.
- Secrets were removed from copied files; use `.env.example` files as templates.

## Next Best Step

Baseline already completed:

1. Backend `/health` returns 200 through FastAPI test client.
2. Frontend dependencies were installed.
3. Frontend production build passes.
4. Secret scan is clean for copied production strings.
5. Stale hardcoded backend URLs were removed from frontend pages.
6. Backend contracts were added/fixed for POS orders, invoices, recipes, and waste.
7. POS lifecycle test passes through FastAPI test client.
8. Frontend production build passes after backend contract work.
9. Backend validation suite passes with `python -m unittest discover -s tests -v`.
10. Recharts prerender sizing warning is fixed with explicit `initialDimension` on responsive charts.

Next best step:

1. Replace deprecated `google.generativeai` usage when OCR/import work is next.
2. Run the app locally in browser and verify each internal portal page.
3. Start deployment preparation after browser verification passes.
