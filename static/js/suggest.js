// "What should I do?" — ranks options from the user's OWN data. Pure function: all inputs are passed in (tested in tests/test_suggest.mjs).
// input: {mins, energy 1-5, mood 1-5, where:'home|out|work|travelling', company:'solo|partner|friends|family', budget:'any|free|low', weather:{rain,temp}, hour, today:'YYYY-MM-DD'}
// data:  {tasks, goals, habits:[{...,done,streak}], items:[{...list_item, listType}], trips, people, body:{battery,sleep}, feedback:{key:n}}
const OUTDOOR = /padel|football|tennis|hiking|beach|karting|run|cycling|golf/i;
const cost = c => ({ free: 0, '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 }[c] ?? 1);

export function suggest(inp, data) {
  const { mins = 60, energy = 3, where = 'home', company = 'solo', budget = 'any', weather = {}, hour = 12, today } = inp;
  const out = [], push = (key, kind, title, reason, score, action) => { const pen = (data.feedback && data.feedback[key] || 0) * 28; out.push({ key, kind, title, reason, score: score - pen, action }); };
  const late = hour >= 21, lowBody = data.body && ((data.body.battery != null && data.body.battery < 30) || (data.body.sleep != null && data.body.sleep < 6));
  const rain = !!weather.rain, hot = (weather.temp ?? 25) >= 38 && hour >= 11 && hour <= 16;

  if (lowBody || energy <= 1) push('rest', 'rest', 'Rest properly', lowBody ? 'Your readiness is low today — recovery counts as progress.' : 'You said your energy is on the floor. Rest is allowed.', (lowBody ? 125 : 70) + (late ? 15 : 0), { type: 'none' });
  for (const t of data.tasks || []) {
    if (t.done || t.someday) continue;
    const est = t.est || 25; let s = 50, why = [];
    const late_ = t.due && t.due < today ? Math.round((new Date(today) - new Date(t.due)) / 864e5) : 0;
    if (late_) { s += 18 + Math.min(10, late_); why.push(`${late_} day${late_ > 1 ? 's' : ''} overdue`); } else if (t.due === today) { s += 20; why.push('due today'); }
    if (t.priority === 1) { s += 30; why.push('urgent'); } else if (t.priority === 2) { s += 15; why.push('high priority'); }
    if (est <= mins) { s += 10; why.push(`fits your ${mins} minutes`); } else { s -= 45; }
    if (energy <= 2 && est > 45) s -= 15; if (late && est > 30) s -= 20;
    if (where === 'work' && !/work/.test(t.ctx || '')) s -= 15; if (where !== 'work' && t.ctx === 'work') s -= 10; if (where === 'out' && t.ctx === 'errands') { s += 12; why.push('you’re already out'); }
    if (!t.due && !t.priority) s -= 15; if (lowBody && t.priority !== 1) s -= 25;
    push('task:' + t.id, 'task', t.title, why.join(', ') || 'next up', s, { type: 'task', id: t.id });
  }
  for (const g of data.goals || []) {
    if (g.status !== 'active') continue; const m = (g.milestones || []).find(x => !x.done); if (!m || mins < 20) continue;
    let s = 44 + (g.quarterly ? 22 : 0) + (g.deadline && g.deadline < addD(today, 30) ? 12 : 0) + (energy >= 3 ? 6 : -6);
    push('goal:' + g.id, 'goal', m.title, `Next small step toward “${g.title}”.`, s, { type: 'goal', id: g.id });
  }
  for (const h of data.habits || []) {
    if (h.done) continue; let s = 38 + (h.streak >= 3 ? 14 : 0) + (hour >= 7 && hour <= 21 ? 4 : -10) + (h.freq === 'weekly' && h.behind ? 14 : 0);
    push('habit:' + h.id, 'habit', h.name, h.streak >= 3 ? `Keeps your ${h.streak}-${h.freq === 'weekly' ? 'week' : 'day'} streak alive.` : 'Not done yet today.', s, { type: 'habit', id: h.id });
  }
  for (const it of data.items || []) {
    const t = it.listType; if (!t) continue; const done = ['done', 'tried', 'finished', 'given', 'bought', 'packed', 'got'].includes(it.status) || /^been/.test(it.status || ''); if (done) continue;
    const why = [];
    if (t === 'restaurant' || t === 'play') {
      if (where === 'work') continue; let s = 52;
      const outdoor = OUTDOOR.test(it.activity || ''); if (outdoor && (rain || hot)) { s -= 60; } else if (outdoor && !rain) { s += 8; why.push('weather’s fine'); }
      if (t === 'restaurant' && (company === 'partner' || company === 'family')) { s += 12; why.push('good with ' + company); } if (t === 'play' && company === 'friends') { s += 14; why.push('a friends thing'); } if (company === 'solo' && t === 'play') s -= 4;
      if (budget === 'free' && cost(it.price) > 0) s -= 30; if (budget === 'low' && cost(it.price) > 2) s -= 18;
      if (mins < 90) s -= 20; if (where === 'out' || where === 'home') s += 4; if (late) s -= 25;
      push('item:' + it.id, t, it.title, [it.cuisine || it.activity, it.city || it.area, ...why].filter(Boolean).join(' · ') || 'from your list', s, { type: 'item', id: it.id, list: it.list });
    } else if (t === 'todo') {
      let s = 40; if (mins >= 120 && it.effort === 'high') { s += 14; why.push('a good use of a free stretch'); } if (energy <= 2 && it.effort === 'high') s -= 20; if (budget === 'free' && it.cost && it.cost !== 'free') s -= 20; if (it.effort === 'low' && mins < 45) { s += 10; why.push('quick'); }
      push('item:' + it.id, 'todo', it.title, why.join(', ') || 'from your “things to do”', s, { type: 'item', id: it.id, list: it.list });
    } else if ((t === 'learning' || t === 'media') && ['learning', 'in progress'].includes(it.status)) {
      push('item:' + it.id, 'learning', it.title, 'You’re mid-way through this.', 36 + (energy <= 3 && mins >= 20 ? 8 : 0) + (late ? 8 : 0), { type: 'item', id: it.id, list: it.list });
    }
  }
  for (const tr of data.trips || []) { const d = tr.start && Math.round((new Date(tr.start) - new Date(today)) / 864e5); if (d != null && d >= 0 && d <= 60 && tr.next_step) push('trip:' + tr.id, 'trip', tr.next_step, `${tr.name} is in ${d} days.`, 42 + (d < 14 ? 20 : 0), { type: 'trip', id: tr.id }); }
  for (const p of data.people || []) { if (!p.keep_weeks) continue; const last = p.last_contact || '2000-01-01', w = Math.floor((new Date(today) - new Date(last)) / (7 * 864e5)); if (w >= p.keep_weeks) push('person:' + p.id, 'person', `Message ${p.name}`, `It’s been ${w} weeks.`, 44 + Math.min(20, (w - p.keep_weeks) * 3) + (late ? -20 : 0), { type: 'person', id: p.id }); }
  out.sort((a, b) => b.score - a.score);
  const ok = out.filter(o => o.score >= 20), picked = [];
  for (const o of ok) if (picked.length < 3 && !picked.some(p => p.kind === o.kind)) picked.push(o);   // diversity first
  for (const o of ok) if (picked.length < 3 && !picked.includes(o)) picked.push(o);
  picked.sort((a, b) => b.score - a.score);
  return { top: picked, all: out };
}
export function surprise(all, rnd = Math.random) { const pool = all.filter(o => o.score > 25); if (!pool.length) return null; const w = pool.map(o => Math.max(1, o.score - 20)), tot = w.reduce((a, b) => a + b, 0); let r = rnd() * tot; for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; } return pool[0]; }
function addD(ds, n) { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Weekend: a small deterministic plan from the same data.
export function weekendPlan(data, inp) {
  const base = (over) => suggest({ ...inp, mins: 180, ...over }, data).all;
  const pick = (kinds, used) => base({ company: inp.company }).find(o => kinds.includes(o.kind) && !used.has(o.key));
  const used = new Set(), plan = [];
  for (const [slot, kinds] of [['Saturday morning', ['play', 'todo']], ['Saturday evening', ['restaurant']], ['Sunday afternoon', ['goal', 'task', 'todo']], ['Sunday evening', ['learning', 'rest', 'habit']]]) { const o = pick(kinds, used) || pick(['task', 'habit', 'todo', 'rest'], used); if (o) { used.add(o.key); plan.push({ slot, ...o }); } }
  return plan;
}
