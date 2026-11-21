import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp, useLoad } from '../lib/store';
import { rpc, uuid, signOut, resetDemo, queued, discardQueued, flushQueue } from '../lib/backend';
import { LANGS } from '../lib/i18n';
import { addDays, dateLong, todayISO } from '../lib/format';
import { Screen, Icon, Loader, ErrorBox, Empty, Chips, Sheet, SaveButton, Field, AmountInput } from '../ui';

export const EXP_CATS = ['rent', 'electricity', 'salary', 'transport', 'purchases', 'maintenance', 'misc'] as const;
const EXP_ICON: Record<string, string> = { rent: 'home', electricity: 'sparkle', salary: 'user', transport: 'trend', purchases: 'box', maintenance: 'settings', misc: 'tag' };

export function More() {
  const { t, business, demo, pending } = useApp();
  const items = [
    { to: '/expenses', icon: 'expense', label: t('more.expenses'), sub: t('more.expensesSub') },
    { to: '/sales', icon: 'sale', label: t('more.salesHistory'), sub: t('more.salesSub') },
    { to: '/khata?f=overdue', icon: 'clock', label: t('more.reminders'), sub: t('more.remindersSub') },
    { to: '/more/settings', icon: 'settings', label: t('more.settings'), sub: t('more.settingsSub') },
    ...(pending ? [{ to: '/more/sync', icon: 'cloud', label: t('sync.title'), sub: t('sync.pending', { n: pending }) }] : []),
  ];
  const soon = [t('soon.suppliers'), t('soon.reports'), t('soon.exports'), t('soon.staff'), t('soon.barcode')];
  return (
    <Screen title={t('nav.more')}>
      <div className="biz-card">
        <div><b>{business!.name}</b><span className="muted small">{t(('cat.' + business!.category) as any)} · {business!.currency} · {t(('role.' + business!.role) as any)}</span></div>
        {demo && <span className="badge amber">{t('more.demo')}</span>}
      </div>
      <div className="card flush">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="row">
            <span className="row-main"><span className="menu-icon"><Icon name={i.icon} size={20} /></span><span><b>{i.label}</b><span className="muted small">{i.sub}</span></span></span>
            <Icon name="chev" className="flip-rtl muted" />
          </Link>
        ))}
      </div>
      <div className="card">
        <h3>{t('more.comingSoon')}</h3>
        <div className="chips wrap">{soon.map((s) => <span key={s} className="chip ghost">{s}</span>)}</div>
      </div>
      <p className="footnote center">HisabEasy v1.0 · {t('app.tagline')}</p>
    </Screen>
  );
}

// ── expenses ─────────────────────────────────────────────────────────────────────
export function Expenses() {
  const { t, business, money, lang, canManage, toast, bump, errorText } = useApp();
  const today = todayISO(business!.timezone);
  const [range, setRange] = useState<'today' | 'week' | 'month'>('month');
  const from = range === 'today' ? today : range === 'week' ? addDays(today, -6) : today.slice(0, 8) + '01';
  const { data, error, loading } = useLoad(() => rpc<any[]>('list_expenses', { p_business: business!.id, p_from: from, p_to: today }), [range]);
  const [cancel, setCancel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const active = (data || []).filter((e) => e.status === 'active');
  const total = active.reduce((a, e) => a + Number(e.amount), 0);
  const byCat = EXP_CATS.map((c) => ({ c, v: active.filter((e) => e.category === c).reduce((a, e) => a + Number(e.amount), 0) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);

  async function doCancel() {
    try { await rpc('cancel_expense', { p_business: business!.id, p_expense: cancel.id, p_reason: reason }); setCancel(null); setReason(''); bump(); toast(t('exp.cancelled')); }
    catch (e) { toast(errorText(e), 'err'); }
  }

  return (
    <Screen title={t('more.expenses')} back right={<Link to="/expenses/new" className="btn primary sm"><Icon name="plus" size={18} /> {t('common.add')}</Link>}>
      <Chips value={range} onChange={setRange} options={[{ value: 'today', label: t('range.today') }, { value: 'week', label: t('range.week') }, { value: 'month', label: t('range.month') }]} />
      <div className="khata-hero red"><span>{t('exp.total')}</span><b>{money(total)}</b></div>
      {byCat.length > 0 && (
        <div className="card">
          {byCat.map(({ c, v }) => (
            <div key={c} className="bar-row">
              <span>{t(('exp.' + c) as any)}</span>
              <div className="bar"><div style={{ width: `${(v / byCat[0].v) * 100}%` }} /></div>
              <b>{money(v)}</b>
            </div>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      {loading && !data ? <Loader /> : data && data.length === 0 ? (
        <Empty icon="expense" title={t('exp.none')} action={<Link to="/expenses/new" className="btn primary">{t('qa.expense')}</Link>} />
      ) : (
        <div className="card flush">
          {data!.map((e) => (
            <button key={e.id} className={'row' + (e.status !== 'active' ? ' struck' : '')} onClick={() => canManage && e.status === 'active' && setCancel(e)}>
              <span className="row-main"><span className="menu-icon red"><Icon name={EXP_ICON[e.category]} size={18} /></span>
                <span><b>{t(('exp.' + e.category) as any)}</b><span className="muted small">{dateLong(e.expense_date, lang, business!.currency)} · {t(('pm.' + e.method) as any)}{e.note ? ` · ${e.note}` : ''}</span></span></span>
              <span className="row-amount red">{money(e.amount)}</span>
            </button>
          ))}
        </div>
      )}
      <Sheet open={!!cancel} onClose={() => setCancel(null)} title={t('exp.cancelTitle')}>
        {cancel && <p className="muted">{t(('exp.' + cancel.category) as any)} · {money(cancel.amount)}</p>}
        <Field label={t('common.reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        <SaveButton onClick={doCancel} disabled={reason.trim().length < 3} className="btn danger block">{t('exp.cancelTitle')}</SaveButton>
      </Sheet>
    </Screen>
  );
}

export function AddExpense() {
  const { t, business, toast, bump, errorText } = useApp();
  const nav = useNavigate();
  const today = todayISO(business!.timezone);
  const [cat, setCat] = useState<string>('misc');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [ref] = useState(uuid);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setError(null);
    try {
      const r = await rpc<any>('record_expense', { p_business: business!.id, p_client_ref: ref, p_category: cat, p_amount: Number(amount), p_date: date, p_method: method, p_note: note.trim() || null });
      bump(); toast(r?.queued ? t('sync.savedOffline') : t('exp.saved')); nav(-1);
    } catch (e) { setError(e); toast(errorText(e), 'err'); }
  }

  return (
    <Screen title={t('qa.expense')} back>
      <div className="tile-grid">
        {EXP_CATS.map((c) => (
          <button key={c} className={'tile' + (cat === c ? ' on red' : '')} onClick={() => setCat(c)}><Icon name={EXP_ICON[c]} /><span>{t(('exp.' + c) as any)}</span></button>
        ))}
      </div>
      {cat === 'purchases' && <p className="muted small">{t('exp.purchasesNote')}</p>}
      <div className="card">
        <Field label={t('sales.amount')}><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
        <div className="method-grid four">
          {['cash', 'upi', 'bank', 'card'].map((m) => <button key={m} className={'method' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>{t(('pm.' + m) as any)}</button>)}
        </div>
        <Field label={t('common.date')}><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('common.note')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('exp.notePh')} /></Field>
      </div>
      <ErrorBox error={error} />
      <SaveButton onClick={save} disabled={!(Number(amount) > 0)}>{t('exp.save')}</SaveButton>
    </Screen>
  );
}

// ── settings ─────────────────────────────────────────────────────────────────────
export function Settings() {
  const { t, business, businesses, lang, setLang, reload, toast, demo, errorText } = useApp();
  const nav = useNavigate();
  const isOwner = business!.role === 'owner';
  const usage = useLoad(() => rpc<any>('plan_usage', { p_business: business!.id }), []);
  const [name, setName] = useState(business!.name);
  const [phone, setPhone] = useState(business!.phone || '');
  const [address, setAddress] = useState(business!.address || '');
  const [tax, setTax] = useState(String(Number(business!.tax_rate) || ''));
  const [track, setTrack] = useState(business!.track_inventory);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setError(null);
    try {
      const tr = Number(tax) || 0;
      if (tr < 0 || tr > 100) throw new Error(t('set.badTax'));
      await rpc('update_business', { p_business: business!.id, p_patch: { name: name.trim(), phone, address, tax_rate: tr, track_inventory: track, language: lang } });
      await reload(); toast(t('common.saved'));
    } catch (e) { setError(e); }
  }

  async function switchTo(id: string) {
    try { await rpc('set_active_business', { p_business: id }); await reload(); nav('/'); } catch (e) { toast(errorText(e), 'err'); }
  }

  const u = usage.data;
  const lim = u?.plan?.limits || {};
  return (
    <Screen title={t('more.settings')} back>
      <div className="card">
        <h3><Icon name="globe" size={18} /> {t('set.language')}</h3>
        <div className="chips wrap">
          {LANGS.map((l) => <button key={l.code} disabled={!l.ready} className={'chip' + (lang === l.code ? ' on' : '')} onClick={() => setLang(l.code)}>{l.native}{!l.ready ? ` · ${t('common.soon')}` : ''}</button>)}
        </div>
      </div>

      <div className="card">
        <h3>{t('set.business')}</h3>
        <Field label={t('onb.nameQ')}><input value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('set.phone')} hint={t('set.onReceipt')}><input type="tel" value={phone} disabled={!isOwner} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label={t('set.address')}><input value={address} disabled={!isOwner} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label={t('set.tax')} hint={t('set.taxHint')}>
          <input inputMode="decimal" value={tax} disabled={!isOwner} placeholder="0" onChange={(e) => /^\d{0,3}(\.\d{0,2})?$/.test(e.target.value) && setTax(e.target.value)} />
        </Field>
        <label className="toggle-row compact"><span><b>{t('set.inventory')}</b><br /><span className="muted small">{t('set.inventoryHint')}</span></span>
          <input type="checkbox" className="switch" disabled={!isOwner} checked={track} onChange={(e) => setTrack(e.target.checked)} /></label>
        <ErrorBox error={error} />
        {isOwner ? <SaveButton onClick={save}>{t('common.save')}</SaveButton> : <p className="muted small">{t('set.ownerOnly')}</p>}
      </div>

      <div className="card">
        <h3>{t('set.plan')}: {u?.plan?.name || '—'}</h3>
        {!u ? <Loader /> : (
          <div className="usage">
            <div><span>{t('set.customers')}</span><b>{u.customers}{lim.max_customers ? ` / ${lim.max_customers}` : ''}</b></div>
            <div><span>{t('set.products')}</span><b>{u.products}{lim.max_products ? ` / ${lim.max_products}` : ''}</b></div>
            <div><span>{t('set.users')}</span><b>{u.users}{lim.max_users ? ` / ${lim.max_users}` : ''}</b></div>
          </div>
        )}
        <p className="muted small">{t('set.planNote')}</p>
      </div>

      {businesses.length > 1 && (
        <div className="card flush">
          <div className="card-head pad"><h3>{t('set.switch')}</h3></div>
          {businesses.map((b) => (
            <button key={b.id} className="row" onClick={() => switchTo(b.id)} disabled={b.id === business!.id}>
              <span className="row-main"><b>{b.name}</b></span>{b.id === business!.id && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
      <Link to="/onboarding/new" className="btn ghost block">{t('set.addBusiness')}</Link>
      {demo && <button className="btn ghost block" onClick={() => setConfirmReset(true)}>{t('set.resetDemo')}</button>}
      <button className="btn danger-ghost block" onClick={async () => { await signOut(); await reload(); nav('/'); }}><Icon name="logout" size={18} /> {demo ? t('set.exitDemo') : t('set.signOut')}</button>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title={t('set.resetDemo')}>
        <p className="muted">{t('set.resetExplain')}</p>
        <SaveButton className="btn danger block" onClick={async () => { await resetDemo(); await reload(); nav('/'); }}>{t('set.resetDemo')}</SaveButton>
      </Sheet>
    </Screen>
  );
}

export function SyncQueue() {
  const { t, bump } = useApp();
  const [items, setItems] = useState(queued());
  const refresh = () => setItems(queued());
  return (
    <Screen title={t('sync.title')} back>
      <p className="muted">{t('sync.explain')}</p>
      {items.length === 0 ? <Empty icon="check" title={t('sync.allDone')} /> : (
        <div className="card flush">
          {items.map((q, i) => (
            <div key={i} className="row static">
              <span className="row-main"><span><b>{t(('sync.fn.' + q.fn) as any)}</b>
                <span className="muted small">{new Date(q.at).toLocaleString()}</span>
                {q.error && <span className="red small">{q.error}</span>}</span></span>
              {q.error && <button className="btn link" onClick={() => { discardQueued(i); refresh(); }}>{t('common.remove')}</button>}
            </div>
          ))}
        </div>
      )}
      <SaveButton onClick={async () => { await flushQueue(); refresh(); bump(); }}>{t('sync.now')}</SaveButton>
    </Screen>
  );
}
