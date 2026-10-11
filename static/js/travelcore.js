// Travel logic that must be right: counted-stay calculators, passport validity, leave bridges, distance, checklists. Pure; tested.
import { addDays, diffDays, dow } from './util.js';

// Editable in Settings — rules change. Dates of last review are shown next to any rule you rely on.
export const SCHENGEN = ['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH'];
export const DEFAULT_RULES = [
  { id: 'schengen', name: 'Schengen 90/180', kind: 'rolling', limit: 90, window: 180, countries: SCHENGEN },
  { id: 'uk', name: 'UK visitor (6 months per visit)', kind: 'per_visit', limit: 180, countries: ['GB'] },
];
const NON_UN = new Set(['TW', 'XK', 'VA', 'PS', 'EH', 'GL', 'PR', 'NC', 'TF', 'FK', 'AQ', 'HK', 'MO', 'AW', 'CW', 'SX', 'GU', 'VI', 'KY', 'BM', 'FO', 'GI', 'PF']);
export const isUN = a2 => !NON_UN.has(a2);
export const UN_COUNT = 193;

// presence days inclusive of entry and exit day (the conservative reading used for Schengen counting)
function presence(entries, countries, asOf) {
  const set = new Set(), scope = countries ? new Set(countries) : null;
  for (const e of entries) {
    if (scope && !scope.has(e.country)) continue;
    const end = e.exit || asOf; if (!e.entry || e.entry > asOf) continue;
    for (let d = e.entry; d <= end && d <= asOf; d = addDays(d, 1)) set.add(d);
  }
  return set;
}
export function stayCalc(entries, rule, asOf) {
  if (rule.kind === 'per_visit') {
    const open = entries.filter(e => rule.countries.includes(e.country) && e.entry <= asOf && (!e.exit || e.exit >= asOf)).sort((a, b) => b.entry.localeCompare(a.entry))[0];
    const used = open ? diffDays(open.entry, asOf) + 1 : 0;
    return { used, remaining: rule.limit - used, leaveBy: open ? addDays(open.entry, rule.limit - 1) : null, kind: 'per_visit' };
  }
  const days = presence(entries, rule.countries, asOf), start = addDays(asOf, -(rule.window - 1));
  const usedAt = d => { let n = 0; for (let i = 0; i < rule.window; i++) if (days.has(addDays(d, -i))) n++; return n; };
  const used = usedAt(asOf);
  let nextFree = null; if (used >= rule.limit) { for (let i = 1; i < 800; i++) { const d = addDays(asOf, i); if (usedAt(d) < rule.limit) { nextFree = d; break; } } } // first day you could re-enter (assuming no further stays)
  let maxStay = 0; for (let i = 1; i <= 365; i++) { const d = addDays(asOf, i), withStay = new Set(days); for (let k = 1; k <= i; k++) withStay.add(addDays(asOf, k)); let n = 0; for (let j = 0; j < rule.window; j++) if (withStay.has(addDays(d, -j))) n++; if (n > rule.limit) break; maxStay = i; }
  return { used, remaining: Math.max(0, rule.limit - used), windowStart: start, nextFree, maxStayStartingTomorrow: maxStay, kind: 'rolling' };
}
// would a planned trip (entry..exit) break the rule, given entries so far?
export function tripFits(entries, rule, entry, exit) {
  const trial = [...entries, { country: rule.countries[0], entry, exit }];
  for (let d = entry; d <= exit; d = addDays(d, 1)) { const c = stayCalc(trial, rule, d); if (c.kind === 'rolling' && c.used > rule.limit) return { ok: false, firstBadDay: d }; if (c.kind === 'per_visit' && c.used > rule.limit) return { ok: false, firstBadDay: d }; }
  return { ok: true };
}

export function passportOkAt(expiry, tripEnd, months = 6) { if (!expiry) return { ok: null }; const need = new Date(tripEnd + 'T12:00:00Z'); need.setUTCMonth(need.getUTCMonth() + months); const needStr = need.toISOString().slice(0, 10); return { ok: expiry >= needStr, validUntilNeeded: needStr }; }
export const visaStale = (verified, today, days = 183) => !verified || diffDays(verified, today) > days;

export function km(a, b) { const R = 6371, r = x => x * Math.PI / 180, dl = r(b[0] - a[0]), dn = r(b[1] - a[1]); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
export const flightHours = d => Math.round((d / 800 + 0.75) * 2) / 2;
export function routeKm(home, stops) { let t = 0, prev = home; for (const s of stops) { if (s) { t += km(prev, s); prev = s; } } return t + km(prev, home); }

// Turn a few leave days into long breaks. holidays: ['YYYY-MM-DD']. workDays: [1..5]. Returns best windows first.
export function bridges(holidays, workDays, year, maxLeave = 5) {
  const hol = new Set(holidays), isOff = d => !workDays.includes(dow(d)) || hol.has(d), out = [], seen = new Set();
  for (const h of holidays) {
    if (!h.startsWith(String(year))) continue;
    for (let back = 0; back <= 8; back++) for (let fwd = 0; fwd <= 8; fwd++) {
      const s = addDays(h, -back), e = addDays(h, fwd); let leave = 0, ok = true;
      for (let d = s; d <= e; d = addDays(d, 1)) if (!isOff(d)) leave++;
      if (leave === 0 || leave > maxLeave) continue;
      let a = s; while (isOff(addDays(a, -1))) a = addDays(a, -1); let b = e; while (isOff(addDays(b, 1))) b = addDays(b, 1);   // extend over adjoining weekend/holidays
      const key = a + b; if (seen.has(key)) continue; seen.add(key);
      const len = diffDays(a, b) + 1; if (len >= leave + 3) out.push({ start: a, end: b, leave, off: len, ratio: len / leave });
    }
  }
  return out.sort((x, y) => y.ratio - x.ratio || y.off - x.off).filter((w, i, arr) => !arr.slice(0, i).some(p => !(w.end < p.start || w.start > p.end))).slice(0, 8);
}
export function leaveNeeded(start, end, workDays, holidays) { let n = 0; for (let d = start; d <= end; d = addDays(d, 1)) if (workDays.includes(dow(d)) && !holidays.includes(d)) n++; return n; }

// Pre-trip checklist, built from what we know about the destination(s). status: ok | todo | warn
const ymdAdd = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export function buildChecklist(trip, ctx) {
  const items = [], end = trip.end || trip.start, T = ctx.today;
  const add = (key, title, status = 'todo', note = '') => items.push({ key, title, status, note, done: status === 'ok' });
  const passports = ctx.docs.filter(d => d.type === 'passport');
  if (!passports.length) add('passport', 'Passport valid 6+ months after you return', 'warn', 'No passport recorded in Documents yet.');
  else passports.forEach(p => { const r = passportOkAt(p.expiry, end); add('passport:' + p.id, `Passport ${p.nationality || ''} valid 6+ months after you return`, r.ok ? 'ok' : 'warn', r.ok ? `valid to ${p.expiry}` : `expires ${p.expiry} — needs ${r.validUntilNeeded}`); });
  for (const c of trip.countries || []) {
    const held = ctx.docs.filter(d => d.type === 'visa' && (d.nationality || '').toUpperCase() === c);   // a visa you already hold for this country
    if (held.length) { held.forEach(v => { const okV = !v.expiry || v.expiry >= end; add('visa:' + c + ':' + v.id, `Visa for ${ctx.countryName(c)}: you hold ${v.name || 'a visa'}`, okV ? 'ok' : 'warn', v.expiry ? (okV ? `valid to ${v.expiry}` : `expires ${v.expiry}, before you return`) : 'no end date recorded, check it covers your dates'); }); continue; }
    const ec = ctx.entry && ctx.entry[c];   // what the airline data says for MY passport (Travel → country → "Entry for you")
    if (ec && ec.verdict && ec.verdict !== 'unclear') {
      const nm = ctx.countryName(c), by = trip.start ? ' by ' + ymdAdd(trip.start, ec.verdict === 'visa_required' ? -30 : -14) : '';
      if (ec.verdict === 'visa_free' || ec.verdict === 'on_arrival') add('visa:' + c, `Visa for ${nm}: ${ec.verdict === 'on_arrival' ? 'issued on arrival' : 'nothing to apply for'}`, 'ok', ec.reason || '');
      else if (ec.verdict === 'eta_or_evisa') add('visa:' + c, `Apply online for ${nm} (e-visa / authorisation)${by}`, 'todo', (ec.steps || []).join(' · '));
      else if (ec.verdict === 'visa_required') add('visa:' + c, `Get a visa for ${nm} from the embassy${by}`, 'todo', 'Embassy visas can take weeks.');
      continue;
    }
    const rules = ctx.rules.filter(r => r.country === c);
    if (!rules.length) add('visa:' + c, `Visa: check entry rules for ${ctx.countryName(c)}`, 'todo', 'Record what you find on the official government site.');
    rules.forEach(r => { const stale = visaStale(r.verified_on, T); add('visa:' + c + r.passport, `Visa (${r.passport || 'passport'}) → ${ctx.countryName(c)}: ${r.status}`, ['visa-free'].includes(r.status) && !stale ? 'ok' : 'todo', stale ? 'rule last verified long ago — re-check the official source' : ''); });
  }
  const ins = ctx.docs.find(d => d.type === 'insurance' && d.expiry >= end && (!d.issued || d.issued <= trip.start)); add('insurance', 'Travel insurance covers these dates', ins ? 'ok' : 'todo', ins ? ins.name : '');
  ['Vaccinations / health requirements checked', 'Cards told + some local currency', 'eSIM or roaming sorted', 'Power adapter', 'Offline maps downloaded', 'Airport transfers booked'].forEach((t, i) => add('x' + i, t));
  return items;
}
