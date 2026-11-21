import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, useLoad } from '../lib/store';
import { rpc, uuid } from '../lib/backend';
import { addDays, dateLong, dateShort, daysBetween, todayISO, waLink } from '../lib/format';
import { Screen, Icon, Loader, ErrorBox, Empty, Chips, SearchBox, Sheet, SaveButton, Field, AmountInput, Avatar } from '../ui';

export type CustomerLite = { id: string; name: string; phone: string | null; balance: number; overdue_since?: string | null };

export function reminderText(t: any, name: string, amount: string, shop: string) {
  return t('khata.reminderMsg', { name, amt: amount, shop });
}

// ── list ─────────────────────────────────────────────────────────────────────────
export function KhataList() {
  const { t, business, money } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const act = params.get('act') as 'credit' | 'payment' | null;
  const [filter, setFilter] = useState<'all' | 'due' | 'overdue'>((params.get('f') as any) || 'all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const h = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(h); }, [search]);
  const { data, error, loading } = useLoad(() => rpc<CustomerLite[]>('list_customers', { p_business: business!.id, p_search: q || null, p_filter: filter }), [q, filter]);
  const total = (data || []).reduce((a, c) => a + Math.max(0, Number(c.balance)), 0);
  const today = todayISO(business!.timezone);

  return (
    <Screen title={act ? (act === 'credit' ? t('khata.pickForCredit') : t('khata.pickForPayment')) : t('nav.khata')} back={act ? true : undefined}
            right={!act && <Link to="/khata/new" className="btn primary sm"><Icon name="userplus" size={18} /> {t('common.add')}</Link>}>
      {!act && (
        <div className="khata-hero">
          <span>{t('khata.totalToCollect')}</span>
          <b>{money(total)}</b>
        </div>
      )}
      <SearchBox value={search} onChange={setSearch} placeholder={t('khata.search')} />
      {!act && <Chips value={filter} onChange={(f) => { setFilter(f); setParams(f === 'all' ? {} : { f }); }} options={[
        { value: 'all', label: t('khata.all') }, { value: 'due', label: t('khata.withDue') }, { value: 'overdue', label: t('khata.overdue') }]} />}
      <ErrorBox error={error} />
      {loading && !data ? <Loader /> : data && data.length === 0 ? (
        <Empty icon="khata" title={q ? t('common.noMatch') : t('khata.none')} sub={q ? undefined : t('khata.noneSub')}
               action={<Link to="/khata/new" className="btn primary">{t('qa.customer')}</Link>} />
      ) : (
        <div className="card flush">
          {data!.map((c) => {
            const bal = Number(c.balance);
            return (
              <button key={c.id} className="row" onClick={() => nav(act ? `/khata/${c.id}?act=${act}` : `/khata/${c.id}`)}>
                <span className="row-main">
                  <Avatar name={c.name} tone={bal > 0 ? 'red' : bal < 0 ? 'green' : undefined} />
                  <span><b>{c.name}</b>
                    <span className="muted small">{c.overdue_since ? <span className="red">{t('khata.overdueDays', { n: daysBetween(c.overdue_since, today) })}</span> : c.phone || t('khata.noPhone')}</span>
                  </span>
                </span>
                <span className="row-end">
                  <span className={'row-amount ' + (bal > 0 ? 'red' : bal < 0 ? 'green' : 'muted')}>{money(Math.abs(bal))}</span>
                  <span className="muted tiny">{bal > 0 ? t('khata.willGet') : bal < 0 ? t('khata.advance') : t('khata.settled')}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

// ── customer profile + ledger ────────────────────────────────────────────────────
export function CustomerDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { t, business, money, lang, canManage, toast, bump, errorText } = useApp();
  const nav = useNavigate();
  const cur = business!.currency;
  const c = useLoad(() => rpc<any>('get_customer', { p_business: business!.id, p_customer: id }), [id]);
  const ledger = useLoad(() => rpc<any[]>('customer_ledger', { p_business: business!.id, p_customer: id }), [id]);
  const [entry, setEntry] = useState<'credit' | 'payment' | null>((params.get('act') as any) || null);
  const [rev, setRev] = useState<any>(null);
  const [reason, setReason] = useState('');
  const today = todayISO(business!.timezone);
  const cust = c.data;
  const bal = Number(cust?.balance || 0);

  function statementText() {
    const lines = (ledger.data || []).slice(-15).map((l) =>
      `${dateShort(l.entry_date, lang, cur)}  ${entryLabel(t, l)}  ${l.amount > 0 ? '+' : '−'}${money(Math.abs(l.amount))}  = ${money(l.running_balance)}`);
    return [`*${business!.name}* – ${t('khata.statement')}`, `${cust.name}`, '', ...lines, '', `*${t('khata.balance')}: ${money(bal)}*`].join('\n');
  }

  async function reverse() {
    try {
      if (rev.entry_type === 'payment') await rpc('reverse_payment', { p_business: business!.id, p_payment: rev.payment_id, p_reason: reason });
      else await rpc('reverse_ledger_entry', { p_business: business!.id, p_entry: rev.id, p_reason: reason });
      setRev(null); setReason(''); bump(); toast(t('khata.reversed'));
    } catch (e) { toast(errorText(e), 'err'); }
  }

  return (
    <Screen title={cust?.name || t('nav.khata')} back right={cust && <Link to={`/khata/${id}/edit`} className="icon-btn" aria-label={t('common.edit')}><Icon name="edit" /></Link>}>
      <ErrorBox error={c.error || ledger.error} />
      {c.loading && !cust ? <Loader /> : cust && (
        <>
          <section className={'balance-hero ' + (bal > 0 ? 'owes' : bal < 0 ? 'adv' : 'clear')}>
            <span>{bal > 0 ? t('khata.youWillGet') : bal < 0 ? t('khata.advancePaid') : t('khata.allSettled')}</span>
            <b>{money(Math.abs(bal))}</b>
            {cust.overdue_since ? <span className="hero-tag">{t('khata.overdueDays', { n: daysBetween(cust.overdue_since, today) })}</span>
              : cust.next_due && bal > 0 ? <span className="hero-tag soft">{t('khata.dueOn', { date: dateShort(cust.next_due, lang, cur) })}</span> : null}
            {cust.credit_limit && <span className="muted tiny">{t('khata.limit')}: {money(cust.credit_limit)}</span>}
          </section>

          <div className="action-row">
            <button className="act red" onClick={() => setEntry('credit')}><Icon name="credit" /><span>{t('khata.giveCredit')}</span></button>
            <button className="act green" onClick={() => setEntry('payment')}><Icon name="cashin" /><span>{t('khata.receive')}</span></button>
            {cust.phone && bal > 0 ? (
              <a className="act wa" target="_blank" rel="noreferrer" href={waLink(cust.phone, cur, reminderText(t, cust.name, money(bal), business!.name))}><Icon name="wa" /><span>{t('khata.remind')}</span></a>
            ) : cust.phone ? (
              <a className="act" href={`tel:${cust.phone}`}><Icon name="phone" /><span>{t('khata.call')}</span></a>
            ) : <Link className="act" to={`/khata/${id}/edit`}><Icon name="phone" /><span>{t('khata.addPhone')}</span></Link>}
            <button className="act" onClick={() => nav(`/sales/new?customer=${id}&name=${encodeURIComponent(cust.name)}`)}><Icon name="sale" /><span>{t('qa.sale')}</span></button>
          </div>

          <div className="stat-strip">
            <div><span>{t('khata.totalPurchases')}</span><b>{money(cust.total_purchases)}</b></div>
            <div><span>{t('khata.totalPaid')}</span><b className="green">{money(cust.total_payments)}</b></div>
            <div><span>{t('khata.lastActivity')}</span><b>{cust.last_activity ? dateShort(cust.last_activity, lang, cur) : '—'}</b></div>
          </div>

          <section className="card flush">
            <div className="card-head pad"><h3>{t('khata.history')}</h3>
              {ledger.data && ledger.data.length > 0 && (
                <button className="link" onClick={() => {
                  const text = statementText();
                  if (cust.phone) window.open(waLink(cust.phone, cur, text), '_blank');
                  else if (navigator.share) navigator.share({ text }).catch(() => {});
                }}><Icon name="share" size={16} /> {t('khata.shareStatement')}</button>
              )}
            </div>
            {ledger.data && ledger.data.length === 0 && <p className="muted small pad">{t('khata.noEntries')}</p>}
            <div className="ledger">
              <div className="ledger-head"><span>{t('khata.entry')}</span><span>{t('khata.gave')}</span><span>{t('khata.got')}</span></div>
              {[...(ledger.data || [])].reverse().map((l) => (
                <div key={l.id} className={'ledger-row' + (l.reversed ? ' struck' : '')}
                     onClick={() => {
                       if (l.sale_id && l.entry_type === 'credit_sale') nav(`/sales/${l.sale_id}`);
                       else if (canManage && !l.reversed && ['payment', 'credit_given', 'opening_balance'].includes(l.entry_type)) setRev(l);
                     }}>
                  <span className="l-info">
                    <b>{entryLabel(t, l)}</b>
                    <span className="muted tiny">{dateLong(l.entry_date, lang, cur)}{l.note && l.entry_type !== 'credit_sale' ? ` · ${l.note}` : ''}{l.due_date && l.amount > 0 ? ` · ${t('khata.due')} ${dateShort(l.due_date, lang, cur)}` : ''}</span>
                    <span className="muted tiny">{t('khata.bal')} {money(l.running_balance)}</span>
                  </span>
                  <span className="red">{l.amount > 0 ? money(l.amount) : ''}</span>
                  <span className="green">{l.amount < 0 ? money(-l.amount) : ''}</span>
                </div>
              ))}
            </div>
          </section>
          {cust.notes && <p className="footnote">{cust.notes}</p>}
        </>
      )}

      <EntrySheet kind={entry} customer={cust} onClose={() => { setEntry(null); if (params.get('act')) setParams({}); }}
                  onDone={() => { setEntry(null); if (params.get('act')) setParams({}); bump(); }} />

      <Sheet open={!!rev} onClose={() => setRev(null)} title={t('khata.reverseTitle')}>
        {rev && <p className="muted">{entryLabel(t, rev)} · {money(Math.abs(rev.amount))} · {dateLong(rev.entry_date, lang, cur)}</p>}
        <p className="muted small">{t('khata.reverseExplain')}</p>
        <Field label={t('common.reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('khata.reversePh')} /></Field>
        <SaveButton onClick={reverse} disabled={reason.trim().length < 3} className="btn danger block">{t('khata.reverse')}</SaveButton>
      </Sheet>
    </Screen>
  );
}

export function entryLabel(t: any, l: any) {
  switch (l.entry_type) {
    case 'credit_sale': return `${t('khata.creditSale')}${l.invoice_no ? ' #' + l.invoice_no : ''}`;
    case 'credit_given': return t('khata.creditGiven');
    case 'payment': return `${t('khata.paymentReceived')}${l.method ? ' · ' + t('pm.' + l.method) : ''}`;
    case 'opening_balance': return t('khata.opening');
    case 'reversal': return t('khata.reversal');
    default: return l.entry_type;
  }
}

// ── give credit / receive payment ────────────────────────────────────────────────
function EntrySheet({ kind, customer, onClose, onDone }: { kind: 'credit' | 'payment' | null; customer: any; onClose: () => void; onDone: () => void }) {
  const { t, business, money, toast, errorText } = useApp();
  const today = todayISO(business!.timezone);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [due, setDue] = useState(addDays(today, 7));
  const [method, setMethod] = useState<'cash' | 'upi' | 'bank' | 'card'>('cash');
  const [note, setNote] = useState('');
  const [ref, setRef] = useState(uuid);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (kind) { setAmount(''); setNote(''); setError(null); setRef(uuid()); setDate(today); } }, [kind, today]);
  if (!customer) return null;
  const bal = Number(customer.balance);

  async function save() {
    setError(null);
    try {
      const args: any = { p_business: business!.id, p_client_ref: ref, p_customer: customer.id, p_amount: Number(amount), p_date: date, p_note: note.trim() || null };
      const r = kind === 'credit'
        ? await rpc<any>('add_credit', { ...args, p_due_date: due || null })
        : await rpc<any>('record_payment', { ...args, p_method: method });
      toast(r?.queued ? t('sync.savedOffline') : kind === 'credit' ? t('khata.creditSaved') : t('khata.paymentSaved'));
      onDone();
    } catch (e) { setError(e); toast(errorText(e), 'err'); }
  }

  const after = kind === 'credit' ? bal + (Number(amount) || 0) : bal - (Number(amount) || 0);
  return (
    <Sheet open={!!kind} onClose={onClose} title={`${kind === 'credit' ? t('khata.giveCredit') : t('khata.receive')} · ${customer.name}`}>
      <Field label={t('sales.amount')}><AmountInput value={amount} onChange={setAmount} autoFocus /></Field>
      {kind === 'payment' && bal > 0 && (
        <div className="chips">
          <button className="chip" onClick={() => setAmount(String(bal))}>{t('khata.fullAmount')} {money(bal)}</button>
          {bal >= 200 && <button className="chip" onClick={() => setAmount(String(Math.round(bal / 2)))}>½ {money(Math.round(bal / 2))}</button>}
        </div>
      )}
      {kind === 'payment' && (
        <div className="method-grid four">
          {(['cash', 'upi', 'bank', 'card'] as const).map((m) => <button key={m} className={'method' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>{t('pm.' + m as any)}</button>)}
        </div>
      )}
      <div className="two-col">
        <Field label={t('common.date')}><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'credit' && <Field label={t('khata.dueDate')}><input type="date" value={due} min={date} onChange={(e) => setDue(e.target.value)} /></Field>}
      </div>
      <Field label={t('common.note')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'credit' ? t('khata.creditNotePh') : ''} /></Field>
      {Number(amount) > 0 && <div className="info-box">{t('khata.balanceAfter')}: <b>{money(after)}</b>{after < 0 ? ` (${t('khata.advance')})` : ''}</div>}
      <ErrorBox error={error} />
      <SaveButton onClick={save} disabled={!(Number(amount) > 0)} className={'btn block ' + (kind === 'credit' ? 'danger' : 'primary')}>
        {kind === 'credit' ? t('khata.saveCredit') : t('khata.savePayment')}
      </SaveButton>
    </Sheet>
  );
}

// ── add / edit customer ──────────────────────────────────────────────────────────
export function CustomerForm() {
  const { id } = useParams();
  const { t, business, toast, bump } = useApp();
  const nav = useNavigate();
  const existing = useLoad(() => (id ? rpc<any>('get_customer', { p_business: business!.id, p_customer: id }) : Promise.resolve(null)), [id]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [notes, setNotes] = useState('');
  const [limit, setLimit] = useState(''); const [opening, setOpening] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [ref] = useState(uuid);
  const [error, setError] = useState<unknown>(null);
  if (existing.data && !loaded) {
    setLoaded(true); setName(existing.data.name); setPhone(existing.data.phone || ''); setNotes(existing.data.notes || '');
    setLimit(existing.data.credit_limit ? String(existing.data.credit_limit) : '');
  }

  async function save() {
    setError(null);
    try {
      if (phone && !/^\+?[0-9 ]{6,20}$/.test(phone.trim())) throw new Error(t('khata.badPhone'));
      const r = await rpc<any>('upsert_customer', {
        p_business: business!.id, p_id: id || null, p_name: name.trim(), p_phone: phone.trim(), p_notes: notes,
        p_credit_limit: limit ? Number(limit) : id ? 0 : null, p_opening_balance: id ? 0 : Number(opening) || 0, p_client_ref: id ? null : ref,
      });
      bump(); toast(t('common.saved'));
      nav(`/khata/${r.id}`, { replace: true });
    } catch (e) { setError(e); }
  }
  async function archive() {
    try { await rpc('upsert_customer', { p_business: business!.id, p_id: id, p_archived: true }); bump(); nav('/khata', { replace: true }); }
    catch (e) { setError(e); }
  }

  return (
    <Screen title={id ? t('khata.editCustomer') : t('qa.customer')} back>
      <div className="card">
        <Field label={t('khata.name')}><input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!id} maxLength={120} /></Field>
        <Field label={t('khata.mobile')} hint={t('khata.mobileHint')}><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98470 12345" /></Field>
        {!id && <Field label={t('khata.openingBal')} hint={t('khata.openingHint')}><AmountInput value={opening} onChange={setOpening} /></Field>}
        <Field label={t('khata.creditLimit')} hint={t('khata.limitHint')}><AmountInput value={limit} onChange={setLimit} placeholder={t('khata.noLimit')} /></Field>
        <Field label={t('common.note')}><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <ErrorBox error={error} />
      <SaveButton onClick={save} disabled={!name.trim()}>{t('common.save')}</SaveButton>
      {id && <button className="btn link block danger-text" onClick={archive}>{t('khata.archive')}</button>}
    </Screen>
  );
}

// ── picker used by New Sale ──────────────────────────────────────────────────────
export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: CustomerLite) => void }) {
  const { t, business, money, errorText } = useApp();
  const [search, setSearch] = useState('');
  const [list, setList] = useState<CustomerLite[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => rpc<CustomerLite[]>('list_customers', { p_business: business!.id, p_search: search.trim() || null }).then(setList).catch(setError), 200);
    return () => clearTimeout(h);
  }, [open, search, business]);

  async function quickAdd() {
    try {
      const c = await rpc<any>('upsert_customer', { p_business: business!.id, p_name: name.trim(), p_phone: phone.trim() || null, p_client_ref: uuid() });
      onPick({ id: c.id, name: c.name, phone: c.phone, balance: 0 }); setAdding(false); setName(''); setPhone('');
    } catch (e) { setError(errorText(e)); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('sales.chooseCustomer')}>
      {adding ? (
        <>
          <Field label={t('khata.name')}><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label={t('khata.mobile')}><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          {error ? <div className="error-box">{String(error)}</div> : null}
          <div className="btn-row"><button className="btn ghost" onClick={() => setAdding(false)}>{t('common.back')}</button>
            <SaveButton onClick={quickAdd} disabled={!name.trim()} className="btn primary">{t('common.add')}</SaveButton></div>
        </>
      ) : (
        <>
          <SearchBox value={search} onChange={setSearch} placeholder={t('khata.search')} />
          <button className="row picker" onClick={() => { setAdding(true); setName(search); }}><span className="row-main"><Icon name="userplus" /><b>{t('qa.customer')}{search ? `: ${search}` : ''}</b></span></button>
          <div className="picker-list">
            {(list || []).map((c) => (
              <button key={c.id} className="row" onClick={() => onPick(c)}>
                <span className="row-main"><Avatar name={c.name} /><span><b>{c.name}</b><span className="muted small">{c.phone || ''}</span></span></span>
                {Number(c.balance) !== 0 && <span className={'row-amount ' + (Number(c.balance) > 0 ? 'red' : 'green')}>{money(c.balance)}</span>}
              </button>
            ))}
            {!list && <Loader />}
          </div>
        </>
      )}
    </Sheet>
  );
}
