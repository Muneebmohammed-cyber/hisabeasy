import { Link, useNavigate } from 'react-router-dom';
import { useApp, useLoad } from '../lib/store';
import { rpc } from '../lib/backend';
import { dateShort, timeShort, daysBetween, waLink } from '../lib/format';
import { Icon, Loader, ErrorBox, Avatar } from '../ui';
import { reminderText } from './Khata';

type Summary = {
  date: string; sales_total: number; sales_count: number; gross_profit: number; net_profit: number;
  expenses_total: number; operating_expenses: number; cash_received: number; credit_given: number; yesterday_sales: number;
  customer_outstanding: number; customers_with_dues: number; low_stock_count: number; overdue_count: number;
  low_stock: { id: string; name: string; stock_qty: number; min_stock: number; unit: string }[];
  overdue: { id: string; name: string; phone: string | null; balance: number; overdue_since: string }[];
  recent: { kind: string; id: string; title: string; sub: string; amount: number; status: string; at: string; date: string; customer_id?: string }[];
};

export function Home() {
  const { t, business, money, lang } = useApp();
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => rpc<Summary>('dashboard_summary', { p_business: business!.id }), [business?.id]);
  const cur = business!.currency;

  const actions = [
    { to: '/sales/new', icon: 'sale', label: t('qa.sale'), tone: 'green' },
    { to: '/expenses/new', icon: 'expense', label: t('qa.expense'), tone: 'red' },
    { to: '/khata/new', icon: 'userplus', label: t('qa.customer'), tone: 'navy' },
    { to: '/khata?act=credit', icon: 'credit', label: t('qa.credit'), tone: 'amber' },
    { to: '/khata?act=payment', icon: 'cashin', label: t('qa.payment'), tone: 'green' },
    { to: '/inventory/new', icon: 'box', label: t('qa.product'), tone: 'navy' },
  ];

  const change = data && data.yesterday_sales > 0 ? Math.round(((data.sales_total - data.yesterday_sales) / data.yesterday_sales) * 100) : null;

  return (
    <div className="screen home">
      <header className="home-head">
        <div>
          <div className="muted small">{new Intl.DateTimeFormat(lang === 'en' ? 'en-IN' : lang + '-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</div>
          <h1 className="home-biz">{business!.name}</h1>
        </div>
        <Link to="/more/settings" className="icon-btn light" aria-label={t('more.settings')}><Icon name="settings" /></Link>
      </header>
      <main className="content">
        <ErrorBox error={error} />
        {loading && !data ? <Loader /> : data && (
          <>
            <section className="today-card">
              <div className="today-label">{t('home.todaySales')}</div>
              <div className="today-amount">{money(data.sales_total)}</div>
              <div className="today-sub">
                {t('home.bills', { n: data.sales_count })}
                {change !== null && <span className={'delta ' + (change >= 0 ? 'up' : 'down')}>{change >= 0 ? '▲' : '▼'} {Math.abs(change)}% {t('home.vsYesterday')}</span>}
              </div>
              <div className="today-grid">
                <div><span>{t('home.cashIn')}</span><b>{money(data.cash_received)}</b></div>
                <div><span>{t('home.expenses')}</span><b>{money(data.expenses_total)}</b></div>
                <div><span>{t('home.profit')}</span><b className={data.net_profit < 0 ? 'neg' : ''}>{money(data.net_profit)}</b></div>
              </div>
            </section>

            <section className="dues-row">
              <Link to="/khata?f=due" className="due-card">
                <span className="due-label">{t('home.toCollect')}</span>
                <span className="due-amount red">{money(data.customer_outstanding)}</span>
                <span className="muted small">{t('home.customersOwe', { n: data.customers_with_dues })}</span>
              </Link>
              <Link to="/inventory?f=low" className="due-card">
                <span className="due-label">{t('home.lowStock')}</span>
                <span className={'due-amount ' + (data.low_stock_count ? 'amber' : '')}>{data.low_stock_count}</span>
                <span className="muted small">{t('home.itemsToReorder')}</span>
              </Link>
            </section>

            <section className="quick">
              {actions.map((a) => (
                <button key={a.to} className={'quick-btn ' + a.tone} onClick={() => nav(a.to)}>
                  <span className="quick-icon"><Icon name={a.icon} size={24} /></span>
                  <span>{a.label}</span>
                </button>
              ))}
            </section>

            {data.overdue.length > 0 && (
              <section className="card">
                <div className="card-head"><h3><Icon name="clock" size={18} /> {t('home.reminders')}</h3><Link to="/khata?f=overdue" className="link">{t('common.seeAll')} ({data.overdue_count})</Link></div>
                {data.overdue.map((c) => (
                  <div key={c.id} className="row">
                    <Link to={`/khata/${c.id}`} className="row-main">
                      <Avatar name={c.name} tone="red" />
                      <span><b>{c.name}</b><span className="muted small">{t('khata.overdueDays', { n: daysBetween(c.overdue_since, data.date) })}</span></span>
                    </Link>
                    <span className="row-amount red">{money(c.balance)}</span>
                    {c.phone && (
                      <a className="wa-btn" aria-label="WhatsApp" target="_blank" rel="noreferrer"
                         href={waLink(c.phone, cur, reminderText(t, c.name, money(c.balance), business!.name))}><Icon name="wa" size={20} /></a>
                    )}
                  </div>
                ))}
              </section>
            )}

            {data.low_stock.length > 0 && (
              <section className="card">
                <div className="card-head"><h3><Icon name="alert" size={18} /> {t('home.lowStock')}</h3><Link to="/inventory?f=low" className="link">{t('common.seeAll')}</Link></div>
                {data.low_stock.map((p) => (
                  <Link key={p.id} to={`/inventory/${p.id}`} className="row">
                    <span className="row-main"><span><b>{p.name}</b><span className="muted small">{t('inv.minLevel')}: {Number(p.min_stock)} {p.unit}</span></span></span>
                    <span className={'badge ' + (Number(p.stock_qty) <= 0 ? 'red' : 'amber')}>
                      {Number(p.stock_qty) <= 0 ? t('inv.out') : `${Number(p.stock_qty)} ${p.unit}`}
                    </span>
                  </Link>
                ))}
              </section>
            )}

            <section className="card">
              <div className="card-head"><h3>{t('home.recent')}</h3><Link to="/sales" className="link">{t('common.seeAll')}</Link></div>
              {data.recent.length === 0 && <p className="muted small">{t('home.noActivity')}</p>}
              {data.recent.map((r) => {
                const to = r.kind === 'sale' ? `/sales/${r.id}` : r.customer_id ? `/khata/${r.customer_id}` : '/expenses';
                const inflow = r.kind === 'sale' || r.kind === 'payment';
                return (
                  <Link key={r.kind + r.id} to={to} className={'row' + (r.status !== 'active' ? ' struck' : '')}>
                    <span className={'kind-dot ' + r.kind}><Icon name={r.kind === 'sale' ? 'sale' : r.kind === 'payment' ? 'cashin' : r.kind === 'credit' ? 'credit' : 'expense'} size={16} /></span>
                    <span className="row-main"><span>
                      <b>{r.kind === 'expense' ? t(('exp.' + r.title) as any) : r.kind === 'sale' ? `${t('receipt.bill')} #${r.title}` : r.title}</b>
                      <span className="muted small">{r.kind === 'payment' ? t('khata.paymentReceived') : r.kind === 'credit' ? t('khata.creditGiven') : r.kind === 'sale' ? r.sub || t('sales.walkIn') : r.sub || t('more.expenses')} · {r.date === data.date ? timeShort(r.at, lang, cur) : dateShort(r.date, lang, cur)}</span>
                    </span></span>
                    <span className={'row-amount ' + (r.kind === 'expense' ? 'red' : r.kind === 'credit' ? 'amber' : inflow ? 'green' : '')}>{money(r.amount)}</span>
                  </Link>
                );
              })}
            </section>
            <p className="footnote">{t('home.profitNote')}</p>
          </>
        )}
      </main>
    </div>
  );
}
