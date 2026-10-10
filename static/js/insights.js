// Plain-sentence patterns between how you feel and what you did. Needs a minimum sample before saying anything.
// days: [{day, mood, energy, sleep_h, steps, workout, caffeine, alcohol, weekend}]  (fields optional)
const mean = a => a.reduce((s, x) => s + x, 0) / a.length, f1 = n => n.toFixed(1);

const FACTORS = [
  { key: 'sleep', a: d => d.sleep_h != null && d.sleep_h < 6.5, b: d => d.sleep_h != null && d.sleep_h >= 6.5, la: 'days after less than 6.5 h of sleep', lb: 'days after 6.5 h or more' },
  { key: 'steps', a: d => d.steps != null && d.steps < 5000, b: d => d.steps != null && d.steps >= 8000, la: 'days with under 5,000 steps', lb: 'days with 8,000+ steps' },
  { key: 'workout', a: d => d.workout === true, b: d => d.workout === false, la: 'days you worked out', lb: 'days you didn’t' },
  { key: 'caffeine', a: d => d.caffeine != null && d.caffeine >= 3, b: d => d.caffeine != null && d.caffeine < 3, la: 'days with 3+ caffeinated drinks', lb: 'days with fewer' },
  { key: 'alcohol', a: d => d.alcohol != null && d.alcohol > 0, b: d => d.alcohol === 0, la: 'days you logged alcohol', lb: 'days you logged none' },
  { key: 'weekend', a: d => d.weekend === true, b: d => d.weekend === false, la: 'weekend days', lb: 'weekdays' },
];
export function insights(days, { minN = 5, minDiff = 0.4 } = {}) {
  const out = [];
  for (const metric of ['mood', 'energy']) {
    for (const f of FACTORS) {
      const A = days.filter(d => d[metric] != null && f.a(d)).map(d => d[metric]), B = days.filter(d => d[metric] != null && f.b(d)).map(d => d[metric]);
      if (A.length < minN || B.length < minN) continue;
      const ma = mean(A), mb = mean(B), diff = ma - mb; if (Math.abs(diff) < minDiff) continue;
      out.push({ metric, factor: f.key, diff, n: [A.length, B.length], text: `On ${f.la} your ${metric} averages ${f1(ma)} vs ${f1(mb)} on ${f.lb}.`, note: `Based on ${A.length} and ${B.length} days. A pattern in your own data, not a diagnosis.` });
    }
  }
  return out.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, 5);
}
// Join everything we know about each day (values come from the store; kept separate so insights() stays pure).
export function buildDays(store, dowFn) {
  const by = {}, get = d => by[d] ||= { day: d };
  for (const m of store.list('mood_log')) { const x = get(m.day); (x._m ||= []).push(m.mood); (x._e ||= []).push(m.energy); }
  for (const x of Object.values(by)) { x.mood = x._m.filter(v => v != null).length ? mean(x._m.filter(v => v != null)) : null; x.energy = x._e.filter(v => v != null).length ? mean(x._e.filter(v => v != null)) : null; }
  for (const g of store.list('garmin_daily')) { const x = get(g.day); x.sleep_h = g.sleep_h; x.steps = g.steps; }
  const acts = new Set(store.list('garmin_activity').map(a => a.day));
  const logs = store.list('manual_log');
  for (const d of Object.keys(by)) { const x = by[d]; if (store.list('garmin_daily', g => g.day === d).length || acts.size) x.workout = acts.has(d); const c = logs.filter(l => l.day === d && l.type === 'caffeine'), a = logs.filter(l => l.day === d && l.type === 'alcohol'); if (c.length) x.caffeine = c.reduce((s, l) => s + (+l.value || 1), 0); if (a.length) x.alcohol = a.reduce((s, l) => s + (+l.value || 1), 0); else if (logs.some(l => l.day === d)) x.alcohol = 0; const w = dowFn(d); x.weekend = w === 0 || w === 6; }
  return Object.values(by).filter(d => d.mood != null || d.energy != null);
}
