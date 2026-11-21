// Runs the production migrations inside PGlite (Postgres in WASM) — the engine used by demo mode.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
const db = new PGlite();
const files = ['tests/supabase_stub.sql', ...readdirSync('supabase/migrations').sort().map(f => 'supabase/migrations/' + f)];
for (const f of files) await db.exec(readFileSync(f, 'utf8'));
const uid = '00000000-0000-0000-0000-0000000000d1';
await db.exec(`insert into auth.users(id) values ('${uid}'); select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
const t0 = Date.now();
const b = (await db.query(`select public.create_business(p_name => $1, p_currency => 'INR', p_with_demo => true) as r`, ['Demo'])).rows[0].r;
const d = (await db.query(`select public.dashboard_summary(p_business => $1) as r`, [b.id])).rows[0].r;
console.log('seed ms', Date.now() - t0, 'sales today', d.sales_total, 'outstanding', d.customer_outstanding, 'overdue', d.overdue_count);
if (d.sales_count !== 5) throw new Error('unexpected');
console.log('PGLITE OK');
