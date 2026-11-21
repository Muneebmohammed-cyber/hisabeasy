// One API for the whole app: every call is a named Postgres function.
// cloud → Supabase RPC; demo → the same SQL running in PGlite inside the browser.
import type { SupabaseClient } from '@supabase/supabase-js';

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

declare global {
  interface Window { HISAB_CONFIG?: { neonUrl?: string; supabaseUrl?: string; supabaseAnonKey?: string } }
}

const cfg = window.HISAB_CONFIG || {};
const SUPABASE_URL = cfg.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = cfg.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const NEON_URL = (cfg.neonUrl || import.meta.env.VITE_NEON_URL || '').trim().replace(/\/$/, '');
export const cloudProvider: 'neon' | 'supabase' | null = NEON_URL ? 'neon' : SUPABASE_URL && SUPABASE_KEY ? 'supabase' : null;
export const cloudConfigured = cloudProvider !== null;

export type Mode = 'cloud' | 'demo';
const MODE_KEY = 'hisab.mode';
export function getMode(): Mode | null { return (localStorage.getItem(MODE_KEY) as Mode) || null; }
export function setMode(m: Mode | null) { m ? localStorage.setItem(MODE_KEY, m) : localStorage.removeItem(MODE_KEY); }

// ── cloud: Neon (Data API + Neon Auth) or Supabase — same Supabase-style client either way ──
let sb: Promise<SupabaseClient> | null = null;
/** Loaded on demand so the demo and first paint don't download either SDK. */
export function cloud(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new ApiError('CONFIG', 'Cloud is not configured yet'));
  if (!sb) {
    sb = cloudProvider === 'neon'
      ? import('@neon/neon-js/supabase').then((m) => m.createClient(NEON_URL) as unknown as SupabaseClient)
      : import('@supabase/supabase-js').then((m) => m.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } }));
  }
  return sb;
}

// ── demo (PGlite) ─────────────────────────────────────────────────────────────
const DEMO_UID = '00000000-0000-4000-8000-00000000d3e0';
type PG = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>; exec: (sql: string) => Promise<unknown> };
let demoDb: Promise<PG> | null = null;

async function openDemo(): Promise<PG> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = (await PGlite.create('idb://hisabeasy-demo')) as unknown as PG;
  const ready = await db.query(`select to_regclass('public.businesses') is not null as ok`);
  if (!ready.rows[0].ok) {
    const sql = import.meta.glob(['../../tests/supabase_stub.sql', '../../supabase/migrations/*.sql'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const order = Object.keys(sql).sort((a, b) => (a.includes('stub') ? -1 : b.includes('stub') ? 1 : a.localeCompare(b)));
    for (const k of order) await db.exec(sql[k]);
    await db.exec(`insert into auth.users(id, email) values ('${DEMO_UID}', 'demo@hisabeasy.app') on conflict do nothing`);
  }
  await db.exec(`select set_config('request.jwt.claim.sub', '${DEMO_UID}', false); set role authenticated;`);
  return db;
}

export async function resetDemo() {
  if (demoDb) { try { const db: any = await demoDb; await db.close?.(); } catch { /* ignore */ } }
  demoDb = null;
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('/pglite/hisabeasy-demo'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

// ── rpc ─────────────────────────────────────────────────────────────────────────
function isNetworkError(e: any) {
  const m = String(e?.message || e || '');
  return !navigator.onLine || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m);
}

async function rawRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const mode = getMode();
  if (mode === 'demo') {
    if (!demoDb) demoDb = openDemo();
    const db = await demoDb;
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    const params = keys.map((k) => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    try {
      const res = await db.query(sql, params);
      return res.rows[0]?.r as T;
    } catch (e: any) {
      throw new ApiError(e.code || 'DB', e.message || 'Something went wrong');
    }
  }
  const { data, error } = await (await cloud()).rpc(fn, args);
  if (error) {
    if (isNetworkError(error)) throw new ApiError('OFFLINE', error.message);
    throw new ApiError(error.code || 'DB', error.message);
  }
  return data as T;
}

// ── offline queue (cloud only): writes keyed by client_ref replay safely ────────
const QUEUE_KEY = 'hisab.queue';
const QUEUEABLE = new Set(['record_sale', 'record_payment', 'add_credit', 'record_expense', 'adjust_stock']);
type Queued = { fn: string; args: Record<string, unknown>; at: number; error?: string };
export function queued(): Queued[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function saveQueue(q: Queued[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); window.dispatchEvent(new Event('hisab-queue')); }

let flushing = false;
export async function flushQueue(): Promise<number> {
  if (flushing || getMode() !== 'cloud' || !navigator.onLine) return 0;
  flushing = true;
  let done = 0;
  try {
    const q = queued();
    const keep: Queued[] = [];
    for (const item of q) {
      if (item.error) { keep.push(item); continue; }
      try { await rawRpc(item.fn, item.args); done++; }
      catch (e: any) {
        if (e.code === 'OFFLINE') { keep.push(item, ...q.slice(q.indexOf(item) + 1)); break; }
        keep.push({ ...item, error: e.message });   // server said no: keep it visible, never drop silently
      }
    }
    saveQueue(keep);
  } finally { flushing = false; }
  return done;
}
export function discardQueued(index: number) { const q = queued(); q.splice(index, 1); saveQueue(q); }
window.addEventListener('online', () => { flushQueue(); });

export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rawRpc<T>(fn, args);
  } catch (e: any) {
    if (e.code === 'OFFLINE' && QUEUEABLE.has(fn) && args.p_client_ref) {
      saveQueue([...queued(), { fn, args, at: Date.now() }]);
      return { queued: true } as T;
    }
    throw e;
  }
}

export const uuid = () => crypto.randomUUID();

// ── auth ────────────────────────────────────────────────────────────────────────
export async function currentSession(): Promise<unknown | 'demo' | null> {
  const mode = getMode();
  if (mode === 'demo') return 'demo';
  if (mode === 'cloud' && cloudConfigured) {
    try {
      const { data } = await (await cloud()).auth.getSession();
      return data?.session ?? null;
    } catch { return null; }
  }
  return null;
}
export async function signOut() {
  if (getMode() === 'cloud' && cloudConfigured) await (await cloud()).auth.signOut();
  setMode(null);
}
