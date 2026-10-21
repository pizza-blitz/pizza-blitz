# Pizza Blitz Frontend

Next.js app for the Pizza Blitz public customer website and internal restaurant portal.

## Main Routes

- `/` - public website homepage.
- `/order` - customer menu, customization, cart, coupon, pickup/delivery, and checkout.
- `/track` - customer order tracking.
- `/login` - admin login.
- `/dashboard` - internal business intelligence dashboard.
- `/orders` - POS and order management.
- `/operations` - kitchen operations board.
- `/reports` - financial reports and comparison dashboard.
- `/promotions`, `/social`, `/ads` - marketing workflows.
- `/ops` - production readiness, environment, and backup controls.

## Local Development

```powershell
copy .env.example .env.local
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3011
```

The frontend expects the backend at `NEXT_PUBLIC_API_URL`, normally `http://127.0.0.1:8010` locally. When it is unset, browser calls go through the same-origin `/server` proxy.

## Verification

```powershell
npm run lint
npm run typecheck
npm run build
```

With the backend on `8010` and this app on `3011`:

```powershell
npm run test:e2e
npm run verify:audit
```

The browser smoke and audit scripts expect `http://127.0.0.1:8010` and
`http://127.0.0.1:3011`. Full gate documentation lives in
[../docs/VERIFICATION.md](../docs/VERIFICATION.md).

The browser smoke test expects backend `http://127.0.0.1:8010` and frontend `http://127.0.0.1:3011` to be running.

## Environment

Use `.env.example` as the local template. Keep real admin passwords and session secrets outside git.
