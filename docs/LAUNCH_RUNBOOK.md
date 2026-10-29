# Pizza Blitz Launch Runbook

This runbook is the handoff checklist for taking the Pizza Blitz restaurant portal from local MVP to a live deployment.

## Current Build Status

Completed in the application:

- Internal admin portal with role-based session flow.
- Public customer website with menu, cart, checkout, pickup/delivery, coupons, and tracking.
- Counter/POS order creation, invoice generation, payment status, and kitchen status flow.
- Delivery zones, delivery fee quote, address validation by zone keywords, and delivery assignment.
- Product customization for sizes, crusts, toppings, add-ons, and combos.
- Payment session abstraction plus manual, Razorpay-style, and Cashfree-style webhook processing.
- Customer CRM, promotions, campaign delivery logs, WhatsApp/SMS/email provider integration points.
- Social publishing workflow and ad campaign management workflow.
- Production ops readiness, backup run tracking, and reporting comparison dashboards.
- Backend unit validation and browser E2E smoke coverage.

## Local Ports

- Backend API: `http://127.0.0.1:8010`
- Frontend: `http://localhost:3011`

Use those ports for local smoke testing unless the environment explicitly overrides them.

## Required Environment Before Production

Backend:

- `SQLALCHEMY_DATABASE_URI`: production database connection. Do not use `sqlite:///:memory:` for production; the server now refuses to start in production on SQLite. For Supabase, take the session pooler URL, change the scheme to `postgresql+psycopg2://`, and keep `?sslmode=require` — the driver name is what makes SQLAlchemy load psycopg2, and SSL is required by the server. Port 5432 is the session pooler; port 6543 is the transaction pooler and is a poor fit because this app takes an advisory lock during bootstrap.
- `ENVIRONMENT=production`
- `CUSTOMER_OTP_DEBUG_ENABLED=false`: OTP codes are never echoed in API responses outside explicitly local environments (`development`, `local`, `test`), and this flag is a second lock for local use only. Leave it false in staging and production.
- `RESTAURANT_TIMEZONE`: calendar timezone for sales days, orders, promotions, and shifts (default `Asia/Kolkata`). Set it explicitly; Cloud Run hosts run in UTC.
- `BACKEND_CORS_ORIGINS`: deployed frontend origin only.
- `RESTAURANT_ADMIN_ID`: production admin login id.
- `RESTAURANT_ADMIN_PASSWORD`: strong password stored as a secret.
- `AUTH_SECRET_KEY`: long random secret, different from the admin password.
- `BACKUP_DIR`: persistent or mounted backup target if local file backups are used.
- `PAYMENT_PROVIDER`: selected live provider.
- `PAYMENT_RETURN_URL`: deployed customer/account URL.
- Provider secrets for Cashfree/Razorpay, campaigns, WhatsApp, email, SMS, Meta social, and Meta ads as needed.

Frontend:

- `NEXT_PUBLIC_API_URL`: deployed backend API base URL.
- `PIZZA_BLITZ_API_URL`: deployed backend API base URL for server routes.
- `PIZZA_BLITZ_SITE_URL`: public storefront origin used in `sitemap.xml` and `robots.txt` (for example `https://pizzablitz.example`). Set it to the deployed domain, not localhost.
- `PIZZA_BLITZ_ADMIN_ID`: admin login id used by the Next.js session route.
- `PIZZA_BLITZ_ADMIN_PASSWORD`: production admin password secret.
- `PIZZA_BLITZ_SESSION_SECRET`: long random secret for frontend session signing.

## Local Verification Sequence

1. Start backend:

```powershell
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

2. Start frontend:

```powershell
cd frontend
npm run dev -- --hostname 127.0.0.1 --port 3011
```

3. Run backend validation:

```powershell
cd backend
python -W error::FutureWarning -m unittest discover -s tests -v
```

4. Run frontend production build:

```powershell
cd frontend
npm run build
```

5. Restart frontend after `npm run build` if using `next dev`, because the build rewrites `.next`.

6. Run browser smoke:

```powershell
cd frontend
npm run test:e2e
```

Shortcut for the standard gates:

```powershell
.\scripts\verify-local.ps1
```

Shortcut including browser smoke:

```powershell
.\scripts\verify-local.ps1 -E2E
```

## Manual Smoke Checklist

- Open `/` and confirm the public website loads.
- Open `/order`, add a menu item, choose customization options, apply a coupon if available, and place a cash pickup order.
- Use the confirmation link to open `/track` and confirm order status renders.
- Open `/login`, sign in as admin, and confirm `/dashboard` loads.
- Check `/orders`, `/operations`, `/customers`, `/promotions`, `/social`, `/ads`, `/ops`, and `/reports`.
- In `/ops`, verify readiness status and backup controls.
- In `/reports`, verify current vs previous vs last-year comparison cards and risk signals.

## Provider Launch Order

1. Payment provider sandbox.
2. Payment webhook signature verification.
3. Email provider sandbox/test domain.
4. SMS/WhatsApp test number.
5. Social posting test page/account.
6. Ad campaign sandbox or paused campaign launch.
7. Live production switch only after provider-specific logs confirm success.

Keep `CAMPAIGN_SEND_ENABLED=false`, `SOCIAL_PUBLISH_ENABLED=false`, and `ADS_LAUNCH_ENABLED=false` until the corresponding provider credentials are verified.

For the messaging inbox, set `MESSAGING_WEBHOOK_TOKEN` and point the provider webhook to
`/api/v1/restaurant/messaging/webhook/{whatsapp|sms|email|instagram}` with the token as the
`token` query parameter or `X-Webhook-Token` header. Without it, inbound webhooks return 503.

Marketing journeys run on the backend scheduler every minute. Keep journey status `draft`
until the relevant provider is live; skipped/failed send steps are recorded on the enrollment.

## Deployment Checklist

- Production database created and migrated. Prove it with `cd backend; python check_database_uri.py`
  before and after `python -m alembic upgrade head`; the checker refuses SQLite, names missing
  tables and compares the schema revision with the head.
- Secrets configured in the deployment platform.
- Backend deployed and `/health` returns OK.
- Frontend deployed with backend URL set.
- CORS contains the deployed frontend origin.
- Admin password changed from local defaults.
- Backup path and retention verified.
- Browser smoke run against deployed URLs.
- Payment webhook endpoint tested from provider dashboard.
- First real order tested with a low-value item or sandbox mode.

## Residual Risks

- Real payment settlement, refunds, chargebacks, and provider reconciliation still depend on selected live provider account behavior.
- WhatsApp/SMS/email/social/ad delivery depends on provider account approval, templates, rate limits, and sender reputation.
- Delivery address validation is zone-keyword based, not a full geocoding service.
- Production reliability depends on persistent database, backups, logging, and deployment monitoring.
