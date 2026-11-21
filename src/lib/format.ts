import type { Lang } from './i18n';

const localeFor = (lang: Lang, currency: string) =>
  lang === 'ar' ? 'ar-AE' : currency === 'AED' ? 'en-AE' : lang === 'ml' ? 'ml-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';

// Digits stay Latin (shop owners read and type 0-9) but grouping follows the currency: ₹1,50,000 vs AED 150,000.
export function money(v: number | string | null | undefined, currency = 'INR', opts: { sign?: boolean; compact?: boolean } = {}) {
  const n = Number(v || 0);
  const fmt = new Intl.NumberFormat(currency === 'AED' ? 'en-AE' : 'en-IN', {
    style: 'currency', currency, currencyDisplay: currency === 'AED' ? 'code' : 'narrowSymbol',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
    notation: opts.compact && Math.abs(n) >= 100000 ? 'compact' : 'standard',
  });
  const s = fmt.format(Math.abs(n));
  if (opts.sign && n !== 0) return (n > 0 ? '+' : '−') + s;
  return n < 0 ? '−' + s : s;
}

export function qty(v: number | string, unit?: string | null) {
  const n = Number(v);
  const s = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n);
  return unit ? `${s} ${unit}` : s;
}

export function dateShort(d: string | null | undefined, lang: Lang, currency = 'INR') {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return new Intl.DateTimeFormat(localeFor(lang, currency), { day: 'numeric', month: 'short' }).format(dt);
}
export function dateLong(d: string | null | undefined, lang: Lang, currency = 'INR') {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return new Intl.DateTimeFormat(localeFor(lang, currency), { day: 'numeric', month: 'short', year: 'numeric' }).format(dt);
}
export function timeShort(d: string, lang: Lang, currency = 'INR') {
  return new Intl.DateTimeFormat(localeFor(lang, currency), { hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}

export function todayISO(tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

// Round to paise/fils the same way the server does (half away from zero).
export const round2 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON) / 100;

/** International number for wa.me — assumes local numbers belong to the shop's country. */
export function waNumber(phone: string | null | undefined, currency: string) {
  if (!phone) return '';
  let p = phone.replace(/[^0-9]/g, '');
  if (phone.trim().startsWith('+')) return p;
  p = p.replace(/^0+/, '');
  if (currency === 'AED' && p.length === 9) return '971' + p;
  if (currency === 'INR' && p.length === 10) return '91' + p;
  return p;
}
export function waLink(phone: string | null | undefined, currency: string, text: string) {
  const n = waNumber(phone, currency);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
