import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from './lib/store';

// ── icons (inline, 24px grid, stroke) ────────────────────────────────────────────
const P: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  sale: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 7h6M9 11h6M9 15h4" /></>,
  khata: <><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  box: <><path d="m3 7 9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  back: <path d="M15 18 9 12l6-6" />,
  chev: <path d="m9 6 6 6-6 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  userplus: <><circle cx="10" cy="8" r="4" /><path d="M2 21a8 8 0 0 1 14-5.3M19 14v6M16 17h6" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" /><circle cx="16" cy="14.5" r="1.3" /></>,
  credit: <><path d="M12 3v18M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5s2 2.8 5 3.5 5 1.6 5 3.7-2.2 3.3-5 3.3-5-1.2-5-3.2" /></>,
  cashin: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></>,
  expense: <><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  wa: <><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.5z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-.9-.4-1.6-1.1-2-2l.8-1-1-2z" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></>,
  print: <><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
  trend: <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  cloud: <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 9.5 4.5 4.5 0 0 1 18.5 18z" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  tag: <><path d="M3 12V3h9l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
};
export function Icon({ name, size = 22, stroke = 2, className }: { name: keyof typeof P | string; size?: number; stroke?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────────
export function Screen({ title, back, right, children, className = '' }: { title?: ReactNode; back?: boolean | string; right?: ReactNode; children: ReactNode; className?: string }) {
  const nav = useNavigate();
  return (
    <div className={'screen ' + className}>
      {(title || back) && (
        <header className="topbar">
          {back ? (
            <button className="icon-btn" aria-label="Back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
              <Icon name="back" className="flip-rtl" />
            </button>
          ) : <span className="topbar-spacer" />}
          <h1 className="topbar-title">{title}</h1>
          <div className="topbar-right">{right}</div>
        </header>
      )}
      <main className="content">{children}</main>
    </div>
  );
}

export function BottomNav() {
  const { t } = useApp();
  const items = [
    { to: '/', icon: 'home', label: t('nav.home'), end: true },
    { to: '/sales', icon: 'sale', label: t('nav.sales') },
    { to: '/khata', icon: 'khata', label: t('nav.khata') },
    { to: '/inventory', icon: 'box', label: t('nav.inventory') },
    { to: '/more', icon: 'more', label: t('nav.more') },
  ];
  return (
    <nav className="bottomnav">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <Icon name={i.icon} size={23} />
          <span>{i.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  if (!toastMsg) return null;
  return <div className={'toast ' + toastMsg.kind} role="status">{toastMsg.msg}</div>;
}

export function SyncBanner() {
  const { pending, t } = useApp();
  if (!pending) return null;
  return <div className="sync-banner"><Icon name="cloud" size={16} /> {t('sync.pending', { n: pending })}</div>;
}

// ── bits ─────────────────────────────────────────────────────────────────────────
export function Loader() { return <div className="loader"><span /><span /><span /></div>; }

export function Empty({ icon = 'sparkle', title, sub, action }: { icon?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={28} /></div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { errorText } = useApp();
  if (!error) return null;
  return <div className="error-box"><Icon name="alert" size={18} /> {errorText(error)}</div>;
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="chips" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
                className={'chip' + (value === o.value ? ' on' : '')} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" size={19} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="search" />
      {value && <button type="button" className="search-x" onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={16} /></button>}
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Big amount entry with currency prefix; keeps the raw string so "12." can be typed. */
export function AmountInput({ value, onChange, autoFocus, placeholder = '0' }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  const { business } = useApp();
  const sym = business?.currency === 'AED' ? 'AED' : '₹';
  return (
    <div className="amount-input">
      <span className="amount-sym">{sym}</span>
      <input inputMode="decimal" autoFocus={autoFocus} placeholder={placeholder} value={value}
             onChange={(e) => {
               const v = e.target.value.replace(/[^0-9.]/g, '');
               if (/^\d{0,10}(\.\d{0,2})?$/.test(v)) onChange(v);
             }} />
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Button that prevents double-submit: disabled while the promise runs. */
export function SaveButton({ onClick, children, disabled, className = 'btn primary block' }: { onClick: () => Promise<unknown>; children: ReactNode; disabled?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={disabled || busy}
            onClick={async () => { if (busy) return; setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
      {busy ? <span className="spinner" /> : children}
    </button>
  );
}

export function Avatar({ name, tone }: { name: string; tone?: 'red' | 'green' }) {
  const initials = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span className={'avatar ' + (tone || '')}>{initials || '?'}</span>;
}
