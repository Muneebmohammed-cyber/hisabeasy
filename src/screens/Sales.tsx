import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useLoad } from '../lib/store';
import { rpc, uuid } from '../lib/backend';
import { addDays, dateLong, dateShort, qty as fmtQty, round2, timeShort, todayISO, waLink } from '../lib/format';
import { Screen, Icon, Loader, ErrorBox, Empty, Chips, SearchBox, Sheet, SaveButton, Field, AmountInput } from '../ui';
import { CustomerPicker, type CustomerLite } from './Khata';

type Product = { id: string; name: string; selling_price: number; purchase_price: number; stock_qty: number; unit: string; track_stock: boolean; stock_status: string; category: string | null };
type Line = { key: string; product_id?: string; name: string; qty: number; unit_price: number; unit?: string; stock?: number; tracked?: boolean };
type Method = 'cash' | 'upi' | 'card' | 'bank' | 'credit';

// ── list ─────────────────────────────────────────────────────────────────────────
export function SalesList() {
  const { t, business, money, lang } = useApp();
  const tz = business!.timezone;
  const today = todayISO(tz);
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const from = range === 'today' ? today : range === 'week' ? addDays(today, -6) : range === 'month' ? today.slice(0, 8) + '01' : null;
  const { data, error, loading } = useLoad(() => rpc<any[]>('list_sales', { p_business: business!.id, p_from: from, p_to: null, p_limit: 300 }), [range]);
  const active = (data || []).filter((s) => s.status === 'active');
  const total = active.reduce((a, s) => a + Number(s.total), 0);
  const credit = active.reduce((a, s) => a + Number(s.credit_amount), 0);

  let lastDate = '';
  return (
    <Screen title={t('nav.sales')} right={<Link to="/sales/new" className="btn primary sm"><Icon name="plus" size={18} /> {t('qa.sale')}</Link>}>
      <Chips value={range} onChange={setRange} options={[
        { value: 'today', label: t('range.today') }, { value: 'week', label: t('range.week') },
        { value: 'month', label: t('range.month') }, { value: 'all', label: t('range.all') }]} />
      <div className="stat-strip">
        <div><span>{t('sales.total')}</span><b>{money(total)}</b></div>
        <div><span>{t('sales.bills')}</span><b>{active.length}</b></div>
        <div><span>{t('sales.onCredit')}</span><b className="amber">{money(credit)}</b></div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loader /> : data && data.length === 0 ? (
        <Empty icon="sale" title={t('sales.none')} sub={t('sales.noneSub')} action={<Link to="/sales/new" className="btn primary">{t('qa.sale')}</Link>} />
      ) : (
        <div className="card flush">
          {data!.map((s) => {
            const head = s.sale_date !== lastDate ? (lastDate = s.sale_date) : null;
            return (
              <div key={s.id}>
                {head && <div className="list-date">{dateLong(head, lang, business!.currency)}</div>}
                <Link to={`/sales/${s.id}`} className={'row' + (s.status !== 'active' ? ' struck' : '')}>
                  <span className="row-main"><span>
                    <b>#{s.invoice_no} · {s.customer_name || t('sales.walkIn')}</b>
                    <span className="muted small">{t('sales.items', { n: s.item_count })} · {t(('pm.' + s.payment_method) as any)} · {timeShort(s.created_at, lang, business!.currency)}</span>
                  </span></span>
                  <span className="row-end">
                    <span className="row-amount">{money(s.total)}</span>
                    {s.status !== 'active' ? <span className="badge grey">{t('sales.cancelled')}</span>
                      : Number(s.credit_amount) > 0 && <span className="badge amber">{t('sales.due')} {money(s.credit_amount)}</span>}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

// ── new sale ─────────────────────────────────────────────────────────────────────
export function NewSale() {
  const { t, business, money, toast, bump, errorText } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const products = useLoad(() => rpc<Product[]>('list_products', { p_business: business!.id }), []);
  const [mode, setMode] = useState<'items' | 'quick'>(business!.track_inventory ? 'items' : 'quick');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [quickAmount, setQuickAmount] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [discount, setDiscount] = useState('');
  const [applyTax, setApplyTax] = useState(Number(business!.tax_rate) > 0);
  const [customer, setCustomer] = useState<CustomerLite | null>(params.get('customer') ? { id: params.get('customer')!, name: params.get('name') || '', phone: null, balance: 0 } : null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [method, setMethod] = useState<Method>('cash');
  const [partial, setPartial] = useState(false);
  const [paidStr, setPaidStr] = useState('');
  const [dueDate, setDueDate] = useState(addDays(todayISO(business!.timezone), 7));
  const [editing, setEditing] = useState<Line | null>(null);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [clientRef] = useState(uuid);   // one ref per bill: retries never duplicate

  const taxRate = applyTax ? Number(business!.tax_rate) : 0;
  const items = mode === 'quick'
    ? (Number(quickAmount) > 0 ? [{ key: 'q', name: quickNote.trim() || t('sales.quickItem'), qty: 1, unit_price: Number(quickAmount) }] : [])
    : lines;
  const subtotal = round2(items.reduce((a, l) => a + round2(l.qty * l.unit_price), 0));
  const disc = Math.min(Number(discount) || 0, subtotal);
  const tax = round2(((subtotal - disc) * taxRate) / 100);
  const total = round2(subtotal - disc + tax);
  const paid = method === 'credit' ? (partial ? Math.min(Number(paidStr) || 0, total) : 0) : partial ? Math.min(Number(paidStr) || 0, total) : total;
  const credit = round2(total - paid);

  const filtered = useMemo(() => {
    const list = products.data || [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)) : list;
  }, [products.data, search]);

  function add(p: Product) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], qty: round2(c[i].qty + 1) }; return c; }
      return [...ls, { key: p.id, product_id: p.id, name: p.name, qty: 1, unit_price: Number(p.selling_price), unit: p.unit, stock: Number(p.stock_qty), tracked: p.track_stock }];
    });
  }
  function setQty(key: string, q: number) {
    setLines((ls) => (q <= 0 ? ls.filter((l) => l.key !== key) : ls.map((l) => (l.key === key ? { ...l, qty: Math.round(q * 1000) / 1000 } : l))));
  }

  async function save() {
    setError(null);
    if (items.length === 0) { setError(new Error(t('sales.addSomething'))); return; }
    if (credit > 0 && !customer) { setError(new Error(t('srv.Choose a customer for a credit (udhar) sale'))); setPickCustomer(true); return; }
    try {
      const res = await rpc<any>('record_sale', {
        p_business: business!.id, p_client_ref: clientRef,
        p_items: items.map((l) => (l.product_id ? { product_id: l.product_id, qty: l.qty, unit_price: l.unit_price } : { name: l.name, qty: l.qty, unit_price: l.unit_price })),
        p_customer: customer?.id ?? null, p_discount: disc, p_tax_rate: taxRate,
        p_paid: paid, p_method: method, p_due_date: credit > 0 ? dueDate : null,
      });
      bump();
      if (res?.queued) { toast(t('sync.savedOffline')); nav('/'); return; }
      toast(t('sales.saved', { n: res.invoice_no }));
      nav(`/sales/${res.id}?new=1`, { replace: true });
    } catch (e) { setError(e); toast(errorText(e), 'err'); }
  }

  const methods: { value: Method; label: string }[] = [
    { value: 'cash', label: t('pm.cash') }, { value: 'upi', label: t('pm.upi') }, { value: 'card', label: t('pm.card') },
    { value: 'bank', label: t('pm.bank') }, { value: 'credit', label: t('pm.credit') }];

  return (
    <Screen title={t('sales.new')} back className="with-footer">
      <Chips value={mode} onChange={setMode} options={[{ value: 'items', label: t('sales.modeItems') }, { value: 'quick', label: t('sales.modeQuick') }]} />

      {mode === 'quick' ? (
        <div className="card">
          <Field label={t('sales.amount')}><AmountInput value={quickAmount} onChange={setQuickAmount} autoFocus /></Field>
          <Field label={t('sales.whatSold')}><input value={quickNote} onChange={(e) => setQuickNote(e.target.value)} placeholder={t('sales.quickItem')} /></Field>
        </div>
      ) : (
        <>
          <SearchBox value={search} onChange={setSearch} placeholder={t('sales.searchProducts')} />
          {products.loading && !products.data ? <Loader /> : (
            <div className="product-grid">
              {filtered.slice(0, 40).map((p) => {
                const inCart = lines.find((l) => l.product_id === p.id);
                return (
                  <button key={p.id} className={'product-tile' + (inCart ? ' in' : '')} onClick={() => add(p)}>
                    <span className="pt-name">{p.name}</span>
                    <span className="pt-price">{money(p.selling_price)}<small>/{p.unit}</small></span>
                    {p.track_stock && business!.track_inventory && <span className={'pt-stock ' + p.stock_status}>{Number(p.stock_qty) <= 0 ? t('inv.out') : fmtQty(p.stock_qty, p.unit)}</span>}
                    {inCart && <span className="pt-count">{inCart.qty}</span>}
                  </button>
                );
              })}
              <button className="product-tile add" onClick={() => setCustom(true)}><Icon name="plus" /><span className="pt-name">{t('sales.customItem')}</span></button>
            </div>
          )}

          {lines.length > 0 && (
            <div className="card cart">
              <div className="card-head"><h3>{t('sales.cart')} ({lines.length})</h3><button className="link" onClick={() => setLines([])}>{t('common.clear')}</button></div>
              {lines.map((l) => (
                <div key={l.key} className="cart-line">
                  <button className="cart-info" onClick={() => setEditing(l)}>
                    <b>{l.name}</b>
                    <span className="muted small">{money(l.unit_price)} × {fmtQty(l.qty, l.unit)}
                      {l.tracked && business!.track_inventory && l.stock !== undefined && l.qty > l.stock && <span className="warn"> · {t('sales.overStock')}</span>}
                    </span>
                  </button>
                  <div className="stepper">
                    <button onClick={() => setQty(l.key, l.qty - 1)} aria-label="−"><Icon name="minus" size={18} /></button>
                    <span>{fmtQty(l.qty)}</span>
                    <button onClick={() => setQty(l.key, l.qty + 1)} aria-label="+"><Icon name="plus" size={18} /></button>
                  </div>
                  <span className="cart-total">{money(round2(l.qty * l.unit_price))}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="card">
        <button className="row picker" onClick={() => setPickCustomer(true)}>
          <span className="row-main"><Icon name="user" /><span><b>{customer ? customer.name : t('sales.walkIn')}</b>
            <span className="muted small">{customer ? (customer.balance ? t('khata.currentDue', { amt: money(customer.balance) }) : t('sales.changeCustomer')) : t('sales.addCustomerOpt')}</span></span></span>
          {customer ? <span className="icon-btn" onClick={(e) => { e.stopPropagation(); setCustomer(null); }}><Icon name="x" size={18} /></span> : <Icon name="chev" className="flip-rtl" />}
        </button>
      </div>

      <div className="card">
        <div className="sum-line"><span>{t('sales.subtotal')}</span><span>{money(subtotal)}</span></div>
        <div className="sum-line"><span>{t('sales.discount')}</span>
          <input className="mini-input" inputMode="decimal" placeholder="0" value={discount} onChange={(e) => /^\d{0,10}(\.\d{0,2})?$/.test(e.target.value) && setDiscount(e.target.value)} /></div>
        {Number(business!.tax_rate) > 0 && (
          <label className="sum-line"><span><input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} /> {t('sales.tax')} {business!.tax_rate}%</span><span>{money(tax)}</span></label>
        )}
        <div className="sum-line total"><span>{t('sales.total')}</span><span>{money(total)}</span></div>
      </div>

      <div className="card">
        <div className="field-label">{t('sales.paymentMethod')}</div>
        <div className="method-grid">
          {methods.map((m) => (
            <button key={m.value} className={'method' + (method === m.value ? ' on' : '') + (m.value === 'credit' ? ' credit' : '')} onClick={() => { setMethod(m.value); if (m.value === 'credit') setPartial(false); }}>{m.label}</button>
          ))}
        </div>
        <label className="toggle-row compact">
          <span>{method === 'credit' ? t('sales.paidSomeNow') : t('sales.partPayment')}</span>
          <input type="checkbox" className="switch" checked={partial} onChange={(e) => { setPartial(e.target.checked); setPaidStr(''); }} />
        </label>
        {partial && <Field label={t('sales.paidNow')}><AmountInput value={paidStr} onChange={setPaidStr} /></Field>}
        {credit > 0 && (
          <>
            <div className="credit-note"><Icon name="khata" size={18} /> {t('sales.creditNote', { amt: money(credit), name: customer?.name || t('sales.chooseCustomer') })}</div>
            <Field label={t('khata.dueDate')}><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </>
        )}
      </div>

      <ErrorBox error={error} />
      <div className="footer-bar">
        <div className="footer-total"><span className="muted small">{credit > 0 ? `${t('sales.paidNow')} ${money(paid)}` : t('sales.total')}</span><b>{money(total)}</b></div>
        <SaveButton onClick={save} disabled={total <= 0} className="btn primary">{t('sales.saveBill')}</SaveButton>
      </div>

      <CustomerPicker open={pickCustomer} onClose={() => setPickCustomer(false)} onPick={(c) => { setCustomer(c); setPickCustomer(false); }} />

      <LineEditor line={editing} onClose={() => setEditing(null)}
        onSave={(l) => { setLines((ls) => ls.map((x) => (x.key === l.key ? l : x))); setEditing(null); }}
        onRemove={(k) => { setLines((ls) => ls.filter((x) => x.key !== k)); setEditing(null); }} />

      <CustomItemSheet open={custom} onClose={() => setCustom(false)}
        onAdd={(name, price, q) => { setLines((ls) => [...ls, { key: uuid(), name, qty: q, unit_price: price }]); setCustom(false); }} />
    </Screen>
  );
}

function LineEditor({ line, onClose, onSave, onRemove }: { line: Line | null; onClose: () => void; onSave: (l: Line) => void; onRemove: (k: string) => void }) {
  const { t } = useApp();
  const [q, setQ] = useState(''); const [p, setP] = useState('');
  const [k, setK] = useState('');
  if (line && k !== line.key) { setK(line.key); setQ(String(line.qty)); setP(String(line.unit_price)); }
  return (
    <Sheet open={!!line} onClose={onClose} title={line?.name || ''}>
      <Field label={t('sales.qty') + (line?.unit ? ` (${line.unit})` : '')}>
        <input inputMode="decimal" value={q} onChange={(e) => /^\d{0,7}(\.\d{0,3})?$/.test(e.target.value) && setQ(e.target.value)} />
      </Field>
      <Field label={t('sales.price')}><AmountInput value={p} onChange={setP} /></Field>
      <div className="btn-row">
        <button className="btn danger-ghost" onClick={() => line && onRemove(line.key)}>{t('common.remove')}</button>
        <button className="btn primary" disabled={!(Number(q) > 0)} onClick={() => line && onSave({ ...line, qty: Number(q), unit_price: Number(p) || 0 })}>{t('common.save')}</button>
      </div>
    </Sheet>
  );
}

function CustomItemSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string, price: number, qty: number) => void }) {
  const { t } = useApp();
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [q, setQ] = useState('1');
  return (
    <Sheet open={open} onClose={onClose} title={t('sales.customItem')}>
      <Field label={t('inv.name')}><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label={t('sales.price')}><AmountInput value={price} onChange={setPrice} /></Field>
      <Field label={t('sales.qty')}><input inputMode="decimal" value={q} onChange={(e) => /^\d{0,7}(\.\d{0,3})?$/.test(e.target.value) && setQ(e.target.value)} /></Field>
      <button className="btn primary block" disabled={!name.trim() || !(Number(price) > 0) || !(Number(q) > 0)}
              onClick={() => { onAdd(name.trim(), Number(price), Number(q)); setName(''); setPrice(''); setQ('1'); }}>{t('common.add')}</button>
    </Sheet>
  );
}

// ── receipt / detail ─────────────────────────────────────────────────────────────
export function receiptText(t: any, s: any, money: (v: any) => string, lang: any) {
  const lines = s.items.map((i: any) => `${i.name}  ${Number(i.qty)} × ${money(i.unit_price)} = ${money(i.line_total)}`);
  return [
    `*${s.business.name}*`,
    `${t('receipt.bill')} #${s.invoice_no} · ${dateLong(s.sale_date, lang, s.business.currency)}`,
    s.customer_name ? `${t('receipt.customer')}: ${s.customer_name}` : null,
    '', ...lines, '',
    Number(s.discount) > 0 ? `${t('sales.discount')}: −${money(s.discount)}` : null,
    Number(s.tax_amount) > 0 ? `${t('sales.tax')} ${s.tax_rate}%: ${money(s.tax_amount)}` : null,
    `*${t('sales.total')}: ${money(s.total)}*`,
    `${t('receipt.paid')}: ${money(s.paid_amount)}`,
    Number(s.credit_amount) > 0 ? `${t('receipt.balanceDue')}: ${money(s.credit_amount)}` : null,
    '', t('receipt.thanks'),
  ].filter((x) => x !== null).join('\n');
}

export function SaleDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t, business, money, lang, canManage, toast, bump, errorText } = useApp();
  const nav = useNavigate();
  const { data: s, error, loading, setData } = useLoad(() => rpc<any>('get_sale', { p_business: business!.id, p_sale: id }), [id]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cur = business!.currency;
  const isNew = params.get('new') === '1';

  async function cancel() {
    try {
      const r = await rpc('cancel_sale', { p_business: business!.id, p_sale: id, p_reason: reason });
      setData(r); setCancelOpen(false); bump(); toast(t('sales.cancelledToast'));
    } catch (e) { toast(errorText(e), 'err'); }
  }

  async function share() {
    const text = receiptText(t, s, money, lang);
    if (s.customer_phone) { window.open(waLink(s.customer_phone, cur, text), '_blank'); return; }
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* cancelled */ } }
    else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'); }
  }

  return (
    <Screen title={s ? `${t('receipt.bill')} #${s.invoice_no}` : t('receipt.bill')} back={isNew ? '/' : true}>
      <ErrorBox error={error} />
      {loading && !s ? <Loader /> : s && (
        <>
          {isNew && <div className="success-banner"><Icon name="check" /> {t('sales.savedBanner')}</div>}
          <div className={'receipt' + (s.status !== 'active' ? ' void' : '')} id="receipt">
            {s.status !== 'active' && <div className="void-stamp">{t('sales.cancelled')}</div>}
            <div className="r-head">
              <b>{s.business.name}</b>
              {s.business.address && <span>{s.business.address}</span>}
              {s.business.phone && <span>{s.business.phone}</span>}
            </div>
            <div className="r-meta">
              <span>{t('receipt.bill')} #{s.invoice_no}</span><span>{dateLong(s.sale_date, lang, cur)} {timeShort(s.created_at, lang, cur)}</span>
            </div>
            {s.customer_name && <div className="r-meta"><span>{t('receipt.customer')}</span><span>{s.customer_name}</span></div>}
            <div className="r-items">
              {s.items.map((i: any) => (
                <div key={i.id} className="r-item">
                  <span>{i.name}<small>{fmtQty(i.qty, i.unit)} × {money(i.unit_price)}</small></span><span>{money(i.line_total)}</span>
                </div>
              ))}
            </div>
            <div className="r-sum">
              <div><span>{t('sales.subtotal')}</span><span>{money(s.subtotal)}</span></div>
              {Number(s.discount) > 0 && <div><span>{t('sales.discount')}</span><span>−{money(s.discount)}</span></div>}
              {Number(s.tax_amount) > 0 && <div><span>{t('sales.tax')} {s.tax_rate}%</span><span>{money(s.tax_amount)}</span></div>}
              <div className="r-total"><span>{t('sales.total')}</span><span>{money(s.total)}</span></div>
              <div><span>{t('receipt.paid')} ({t(('pm.' + s.payment_method) as any)})</span><span>{money(s.paid_amount)}</span></div>
              {Number(s.credit_amount) > 0 && <div className="r-due"><span>{t('receipt.balanceDue')}</span><span>{money(s.credit_amount)}</span></div>}
              {Number(s.credit_amount) > 0 && s.due_date && <div><span>{t('khata.dueDate')}</span><span>{dateShort(s.due_date, lang, cur)}</span></div>}
            </div>
            <div className="r-foot">{t('receipt.thanks')}</div>
          </div>
          {s.status !== 'active' && <div className="info-box">{t('sales.cancelReasonShown')}: {s.cancel_reason}</div>}

          <div className="btn-row no-print">
            <button className="btn wa" onClick={share}><Icon name="wa" size={20} /> {t('receipt.share')}</button>
            <button className="btn ghost" onClick={() => window.print()}><Icon name="print" size={20} /> {t('receipt.print')}</button>
          </div>
          <div className="btn-row no-print">
            <button className="btn ghost" onClick={() => nav('/sales/new')}><Icon name="plus" size={20} /> {t('sales.newAnother')}</button>
            {s.customer_id && <Link className="btn ghost" to={`/khata/${s.customer_id}`}><Icon name="khata" size={20} /> {t('khata.openKhata')}</Link>}
          </div>
          {s.status === 'active' && canManage && (
            <button className="btn danger-ghost block no-print" onClick={() => setCancelOpen(true)}><Icon name="undo" size={18} /> {t('sales.cancelBill')}</button>
          )}
          <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('sales.cancelBill')}>
            <p className="muted">{t('sales.cancelExplain')}</p>
            <Field label={t('common.reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={t('sales.reasonPh')} /></Field>
            <SaveButton onClick={cancel} disabled={reason.trim().length < 3} className="btn danger block">{t('sales.confirmCancel')}</SaveButton>
          </Sheet>
        </>
      )}
    </Screen>
  );
}
