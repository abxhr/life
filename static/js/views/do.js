// "What should I do?" — full screen. Inputs prefilled from context; three ranked options from your own data.
import { h, today, timeIn, dow, addDays } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast, seg, field, empty } from '../ui.js';
import { suggest, surprise, weekendPlan } from '../suggest.js';
import { types } from '../lists-core.js';
import { streak, doneOn, weekCount } from '../habits-core.js';
import { editTask } from './tasks.js';
import { saveTask } from '../tasks-core.js';
import { inMode } from '../state.js';

const inp = { mins: 60, where: 'home', company: 'solo', budget: 'any', energy: null, mood: null };

function gather() {
  const T = today(), ty = types(), lists = Object.fromEntries(store.list('list').map(l => [l.id, l.type]));
  const gd = store.list('garmin_daily').sort((a, b) => b.day.localeCompare(a.day))[0], m = store.list('mood_log', x => x.day === T)[0];
  return { mood: m,
    data: { tasks: store.list('task', inMode), goals: store.list('goal'), feedback: Object.fromEntries(store.list('suggest_fb').map(f => [f.key, f.n || 0])),
      habits: store.list('habit', x => !x.archived).map(x => ({ ...x, done: x.freq === 'weekly' ? weekCount(x) >= (x.per_week || 3) || doneOn(x) : doneOn(x), streak: streak(x), behind: x.freq === 'weekly' && weekCount(x) < (x.per_week || 3) - 1 })),
      items: store.list('list_item').map(i => ({ ...i, listType: lists[i.list] })).filter(i => i.listType), trips: store.list('trip').map(t => ({ ...t, next_step: (t.checklist || []).find(c => !c.done)?.title })),
      people: store.list('person'), body: gd && gd.day >= addDays(T, -1) ? { battery: gd.body_battery, sleep: gd.sleep_h } : null } };
}

export default async function render(el, ctx) {
  const { mood, data } = gather(), T = today(), hour = +timeIn().slice(0, 2);
  let weather = {}; try { const w = await store.api('/api/weather'); weather = { rain: (w.current?.precipitation || 0) > 0.2 || (w.daily?.precipitation_probability_max?.[0] || 0) > 60, temp: w.current?.temperature_2m }; } catch { /* offline */ }
  if (inp.energy == null) inp.energy = mood?.energy || (data.body ? (data.body.sleep < 6 ? 2 : 3) : 3);
  if (inp.mood == null) inp.mood = mood?.mood || 3;
  const weekend = [0, 6].includes(dow(T)) && !(window.__settings?.work_days || [1, 2, 3, 4, 5]).includes(dow(T));
  el.append(h('div', { class: 'page-head' }, h('a', { class: 'btn icon sm ghost', href: '#/goals', 'aria-label': 'Back' }, icon('chevL')), h('h1', { class: 'squig' }, 'What should I do?'), h('span', { class: 'sub' }, weather.temp != null ? `${Math.round(weather.temp)}° ${weather.rain ? 'rain about' : 'dry'}` : '')));
  const out = h('div', { class: 'stack' });
  const num = (label, key, opts) => h('div', {}, h('div', { class: 'small muted' }, label), seg(opts, inp[key], v => { inp[key] = v; paint(); }));
  el.append(h('section', { class: 'card' }, h('div', { class: 'stack' },
    num('Time I have', 'mins', [[15, '15 min'], [30, '30'], [60, '1 h'], [120, '2 h'], [240, 'Half day']]), num('Energy', 'energy', [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]),
    num('Where I am', 'where', [['home', 'Home'], ['out', 'Out'], ['work', 'Work'], ['travelling', 'Travelling']]), num('With', 'company', [['solo', 'Solo'], ['partner', 'Partner'], ['friends', 'Friends'], ['family', 'Family']]), num('Budget', 'budget', [['any', 'Any'], ['low', 'Low'], ['free', 'Free']]))));
  el.append(out);
  const act = o => { const a = o.action || {}; if (a.type === 'task') return editTask(a.id); if (a.type === 'goal') return (location.hash = '#/goals'); if (a.type === 'item') return (location.hash = '#/lists/' + a.list); if (a.type === 'habit') { const hb = store.get(a.id); if (hb) { store.put('habit_log', { habit: hb.id, day: T }); toast(hb.name + ' ✓'); } return; } if (a.type === 'trip') return (location.hash = '#/travel'); toast('Good choice.'); };
  const schedule = o => { const t = saveTask({ title: o.title, due: T, scheduled: T, sched_time: timeIn(), est: inp.mins, ctx: 'personal', priority: 3 }); toast('Blocked on your calendar from now'); return t; };
  function paint() {
    const r = suggest({ ...inp, hour, today: T, weather }, data); out.replaceChildren();
    if (!r.top.length) { out.append(empty('star', 'Nothing to suggest yet', 'Add tasks, goals, habits or things to do and I’ll pick from them.')); return; }
    r.top.forEach((o, i) => out.append(h('article', { class: 'card rise', style: { animationDelay: i * 70 + 'ms' } }, h('div', { class: 'card-head' }, h('span', { class: 'chip' }, o.kind), h('h3', { style: { flex: 1 } }, o.title)), h('p', { class: 'muted', style: { margin: '0 0 8px' } }, o.reason),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm primary', onclick: () => act(o) }, 'Start'), o.action?.type !== 'none' ? h('button', { class: 'btn sm', onclick: () => schedule(o) }, icon('calendar'), 'Schedule it') : '', h('button', { class: 'btn sm ghost', onclick: () => { const fb = store.list('suggest_fb', f => f.key === o.key)[0]; store.put('suggest_fb', { key: o.key, n: (fb?.n || 0) + 1 }, fb?.id); paint(); } }, 'Not this')))));
    out.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { const s = surprise(r.all); if (s) { out.replaceChildren(h('article', { class: 'card taped rise' }, h('p', { class: 'muted small' }, 'Surprise'), h('p', { class: 'hero-line', style: { fontSize: '2.4rem' } }, s.title), h('p', { class: 'muted' }, s.reason), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => act(s) }, 'Do it'), h('button', { class: 'btn', onclick: paint }, 'Back')))); } } }, icon('zap'), 'Surprise me')));
    if (weekend) { const plan = weekendPlan(data, { ...inp, hour: 10, today: T, weather }); if (plan.length) out.append(h('section', { class: 'card taped' }, h('h3', {}, 'A gentle weekend'), plan.map(p => h('div', { class: 'item' }, h('span', { class: 'time-col', style: { width: '120px' } }, p.slot), h('div', { class: 'grow' }, p.title, h('div', { class: 'meta' }, p.reason)))))); }
  }
  paint();
}
