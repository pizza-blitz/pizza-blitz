# Pizza Blitz — Deployment Request

**Date:** 2026-10-28
**Release:** Company OS + conversion program (see [ROADMAP.md](ROADMAP.md) Phase 10)
**Status:** code and deployment assets are ready; **no live URL exists yet** because a
verified hosting account and production secrets were not available. Nothing has been faked.

---

## 1. What is ready

| Asset | Location | State |
|---|---|---|
| Backend image | `backend/Dockerfile` | Builds FastAPI on Python 3.11 |
| Frontend image | `frontend/Dockerfile` | Builds Next.js 14 standalone |
| GCP deploy script | `deploy-gcp.ps1` / `deploy-gcp.sh` | Optional, unused after the Supabase decision. Kept for a later move to Google Cloud |
| Vercel config | `vercel.json` | Experimental services: `web` (frontend) at `/`, `api` (backend) at `/server` |
| Database migrations | `backend/alembic/versions` | Head `9f8e7d6c5b4a`; verified on a copy of the working DB |
| Readiness probes | `/health`, `/ready` | `/ready` returns 503 when the DB is unreachable |
| Verification plan | `docs/LAUNCH_RUNBOOK.md` | Post-deploy smoke and provider steps |

Local production proof already passes: 364 backend tests (87 subtests), 176
browser proofs, production build, and the Company OS/conversion/gift-card proofs.

## 2. Why it is not live

One blocker remains now that Supabase replaces Google Cloud: **hosting
credentials and the database URL**. Both are measured facts, not guesses:

1. **Vercel:** `VERCEL_TOKEN` is present in the environment, and the Vercel API
   answers it with `403 {"error":{"code":"forbidden","message":"Not authorized"}}`
   for `GET /v2/user`. Vercel CLI 65.2.0 is installed, so the tooling is ready —
   the credential is not.
2. **Database:** there is no Supabase project yet, so there is no Postgres URL to
   point the app at. The app now refuses to start in production on SQLite, which
   is the correct behaviour and the reason this is a hard blocker rather than a
   soft one.
3. The Google Cloud blocker recorded earlier — an account with no Pizza Blitz
   project — no longer applies to the plan, because Supabase is the database and
   Render or Vercel is the host. `deploy-gcp.ps1` stays unused.

Supporting facts from the same pass:

- **Docker:** the CLI is installed at 29.5.3, but the engine cannot start. Docker
  Desktop reports "unable to start", and `wsl --status` returns
  `Class not registered` / `Wsl/CallMsi/Install/REGDB_E_CLASSNOTREG`, which means
  the Windows Subsystem for Linux backend is not installed. Fixing that needs an
  elevated `wsl --install` and probably a reboot, so it is outside what this
  session may do. The images therefore cannot be built or run here, and the
  migration chain is verified to *render* as Postgres DDL, never verified to
  *apply* against a live Postgres.
- **Mobbin MCP:** answers "Mobbin MCP requires a paid plan", so no further UI
  references could be pulled.
- A DNS name (`PizzaBlitz.com`) is also not under our control here; hosting must
  supply the domain or a staging URL first.

Nothing above was worked around with a mock, a screenshot, or a claim of a
deployment. The honest state is: application code and release assets verified
locally, zero live targets.

## 3. The hosting shape, decided on 2026-10-28

**Database: Supabase.** Google Cloud is no longer the plan. The application speaks
plain Postgres, the migrations target nothing else, and Supabase hands over one
connection string and a web dashboard — no service accounts, no IAM roles, no
project ownership questions. If the restaurant later outgrows it, Supabase is
plain Postgres, so moving to Cloud SQL or a managed instance is a dump and a
restore, not a rewrite. The GCP assets in this repository (`deploy-gcp.ps1`,
`deploy-gcp.sh`) stay as an unused option.

### Path A — Supabase + Vercel, fastest preview

1. A Supabase project, free tier is enough to prove the launch.
2. A Vercel token for the intended team, or an interactive login.
3. Deploy from the repository root so `vercel.json` maps `frontend` to `/` and
   `backend` to `/server`.

Trade-off to know before choosing this path: Vercel runs the API as a serverless
function, so the in-process scheduler is switched off and scheduled reports and
reminders do not fire. Fine for a preview, incomplete for a restaurant.

### Path B — Supabase + Render or Railway, the honest restaurant setup

1. A Supabase project.
2. A Render or Railway account. Both build the existing
   `backend/Dockerfile` and keep one process running, so the scheduler, the
   in-process rate limiter and the media directory behave exactly as they do on
   this laptop.
3. Point the service at `backend/` as the build context, set the variables from
   Section 5, add a persistent disk for `MEDIA_ROOT`, and deploy.
4. Run the Section 6 checks, then deploy the frontend to Vercel against it.

Recommended: Path B once real orders are involved, Path A if the goal is only a
clickable link to show someone today.

### The Supabase connection string, exactly

Supabase shows several URL flavours. Use the **Session pooler** string and change
two things:

```text
Dashboard string:  postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
Application value: postgresql+psycopg2://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

The `+psycopg2` part tells SQLAlchemy which driver to load — without it the app
fails at startup with "No module named psycopg2" style errors. `sslmode=require`
is not optional with Supabase; the connection is rejected without it. Prefer the
session pooler on port 5432 over the transaction pooler on port 6543, because the
transaction pooler reuses server connections between statements, and this app
takes a Postgres advisory lock during bootstrap.

Then apply the schema once from this machine:

```powershell
cd backend
$env:SQLALCHEMY_DATABASE_URI = "<the +psycopg2 URL above>"
python -m alembic upgrade head
```

## 4. What I need from you, in order

1. **The Supabase connection string.** Create the project, then paste the session
   pooler URL into `backend/.env.deploy.local` as `SQLALCHEMY_DATABASE_URI` in the
   `postgresql+psycopg2://...?sslmode=require` form above. Start from
   `backend/.env.deploy.local.example`, which lists every name with a comment.
   That file is already ignored by git. Do not paste secrets into this chat; a
   file on your machine is enough for me to read.
2. **Strong values** for `AUTH_SECRET_KEY`, `PIZZA_BLITZ_SESSION_SECRET`,
   `RESTAURANT_ADMIN_PASSWORD` and `PIZZA_BLITZ_SESSION_SECRET` in the same file.
   They can be any long random text; I can generate them on request.
3. **A hosting credential.** A Vercel token for the right team for Path A, or a
   Render/Railway API key for Path B. Without one, nothing can be deployed and I
   will not simulate it.
4. **The real store details**: address, phone, FSSAI licence number, opening
   hours, and the delivery radius you actually honour. These fields are
   deliberately empty in the store profile.
5. **Optional, only when you want them live:** Cashfree or Razorpay keys for
   online payments, WhatsApp/SMS sender credentials, an S3 bucket for photos, and
   a Google Maps key. Everything else works without them and says so.

The first thing I run after you fill in the file is a proof that the database
answers, not just that the string looks right:

```powershell
cd backend
python check_database_uri.py
```

It prints the URL with the password hidden, confirms the server version, takes an
advisory lock the same way the bootstrap does, compares the schema revision with
the Alembic head, and lists any missing core tables. Exit code 0 means the launch
can proceed; anything else prints the exact fix. Its 12 unit tests run with the
normal suite, so the checker itself is not a guess either.

## 5. Environment variables

Required for a real deployment (names match `backend/app/core/config.py` and the deploy
script):

| Variable | Purpose |
|---|---|
| `SQLALCHEMY_DATABASE_URI` | Production Postgres URL |
| `ENVIRONMENT=production` | Enables production guards and rejects default secrets |
| `RESTAURANT_ADMIN_ID` / `RESTAURANT_ADMIN_PASSWORD` | Strong admin credentials (not `admin/admin123`) |
| `AUTH_SECRET_KEY` | Token/credential encryption; back it up |
| `PIZZA_BLITZ_SESSION_SECRET` | Portal cookie signing (shared with frontend) |
| `BACKEND_CORS_ORIGINS` | Exact deployed frontend origin |
| `PAYMENT_RETURN_URL` | Deployed customer account URL |
| `PIZZA_BLITZ_API_URL` / `PIZZA_BLITZ_BACKEND_URL` | Frontend → backend URLs |
| `RESTAURANT_TIMEZONE` | Business-day calendar (default `Asia/Kolkata`) |
| Provider keys | Payment, WhatsApp/SMS/email, S3/CDN, pager — only when accounts exist |

Keep `CAMPAIGN_SEND_ENABLED`, `SOCIAL_PUBLISH_ENABLED` and `ADS_LAUNCH_ENABLED` off until each
provider is verified.

## 6. Post-deploy verification

```powershell
# Probes
curl https://<backend>/health
curl https://<backend>/ready

# Schema (run once against production)
cd backend
$env:SQLALCHEMY_DATABASE_URI = "<production Postgres URL>"
python -m alembic upgrade head

# Browser proofs against the deployment
cd ..\frontend
$env:E2E_BASE_URL = "https://<frontend>"
$env:E2E_API_URL = "https://<backend>"
$env:E2E_ADMIN_ID = "<admin id>"
$env:E2E_ADMIN_PASSWORD = "<admin password>"
npm run verify:deployment
npm run verify:audit
```

Definition of done: the landing page, customer order, Blaze concierge, portal login, one
department workspace and the gift-card checkout work against the live URL, `/ready` is green,
and the deployment proof passes — not just a successful build.

## 7. What will not be faked

- No DNS record, TLS certificate, live URL or provider account will be claimed without
  actually creating it.
- No real payment/WhatsApp/email send will be made without credentials and explicit approval.
- The repository stays uncommitted unless a commit is requested.
