// Tiny helpers shared by every module. No framework: h() builds DOM, text is never innerHTML'd.
export const cfg = { tz: 'Asia/Dubai', name: 'Abshar', currency: 'AED', workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00', eveningFrom: '20:00' };

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') throw new Error('no raw html');
    else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) { if (x == null) continue; p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x); } }
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const isMeta = /(^|\s)meta(\s|$)/.test((attrs && attrs.class) || '');   // bare strings in a .meta row become their own items, so they get spacing
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : isMeta ? h('span', {}, String(k)) : document.createTextNode(String(k)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
export const nowIso = () => new Date().toISOString();
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---- dates: user-facing dates are 'YYYY-MM-DD' in the user's timezone; instants are UTC ISO ----
const fmtParts = (d, tz, opt) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opt }).formatToParts(d).map(p => [p.type, p.value]));
export function dateIn(d = new Date(), tz = cfg.tz) { const p = fmtParts(d, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }); return `${p.year}-${p.month}-${p.day}`; }
export const today = () => dateIn();
export function timeIn(d = new Date(), tz = cfg.tz) { const p = fmtParts(d, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); return `${p.hour}:${p.minute}`; }
export function addDays(ds, n) { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addMonths(ds, n) { const [y, m, dd] = ds.split('-').map(Number); const t = m - 1 + n; const ny = y + Math.floor(t / 12), nm = ((t % 12) + 12) % 12; const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate(); return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`; }
export const dow = ds => new Date(ds + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
export function diffDays(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5); }
// local wall-clock in tz -> UTC instant (handles DST by iterating on the offset)
export function localToUtc(ds, hm = '00:00', tz = cfg.tz) {
  const [y, mo, d] = ds.split('-').map(Number), [H, M] = hm.split(':').map(Number);
  let t = Date.UTC(y, mo - 1, d, H, M);
  for (let i = 0; i < 2; i++) { const p = fmtParts(new Date(t), tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); t += Date.UTC(y, mo - 1, d, H, M) - shown; }
  return new Date(t);
}
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const wdName = i => WD[i], monthName = i => MO[i];
export function niceDate(ds, withYear) {
  if (!ds) return '';
  const t = today(), n = diffDays(t, ds);
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  const d = new Date(ds + 'T12:00:00Z'), s = `${WD[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MO[d.getUTCMonth()].slice(0, 3)}`;
  return withYear || ds.slice(0, 4) !== t.slice(0, 4) ? s + ' ' + ds.slice(0, 4) : (n > 0 && n < 7 ? WD[d.getUTCDay()] : s);
}
export const fmtTime = hm => { if (!hm) return ''; const [H, M] = hm.split(':').map(Number); return `${H % 12 || 12}${M ? ':' + String(M).padStart(2, '0') : ''} ${H < 12 ? 'am' : 'pm'}`; };
export const isWorkDay = ds => cfg.workDays.includes(dow(ds));
export function ago(iso) { if (!iso) return 'never'; const s = (Date.now() - new Date(iso)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; }
export const money = (n, c = cfg.currency) => new Intl.NumberFormat('en', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n || 0);
export const pad = n => String(n).padStart(2, '0');
export { mdToNodes } from './md.js';
