// Goals & habits: goals (max 3 big), habits with heatmap, wheel of life, wins, vision & values, notes to future me.
import { h, today, addDays, niceDate, ago, uid, dow } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox, promptBox, actMenu } from '../ui.js';
import { progress, AREAS, LIVE, addWin, achieve, activeBig } from '../goals-core.js';
import { streak, toggleHabit, doneOn, logsFor, weekCount } from '../habits-core.js';
import { openCapture } from '../capture.js';
import { coverStrip, iconSpan, decorDialog } from '../decor.js';
import { linksPanel } from '../links.js';

let tab = 'goals', wealth = null;
const TABS = [['goals', 'Goals'], ['habits', 'Habits'], ['wheel', 'Life wheel'], ['wins', 'Wins'], ['vision', 'Vision']];

function bar(p, label = 'Progress') { return h('div', { class: 'pbar', role: 'progressbar', 'aria-label': label, 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: p + '%' } })); }

function editGoal(id) {
  const g = id ? store.get(id) : { title: '', why: '', area: 'health', status: 'active', milestones: [], target: null };
  modal((d, close) => {
    const f = { ...g, milestones: [...(g.milestones || [])] };
    const title = h('input', { class: 'in', value: g.title, placeholder: 'What do you want?' }), why = h('textarea', { class: 'in', value: g.why || '', placeholder: 'Why does this matter to you? (you’ll see this when motivation dips)' });
    const area = h('select', { class: 'in' }, AREAS.map(a => h('option', { value: a, selected: a === g.area }, a))), dl = h('input', { class: 'in', type: 'date', value: g.deadline || '' });
    const tType = h('select', { class: 'in' }, [['none', 'No number — just steps'], ['numeric', 'A number to reach'], ...Object.entries(LIVE).map(([k, v]) => ['live:' + k, 'Live: ' + v.label])].map(([v, l]) => h('option', { value: v, selected: v === (g.live ? 'live:' + g.live : g.target ? 'numeric' : 'none') }, l)));
    const start = h('input', { class: 'in', type: 'number', value: g.target?.start ?? '', step: 'any' }), cur = h('input', { class: 'in', type: 'number', value: g.target?.current ?? '', step: 'any' }), goal = h('input', { class: 'in', type: 'number', value: g.target?.goal ?? '', step: 'any' }), unit = h('input', { class: 'in', value: g.target?.unit || '', placeholder: 'km, AED, books…' });
    const nums = h('div', { class: 'grid2' }, field('Starting at', start), field('Now', cur), field('Target', goal), field('Unit', unit));
    const showNums = () => nums.classList.toggle('hide', tType.value === 'none'); tType.onchange = showNums; showNums();
    const ms = h('div', { class: 'stack-s' }), paint = () => ms.replaceChildren(...f.milestones.map(m => h('div', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: m.done, onchange: e => { m.done = e.target.checked; } }), h('span', { class: 'grow' }, m.title), h('button', { class: 'btn icon sm ghost', onclick: () => { f.milestones = f.milestones.filter(x => x !== m); paint(); } }, icon('x'))))); paint();
    const msIn = h('input', { class: 'in', placeholder: 'Add a milestone…', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { f.milestones.push({ id: uid().slice(0, 8), title: e.target.value.trim(), done: false }); e.target.value = ''; paint(); e.preventDefault(); } } });
    const big = h('input', { type: 'checkbox', class: 'chk', checked: !!g.quarterly });
    const status = seg([['active', 'Active'], ['paused', 'Paused'], ['achieved', 'Achieved'], ['dropped', 'Dropped']], f.status, v => f.status = v);
    const save = () => {
      if (!title.value.trim()) return title.focus(); if (!why.value.trim()) { why.focus(); toast('Add your why — it’s the point.'); return; }
      const live = tType.value.startsWith('live:') ? tType.value.slice(5) : null, tgt = tType.value === 'none' ? null : { type: 'numeric', start: start.value === '' ? 0 : +start.value, current: cur.value === '' ? null : +cur.value, goal: goal.value === '' ? null : +goal.value, unit: unit.value || (live ? LIVE[live].unit : '') };
      const patch = { title: title.value.trim(), why: why.value.trim(), area: area.value, deadline: dl.value || null, live, target: tgt, milestones: f.milestones, status: f.status, quarterly: big.checked, started: g.started || today() };
      const was = g.milestones || []; f.milestones.forEach(m => { const o = was.find(x => x.id === m.id); if (m.done && !(o && o.done)) addWin(`${m.title} — ${patch.title}`, 'milestone', { goal: id }); });
      const rec = store.put('goal', patch, id); if (f.status === 'achieved' && g.status !== 'achieved') addWin(`Achieved: ${patch.title}`, 'goal', { goal: rec.id });
      close();
    };
    big.addEventListener('change', async () => { if (big.checked && activeBig().filter(x => x.id !== id).length >= 3) { big.checked = false; const names = activeBig().map(x => x.title).join(', '); if (await confirmBox('Three big goals already', `You’re focusing on: ${names}. More than three tends to dilute all of them. Keep this one as a regular goal?`, { ok: 'Keep as regular' })) { /* stays unchecked */ } } });
    d.append(h('h2', {}, id ? 'Edit goal' : 'New goal'), h('div', { class: 'stack' }, title, field('Why it matters', why), h('div', { class: 'grid2' }, field('Life area', area), field('Deadline', dl)), field('How will you measure it?', tType), nums, h('div', {}, h('div', { class: 'small muted' }, 'Milestones'), ms, msIn), h('label', { class: 'row' }, big, 'One of my big goals this quarter (max 3)'), h('div', {}, h('div', { class: 'small muted' }, 'Status'), status)),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); toast('Goal deleted', () => store.restore(id)); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')));
  }, { wide: true, label: 'Goal' });
}

function goalsTab(box) {
  const all = store.list('goal').sort((a, b) => (b.quarterly ? 1 : 0) - (a.quarterly ? 1 : 0) || a.created_at.localeCompare(b.created_at));
  const act = all.filter(g => g.status === 'active' || g.status === 'paused');
  box.append(h('div', { class: 'row' }, h('span', { class: 'muted grow' }, `${activeBig().length} of 3 big goals`), h('button', { class: 'btn primary', onclick: () => editGoal() }, icon('plus'), 'New goal')));
  if (!all.length) { box.append(empty('goals', 'What’s worth wanting?', 'Add one goal and the reason behind it. Everything else can wait.', h('button', { class: 'btn primary', onclick: () => editGoal() }, 'Add a goal'))); return; }
  const card = g => { const p = progress(g, wealth), tasks = store.list('task', t => t.goal_id === g.id && !t.done).length, hb = store.list('habit', x => x.goal_id === g.id);
    return h('article', { class: 'card goal' + (g.status === 'paused' ? ' paused' : ''), style: { '--dom': 'var(--d-goals)' } }, coverStrip(g), h('div', { class: 'card-head' }, g.quarterly ? h('span', { class: 'chip dom' }, 'big goal') : '', h('h3', { style: { flex: 1 } }, iconSpan(g), g.title), actMenu(h('button', { class: 'btn sm', onclick: () => editGoal(g.id) }, icon('edit'), 'Edit goal'), h('button', { class: 'btn sm', onclick: () => decorDialog(g, () => {}) }, icon('image'), 'Icon & cover'))),
      h('p', { class: 'muted', style: { margin: '0 0 8px', fontStyle: 'italic' } }, '“' + g.why + '”'), bar(p.pct, g.title + ' progress'),
      h('div', { class: 'row wrap small muted', style: { marginTop: '6px' } }, h('span', {}, p.label), g.deadline ? h('span', {}, '· by ' + niceDate(g.deadline, true)) : '', p.pace ? h('span', { class: 'chip ' + (p.pace === 'behind' ? 'warn' : 'good') }, p.pace === 'ahead' ? 'ahead of pace' : p.pace === 'on' ? 'on pace' : 'behind pace') : '', p.projected ? h('span', {}, '· on track for ' + niceDate(p.projected, true)) : '', tasks ? h('span', {}, `· ${tasks} task${tasks > 1 ? 's' : ''}`) : '', hb.length ? h('span', {}, '· ' + hb.map(x => x.name).join(', ')) : ''),
      (g.milestones || []).length ? h('div', { class: 'stack-s', style: { marginTop: '8px' } }, g.milestones.map(m => h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: m.done, onchange: e => { const ms = g.milestones.map(x => x.id === m.id ? { ...x, done: e.target.checked } : x); store.put('goal', { milestones: ms }, g.id); if (e.target.checked) { addWin(`${m.title} — ${g.title}`, 'milestone', { goal: g.id }); toast('Milestone ✓ — added to your wins'); } } }), h('span', { class: m.done ? 'faint' : '' }, m.title)))) : '',
      linksPanel(g),
      g.status === 'active' ? h('div', { class: 'row', style: { marginTop: '8px' } }, g.target && !g.live ? h('button', { class: 'btn sm', onclick: async () => { const v = await promptBox('Where are you now?', { value: String(g.target.current ?? '') }); if (v !== null && v !== '' && !isNaN(+v)) store.put('goal', { target: { ...g.target, current: +v } }, g.id); } }, 'Update number') : '', h('button', { class: 'btn sm', onclick: () => { achieve(g); toast('Achieved. Take a moment.'); } }, icon('check'), 'Mark achieved')) : '');
  };
  box.append(h('div', { class: 'grid2' }, act.map(card)));
  const done = all.filter(g => g.status === 'achieved' || g.status === 'dropped');
  if (done.length) box.append(h('details', {}, h('summary', { class: 'muted' }, `${done.length} finished or let go`), h('div', { class: 'stack-s sp-t' }, done.map(g => h('div', { class: 'item' }, h('span', { class: 't' }, g.title), h('span', { class: 'meta' }, g.status))))));
}

function heat(hb) { // last 14 weeks, Monday-first columns
  const logs = logsFor(hb.id), T = today(), start = addDays(T, -((dow(T) + 6) % 7) - 13 * 7), cols = h('div', { class: 'heat' });
  for (let w = 0; w < 14; w++) { const col = h('div', {}); for (let d = 0; d < 7; d++) { const ds = addDays(start, w * 7 + d); col.append(h('span', { class: 'hc' + (logs.has(ds) ? ' on' : '') + (ds > T ? ' fut' : ''), title: ds, onclick: ds <= T ? () => { toggleHabit(hb, ds); } : null })); } cols.append(col); }
  return cols;
}
// rollups: the numbers people actually ask of a habit
function habitRollups(hb, logs) {
  const T = today(), ym = T.slice(0, 7), last = [...logs].sort().pop(), d30 = logs.filter(d => d > addDays(T, -30)).length;
  const target30 = hb.freq === 'weekly' ? Math.round((hb.per_week || 3) * 30 / 7) : 30;
  return [h('span', {}, last ? (last === T ? 'done today' : `${Math.floor((new Date(T) - new Date(last)) / 864e5)} days since last`) : 'never done'), h('span', {}, `· ${logs.filter(d => d.startsWith(ym)).length} this month`), h('span', {}, `· ${Math.min(100, Math.round(d30 / target30 * 100))}% of the last 30 days`), h('span', {}, `· ${logs.length} in total`)];
}
function habitsTab(box) {
  const habits = store.list('habit', x => !x.archived).sort((a, b) => a.created_at.localeCompare(b.created_at));
  box.append(h('div', { class: 'row' }, h('span', { class: 'muted grow' }, 'One missed day won’t break a streak — you get a shield.'), h('button', { class: 'btn primary', onclick: () => editHabit() }, icon('plus'), 'New habit')));
  if (!habits.length) { box.append(empty('check', 'Tiny things, repeated', 'Add a habit like “read 20 min” and tick it from Today.')); return; }
  habits.forEach(hb => { const logs = [...logsFor(hb.id)]; const byDow = Array(7).fill(0); logs.forEach(d => byDow[dow(d)]++); const best = logs.length >= 14 ? byDow.indexOf(Math.max(...byDow)) : -1;
    box.append(h('article', { class: 'card', style: { '--dom': 'var(--d-goals)' } }, h('div', { class: 'card-head' }, h('h3', { style: { flex: 1 } }, hb.name), h('span', { class: 'chip' + (doneOn(hb) ? ' on' : '') }, hb.freq === 'weekly' ? `${weekCount(hb)}/${hb.per_week} this week` : doneOn(hb) ? 'done today' : 'not yet'), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Edit habit', onclick: () => editHabit(hb.id) }, icon('edit'))),
      h('div', { class: 'row wrap' }, h('b', { style: { font: '700 1.8rem var(--f-title)' } }, streak(hb)), h('span', { class: 'muted' }, hb.freq === 'weekly' ? 'week streak' : 'day streak'), best >= 0 ? h('span', { class: 'faint small' }, `· best on ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][best]}`) : '', hb.goal_id && store.get(hb.goal_id) ? h('span', { class: 'chip' }, '→ ' + store.get(hb.goal_id).title) : ''), h('div', { class: 'row wrap small muted', style: { marginTop: '4px' } }, ...habitRollups(hb, logs)), heat(hb))); });
}
function editHabit(id) {
  const hb = id ? store.get(id) : { name: '', freq: 'daily', per_week: 3 };
  modal((d, close) => {
    const name = h('input', { class: 'in', value: hb.name, placeholder: 'e.g. Read 20 minutes' }), f = { ...hb }, per = h('input', { class: 'in', type: 'number', min: 1, max: 6, value: hb.per_week || 3 }), goals = store.list('goal', g => g.status === 'active');
    const gsel = h('select', { class: 'in' }, h('option', { value: '' }, 'No goal'), goals.map(g => h('option', { value: g.id, selected: g.id === hb.goal_id }, g.title)));
    const fr = seg([['daily', 'Every day'], ['weekly', 'Some days a week']], f.freq, v => { f.freq = v; per.parentElement.classList.toggle('hide', v !== 'weekly'); });
    d.append(h('h2', {}, id ? 'Edit habit' : 'New habit'), h('div', { class: 'stack' }, name, fr, field('Times per week', per), field('Feeds goal', gsel)), h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.put('habit', { archived: true }, id); close(); toast('Archived'); } }, 'Archive') : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (!name.value.trim()) return; store.put('habit', { name: name.value.trim(), freq: f.freq, per_week: +per.value || 3, goal_id: gsel.value || null }, id); close(); } }, 'Save')));
    per.parentElement.classList.toggle('hide', f.freq !== 'weekly');
  });
}

function radar(series, areas) { // hand-made SVG: one accent series (latest), faint earlier ones
  const S = 320, c = S / 2, R = 118, ns = 'http://www.w3.org/2000/svg', mk = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: `0 0 ${S} ${S}`, class: 'radar', role: 'img', 'aria-label': 'Life wheel' }), pt = (i, v) => { const a = -Math.PI / 2 + i / areas.length * 2 * Math.PI; return [c + Math.cos(a) * R * v / 10, c + Math.sin(a) * R * v / 10]; };
  [2, 4, 6, 8, 10].forEach(v => svg.append(mk('polygon', { points: areas.map((_, i) => pt(i, v).join(',')).join(' '), fill: 'none', stroke: 'var(--rule)', 'stroke-dasharray': v < 10 ? '3 4' : '' })));
  areas.forEach((a, i) => { const [x, y] = pt(i, 10.9); svg.append(mk('line', { x1: c, y1: c, x2: pt(i, 10)[0], y2: pt(i, 10)[1], stroke: 'var(--rule)' })); const t = mk('text', { x, y, 'text-anchor': x < c - 5 ? 'end' : x > c + 5 ? 'start' : 'middle', 'dominant-baseline': 'middle', fill: 'var(--ink-2)', 'font-size': 13, 'font-family': 'var(--f-hand)' }); t.textContent = a.split(' ')[0]; svg.append(t); });
  series.forEach((s, k) => { const last = k === series.length - 1; svg.append(mk('polygon', { points: areas.map((a, i) => pt(i, s.r[a] || 0).join(',')).join(' '), fill: last ? 'var(--pen)' : 'none', 'fill-opacity': last ? .18 : 0, stroke: last ? 'var(--pen)' : 'var(--ink-3)', 'stroke-width': last ? 2.2 : 1, 'stroke-dasharray': last ? '' : '4 3' })); });
  return svg;
}
function wheelTab(box) {
  const ym = today().slice(0, 7), rs = store.list('area_rating').sort((a, b) => a.month.localeCompare(b.month)), cur = rs.find(r => r.month === ym), ratings = { ...(cur ? cur.r : {}) };
  const areas = (window.__settings && window.__settings.areas) || AREAS;
  box.append(h('p', { class: 'muted' }, 'Rate each area 1–10 once a month. The shape over time shows what you’re neglecting — no judgement.'));
  const sliders = h('div', { class: 'stack-s' }, areas.map(a => h('label', { class: 'row' }, h('span', { style: { width: '130px' } }, a), h('input', { type: 'range', min: 1, max: 10, value: ratings[a] || 5, class: 'grow', 'aria-label': a, oninput: e => { ratings[a] = +e.target.value; out.textContent = ''; }, onchange: () => store.put('area_rating', { month: ym, r: { ...ratings } }, cur?.id) }), h('b', {}, ''))));
  const out = h('span');
  const wheel = h('div', { class: 'card' }, radar(rs.slice(-3).map(r => r.id === cur?.id ? { ...r, r: ratings } : r).concat(cur ? [] : [{ r: ratings }]), areas), h('p', { class: 'faint small', style: { textAlign: 'center', margin: 0 } }, rs.length > 1 ? 'Solid shape: this month. Dashes: earlier months.' : 'Your first wheel.'));
  box.append(h('div', { class: 'grid2' }, h('div', { class: 'card' }, h('h3', {}, ymLabel(ym)), sliders, h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: () => { store.put('area_rating', { month: ym, r: { ...ratings } }, cur?.id); toast('Saved'); setTimeout(() => location.reload(), 200); } }, 'Save this month')), wheel));
  const low = areas.filter(a => ratings[a] && ratings[a] <= 4); if (low.length) box.append(h('p', { class: 'muted' }, `Quietest: ${low.join(', ')}. One small thing there this week?`));
}
const ymLabel = ym => new Date(ym + '-15T12:00:00Z').toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function winsTab(box) {
  const inp = h('input', { class: 'in cap-input', placeholder: 'Something you’re proud of…', 'aria-label': 'Add a win', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { addWin(e.target.value.trim()); e.target.value = ''; } } });
  const wins = store.list('win').sort((a, b) => b.created_at.localeCompare(a.created_at)); box.append(inp);
  if (!wins.length) { box.append(empty('star', 'Your wins live here', 'Finished goals and milestones land here automatically. Add the small ones too.')); return; }
  box.append(h('div', { class: 'card' }, wins.map(w => h('div', { class: 'item' }, icon('star', 'mini'), h('div', { class: 'grow' }, w.title, h('div', { class: 'meta' }, niceDate(w.day, true), w.source !== 'manual' ? ' · ' + w.source : '')), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => { store.del(w.id); } }, icon('x'))))));
}
const VISION = [['who', 'Who I’m becoming'], ['value', 'My values'], ['why', 'My why'], ['picture5', 'My 5-year picture'], ['rule', 'Personal rules'], ['note', 'Notes to self (written in good moments)']];
function visionTab(box) {
  box.append(h('p', { class: 'muted' }, 'In your own words. These get shown back to you on Today, ahead of any quote.'));
  VISION.forEach(([k, label]) => { const items = store.list('vision_item', v => v.type === k).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const inp = h('input', { class: 'in', placeholder: 'Add…', 'aria-label': 'Add to ' + label, onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { store.put('vision_item', { type: k, text: e.target.value.trim() }); } } });
    box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, label)), items.map(v => h('div', { class: 'item' }, h('div', { class: 'grow', contenteditable: 'plaintext-only', spellcheck: 'true', onblur: e => { const t = e.target.textContent.trim(); if (t && t !== v.text) store.put('vision_item', { text: t }, v.id); if (!t) store.del(v.id); } }, v.text))), inp)); });
  const fut = store.list('future_note').sort((a, b) => (a.deliver_on || '9').localeCompare(b.deliver_on || '9'));
  box.append(h('section', { class: 'card taped' }, h('div', { class: 'card-head' }, h('h3', {}, 'Notes to future me')), fut.map(n => h('div', { class: 'item' }, h('div', { class: 'grow' }, n.delivered ? n.text : '🔒 sealed — ' + (n.when_low ? 'opens when you’ve been low for 3 days' : 'opens ' + niceDate(n.deliver_on, true)), n.delivered ? h('div', { class: 'meta' }, 'delivered') : ''))), h('button', { class: 'btn', onclick: () => modal((d, close) => { const t = h('textarea', { class: 'in', placeholder: 'Dear me…' }), on = h('input', { class: 'in', type: 'date', value: addDays(today(), 30) }), low = h('input', { type: 'checkbox', class: 'chk' }); d.append(h('h2', {}, 'Write to future you'), h('div', { class: 'stack' }, t, field('Deliver on', on), h('label', { class: 'row' }, low, 'Or deliver it when my mood has been low for 3 days')), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (t.value.trim()) { store.put('future_note', { text: t.value.trim(), deliver_on: on.value, when_low: low.checked }); close(); toast('Sealed'); } } }, 'Seal it'))); }) }, icon('send'), 'Write one')));
}

export default async function render(el, ctx) {
  if (ctx.q.tab && !ctx.soft) { if (ctx.q.tab === 'do') { location.hash = '#/do'; return; } tab = ctx.q.tab; }
  try { const w = await store.api('/api/wealth/summary'); wealth = w.net_worth != null ? w : null; } catch { wealth = null; }
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig', style: { '--dom': 'var(--d-goals)' } }, 'Goals'), h('a', { class: 'btn sm', href: '#/do' }, icon('star'), 'What should I do?')), h('div', { style: { margin: '0 0 18px', overflowX: 'auto' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box);
  ({ goals: goalsTab, habits: habitsTab, wheel: wheelTab, wins: winsTab, vision: visionTab })[tab](box);
}
