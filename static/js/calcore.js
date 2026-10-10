// Merges everything that lives on a day: native events, ICS feed events, time-blocked tasks, due tasks, reminders, trips.
import { store } from './store.js';
import { dateIn, timeIn, addDays, diffDays, localToUtc, cfg, today } from './util.js';
import { inMode, isWork } from './state.js';

let feedCache = { key: '', rows: [] };
export async function loadFeeds(from, to) {
  const key = from + '|' + to;
  if (feedCache.key === key) return feedCache.rows;
  try {
    const rows = await store.api(`/api/ics?from=${from}T00:00:00Z&to=${addDays(to, 1)}T00:00:00Z`);
    feedCache = { key, rows }; try { localStorage.setItem('feedcache', JSON.stringify(rows.slice(0, 1500))); } catch { /* quota */ }
    return rows;
  } catch { try { feedCache = { key: '', rows: JSON.parse(localStorage.getItem('feedcache') || '[]') }; } catch { feedCache = { key: '', rows: [] }; } return feedCache.rows; }
}
export const feedMeta = () => Object.fromEntries((window.__settings?.feeds || []).map(f => [f.id || f.url.slice(-12), f]));

// one normalized entry per occurrence on `ds`
export function dayItems(ds, feeds = feedCache.rows) {
  const out = [];
  const fm = feedMeta();
  for (const e of feeds) {
    const f = fm[e.feed] || {};
    const work = !!f.work;
    if (e.allday) { if (e.start <= ds && ds < e.end) out.push({ type: 'feed', id: e.uid, title: e.title, allday: true, color: f.color, work, loc: e.loc }); continue; }
    const s = new Date(e.start), en = new Date(e.end), sd = dateIn(s), ed = dateIn(new Date(en - 1));
    if (sd <= ds && ds <= ed) out.push({ type: 'feed', id: e.uid, title: e.title, start: sd === ds ? timeIn(s) : '00:00', end: ed === ds ? timeIn(en) : '23:59', color: f.color, work, loc: e.loc });
  }
  for (const e of store.list('event')) {
    const last = e.end_date || e.date;
    if (e.date <= ds && ds <= last) out.push({ type: 'event', id: e.id, title: e.title, allday: !!e.allday, start: e.allday ? null : (e.date === ds ? e.start : '00:00'), end: e.allday ? null : (last === ds ? e.end || e.start : '23:59'), work: isWork(e), color: e.color, ref: e });
  }
  for (const t of store.list('task', t => !t.done)) {
    if (t.scheduled === ds && t.sched_time) out.push({ type: 'block', id: t.id, title: t.title, start: t.sched_time, end: addMin(t.sched_time, t.est || 30), work: isWork(t), ref: t });
    else if (t.due === ds && t.due_time) out.push({ type: 'taskdue', id: t.id, title: t.title, start: t.due_time, end: addMin(t.due_time, t.est || 15), work: isWork(t), ref: t });
  }
  for (const r of store.list('reminder', r => !r.done)) { const at = r.remind_at && new Date(r.remind_at); if (at && dateIn(at) === ds) out.push({ type: 'reminder', id: r.id, title: r.title, start: timeIn(at), end: addMin(timeIn(at), 15), work: false, ref: r }); }
  for (const tr of store.list('trip')) if (tr.start && tr.end && tr.start <= ds && ds <= tr.end) out.push({ type: 'trip', id: tr.id, title: '✈ ' + tr.name, allday: true, color: 'var(--d-travel)', work: false });
  return out.filter(it => state_ok(it)).sort((a, b) => (a.allday ? 0 : 1) - (b.allday ? 0 : 1) || (a.start || '').localeCompare(b.start || ''));
}
const state_ok = it => inMode({ ctx: it.work ? 'work' : 'personal' });
export function addMin(hm, m) { let [H, M] = hm.split(':').map(Number); let t = H * 60 + M + m; if (t >= 1440) t = 1439; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); }
export const toMin = hm => { const [H, M] = hm.split(':').map(Number); return H * 60 + M; };
export function nowBlock(ds = today()) { // current and next timed item
  const n = timeIn(), items = dayItems(ds).filter(i => !i.allday && i.start);
  return { now: items.find(i => i.start <= n && (i.end || i.start) > n) || null, next: items.find(i => i.start > n) || null };
}
