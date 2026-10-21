# Pizza Blitz Handoff

If context is compressed, continue from this file first.

## What Matters

- Pizza Blitz is a standalone workspace at `D:\Development\pizza Blitz`.
- Do not work inside `D:\Development\EduEcosystem\restaurant-portal`.
- Both products are built: the internal restaurant portal and the public
  customer ordering website.
- The repository is healthy: backend tests, lint, typecheck, production build,
  browser smoke, and the local audit suite all pass as of 2026-10-21.
- The open work is deployment and provider integration, not application code.
- Secrets were removed from copied files; use the `.env.example` files as
  templates.

## Current Verified Gates

1. Backend: `python -W error::FutureWarning -m unittest discover -s tests -v`
   → 43 tests pass.
2. Frontend: `npm run lint`, `npm run typecheck`, `npm run build` → pass.
3. Browser smoke: `npm run test:e2e` with servers on 8010/3011 → pass.
4. Audit suite: `npm run verify:audit` with servers running → pass.

Full commands and what each gate proves: `docs/VERIFICATION.md`.

## Next Best Steps

1. Connect the production database (`SQLALCHEMY_DATABASE_URI`), run Alembic,
   and verify `/ready` against it.
2. Configure production secrets: admin credentials, `AUTH_SECRET_KEY`,
   `PIZZA_BLITZ_SESSION_SECRET`, `BACKEND_CORS_ORIGINS`, and the public URLs.
3. Deploy with `deploy-gcp.ps1` (backend then frontend), then run the
   production-only proofs listed in `docs/VERIFICATION.md`.
4. Add provider credentials one at a time (payment sandbox first), keeping
   `CAMPAIGN_SEND_ENABLED`, `SOCIAL_PUBLISH_ENABLED`, and `ADS_LAUNCH_ENABLED`
   off until each provider is verified.
5. Pay down the remaining `no-explicit-any` warnings in the older dashboard
   pages when those screens are next touched.

Open gaps and their status: `docs/GAP_AUDIT.md`.
