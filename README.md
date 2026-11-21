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
| Platform | PostgreSQL (Neon or Supabase) with RLS per business, roles, audit log, idempotent writes, offline queue, configurable plans, PWA install |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 – "Try the demo shop" works with no backend
npm run build        # production build in dist/
```

**Demo mode** runs the real database code in the browser (PGlite), so it behaves exactly like production.

## Connect a cloud database (Neon – recommended, free)

Neon's free plan allows 100 projects (Supabase allows 2), scales to zero when idle and runs the same SQL.

1. Sign up at neon.com → **New project** `hisabeasy`, Postgres 17+, region nearest your users (Asia Pacific).
2. In the project: **Auth** → enable Neon Auth (email + password).
3. **Data API** → enable it, choose **Neon Auth** as the provider, expose schema `public`.
   (Do this before step 4 — it creates the `authenticated` and `anonymous` roles the SQL grants to.)
4. **SQL Editor** → run, in order: `supabase/migrations/001_schema.sql`, `002_functions.sql`, `003_demo_seed.sql`.
5. Copy the project's base URL (Data API page, e.g. `https://ep-xxx.ap-southeast-1.aws.neon.tech/neondb`)
   into `neonUrl` in `public/config.js`, commit, and the site redeploys. The welcome screen now shows *Create free account*.

The same SQL also runs on Supabase: put `supabaseUrl` + `supabaseAnonKey` in `config.js` instead.

## Deploy on GitHub Pages

1. Create a repo (e.g. `hisabeasy`) and upload this folder (without `node_modules`).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` builds, runs the database smoke test and publishes to
   `https://<user>.github.io/hisabeasy/`. Open it on Android → menu → *Install app*.

## Tests

```bash
npm run test:pglite   # migrations + demo seed inside PGlite
bash tests/neon_sim.sh # Neon-style roles + non-UUID auth ids
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
