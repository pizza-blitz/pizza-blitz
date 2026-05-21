# Pizza Blitz

Standalone codebase for the Pizza Blitz restaurant operating system and customer ordering platform.

## Current Scope

This project starts from the older `restaurant-portal` code that was previously parked inside the EduEcosystem repository. From this point forward, Pizza Blitz work should happen in this standalone folder.

## Apps

- `backend/` - FastAPI backend for restaurant operations, sales, inventory, menu, POS, orders, reports, vendors, promotions, and imports.
- `frontend/` - Next.js dashboard for the internal restaurant portal.

## Local Development

Backend:

```powershell
cd backend
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
copy .env.example .env.local
npm install
npm run dev
```

The frontend expects `NEXT_PUBLIC_API_URL` to point at the backend, normally `http://localhost:8000` during local development.

## Rule

Do not modify EduEcosystem files for Pizza Blitz work. Treat this folder as the source project.

