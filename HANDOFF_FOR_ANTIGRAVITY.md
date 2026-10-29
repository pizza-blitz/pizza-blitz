# Pizza Blitz — Handoff Brief for Antigravity

**Date:** 2026-10-29 (updated after live COD test)
**Workspace:** `D:\Development\pizza Blitz` (repo root `D:/Development/pizza Blitz`)
**Branch:** `main`, HEAD `73265ec` (receipt Delivered, rider cash settlement, docs refresh)
**Local build:** passes `typecheck`, `build`, 18 assistant unit tests and `verify:blaze`
**Status:** live at `https://pizza-blitz.vercel.app`; GitHub and Supabase are connected. The newest
commits are pushed but **the live site has not visibly rebuilt from them yet** — see below.

Read this file first, then [HANDOVER.md](HANDOVER.md), [DEPLOY_REQUEST.md](DEPLOY_REQUEST.md),
[CURRENT_STATUS.md](CURRENT_STATUS.md), [docs/LAUNCH_RUNBOOK.md](docs/LAUNCH_RUNBOOK.md) and
[docs/GAP_AUDIT.md](docs/GAP_AUDIT.md) for detail. Sections 2 onward remain accurate; this
banner supersedes older deployment claims at the top of those files.

---

## 1. GitHub, Supabase and Vercel — verified state

**GitHub: connected.** Remote `https://github.com/pizza-blitz/pizza-blitz.git`; `main` was pushed
through `73265ec`. The working tree is clean after that push.

**Supabase: connected.** PostgreSQL 17.11 with 120 tables, Alembic head `9f8e7d6c5b4a`.
`/server/health` and `/server/ready` both return 200 on the live URL. The database schema was
checked against the models on 2026-10-29: `alembic check` initially wanted a duplicate
`ix_customer_memories_id` index because the model declared `index=True` on the primary key; with
that declaration removed, `alembic check` reports "No new upgrade operations detected." A
production-mode backend started with `backend/.env.deploy.local` on port 8011 answered health
and ready 200, accepted the admin login, and returned the seeded menu (10 items), 4 customers
and 3 delivery zones from the real Supabase database.

**Vercel: the project serves traffic, but it is not linked to this GitHub repository.** After
pushing `c1f732a`, `7aebc5c` and `5496329`, the live assistant still answered an order phrased
"for delivery" with the old delivery-zone list (checked 2026-10-29 18:40 UTC). The public
GitHub API shows **zero commit statuses and zero GitHub deployments** for those commits, which
means no Vercel Git integration is running on this repo. The local Vercel CLI is logged out and
the `VERCEL_TOKEN` environment value is rejected with 403, so a deploy cannot be triggered from
this machine. Concrete next step — do one of these:

1. Vercel dashboard → project `pizza-blitz` → Settings → Git → connect
   `pizza-blitz/pizza-blitz`, production branch `main`, then Redeploy.
2. Create a token at vercel.com/account/tokens, save it in a gitignored file, and the deploy can
   be run from this machine.

Then re-check with:

```bash
curl -s -X POST https://pizza-blitz.vercel.app/api/concierge \
  -H 'Content-Type: application/json' \
  -d '{"message":"one margherita pizza for delivery","cart":[]}'
```

The fixed backend returns `intent: add_item` and a cart count of 1; the old one returns
`intent: delivery` with zero items.

**Human-level COD delivery test (local, 2026-10-29):** green. Through the Blaze avatar the
order was added, handed to `/order`, Delivery was pre-selected, Near Store quoted Rs 25,
order #1 was placed for Rs 358.90 cash, rider "Ravi Kumar" was assigned, GPS was published,
the order moved to out for delivery, OTP proof was captured, and it was marked delivered
(4/4 timeline). The customer `/track` page showed the Leaflet map and rider, and the rider
portal at `/rider/<token>` rendered collection, proof and failure actions. Cash was then
settled through the staff payment-confirmation endpoint.

**Fixes in these commits:** Blaze adds items even when the message names delivery; the
delivery/pickup chip is acknowledged instead of repeating zone lists; a restored cart defaults
to an active zone so the quote runs and Place Order enables; Enter sends in the concierge;
an empty cart no longer shows a delivery fee; unset opening hours are hidden instead of
printing "Closed every day" while ordering is active.

**Still to confirm after the live build catches up:** run `npm run verify:deployment` and
`npm run verify:audit:live` against `https://pizza-blitz.vercel.app`, and repeat the COD +
tracking flow on the live site.

**Fixed after the COD test:** the customer receipt now shows "Order Status: Delivered" (it reads
the delivery assignment, which previously left the receipt saying "Ready" after handoff), and the
rider portal has a "Cash collected from customer" button that settles cash-on-delivery through
`POST /delivery/rider/{token}/cash-collected` so nobody has to open the staff payment queue.
Cash is still accepted via the staff payment queue as well.

---

## 2. What the product is

Two connected products in one repository:

1. **Customer website** — conversion-focused landing page, full menu and cart, pickup/delivery
   checkout, coupons, order confirmation, and live delivery tracking.
2. **Restaurant operating system** — admin portal, POS, KDS, dispatch, finance and outlet P&L,
   inventory, HR, marketing, support, quality, and 11 department workspaces.

Objective coverage, with the evidence that exists today:

| Requirement | Implementation | Evidence |
|---|---|---|
| Website attracts customers and speeds ordering | Landing conversion, Blaze concierge, menu, cart persistence, checkout, reorder | `verify:landing`, `verify:landing-conversion`, `verify:order-confirmation`, `verify:blaze` |
| 3D avatar in two-way conversation | Real Three.js chef avatar driven by the concierge; voice/text replies and actions | `frontend/src/components/blaze/chef-avatar.tsx`, `verify:blaze` |
| Customer memory, especially allergies | Saved and recalled across sessions, forget action, checkout reminder, allergy written onto the order and shown red on the KDS | `backend/tests/test_customer_memory.py`, `verify:customer-memory`, `verify:kds` |
| Delivery tracking at the level expected from Chinese delivery apps | OpenStreetMap with moving rider marker, last-fix time, ETA and arrival countdown, call rider, open in maps, handoff timeline, live 15-second refresh | `frontend/src/app/track/page.tsx`, `frontend/src/app/track/delivery-live-map*.tsx`, `verify:rider` |
| Manageable with fewer staff | KDS, dispatch, readiness checks, company OS, department workspaces, finance/HR automation | 65-step live audit, department proofs |

The proof-gated privacy rule matters: `/api/concierge` returns an empty memory unless a valid
signed customer session cookie proves the phone number. Do not weaken it.

---

## 3. Architecture and key files

- `backend/` — FastAPI, SQLAlchemy 2, Alembic. Entry: `backend/main.py` / `app.main:app`.
- `frontend/` — Next.js 14 App Router, React 18, TypeScript strict. Port 3011 locally.
- `docs/` — verification, launch, gap audit and beginner guide.

Key areas:

- Concierge and memory: `frontend/src/app/api/concierge/route.ts`,
  `backend/app/api/api_v1/endpoints/assistant.py`,
  `backend/app/services/customer_memory_service.py`
- Checkout and tracking: `frontend/src/app/order/page.tsx`, `frontend/src/app/track/page.tsx`
- Kitchen: `frontend/src/app/kds/page.tsx`, `backend/app/api/api_v1/endpoints/orders.py`
- Proofs: `frontend/e2e/` (176 scripts), ordered runner `frontend/e2e/verify-audit-live.cjs`
- Deployment assets: `backend/Dockerfile`, `frontend/Dockerfile`, `vercel.json`,
  `deploy-gcp.ps1` / `.sh` (an unused fallback), `backend/.env.deploy.local.example`,
  `backend/check_database_uri.py`, `docs/LAUNCH_RUNBOOK.md`
- Database migrations: 75 files; current head `9f8e7d6c5b4a`

Local data is in-memory SQLite by default, so it resets on every backend restart. Only one
ordered audit run works per backend process; restarting invalidates a partial run.

---

## 4. Run it locally

Backend (the verified machine uses `D:\DevTools\Python\python.exe`):

```powershell
cd backend
copy .env.example .env    # then adjust values
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Frontend:

```powershell
cd frontend
copy .env.example .env.local
npm install
npm run build
node node_modules/next/dist/bin/next start -p 3011 -H 127.0.0.1
```

URLs: storefront `http://localhost:3011`, admin `/login`, API `http://127.0.0.1:8010`.

Local proof env used on this machine: `PIZZA_BLITZ_SESSION_SECRET`, `PIZZA_BLITZ_API_URL`,
`MESSAGING_WEBHOOK_TOKEN=messaging-proof-token`, admin `admin/admin123`, staff `staff/staff123`.
These are local-only and must be replaced in production.

---

## 5. Verification — latest measured results

| Gate | Command | Latest result |
|---|---|---|
| Backend suite | `cd backend; python -W error::FutureWarning -m unittest discover -s tests -v` | **366 tests, 87 subtests, 0 failures** (about 75 s) |
| Typecheck / lint / build | `cd frontend; npm run typecheck; npm run lint; npm run build` | pass; lint has only pre-existing hook-dependency and `<img>` warnings |
| Audit preflight | `cd frontend; npm run verify:audit:preflight` | pass on `FwJA3-Y0izweWvL60Hp_T`; messaging webhook configured |
| Live audit | `cd frontend; npm run verify:audit:live` | **65/65 in 6.6 minutes**, no runner retry, on `FwJA3-Y0izweWvL60Hp_T` |
| Deployment proof | `cd frontend; npm run verify:deployment` | not run — requires a live URL |

The latest live-audit log is at `frontend/e2e/artifacts/audit-live-run.log` (gitignored).
Screenshots and JSON artifacts are in `frontend/e2e/artifacts/`.

No open application bug is known. The last real defect found by the audit was a flaky
`verify:role-gates` sign-in throttle; it was fixed by waiting out a full one-minute window
after a second 429, and the same proof passed inside the green run.

Known non-blocking limitations, not bugs: in-process rate limiting needs Redis/WAF when
horizontally scaled; map base tiles come from OpenStreetMap and need internet; the Vercel
serverless shape disables the in-process scheduler; Mobbin UI references are blocked by its
paid plan.

---

## 6. Deployment plan for Supabase + hosting

The owner will connect Supabase, Vercel and GitHub. Use this order.

1. **Commit and push** the working tree as described in section 1.
2. **Supabase:** create a project, take the **session pooler** connection string (port 5432),
   change the scheme to `postgresql+psycopg2://` and keep `?sslmode=require`. The transaction
   pooler (6543) is a poor fit because the app takes an advisory lock during bootstrap.
3. **Backend host:** Render or Railway (Dockerfile exists), not serverless if scheduled jobs
   must fire. Set at minimum:
   `ENVIRONMENT=production`, `SQLALCHEMY_DATABASE_URI`, `AUTH_SECRET_KEY`,
   `PIZZA_BLITZ_SESSION_SECRET`, `RESTAURANT_ADMIN_ID`, `RESTAURANT_ADMIN_PASSWORD`,
   `PIZZA_BLITZ_ADMIN_ID`, `PIZZA_BLITZ_ADMIN_PASSWORD`, `BACKEND_CORS_ORIGINS`,
   `PIZZA_BLITZ_PUBLIC_URL`, `PAYMENT_RETURN_URL`, `RESTAURANT_TIMEZONE`,
   `CUSTOMER_OTP_DEBUG_ENABLED=false`, and `PIZZA_BLITZ_STAFF_ID` / `PIZZA_BLITZ_STAFF_PASSWORD`.
   Production deliberately refuses SQLite and weak default secrets.
4. **Apply migrations** from this machine with the real URL in the gitignored
   `backend/.env.deploy.local`:
   ```bash
   cd backend
   python check_database_uri.py
   python -m alembic upgrade head
   ```
5. **Frontend host:** Vercel or the same provider. Set `NEXT_PUBLIC_API_URL`,
   `PIZZA_BLITZ_API_URL`, `PIZZA_BLITZ_SITE_URL`, `PIZZA_BLITZ_ADMIN_ID`,
   `PIZZA_BLITZ_ADMIN_PASSWORD`, `PIZZA_BLITZ_SESSION_SECRET`. Build with `npm run build`.
6. **Prove the deployment** with `E2E_BASE_URL=<public URL>` plus the matching API/admin env:
   `npm run verify:deployment`, then `npm run verify:audit:preflight` and
   `npm run verify:audit:live`. A deployment without these proofs is not finished.
7. **Providers last:** payment (Cashfree/Razorpay), email (Resend), SMS (Twilio), WhatsApp,
   Meta social and ads. They are intentionally gated by `PAYMENT_PROVIDER`,
   `CAMPAIGN_SEND_ENABLED`, `SOCIAL_PUBLISH_ENABLED` and `ADS_LAUNCH_ENABLED`.

A domain (`PizzaBlitz.com`) is not under project control; use the host's URL until DNS is set.

---

## 7. Missing information the owner must supply

These cannot be invented and block a truthful launch:

- Real store address, phone number, FSSAI number and opening hours
- Supabase Postgres URL
- A working hosting credential (current `VERCEL_TOKEN` returns 403) or an interactive host login
- Live payment and messaging provider accounts and their keys
- The production domain

Do not fabricate store details, analytics IDs, testimonials, ratings, or a "live" status.
Secrets belong only in gitignored files or the host's secret store, never in chat or commits.

---

## 8. Where to start, in order

1. Read this brief and `HANDOVER.md`; run the backend suite and the preflight to confirm the
   environment before changing anything.
2. Review and commit the 291 working-tree entries; create and push the GitHub repository.
3. Create Supabase, fill `backend/.env.deploy.local`, run `check_database_uri.py` and
   `alembic upgrade head`.
4. Deploy backend, then frontend; set all env names from section 6.
5. Run `verify:deployment`, the preflight and the 65-step audit against the public URL.
6. Replace demo/placeholder store identity text only with owner-supplied facts.
7. Enable providers one at a time with their own sandbox proof.

The previous goals and the current verified state are recorded in `CURRENT_STATUS.md`,
`docs/GAP_AUDIT.md` and `docs/VERIFICATION.md`. Keep those files honest as deployments and
fixes happen; they are the project's memory.
