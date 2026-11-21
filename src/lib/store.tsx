import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { rpc, currentSession, getMode, flushQueue, queued, ApiError } from './backend';
import { makeT, type Lang, isRtl } from './i18n';
import { money as fmtMoney } from './format';

export type Business = {
  id: string; name: string; category: string; currency: 'INR' | 'AED'; language: Lang; timezone: string;
  tax_rate: number; track_inventory: boolean; phone?: string | null; address?: string | null; role: string; plan_code: string;
};

type Ctx = {
  ready: boolean; signedIn: boolean; demo: boolean;
  business: Business | null; businesses: Business[];
  lang: Lang; setLang: (l: Lang) => void;
  t: ReturnType<typeof makeT>;
  money: (v: any, o?: { sign?: boolean; compact?: boolean }) => string;
  reload: () => Promise<void>;
  tick: number; bump: () => void;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  toastMsg: { msg: string; kind: 'ok' | 'err' } | null;
  pending: number;
  canManage: boolean;
  errorText: (e: unknown) => string;
};

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [business, setBusiness] = useState<Business | null>(null);
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('hisab.lang') as Lang) || 'en');
  const [tick, setTick] = useState(0);
  const [toastMsg, setToast] = useState<Ctx['toastMsg']>(null);
  const [pending, setPending] = useState(queued().length);

  const setLang = useCallback((l: Lang) => { setLangState(l); localStorage.setItem('hisab.lang', l); }, []);
  const t = useMemo(() => makeT(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
    document.body.dataset.lang = lang;
  }, [lang]);

  const reload = useCallback(async () => {
    const s = await currentSession();
    if (!s) { setSignedIn(false); setBusinesses([]); setBusiness(null); setReady(true); return; }
    setSignedIn(true);
    try {
      const list = await rpc<Business[]>('my_businesses');
      setBusinesses(list);
      const active = list.find((b: any) => b.is_active) || list[0] || null;
      setBusiness(active);
    } catch { setBusinesses([]); setBusiness(null); }
    setReady(true);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onQ = () => setPending(queued().length);
    window.addEventListener('hisab-queue', onQ);
    const iv = setInterval(() => flushQueue().then((n) => n && setTick((x) => x + 1)), 20000);
    flushQueue();
    return () => { window.removeEventListener('hisab-queue', onQ); clearInterval(iv); };
  }, []);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind }); setTimeout(() => setToast(null), 2600);
  }, []);

  const errorText = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.code === 'OFFLINE') return t('err.offline');
      const key = 'srv.' + e.message;
      const tr = t(key as any);
      return tr === key ? e.message : tr;
    }
    return String((e as any)?.message || e);
  }, [t]);

  const value: Ctx = {
    ready, signedIn, demo: getMode() === 'demo', business, businesses, lang, setLang, t,
    money: (v, o) => fmtMoney(v, business?.currency || 'INR', o),
    reload, tick, bump: () => setTick((x) => x + 1), toast, toastMsg, pending,
    canManage: business?.role === 'owner' || business?.role === 'manager',
    errorText,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Load data for a screen; reloads whenever `tick` changes or deps change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { tick } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } })
        .catch((e) => alive && setError(e))
        .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, loading, setData };
}
