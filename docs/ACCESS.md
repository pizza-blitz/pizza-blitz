# Pizza Blitz — Access & Master Credentials

## Quick access (local development)

Start the backend on `8010` and the frontend on `3011`, then open
`http://127.0.0.1:3011/login`.

| Role | ID | Password | Landing page | What they can open |
|---|---|---|---|---|
| Master admin | `admin` | `admin123` | `/dashboard` | Every portal page: dashboard, POS, kitchen, menu, inventory, purchase orders, customers, marketing, reports, finance, ops, store profile, settings |
| Counter staff | `staff` | `staff123` | `/orders` | Quick Counter, POS (Orders), Kitchen Ops, receipts and kitchen tickets |
| Customer | phone number + one-time code (or a recent order ID) | none (OTP/proof-based) | `/account` | Own order history, profile and consent |

These are the **development defaults** from `backend/app/core/config.py` and
`frontend/src/app/api/admin-session/route.ts`. They work because
`ENVIRONMENT=development`. Change them before exposing the app.

### Customer login

Customers sign in at `/account/login` with either:

- a **one-time code** sent to their phone (6 digits, 5-minute expiry, 5 attempts),
  or
- the **phone number + a recent order ID** from their receipt.

The backend verifies the code or the order proof before the Next session route
issues the customer cookie. Phone-only login is rejected. In local development
the OTP channel defaults to `console`, so the code appears on screen as a
"Development code"; set `CUSTOMER_OTP_CHANNEL=sms` or `whatsapp` and configure
the provider for real delivery.

## Production credentials (required)

The backend refuses to start in production when secrets are left at repository
defaults (see `validate_production_settings()`), and the frontend rejects
`admin/admin123` unless credentials are configured.

Set these on the deployment:

| Variable | Service | Purpose |
|---|---|---|
| `RESTAURANT_ADMIN_ID` | backend | Environment admin login ID |
| `RESTAURANT_ADMIN_PASSWORD` | backend | Environment admin password (strong, unique) |
| `PIZZA_BLITZ_ADMIN_ID` / `PIZZA_BLITZ_ADMIN_PASSWORD` | backend + frontend | Portal login credentials (both services must agree) |
| `PIZZA_BLITZ_STAFF_ID` / `PIZZA_BLITZ_STAFF_PASSWORD` | frontend | Counter staff login (optional; managed staff works without it) |
| `AUTH_SECRET_KEY` | backend | Signs API access tokens |
| `PIZZA_BLITZ_SESSION_SECRET` | backend + frontend | Signs portal session cookies |
| `PIZZA_BLITZ_ADMIN_NAME` | frontend | Display name on the portal |

`deploy-gcp.ps1` / `deploy-gcp.sh` require `PIZZA_BLITZ_SESSION_SECRET` and
`PAYMENT_RETURN_URL` and pass the admin credentials to both services.

### Managed master admin (recommended for production)

Instead of storing the admin password in environment variables, create a managed
credential stored hashed in the database:

```powershell
cd backend
python bootstrap_managed_database.py          # creates tables/seed data
python bootstrap_master_admin.py `
  --admin-id "owner@example.com" `
  --display-name "Restaurant Owner" `
  --password-stdin                            # pipe a 12+ character password
```

- Requires PostgreSQL by default; add `--allow-sqlite` only for a local check.
- Re-running requires `--rotate-existing`.
- The credential is hashed (PBKDF2-SHA256, 260k iterations) and the action is
  written to the operational audit log.
- The login screen accepts the managed ID/password and works even when the
  environment admin variables are absent.

## Role matrix (navigation + route protection)

| Area | Admin | Staff |
|---|---|---|
| Dashboard, CEO, Reports, Roadmap | yes | redirect to `/orders` |
| Quick Counter, POS Orders, Kitchen Ops, KDS Board | yes | yes |
| Menu, Inventory, Purchase Orders, Recipes, Vendors, Waste | yes | redirect to `/orders` |
| Customers, Comms, Promotions, Social, Ads | yes | redirect to `/orders` |
| Sales, Daily Entry, Invoices, Breakeven, Expenses | yes | redirect to `/orders` |
| Production Ops, AI Insights, Settings | yes | redirect to `/orders` |

Route protection is enforced by `frontend/src/middleware.ts` using
`frontend/src/lib/access.ts`; navigation hides links a role cannot open.

## Verifying access

```powershell
# Admin portal login (frontend session route)
$body = @{ id = "admin"; password = "admin123"; role = "admin" } | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri http://127.0.0.1:3011/api/admin-session `
  -ContentType "application/json" -Body $body

# Staff portal login
$body = @{ id = "staff"; password = "staff123"; role = "staff" } | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri http://127.0.0.1:3011/api/admin-session `
  -ContentType "application/json" -Body $body

# Browser proof for role gates
cd frontend
npm run verify:role-gates   # (node e2e/verify-role-gates.cjs)
```

## Security notes

- Change the dev defaults before any public deployment; the production guard is a
  safety net, not a substitute for real secrets.
- Sessions are HMAC-signed, HTTP-only cookies. Set `secure` cookies by running
  behind HTTPS (the app sets `secure` automatically when `NODE_ENV=production`).
- Login, customer history, order creation and payment verification are rate
  limited per instance (`RATE_LIMIT_ENABLED`). Add an edge/shared limiter when
  scaling horizontally.
- Use `/api/v1/restaurant/ops/credential-activation` and `/ops/readiness` to see
  whether managed credentials and production secrets are configured.
