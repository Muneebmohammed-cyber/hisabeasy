# HisabEasy – Small Business Assistant

*Your Business. Your Hisab. One Easy App.*

A mobile-first PWA for small shops (Kerala first, UAE next): sales, digital khata (udhar), payments,
WhatsApp reminders, stock, expenses and a five-second dashboard, in Malayalam, English and Hindi.

## What's in Phase 1

| Area | Done |
| --- | --- |
| Onboarding | Email sign-up, business name, category, language, currency (INR/AED), optional sample data |
| Dashboard | Today's sales, cash received, expenses, profit estimate, dues to collect, low stock, overdue reminders, recent activity, 6 quick actions |
| Sales | Tap-to-add products or quick amount, discount, tax, cash/UPI/card/bank/credit, part payment, receipt with WhatsApp share + print, history, cancel with reason (owner/manager) |
| Khata | Customers, credit sales, manual credit, payments, due dates, overdue (oldest-first), ledger with running balance, statement share, WhatsApp reminder, credit limit, opening balance, reversals |
| Inventory | Products with prices/units/SKU/barcode, auto deduction on sale, stock in, adjustments, damage, movement history, low/out alerts; can be switched off |
| Expenses | 7 categories, method, date, note, cancel, monthly breakdown |
| Platform | Supabase Postgres with RLS per business, roles, audit log, idempotent writes, offline queue, configurable plans, PWA install |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 – "Try the demo shop" works with no backend
npm run build        # production build in dist/
```

**Demo mode** runs the real database code in the browser (PGlite), so it behaves exactly like production.

## Connect Supabase (cloud accounts)

1. Create a project at supabase.com (region: Mumbai `ap-south-1` for Kerala users).
2. SQL Editor → run, in order: `supabase/migrations/001_schema.sql`, `002_functions.sql`, `003_demo_seed.sql`.
3. Authentication → Providers → Email: on. (Turn "Confirm email" off while testing if you like.)
4. Project Settings → API: copy the **Project URL** and **anon public key** into `public/config.js`.
   (The anon key is meant to be public; all data is protected by sign-in + row-level security.)
5. Rebuild / redeploy. The welcome screen now shows *Create free account*.

## Deploy on GitHub Pages

1. Create a repo (e.g. `hisabeasy`) and upload this folder (without `node_modules`).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` builds, runs the database smoke test and publishes to
   `https://<user>.github.io/hisabeasy/`. Open it on Android → menu → *Install app*.

## Tests

```bash
npm run test:pglite   # migrations + demo seed inside PGlite
npm run test:db       # 78 API checks on PostgreSQL 16 (needs a local server on port 5544, see tests/load.sh)
python3 tests/e2e.py  # browser run at phone size against `npm run preview`
```

## Money rules

- `numeric(14,2)` money, `numeric(14,3)` quantities; totals recomputed on the server.
- Balances are never typed: a customer's balance is the sum of their ledger lines.
- Bills, payments, ledger and stock lines can't be edited or deleted; cancel/reverse adds a new line, and every change lands in `audit_log`.
- Every write carries a `client_ref` UUID, so a retry or offline replay never double-counts.

## Layout

```
supabase/migrations/   schema, API functions, demo seed
src/lib/               backend (Supabase / PGlite), i18n, formatting, app state
src/screens/           Auth, Home, Sales, Khata, Inventory, More
tests/                 SQL tests, PGlite smoke test, browser E2E
```
