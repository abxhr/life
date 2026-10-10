// Goals: progress (numeric / checklist / live-linked), pace estimate, life areas, wins.
import { store } from './store.js';
import { today, diffDays, addDays, nowIso } from './util.js';

export const AREAS = ['health', 'career', 'money', 'relationships', 'family', 'learning', 'fun / adventure', 'home', 'peace'];
export const LIVE = {
  net_worth: { label: 'Net worth (wealth app)', unit: 'AED' },
  month_km: { label: 'Km run this month (Garmin)', unit: 'km' },
  month_active: { label: 'Active minutes this month (Garmin)', unit: 'min' },
  avg_sleep: { label: 'Average sleep last 30 days (Garmin)', unit: 'h' },
  weight: { label: 'Weight (Garmin / manual)', unit: 'kg' },
};
export function liveValue(metric, wealth) {
  const T = today(), ym = T.slice(0, 7);
  if (metric === 'net_worth') return wealth && wealth.net_worth != null ? wealth.net_worth : null;
  if (metric === 'month_km') { const a = store.list('garmin_activity', x => (x.day || '').startsWith(ym) && /run/i.test(x.type || '')); return a.length ? +(a.reduce((s, x) => s + (x.distance_km || 0), 0)).toFixed(1) : null; }
  if (metric === 'month_active') { const d = store.list('garmin_daily', x => (x.day || '').startsWith(ym)); return d.length ? d.reduce((s, x) => s + (x.active_min || 0), 0) : null; }
  if (metric === 'avg_sleep') { const d = store.list('garmin_daily', x => x.day >= addDays(T, -30) && x.sleep_h); return d.length ? +(d.reduce((s, x) => s + x.sleep_h, 0) / d.length).toFixed(2) : null; }
  if (metric === 'weight') { const d = [...store.list('garmin_daily', x => x.weight), ...store.list('manual_log', x => x.kind === 'weight')].sort((a, b) => (b.day || '').localeCompare(a.day || '')); return d[0] ? (d[0].weight ?? d[0].value) : null; }
  return null;
}
// returns {pct 0-100, current, target, unit, label, pace:'ahead'|'on'|'behind'|null, projected:'YYYY-MM-DD'|null}
export function progress(g, wealth) {
  const m = g.milestones || [];
  if (g.live) {
    const v = liveValue(g.live, wealth); const t = g.target && g.target.goal;
    if (v != null && t) return pace(g, v, t, g.target.start ?? 0, LIVE[g.live].unit, `${fmt(v)} of ${fmt(t)} ${LIVE[g.live].unit}`);
    return { pct: 0, label: v == null ? 'waiting for data' : `${fmt(v)} ${LIVE[g.live].unit}`, unit: LIVE[g.live].unit };
  }
  if (g.target && g.target.type === 'numeric' && g.target.goal != null) return pace(g, g.target.current ?? g.target.start ?? 0, g.target.goal, g.target.start ?? 0, g.target.unit || '', `${fmt(g.target.current ?? 0)} of ${fmt(g.target.goal)} ${g.target.unit || ''}`);
  if (m.length) { const d = m.filter(x => x.done).length; return { pct: Math.round(d / m.length * 100), label: `${d} of ${m.length} steps` }; }
  return { pct: g.status === 'achieved' ? 100 : 0, label: g.status === 'achieved' ? 'done' : 'no target yet' };
}
const fmt = n => n >= 1000 ? Math.round(n).toLocaleString() : +(+n).toFixed(1);
function pace(g, cur, goal, start, unit, label) {
  const span = goal - start, pct = span ? Math.max(0, Math.min(100, Math.round((cur - start) / span * 100))) : 0, out = { pct, current: cur, target: goal, unit, label, pace: null, projected: null };
  const t0 = (g.started || g.created_at || '').slice(0, 10), T = today(), days = t0 ? diffDays(t0, T) : 0;
  if (days >= 7 && cur > start && span > 0) {
    const rate = (cur - start) / days, left = (goal - cur) / rate; if (isFinite(left) && left < 36500) out.projected = addDays(T, Math.max(0, Math.round(left)));
    if (g.deadline && out.projected) { const slack = diffDays(out.projected, g.deadline); out.pace = slack > 14 ? 'ahead' : slack >= -14 ? 'on' : 'behind'; }
  }
  return out;
}
export function addWin(title, source = 'manual', extra = {}) { return store.put('win', { title, source, day: today(), ...extra }); }
export function achieve(g) { store.put('goal', { status: 'achieved', achieved_at: nowIso() }, g.id); addWin(`Achieved: ${g.title}`, 'goal', { goal: g.id }); }
export const activeBig = () => store.list('goal', g => g.status === 'active' && g.quarterly);
