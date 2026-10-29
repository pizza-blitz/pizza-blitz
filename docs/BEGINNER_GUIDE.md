# Pizza Blitz — Beginner's Guide

This guide explains Pizza Blitz in everyday language. You do not need to know what
"REST", "SSH", "TTS", "etcd", "Azure", "Gin", "Vite", "Git" or "SRE" mean to use it.
Those words appear in a glossary at the end if someone asks.

---

## 1. What is Pizza Blitz?

Pizza Blitz is a restaurant in a box. It has three doors:

1. **The customer website** — what a guest sees at PizzaBlitz.com. They can look at the
   menu, talk to Blaze (a 3D pizza-chef assistant), build a cart, pay, and watch the order
   being prepared.
2. **The staff/owner portal** — what the restaurant team uses. It replaces the counter
   till, the kitchen printer, the delivery board, the stock register and dozens of
   spreadsheets.
3. **The company office** — the part that runs the business behind the restaurant:
   departments, tasks, approvals, HR, finance, quality, training, marketing and so on.

All three read and write the same live data. When a customer orders, the kitchen, the
counter, the delivery rider, the stock count and the daily sales report all see the same
order.

---

## 2. The life of one order

Here is the simplest way to understand the whole system:

1. **A guest lands on the landing page.** They see today's menu, offers and opening hours.
   After a few seconds Blaze greets them in a small speech bubble; tapping it opens the
   concierge, and the **Ask Blaze** button is always there. A returning signed-in guest is
   greeted with what Blaze remembers, for example "Welcome back. Want the usual? I remember:
   no peanuts." The bubble can be dismissed and stays gone for that browser session.
2. **Blaze answers from the real menu.** Ask "something vegetarian under 300" and it
   recommends real items, adds one to the cart and opens checkout. It cannot invent a price
   or an offer.
3. **The cart is remembered.** If the guest refreshes or comes back later, the cart,
   pickup/delivery choice and coupon are still there, re-priced against the current menu.
4. **Checkout takes a name, phone, address (if delivery), time slot, tip and payment.**
   Coupons, loyalty points and gift cards can reduce the total. If a card covers
   everything, the order is marked paid immediately.
5. **The order goes to the kitchen.** It appears on the Kitchen Display Screen (KDS) with a
   timer. Cooks tap **Start**, then **Bump** when each item is ready.
6. **The counter or delivery team takes over.** A rider can open a private link on their
   phone, share GPS and capture proof of delivery before the order is marked delivered.
7. **The guest sees progress.** The tracking page refreshes by itself, shows each stage,
   counts down to a due time ("Arriving in ~35 min · Due by 3:24 PM"), says plainly when a
   delivery is running late, and puts the rider on a live map while the handoff is active.
   A signed-in guest can also just ask Blaze "where is my order?" and get that same page
   opened on the right order, without typing an order id, or say "Repeat my usual" to have
   Blaze rebuild their last order at today's prices.
8. **The books update.** The sale lands in daily sales, the dashboard, GST reports and the
   outlet profit-and-loss view without someone retyping it.
9. **The customer comes back.** Loyalty points, referrals, feedback and marketing journeys
   can bring them back.

That loop — order in, money in, stock down, report updated — is the heart of the product.
Everything else supports it.

---

## 3. The people and departments

Pizza Blitz is organised the way a real company is. There are **10 main departments**,
**Company shared services**, and **five sub-departments** that sit under a parent:

| Department | What it looks after | Example page |
|---|---|---|
| Executive Office | Goals, budget, company scorecard, reports, AI insights | `/departments/executive` |
| Operations | Counter, orders, kitchen board, checklists | `/departments/operations` |
| Kitchen & Menu | Menu, recipes, waste, menu engineering | `/departments/kitchen` |
| Supply Chain | Inventory, purchase orders, vendors, stocktakes | `/departments/supply` |
| Quality & Safety | Food-safety audits, temperature logs, corrective actions | `/departments/quality` |
| Finance & Accounts | Daily close, expenses, P&L, GST, outlet P&L | `/departments/finance` |
| People & HR | Recruitment, people, leave, attendance, payroll, exits | `/departments/hr` |
| Marketing & Brand | Campaigns, social, ads, journeys, landing content | `/departments/marketing` |
| Revenue & CRM | Customers, loyalty, gift cards, promotions, stores | `/departments/revenue` |
| Technology & Data | Settings, security, hardware, integrations, data exports | `/departments/technology` |

Sub-departments: **Guest Experience** (support, messaging, feedback under Operations),
**Facilities** (assets and repairs), **Legal** (licences and contracts), **Training**
(courses and certifications) and **Franchise** (new-site pipeline under Executive).
**Company** shared services hold the department directory, store profile and the work inbox.

Every department has a workspace with four things: a few numbers (KPIs), a **"Needs you"**
queue, the team, and the modules it owns. If a task or approval is waiting on you, it shows
up there and in **My work** (`/work`).

---

## 4. The 11 extra department tools

These are the newest working tools, all backed by real data:

| Tool | Plain-language job | Page |
|---|---|---|
| Daily checklists | Opening, closing and deep-clean sign-off | `/departments/operations/checklists` |
| Assets & maintenance | Register ovens/fridges, log breakdowns and repairs | `/departments/facilities/assets` |
| Menu engineering | Mark each dish a star, plough-horse, puzzle or dog | `/departments/kitchen/engineering` |
| Stocktake | Count stock, see the variance and correct the books | `/departments/supply/stocktake` |
| Audits & CAPA | Hygiene audits, findings and corrective actions | `/departments/quality/audits` |
| Licences & contracts | FSSAI/insurance renewals with expiry alerts | `/departments/legal/licences` |
| Training & certification | Courses, completion and expiry | `/departments/training/lms` |
| Gift cards | Issue, reload, redeem, refund and track liability | `/departments/revenue/gift-cards` |
| Budget & goals | Company goals and progress | `/departments/executive/budget` |
| Franchise pipeline | Sites from lead to opening | `/departments/franchise/pipeline` |
| Data platform | Freshness checks and CSV exports | `/departments/technology/data` |

A gift card works end to end: it can be bought/issued at the counter, checked by a guest,
used at checkout, and credited back on a refund.

---

## 5. Blaze, the talking assistant

Blaze is a 3D chef avatar on the landing page. It greets visitors in a small bubble, so
nobody has to guess that help is available, and it is not a video and does not invent
answers. It reads the live menu, offers and opening hours, then:

- answers questions ("what's vegetarian?", "when do you open?", "what offers are on?");
- tells a signed-in guest **where their order is** — the real kitchen state, ETA and rider —
  and opens the live tracking page for that exact order with one tap;
- **repeats a signed-in guest's last order.** "Repeat my usual" rebuilds those items at
  today's menu prices, keeps the sizes and extras they chose, leaves out anything since
  removed or hidden, and still warns about a saved allergy (the allergy is also shown again
  on the checkout page, above Place Order, and is written onto the order so the Kitchen
  Display shows a red allergy strip before anyone cooks or serves it);
- recommends dishes by budget, taste or popularity;
- adds or removes items with the right size/options;
- applies a coupon if given one;
- hands the finished cart to checkout.

It speaks using the browser's built-in voice and can listen with the browser's microphone.
If those are unavailable, the chat still works. An optional smarter language-model answer
path can be switched on with a provider key; without one, the assistant uses fixed rules
that are predictable and cannot make up prices.

---

## 6. Words people may use, explained simply

| Word | What it means here |
|---|---|
| **Frontend** | The part you see and click: the website and portal pages. |
| **Backend** | The part that decides and remembers: prices, orders, permissions, reports. |
| **API** | The waiter between frontend and backend. The frontend asks; the API answers with data. |
| **REST** | A common style of API where each thing has a URL and an action (GET, POST, PATCH, DELETE). |
| **Database** | The filing cabinet. Orders, menu, staff and stock live here. |
| **SQLite / Postgres** | Two kinds of database. SQLite is a single file for local use; Postgres is the production server. |
| **Migration** | A recipe for changing the filing cabinet's drawers without losing the files. |
| **Session / cookie** | A small badge the browser shows after login so you are not asked every time. |
| **Webhook** | A doorbell another service rings when something happens (e.g. a payment succeeds). |
| **Provider** | An outside company such as a payment gateway, WhatsApp or an SMS service. |
| **Environment variable** | A setting kept outside the code, like a password or a URL. |
| **Build** | Turning the source code into the fast files a server can run. |
| **Deploy** | Putting the built app on a computer on the internet. |
| **TTS** | Text-to-speech: a computer reading words aloud. Blaze uses the browser's TTS. |
| **SSH** | A secure remote terminal for logging into a server. Not needed to use the app. |
| **Git** | A history of code changes. This project has one but nothing new was committed. |
| **SRE** | Site reliability engineering: keeping a live service healthy. Relevant only after deploy. |
| **Vite / Gin / etcd / Azure** | Other tools from other projects. Pizza Blitz does not use them. |

---

## 7. Run it on your own computer

You need Python 3.11+, Node 20+ and npm. Two terminals.

**Terminal 1 — the backend (the brain):**

```powershell
cd backend
python -m pip install -r requirements.txt
$env:SQLALCHEMY_DATABASE_URI = "sqlite:///./pizza_blitz.db"
$env:PIZZA_BLITZ_ADMIN_ID = "admin"
$env:PIZZA_BLITZ_ADMIN_PASSWORD = "admin123"
$env:PIZZA_BLITZ_STAFF_ID = "staff"
$env:PIZZA_BLITZ_STAFF_PASSWORD = "staff123"
$env:BACKEND_CORS_ORIGINS = "http://localhost:3011,http://127.0.0.1:3011"
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

**Terminal 2 — the frontend (the face):**

```powershell
cd frontend
npm install
npm run build
npm start -- --hostname 127.0.0.1 --port 3011
```

Open `http://localhost:3011`. The customer site is the landing page; sign in at
`/login` with `admin` / `admin123` for the office, or `staff` / `staff123` for the counter.
These are development defaults and are rejected in production.

The server listens only on your own machine. Typing `http://127.0.0.1:3011` reaches the same
app, and the server answers either spelling with the name `localhost`, so every address and
script in this project uses `localhost` and the browser policy still allows both names.

If you only want to change code while you work, use `npm run dev` instead of
`npm run build` + `npm start`.

---

## 8. A 15-minute tour

1. Open the landing page. Scroll the live menu and tap **Ask Blaze**. Ask for a
   vegetarian recommendation, add it, then open checkout.
2. Place a pickup order. Use the confirmation page to open tracking.
3. Sign in as `staff` and open `/kds`. Find the order, press **Start**, then **Bump**.
4. Sign in as `admin`. Open `/orders`, find the order, print or view the receipt.
5. Open `/departments` to see the company scorecard, then click Operations.
6. Open `/work` and create a task; move it to In progress.
7. Open `/departments/revenue/gift-cards`, issue a Rs 500 card, then try it at checkout.
8. Open `/departments/kitchen/engineering` and `/departments/quality/audits` to see the
   operating tools.
9. Open `/reports` and `/finance/pnl` to see the same order in the books.

---

## 9. What is real, what is gated, what is not built

**Real and working locally:** ordering, payments recorded manually or through gift
cards/coupons, kitchen display, delivery and rider proof, inventory, purchasing, recipes,
HR end to end, marketing/journeys, support, gift cards, the department tools, the assistant,
reports, GST and the company OS.

**Real but gated on credentials:** live card payments, WhatsApp/SMS/email sending, Instagram
publishing, ad launches, S3/CDN media, PagerDuty paging and live maps. Without credentials
they say "not configured" instead of pretending. The AI insights page is a good example: with
no model key it still shows a summary and tips, but they are arithmetic on your own 30-day
sales and stock numbers, labelled as standard guidance rather than AI output.

**Not built / not claimed:** a live production URL, a double-entry accounting ledger,
physical gift cards, certified e-signature, statutory payroll filing, hosted voice/telephony
ordering, biometric clock-in, offline/PWA and multi-language menus.

**Deliberately not invented:** the restaurant's real address, phone number, FSSAI number,
opening hours, reviews and analytics IDs. The store profile has placeholders/empty fields
until the owner supplies the real values.

**A guard you will meet on launch day:** the local app keeps its data in a temporary
database that lives only in memory, which is perfect for a laptop and wrong for a
restaurant. So the server refuses to start with a production setting unless it is given a
real Postgres database address and strong passwords. The refusal names the missing setting
in the error, and the deployment page in the portal has a row called "Database survives a
restart" that says plainly when the current database would forget everything. This is
deliberate: a server that starts anyway and quietly loses a dinner service is worse than
one that stops and tells you why.

---

## 10. How to prove it works

From `backend/`:

```powershell
python -W error::FutureWarning -m unittest discover -s tests -v
ruff check .        # or: uvx ruff check .   if ruff is not installed globally
```

From `frontend/` (with both servers running):

```powershell
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run verify:audit
```

The full audit opens a browser and checks the landing page, customer order, Blaze,
gift cards, 11 department tools, HR, support and the rest. Expect it to take several
minutes. A deployment-only check is separate: `npm run verify:deployment`.

---

## 11. Where things live

```text
backend/   FastAPI app, database models, migrations, tests
frontend/  Next.js website and portal, browser proofs in e2e/
docs/      beginner guide, blueprint, verification, gap audit, runbook, access
ROADMAP.md the phase-by-phase history and what is open
HANDOVER.md the technical handover for the next team
DEPLOY_REQUEST.md exactly what is needed to put it online
```

Logins and role entry points: [ACCESS.md](ACCESS.md).
Every verification gate: [VERIFICATION.md](VERIFICATION.md).
Deployment steps: [LAUNCH_RUNBOOK.md](LAUNCH_RUNBOOK.md).

---

## 12. Three rules that keep the project honest

1. **Do not invent restaurant facts.** Address, phone, FSSAI, hours, reviews and analytics
   IDs come from the owner, not from imagination.
2. **Do not fake an integration.** If a provider is not configured, the screen says so and
   the delivery record says "skipped".
3. **Do not claim a deployment that did not happen.** A live URL is only real when it
   actually answers on the internet; see [DEPLOY_REQUEST.md](../DEPLOY_REQUEST.md).
