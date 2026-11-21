import { useState } from 'react';
import { useApp } from '../lib/store';
import { cloudConfigured, rpc, setMode, supabase } from '../lib/backend';
import { LANGS, type Lang } from '../lib/i18n';
import { Icon, Field, SaveButton, ErrorBox } from '../ui';

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0B6E4F" />
      <path d="M18 18h28M18 27h28M30 18c8 0 12 3 12 9s-4 9-12 9h-6l16 14" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="48" r="7" fill="#7BE0B0" />
    </svg>
  );
}

function LangPills() {
  const { lang, setLang } = useApp();
  return (
    <div className="lang-pills">
      {LANGS.filter((l) => l.ready).map((l) => (
        <button key={l.code} className={'pill' + (lang === l.code ? ' on' : '')} onClick={() => setLang(l.code)}>{l.native}</button>
      ))}
    </div>
  );
}

export function Welcome() {
  const { t, reload } = useApp();
  const [view, setView] = useState<'start' | 'login' | 'signup'>('start');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState('');

  async function startDemo() {
    setMode('demo');
    await reload();
  }

  async function submit() {
    setError(null); setInfo('');
    try {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(t('auth.badEmail'));
      if (password.length < 8) throw new Error(t('auth.badPassword'));
      if (view === 'signup') {
        const { data, error } = await supabase().auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) { setInfo(t('auth.checkEmail')); setView('login'); return; }
      } else {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      setMode('cloud');
      await reload();
    } catch (e) { setError(e); }
  }

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <Logo size={64} />
        <h1>HisabEasy</h1>
        <p className="tagline">{t('app.tagline')}</p>
        <LangPills />
      </div>

      {view === 'start' ? (
        <div className="welcome-card">
          <ul className="welcome-points">
            <li><Icon name="sale" size={20} /> {t('welcome.p1')}</li>
            <li><Icon name="khata" size={20} /> {t('welcome.p2')}</li>
            <li><Icon name="wa" size={20} /> {t('welcome.p3')}</li>
            <li><Icon name="box" size={20} /> {t('welcome.p4')}</li>
          </ul>
          {cloudConfigured && <button className="btn primary block" onClick={() => setView('signup')}>{t('auth.create')}</button>}
          {cloudConfigured && <button className="btn ghost block" onClick={() => setView('login')}>{t('auth.haveAccount')}</button>}
          <button className={'btn block ' + (cloudConfigured ? 'link' : 'primary')} onClick={startDemo}>
            <Icon name="sparkle" size={18} /> {t('auth.tryDemo')}
          </button>
          {!cloudConfigured && <p className="muted small center">{t('auth.demoOnly')}</p>}
        </div>
      ) : (
        <div className="welcome-card">
          <h2>{view === 'signup' ? t('auth.create') : t('auth.signIn')}</h2>
          <Field label={t('auth.email')}>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
          </Field>
          <Field label={t('auth.password')} hint={view === 'signup' ? t('auth.passwordHint') : undefined}>
            <input type="password" autoComplete={view === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {info && <div className="info-box">{info}</div>}
          <ErrorBox error={error} />
          <SaveButton onClick={submit}>{view === 'signup' ? t('auth.create') : t('auth.signIn')}</SaveButton>
          <button className="btn link block" onClick={() => setView(view === 'signup' ? 'login' : 'signup')}>
            {view === 'signup' ? t('auth.haveAccount') : t('auth.newHere')}
          </button>
          <button className="btn link block" onClick={() => setView('start')}>{t('common.back')}</button>
        </div>
      )}
    </div>
  );
}

const CATEGORIES = ['grocery', 'minimart', 'retail', 'hardware', 'electrical', 'wholesale', 'restaurant', 'mobile', 'trader'] as const;
const CAT_ICON: Record<string, string> = { grocery: 'tag', minimart: 'box', retail: 'sale', hardware: 'settings', electrical: 'sparkle', wholesale: 'layers', restaurant: 'clock', mobile: 'phone', trader: 'trend' };

export function Onboarding() {
  const { t, lang, setLang, reload, demo } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(demo ? 'ABC Stores' : '');
  const [category, setCategory] = useState('grocery');
  const [currency, setCurrency] = useState<'INR' | 'AED'>('INR');
  const [withDemo, setWithDemo] = useState(true);
  const [error, setError] = useState<unknown>(null);

  async function finish() {
    setError(null);
    try {
      await rpc('create_business', { p_name: name.trim(), p_category: category, p_currency: currency, p_language: lang, p_with_demo: withDemo });
      await reload();
    } catch (e) { setError(e); }
  }

  const steps = [
    <div key="n">
      <h2>{t('onb.nameQ')}</h2>
      <p className="muted">{t('onb.nameHint')}</p>
      <input className="big-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('onb.namePh')} maxLength={120} />
      <button className="btn primary block" disabled={!name.trim()} onClick={() => setStep(1)}>{t('common.next')}</button>
    </div>,
    <div key="c">
      <h2>{t('onb.catQ')}</h2>
      <div className="tile-grid">
        {CATEGORIES.map((c) => (
          <button key={c} className={'tile' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>
            <Icon name={CAT_ICON[c]} size={24} /><span>{t(('cat.' + c) as any)}</span>
          </button>
        ))}
      </div>
      <button className="btn primary block" onClick={() => setStep(2)}>{t('common.next')}</button>
    </div>,
    <div key="l">
      <h2>{t('onb.langQ')}</h2>
      <div className="option-list">
        {LANGS.map((l) => (
          <button key={l.code} disabled={!l.ready} className={'option' + (lang === l.code ? ' on' : '')} onClick={() => setLang(l.code as Lang)}>
            <span className="option-main">{l.native}</span>
            <span className="option-sub">{l.ready ? l.english : t('common.soon')}</span>
            {lang === l.code && <Icon name="check" />}
          </button>
        ))}
      </div>
      <button className="btn primary block" onClick={() => setStep(3)}>{t('common.next')}</button>
    </div>,
    <div key="cur">
      <h2>{t('onb.curQ')}</h2>
      <div className="option-list">
        {(['INR', 'AED'] as const).map((c) => (
          <button key={c} className={'option' + (currency === c ? ' on' : '')} onClick={() => setCurrency(c)}>
            <span className="option-main">{c === 'INR' ? '₹ INR' : 'AED'}</span>
            <span className="option-sub">{c === 'INR' ? t('onb.india') : t('onb.uae')}</span>
            {currency === c && <Icon name="check" />}
          </button>
        ))}
      </div>
      <label className="toggle-row">
        <span><b>{t('onb.sample')}</b><br /><span className="muted small">{t('onb.sampleHint')}</span></span>
        <input type="checkbox" className="switch" checked={withDemo} onChange={(e) => setWithDemo(e.target.checked)} />
      </label>
      <ErrorBox error={error} />
      <SaveButton onClick={finish}>{t('onb.start')}</SaveButton>
    </div>,
  ];

  return (
    <div className="onboarding">
      <div className="onb-top">
        {step > 0 ? <button className="icon-btn" onClick={() => setStep(step - 1)} aria-label="Back"><Icon name="back" className="flip-rtl" /></button> : <Logo size={36} />}
        <div className="progress"><div style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
        <span className="muted small">{step + 1}/{steps.length}</span>
      </div>
      <div className="onb-body">{steps[step]}</div>
    </div>
  );
}
