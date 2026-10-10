// In-app reminders: while Life is open, due reminders and task reminders surface as a card you can Done / OK / Snooze.
// (Telegram and web push cover the closed-app case; critical ones keep re-nagging server-side until acknowledged.)
import { h, localToUtc, addDays, today, cfg, timeIn, nowIso } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, field } from './ui.js';
import { completeTask } from './tasks-core.js';
import { nearbyDue } from './geo-core.js';

const shown = new Map();   // id -> ms of last display (this session)
let box;
const layer = () => box || (box = document.querySelector('.toasts') || document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));

export function snoozeTo(kind, id, iso) { store.put(kind, { remind_at: iso, last_fired: null, acked: false }, id); }
const inQuiet = () => { const s = window.__settings || {}, n = timeIn(), qf = s.quiet_from || '23:00', qt = s.quiet_to || '07:00'; return qf > qt ? (n >= qf || n < qt) : (n >= qf && n < qt); };

function card(it) {
  const { kind, rec } = it, snooze = iso => { snoozeTo(kind, rec.id, iso); c.remove(); };
  const later = ms => new Date(Date.now() + ms).toISOString();
  const tomorrow = () => localToUtc(addDays(today(), 1), '09:00', cfg.tz).toISOString();
  const pick = () => modal((d, close) => { const dt = h('input', { class: 'in', type: 'datetime-local' }); d.append(h('h2', {}, 'Snooze until'), field('When', dt), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (dt.value) { snooze(new Date(dt.value).toISOString()); close(); } } }, 'Snooze'))); });
  const menu = h('div', { class: 'row wrap hide', style: { marginTop: '6px' } }, [['10 min', () => later(10 * 60e3)], ['1 hour', () => later(3600e3)], ['Tomorrow morning', tomorrow]].map(([l, f]) => h('button', { class: 'chip', onclick: () => snooze(f()) }, l)), h('button', { class: 'chip', onclick: pick }, 'Pick…'));
  const c = h('div', { class: 'toast remind', style: { display: 'block', background: 'var(--sticky)', color: 'var(--sticky-ink)' } }, h('div', { class: 'row' }, icon('bell'), h('b', { style: { fontWeight: 400, fontSize: '1.2rem', flex: 1 } }, (rec.critical ? 'Important: ' : '') + (rec.title || rec.text))),
    h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => { kind === 'task' ? completeTask(rec) : store.put('reminder', { done: true, acked: true }, rec.id); c.remove(); } }, icon('check'), 'Done'),
      h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => { store.put(kind, { acked: true }, rec.id); c.remove(); } }, 'OK'), h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => menu.classList.toggle('hide') }, icon('clock'), 'Snooze')), menu);
  return c;
}

export function dueNow(now = Date.now()) {
  const out = [];
  for (const t of store.list('task', t => !t.done && !t.acked && t.remind_at)) if (new Date(t.remind_at).getTime() <= now) out.push({ kind: 'task', rec: t });
  for (const r of store.list('reminder', r => !r.done && !r.acked && r.remind_at)) if (new Date(r.remind_at).getTime() <= now) out.push({ kind: 'reminder', rec: r });
  return out;
}
export function check() {
  const now = Date.now();
  for (const it of dueNow(now)) {
    const last = shown.get(it.rec.id), crit = !!it.rec.critical;
    if (last && !(crit && now - last > 10 * 60e3)) continue;
    if (inQuiet() && !crit) continue;
    shown.set(it.rec.id, now);
    layer().append(card(it));
    try { if (Notification.permission === 'granted' && document.hidden) new Notification((crit ? 'Important: ' : '') + (it.rec.title || it.rec.text)); } catch { /* not allowed */ }
  }
}
// ---- "remind me near a place": uses the browser's location while Life is open (web apps can't geofence in the background; Telegram/push can't know where you are) ----
let watching = false; const seen = new Set();
function startGeo() {
  if (watching || !navigator.geolocation || !store.list('task', t => t.near && !t.done).length) return;
  const go = () => { if (watching) return; watching = true; navigator.geolocation.watchPosition(p => { const pos = { lat: p.coords.latitude, lon: p.coords.longitude }; for (const t of nearbyDue(pos, store.list('task', x => x.near && !x.done), seen)) { seen.add(t.id); layer().append(card({ kind: 'task', rec: { ...t, title: 'You’re nearby: ' + t.title } })); } }, () => {}, { maximumAge: 60000, timeout: 20000 }); };
  navigator.permissions?.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') go(); else if (r.state === 'prompt' && sessionStorage.getItem('geoAsked') !== '1') { sessionStorage.setItem('geoAsked', '1'); go(); } }).catch(() => {});
}
export function startReminderWatcher() { setTimeout(startGeo, 3000); setTimeout(check, 1500); setInterval(check, 20000); store.subscribe(() => setTimeout(() => { check(); startGeo(); }, 300)); }
