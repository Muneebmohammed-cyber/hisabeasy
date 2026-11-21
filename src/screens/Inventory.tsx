import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useLoad } from '../lib/store';
import { rpc, uuid } from '../lib/backend';
import { dateShort, qty as fmtQty, timeShort } from '../lib/format';
import { Screen, Icon, Loader, ErrorBox, Empty, Chips, SearchBox, Sheet, SaveButton, Field, AmountInput } from '../ui';

const UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'pkt', 'btl', 'box', 'dozen', 'm', 'bag'];

export function InventoryList() {
  const { t, business, money } = useApp();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>((params.get('f') as any) || 'all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const h = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(h); }, [search]);
  const { data, error, loading } = useLoad(() => rpc<any[]>('list_products', { p_business: business!.id, p_search: q || null, p_filter: filter }), [q, filter]);
  const value = (data || []).reduce((a, p) => a + Number(p.stock_value), 0);
  const low = (data || []).filter((p) => p.stock_status === 'low' || p.stock_status === 'out').length;

  return (
    <Screen title={t('nav.inventory')} right={<Link to="/inventory/new" className="btn primary sm"><Icon name="plus" size={18} /> {t('qa.product')}</Link>}>
      {!business!.track_inventory && <div className="info-box">{t('inv.offNote')} <Link to="/more/settings" className="link">{t('more.settings')}</Link></div>}
      <div className="stat-strip">
        <div><span>{t('inv.products')}</span><b>{data?.length ?? '—'}</b></div>
        <div><span>{t('inv.stockValue')}</span><b>{money(value, { compact: true })}</b></div>
        <div><span>{t('inv.needAttention')}</span><b className={low ? 'amber' : ''}>{low}</b></div>
      </div>
      <SearchBox value={search} onChange={setSearch} placeholder={t('inv.search')} />
      <Chips value={filter} onChange={(f) => { setFilter(f); setParams(f === 'all' ? {} : { f }); }} options={[
        { value: 'all', label: t('khata.all') }, { value: 'low', label: t('inv.low') }, { value: 'out', label: t('inv.out') }]} />
      <ErrorBox error={error} />
      {loading && !data ? <Loader /> : data && data.length === 0 ? (
        <Empty icon="box" title={q ? t('common.noMatch') : t('inv.none')} sub={q ? undefined : t('inv.noneSub')}
               action={<Link to="/inventory/new" className="btn primary">{t('qa.product')}</Link>} />
      ) : (
        <div className="card flush">
          {data!.map((p) => (
            <Link key={p.id} to={`/inventory/${p.id}`} className="row">
              <span className="row-main"><span className="prod-icon">{p.name.slice(0, 1)}</span><span><b>{p.name}</b>
                <span className="muted small">{money(p.selling_price)}/{p.unit}{p.category ? ` · ${p.category}` : ''}</span></span></span>
              <span className="row-end">
                {p.track_stock ? <span className={'badge ' + (p.stock_status === 'out' ? 'red' : p.stock_status === 'low' ? 'amber' : 'green')}>
                  {p.stock_status === 'out' ? t('inv.out') : fmtQty(p.stock_qty, p.unit)}</span>
                  : <span className="badge grey">{t('inv.untracked')}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Screen>
  );
}

export function ProductForm() {
  const { id } = useParams();
  const { t, business, toast, bump } = useApp();
  const nav = useNavigate();
  const existing = useLoad(() => (id ? rpc<any[]>('list_products', { p_business: business!.id }).then((l) => l.find((p) => p.id === id)) : Promise.resolve(null)), [id]);
  const [f, setF] = useState({ name: '', sku: '', barcode: '', category: '', unit: 'pcs', purchase: '', selling: '', opening: '', min: '', track: true });
  const [loaded, setLoaded] = useState(false);
  const [ref] = useState(uuid);
  const [error, setError] = useState<unknown>(null);
  if (existing.data && !loaded) {
    const p = existing.data; setLoaded(true);
    setF({ name: p.name, sku: p.sku || '', barcode: p.barcode || '', category: p.category || '', unit: p.unit, purchase: String(Number(p.purchase_price) || ''),
           selling: String(Number(p.selling_price) || ''), opening: '', min: String(Number(p.min_stock) || ''), track: p.track_stock });
  }
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  const margin = Number(f.selling) - Number(f.purchase);

  async function save() {
    setError(null);
    try {
      const r = await rpc<any>('upsert_product', {
        p_business: business!.id, p_id: id || null, p_name: f.name.trim(), p_sku: f.sku, p_barcode: f.barcode, p_category: f.category,
        p_unit: f.unit, p_purchase_price: Number(f.purchase) || 0, p_selling_price: Number(f.selling) || 0,
        p_opening_stock: id ? 0 : Number(f.opening) || 0, p_min_stock: Number(f.min) || 0, p_track_stock: f.track, p_client_ref: id ? null : ref,
      });
      bump(); toast(t('common.saved'));
      nav(`/inventory/${r.id}`, { replace: true });
    } catch (e) { setError(e); }
  }
  async function archive() {
    try { await rpc('upsert_product', { p_business: business!.id, p_id: id, p_archived: true }); bump(); nav('/inventory', { replace: true }); }
    catch (e) { setError(e); }
  }

  return (
    <Screen title={id ? t('inv.edit') : t('qa.product')} back>
      <div className="card">
        <Field label={t('inv.name')}><input value={f.name} onChange={(e) => set('name')(e.target.value)} autoFocus={!id} placeholder={t('inv.namePh')} /></Field>
        <div className="two-col">
          <Field label={t('inv.purchasePrice')}><AmountInput value={f.purchase} onChange={set('purchase')} /></Field>
          <Field label={t('inv.sellingPrice')}><AmountInput value={f.selling} onChange={set('selling')} /></Field>
        </div>
        {Number(f.selling) > 0 && Number(f.purchase) > 0 && (
          <div className={'info-box ' + (margin < 0 ? 'warn' : '')}>{t('inv.margin')}: <b>{margin.toFixed(2)}</b> ({Math.round((margin / Number(f.selling)) * 100)}%)</div>
        )}
        <Field label={t('inv.unit')}>
          <div className="chips wrap">{UNITS.map((u) => <button key={u} type="button" className={'chip' + (f.unit === u ? ' on' : '')} onClick={() => set('unit')(u)}>{u}</button>)}</div>
        </Field>
      </div>
      <div className="card">
        <label className="toggle-row compact"><span>{t('inv.trackStock')}</span><input type="checkbox" className="switch" checked={f.track} onChange={(e) => set('track')(e.target.checked)} /></label>
        {f.track && (
          <div className="two-col">
            {!id && <Field label={t('inv.openingStock')}><input inputMode="decimal" value={f.opening} onChange={(e) => /^\d{0,8}(\.\d{0,3})?$/.test(e.target.value) && set('opening')(e.target.value)} /></Field>}
            <Field label={t('inv.minLevel')}><input inputMode="decimal" value={f.min} onChange={(e) => /^\d{0,8}(\.\d{0,3})?$/.test(e.target.value) && set('min')(e.target.value)} /></Field>
          </div>
        )}
        {id && f.track && <p className="muted small">{t('inv.stockViaAdjust')}</p>}
      </div>
      <div className="card">
        <Field label={t('inv.category')}><input value={f.category} onChange={(e) => set('category')(e.target.value)} placeholder={t('inv.categoryPh')} /></Field>
        <div className="two-col">
          <Field label="SKU"><input value={f.sku} onChange={(e) => set('sku')(e.target.value)} /></Field>
          <Field label={t('inv.barcode')}><input inputMode="numeric" value={f.barcode} onChange={(e) => set('barcode')(e.target.value)} /></Field>
        </div>
      </div>
      <ErrorBox error={error} />
      <SaveButton onClick={save} disabled={!f.name.trim()}>{t('common.save')}</SaveButton>
      {id && <button className="btn link block danger-text" onClick={archive}>{t('inv.archive')}</button>}
    </Screen>
  );
}

const REASON_KEYS: Record<string, string> = { opening: 'inv.r.opening', sale: 'inv.r.sale', sale_cancel: 'inv.r.sale_cancel', stock_in: 'inv.r.stock_in', adjustment: 'inv.r.adjustment', damage: 'inv.r.damage' };

export function ProductDetail() {
  const { id } = useParams();
  const { t, business, money, lang, toast, bump, errorText } = useApp();
  const cur = business!.currency;
  const p = useLoad(() => rpc<any[]>('list_products', { p_business: business!.id }).then((l) => l.find((x) => x.id === id)), [id]);
  const hist = useLoad(() => rpc<any[]>('stock_history', { p_business: business!.id, p_product: id }), [id]);
  const [sheet, setSheet] = useState<'stock_in' | 'adjustment' | null>(null);
  const [q, setQ] = useState(''); const [cost, setCost] = useState(''); const [note, setNote] = useState('');
  const [dir, setDir] = useState<'add' | 'remove'>('remove');
  const [isDamage, setIsDamage] = useState(false);
  const [ref, setRef] = useState(uuid);
  const prod = p.data;

  function open(kind: 'stock_in' | 'adjustment') { setSheet(kind); setQ(''); setNote(''); setCost(prod ? String(Number(prod.purchase_price) || '') : ''); setRef(uuid()); setIsDamage(false); setDir('remove'); }

  async function save() {
    const n = Number(q);
    const change = sheet === 'stock_in' ? n : dir === 'add' ? n : -n;
    try {
      const r = await rpc<any>('adjust_stock', {
        p_business: business!.id, p_client_ref: ref, p_product: id, p_qty_change: change,
        p_reason: sheet === 'stock_in' ? 'stock_in' : isDamage ? 'damage' : 'adjustment',
        p_unit_cost: sheet === 'stock_in' && cost ? Number(cost) : null, p_note: note.trim() || null,
      });
      setSheet(null); bump(); toast(r?.queued ? t('sync.savedOffline') : t('inv.updated'));
    } catch (e) { toast(errorText(e), 'err'); }
  }

  return (
    <Screen title={prod?.name || t('nav.inventory')} back right={prod && <Link to={`/inventory/${id}/edit`} className="icon-btn" aria-label={t('common.edit')}><Icon name="edit" /></Link>}>
      <ErrorBox error={p.error} />
      {p.loading && !prod ? <Loader /> : prod && (
        <>
          <section className={'balance-hero stock ' + prod.stock_status}>
            <span>{t('inv.inStock')}</span>
            <b>{prod.track_stock ? fmtQty(prod.stock_qty, prod.unit) : t('inv.untracked')}</b>
            {prod.track_stock && <span className="hero-tag soft">{t('inv.minLevel')}: {fmtQty(prod.min_stock, prod.unit)}</span>}
          </section>
          {prod.track_stock && (
            <div className="btn-row">
              <button className="btn primary" onClick={() => open('stock_in')}><Icon name="plus" size={18} /> {t('inv.stockIn')}</button>
              <button className="btn ghost" onClick={() => open('adjustment')}><Icon name="edit" size={18} /> {t('inv.adjust')}</button>
            </div>
          )}
          <div className="stat-strip">
            <div><span>{t('inv.sellingPrice')}</span><b>{money(prod.selling_price)}</b></div>
            <div><span>{t('inv.purchasePrice')}</span><b>{money(prod.purchase_price)}</b></div>
            <div><span>{t('inv.stockValue')}</span><b>{money(prod.stock_value)}</b></div>
          </div>
          <section className="card flush">
            <div className="card-head pad"><h3>{t('inv.history')}</h3></div>
            {(hist.data || []).length === 0 && <p className="muted small pad">{t('inv.noHistory')}</p>}
            {(hist.data || []).map((m) => (
              <div key={m.id} className="row static">
                <span className="row-main"><span><b>{t(REASON_KEYS[m.reason] as any)}{m.invoice_no ? ` · #${m.invoice_no}` : ''}</b>
                  <span className="muted small">{dateShort(m.created_at, lang, cur)} {timeShort(m.created_at, lang, cur)}{m.note ? ` · ${m.note}` : ''}</span></span></span>
                <span className={'row-amount ' + (Number(m.qty_change) > 0 ? 'green' : 'red')}>{Number(m.qty_change) > 0 ? '+' : ''}{fmtQty(m.qty_change)}</span>
              </div>
            ))}
          </section>
        </>
      )}
      <Sheet open={!!sheet} onClose={() => setSheet(null)} title={sheet === 'stock_in' ? t('inv.stockIn') : t('inv.adjust')}>
        {sheet === 'adjustment' && (
          <>
            <Chips value={dir} onChange={setDir} options={[{ value: 'remove', label: t('inv.remove') }, { value: 'add', label: t('inv.addFound') }]} />
            {dir === 'remove' && <label className="toggle-row compact"><span>{t('inv.damaged')}</span><input type="checkbox" className="switch" checked={isDamage} onChange={(e) => setIsDamage(e.target.checked)} /></label>}
          </>
        )}
        <Field label={`${t('sales.qty')} (${prod?.unit || ''})`}>
          <input inputMode="decimal" autoFocus value={q} onChange={(e) => /^\d{0,8}(\.\d{0,3})?$/.test(e.target.value) && setQ(e.target.value)} />
        </Field>
        {sheet === 'stock_in' && <Field label={t('inv.costPerUnit')}><AmountInput value={cost} onChange={setCost} /></Field>}
        <Field label={t('common.note')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={sheet === 'stock_in' ? t('inv.supplierPh') : ''} /></Field>
        <SaveButton onClick={save} disabled={!(Number(q) > 0)}>{t('common.save')}</SaveButton>
      </Sheet>
    </Screen>
  );
}
