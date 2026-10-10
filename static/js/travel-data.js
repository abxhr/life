// Travel data helpers shared by the travel views. Country records have deterministic ids so devices merge instead of duplicating.
import { store } from './store.js';
import { today, diffDays, cfg } from './util.js';
import { world } from './worldmap.js';
import { km, routeKm, isUN, UN_COUNT, DEFAULT_RULES } from './travelcore.js';

export const countryId = a2 => 'c0c0c0c0-0000-4000-8000-' + [...a2].map(c => c.charCodeAt(0).toString(16)).join('').padStart(12, '0');
export const STATUS = [['been', 'Been'], ['lived', 'Lived'], ['want', 'Want to go'], ['planned', 'Planned']];
export const home = () => { const s = window.__settings || {}; return [s.home_lat ?? 25.25, s.home_lon ?? 55.36]; };

export function states() { // effective status per country
  const out = {};
  for (const v of store.list('visit')) out[v.country] = 'been';
  for (const c of store.list('country')) if (c.status) out[c.code] = c.status === 'want' && out[c.code] === 'been' ? 'been' : c.status;
  for (const t of store.list('trip', t => t.status !== 'done' && t.end >= today())) for (const a2 of t.countries || []) if (!out[a2] || out[a2] === 'want') out[a2] = 'planned';
  return out;
}
export const getCountry = a2 => store.getAny(countryId(a2)) ? store.get(countryId(a2)) : null;
export function setStatus(a2, status) { return store.put('country', { code: a2, status: status || null }, countryId(a2)); }
export function visitsOf(a2) { return store.list('visit', v => v.country === a2).sort((a, b) => (b.start || '').localeCompare(a.start || '')); }

export async function stats() {
  const w = await world(), st = states(), vis = store.list('visit');
  const been = Object.entries(st).filter(([a, s]) => s === 'been' || s === 'lived'), un = been.filter(([a]) => isUN(a)).length;
  const conts = new Set(been.map(([a]) => w.byA2[a]?.continent).filter(Boolean)); conts.delete('Antarctica');
  const days = vis.reduce((s, v) => s + (v.start && v.end ? diffDays(v.start, v.end) + 1 : 0), 0);
  let dist = 0; const h = home();
  for (const t of store.list('trip', t => t.status === 'done' || (t.end && t.end < today()))) dist += routeKm(h, (t.countries || []).map(a => w.byA2[a]?.centre));
  const byYear = {}; vis.forEach(v => { if (v.start) (byYear[v.start.slice(0, 4)] ||= new Set()).add(v.country); });
  return { count: been.length, un, pct: Math.round(un / UN_COUNT * 100), continents: conts.size, days, km: Math.round(dist), byYear };
}
export const rules = () => (window.__settings && window.__settings.stay_rules) || DEFAULT_RULES;  // null -> built-in rules
export const passports = () => store.list('travel_doc', d => d.type === 'passport');
export function stayEntries() { return store.list('stay_log').map(s => ({ country: s.country, entry: s.entry, exit: s.exit || null })); }
