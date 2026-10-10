// Today: one calm sentence + the one thing. Everything else is quiet and scannable.
import { h, today, addDays, niceDate, fmtTime, cfg, timeIn, wdName, dow, isWorkDay, ago, uid } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast, empty } from '../ui.js';
import { inMode, state } from '../state.js';
import { dayItems, loadFeeds, nowBlock } from '../calcore.js';
import { completeTask, sortTasks, saveTask } from '../tasks-core.js';
import { taskRow, editTask, overdueTriage } from './tasks.js';
import { streak, toggleHabit, doneOn, weekCount } from '../habits-core.js';
import { pickQuote } from '../quotes.js';
import { openCapture } from '../capture.js';

const greet = () => { const H = +timeIn().slice(0, 2); return H < 5 ? 'Still up' : H < 12 ? 'Good morning' : H < 17 ? 'Good afternoon' : 'Good evening'; };
const MOODS = ['', 'rough', 'low', 'okay', 'good', 'great'];

function oneThing(open, T) {
  const pinned = open.find(t => t.one_day === T); if (pinned) return pinned;
  const cands = open.filter(t => !t.someday && (t.due === T || t.scheduled === T || (t.due && t.due < T))).sort((a, b) => (a.priority || 3) - (b.priority || 3) || sortTasks(a, b));
  return cands[0] || open.filter(t => !t.someday).sort((a, b) => (a.priority || 3) - (b.priority || 3) || sortTasks(a, b))[0] || null;
}

function briefing(T, items, open, over, sleepH) {
  const parts = [wdName(dow(T)) + '.'];
  const timed = items.filter(i => !i.allday && i.type !== 'block' && i.type !== 'taskdue' && i.type !== 'reminder');
  if (timed.length) parts.push(`${timed.length} ${timed.length > 1 ? 'meetings' : 'thing on the calendar'}, first at ${fmtTime(timed[0].start)}.`); else parts.push('Nothing on the calendar.');
  const due = open.filter(t => t.due === T).length;
  if (due) parts.push(`${due} task${due > 1 ? 's' : ''} due${over ? `, ${over} slipped` : ''}.`); else if (over) parts.push(`${over} slipped from before.`);
  const exp = store.list('travel_doc').filter(d => d.expiry && d.expiry <= addDays(T, 30) && d.expiry >= T);
  if (exp.length) parts.push(`${exp[0].name || 'A document'} expires soon.`);
  if (sleepH && sleepH < 6.5) parts.push(`You slept ${Math.floor(sleepH)}h${String(Math.round((sleepH % 1) * 60)).padStart(2, '0')} — go easy, pick one big thing.`);
  else parts.push(due + over > 4 ? 'A lot — choose one thing and start there.' : 'Plenty of room today.');
  return parts.join(' ');
}

export default async function render(el, ctx) {
  const T = today(), now = timeIn(), evening = now >= (cfg.eveningFrom || '20:00');
  const feeds = await loadFeeds(addDays(T, -1), addDays(T, 2));
  const open = store.list('task', t => !t.done && inMode(t));
  const items = dayItems(T, feeds);
  const over = open.filter(t => t.due && t.due < T && !t.someday);
  const gd = store.list('garmin_daily').sort((a, b) => b.day.localeCompare(a.day))[0];
  const sleepH = gd && gd.day >= addDays(T, -1) ? gd.sleep_h : null;
  const one = oneThing(open, T);

  el.append(h('div', { class: 'page-head' }, h('h1', {}, `${greet()}, ${cfg.name}`), h('span', { class: 'sub' }, niceDate(T, true) + (state.mode !== 'all' ? ' · ' + state.mode + ' mode' : ''))));
  const cached = store.list('briefing', b => b.day === T)[0];
  el.append(h('p', { class: 'hero-line rise', style: { maxWidth: '30ch' } }, cached ? cached.text : briefing(T, items, open, over.length, sleepH)));

  const lowDays = store.list('mood_log').filter(m => m.day >= addDays(T, -2) && m.mood <= 2).length >= 3;
  store.list('future_note', n => !n.delivered && ((n.deliver_on && n.deliver_on <= T) || (n.when_low && lowDays))).slice(0, 1).forEach(n => el.append(h('div', { class: 'sticky rise', style: { marginBottom: '16px' } }, h('div', { class: 'small' }, 'A note from past you'), h('div', { class: 'big' }, n.text), h('button', { class: 'btn sm', style: { '--b': 'currentColor', marginTop: '8px' }, onclick: () => store.put('future_note', { delivered: true }, n.id) }, 'Thanks, me'))));
  const grid = h('div', { class: 'today-grid' }), L = h('div', { class: 'stack' }), R = h('div', { class: 'stack' }); grid.append(L, R); el.append(grid);

  if (evening) { shutdown(L, T, open, ctx); } else {
    // Now / next + the one thing
    const nb = nowBlock(T);
    const hero = h('div', { class: 'hero-row' });
    hero.append(one ? h('div', { class: 'sticky rise' }, h('div', { class: 'small' }, 'The one thing'), h('div', { class: 'big', style: { margin: '4px 0 12px' } }, one.title),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => { completeTask(one); toast('Nice. Done.'); } }, icon('check'), 'Done'), h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => editTask(one.id) }, 'Open'),
        h('button', { class: 'btn sm ghost', onclick: () => { const alt = open.filter(t => t.id !== one.id && !t.someday).sort((a, b) => (a.priority || 3) - (b.priority || 3) || sortTasks(a, b))[0]; if (alt) store.put('task', { one_day: T }, alt.id); } }, 'Pick another')))
      : h('div', { class: 'sticky' }, h('div', { class: 'big' }, 'Nothing pressing.'), h('p', { style: { margin: '6px 0 0' } }, 'Capture something, or ask “What should I do?” →')));
    hero.append(h('div', { class: 'card nownext' }, h('div', { class: 'small muted' }, 'Now'), nb.now ? h('div', { class: 'big-line' }, nb.now.title, h('span', { class: 'faint small' }, ` until ${fmtTime(nb.now.end)}`)) : h('div', { class: 'faint' }, 'Free'),
      h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Next'), nb.next ? h('div', { class: 'big-line' }, nb.next.title, h('span', { class: 'faint small' }, ` ${fmtTime(nb.next.start)}`)) : h('div', { class: 'faint' }, 'Nothing else today')));
    L.append(hero);

    // timeline
    const tl = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Today’s page'), h('span', { class: 'count' }, items.length || '')));
    if (!items.length) tl.append(h('p', { class: 'faint', style: { margin: 0 } }, 'A blank page. Add an event in Calendar, or time-block a task.'));
    items.forEach(i => tl.append(h('div', { class: 'item' }, h('span', { class: 'time-col' }, i.allday ? 'all day' : fmtTime(i.start)), h('span', { class: 'dot', style: { background: i.color || (i.work ? 'var(--d-work)' : 'var(--pen)'), marginTop: '10px' } }), h('div', { class: 'grow' }, h('span', {}, i.title), i.loc ? h('div', { class: 'meta' }, i.loc) : '', i.type === 'block' ? h('div', { class: 'meta' }, 'time-blocked task') : ''))));
    L.append(tl);

    // due & overdue
    const dueToday = open.filter(t => t.due === T).sort(sortTasks);
    const due = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Due'), h('span', { class: 'count' }, dueToday.length || '')));
    if (over.length) due.append(h('details', { open: true }, h('summary', { class: 'small', style: { cursor: 'pointer', color: 'var(--warn)' } }, `${over.length} slipped — sort them out`), overdueTriage(over)));
    dueToday.forEach(t => due.append(taskRow(t)));
    const bills = store.list('bill_feed', b => b.due && b.due >= T && b.due <= addDays(T, 7));
    bills.forEach(b => due.append(h('div', { class: 'item' }, icon('clock'), h('span', {}, `${b.name} · ${b.amount ? cfg.currency + ' ' + b.amount : ''}`), h('span', { class: 'meta' }, niceDate(b.due)))));
    if (!dueToday.length && !over.length && !bills.length) due.append(h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing due. That’s a good feeling.'));
    L.append(due);
  }

  // trip countdown
  const nextTrip = store.list('trip', t => t.start && t.start >= T && t.status !== 'done').sort((a, b) => a.start.localeCompare(b.start))[0];
  if (nextTrip) { const n = Math.round((new Date(nextTrip.start) - new Date(T)) / 864e5); R.append(h('a', { class: 'card', href: '#/travel/t/' + nextTrip.id, style: { '--dom': 'var(--d-travel)', textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'card-head' }, h('h3', {}, nextTrip.name), h('span', { class: 'count' }, n === 0 ? 'today' : `in ${n} day${n > 1 ? 's' : ''}`)), h('div', { class: 'faint small' }, niceDate(nextTrip.start, true) + (nextTrip.checklist ? ` · ${nextTrip.checklist.filter(c => c.done).length}/${nextTrip.checklist.length} ready` : '')))); }
  // mood check-in
  const m = store.list('mood_log', x => x.day === T)[0];
  const mood = h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'How are you?'), m ? h('span', { class: 'count' }, 'logged') : ''));
  const rate = (label, key) => h('div', { class: 'row wrap' }, h('span', { class: 'small muted', style: { width: '56px' } }, label), [1, 2, 3, 4, 5].map(n => h('button', { class: 'chip' + (m && m[key] === n ? ' on' : ''), 'aria-label': `${label} ${n}`, 'aria-pressed': String(!!m && m[key] === n), onclick: () => store.put('mood_log', { day: T, [key]: n, at: new Date().toISOString() }, m?.id), title: MOODS[n] }, n)));
  mood.append(rate('Mood', 'mood'), rate('Energy', 'energy'));
  R.append(mood);

  // habits
  const habits = store.list('habit', x => !x.archived && inMode(x)).sort((a, b) => (a.created_at).localeCompare(b.created_at));
  if (habits.length) { const hc = h('section', { class: 'card', style: { '--dom': 'var(--d-goals)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Habits')), h('div', { class: 'row wrap' }, habits.map(hb => { const d = doneOn(hb); const s = streak(hb);
      return h('button', { class: 'chip' + (d ? ' on' : ''), 'aria-pressed': String(d), onclick: () => { const on = toggleHabit(hb); if (on) toast(`${hb.name} ✓${streak(hb) > 1 ? ' · ' + streak(hb) + ' in a row' : ''}`); }, title: hb.freq === 'weekly' ? `${weekCount(hb)}/${hb.per_week} this week` : '' }, d ? icon('check', 'mini') : '', hb.name, s > 1 ? h('span', { class: 'faint' }, s + (hb.freq === 'weekly' ? 'w' : '')) : ''); }))); R.append(hc); }

  // health strip
  if (gd) R.append(h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Body'), h('span', { class: 'count' }, gd.day === T ? 'today' : niceDate(gd.day))),
    h('div', { class: 'stat-row' }, stat(gd.sleep_h ? `${Math.floor(gd.sleep_h)}h${String(Math.round((gd.sleep_h % 1) * 60)).padStart(2, '0')}` : '–', 'sleep'), stat(gd.body_battery ?? '–', 'battery'), stat(gd.steps ? gd.steps.toLocaleString() : '–', 'steps'))));

  // what should I do?
  R.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'What should I do?')), h('p', { class: 'muted', style: { margin: '0 0 10px' } }, 'Free time? I’ll suggest from your own lists.'), h('a', { class: 'btn sm', href: '#/do' }, icon('star'), 'Suggest')));

  // motivation: own words > own wins > progress > quotes
  const vis = store.list('vision_item'), wins = store.list('win').sort((a, b) => b.created_at.localeCompare(a.created_at));
  let line, by = '';
  const seed = T;
  if (vis.length && parseInt(seed.slice(-1)) % 2 === 0) { const v = vis[parseInt(seed.replace(/-/g, '')) % vis.length]; line = v.text; by = 'your words'; }
  else if (wins.length) { const w = wins[0]; line = `${ago(w.created_at)}: ${w.title}`; by = 'a win'; }
  else { const q = pickQuote(seed); line = q[1]; by = q[2]; }
  R.append(h('p', { class: 'faint', style: { margin: '4px 0 0', fontFamily: 'var(--f-title)', fontSize: '1.4rem', lineHeight: 1.15 } }, '“' + line + '”', h('span', { class: 'small', style: { fontFamily: 'var(--f-hand)' } }, by ? '  — ' + by : '')));
}

const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));

function shutdown(L, T, open, ctx) {
  const done = store.list('done_log', d => d.day === T).filter(inMode);
  const rolling = open.filter(t => t.due === T);
  L.append(h('section', { class: 'card taped' }, h('h2', {}, 'Close the book on today'), h('p', { class: 'muted' }, done.length ? `${done.length} finished today. That counts.` : 'Quiet day on the done list — that’s okay.'), done.slice(0, 6).map(d => h('div', { class: 'item done' }, icon('check'), h('span', { class: 't' }, d.title)))));
  const roll = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Rolls over'), h('span', { class: 'count' }, rolling.length || '')));
  rolling.forEach(t => roll.append(taskRow(t)));
  if (rolling.length) roll.append(h('button', { class: 'btn sm', onclick: () => { rolling.forEach(t => saveTask({ due: addDays(T, 1) }, t.id)); toast('Moved to tomorrow'); } }, 'Move all to tomorrow')); else roll.append(h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing left over.'));
  L.append(roll);
  const tm = open.filter(t => t.due === addDays(T, 1)).slice(0, 3);
  L.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Tomorrow’s top 3')), tm.length ? tm.map(t => taskRow(t)) : h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing set. Capture one thing for tomorrow.')));
  const g = store.list('gratitude', x => x.day === T)[0];
  const inp = h('input', { class: 'in', placeholder: 'One good thing from today…', value: g?.text || '', 'aria-label': 'Gratitude', onchange: e => { if (e.target.value.trim()) { store.put('gratitude', { day: T, text: e.target.value.trim() }, g?.id); toast('Kept in your jar'); } } });
  L.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Gratitude')), inp));
}
