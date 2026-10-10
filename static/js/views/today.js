// Today: one calm sentence + the one thing. Everything else is quiet and scannable.
import { h, today, addDays, niceDate, fmtTime, cfg, timeIn, wdName, dow, isWorkDay, ago, uid, diffDays } from '../util.js';
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
import { moodCard } from '../mood.js';

const addMinStr = (hm, m) => { let [H, M] = hm.split(':').map(Number); const t = Math.min(1439, H * 60 + M + m); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
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
  const briefEl = h('p', { class: 'hero-line rise', style: { maxWidth: '30ch' } }, cached ? cached.text : briefing(T, items, open, over.length, sleepH));
  el.append(briefEl);
  const pro = (window.__settings && window.__settings.ai_proactive) || {};
  if (!cached && pro.morning && !evening) { // opt-in: one AI-written sentence per morning, cached; the rule-based line stays if AI is unavailable
    const facts = { weekday: wdName(dow(T)), events: items.filter(i => !i.allday).slice(0, 6).map(i => ({ title: i.title, start: i.start })), tasks_due: open.filter(t => t.due === T).length, overdue: over.length, sleep_hours: sleepH };
    store.api('/api/ai/briefing', { method: 'POST', body: JSON.stringify({ facts }) }).then(j => { if (j && j.text) { store.put('briefing', { day: T, text: j.text }); briefEl.textContent = j.text; } }).catch(() => {});
  }

  const lowDays = store.list('mood_log').filter(m => m.day >= addDays(T, -2) && m.mood <= 2).length >= 3;
  store.list('future_note', n => !n.delivered && ((n.deliver_on && n.deliver_on <= T) || (n.when_low && lowDays))).slice(0, 1).forEach(n => el.append(h('div', { class: 'sticky rise', style: { marginBottom: '16px' } }, h('div', { class: 'small' }, 'A note from past you'), h('div', { class: 'big' }, n.text), h('button', { class: 'btn sm', style: { '--b': 'currentColor', marginTop: '8px' }, onclick: () => store.put('future_note', { delivered: true }, n.id) }, 'Thanks, me'))));
  const grid = h('div', { class: 'today-grid' }), L = h('div', { class: 'stack' }), R = h('div', { class: 'stack' }); grid.append(L, R); el.append(grid);

  if (evening) { shutdown(L, T, open, ctx); } else {
    // Now / next + the one thing
    const nb = nowBlock(T);
    const hero = h('div', { class: 'hero-row' });
    hero.append(one ? h('div', { class: 'sticky rise' }, h('div', { class: 'small' }, 'The one thing'), h('div', { class: 'big', style: { margin: '4px 0 12px' } }, one.title),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => { completeTask(one); toast('Nice. Done.'); } }, icon('check'), 'Done'), h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => editTask(one.id) }, 'Open'), h('button', { class: 'btn sm', style: { '--b': 'currentColor' }, onclick: () => import('../focus.js').then(m => m.openFocus(one.id)) }, icon('zap'), 'Focus'),
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
    const billBox = h('div', {});
    store.api('/api/wealth/summary').then(w => (w.upcoming || []).filter(b => b.due && b.due >= T && b.due <= addDays(T, 7)).forEach(b => billBox.append(h('div', { class: 'item' }, icon('clock'), h('span', {}, `${b.name}${b.amount ? ' · ' + (w.currency || cfg.currency) + ' ' + b.amount : ''}`), h('span', { class: 'meta' }, niceDate(b.due)))))).catch(() => {});
    due.append(billBox);
    if (!dueToday.length && !over.length) due.append(h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing due. That’s a good feeling.'));
    L.append(due);
  }

  // this week's top three (set in last week's review)
  const mon = addDays(T, -((dow(T) + 6) % 7)), lastRev = store.list('review', r => r.kind === 'week' && r.start === addDays(mon, -7))[0];
  if (lastRev && (lastRev.top3 || []).length) R.append(h('section', { class: 'card', style: { '--dom': 'var(--d-goals)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'This week’s three')), lastRev.top3.map(t => { const tk = store.list('task', x => x.title === t)[0]; return h('div', { class: 'item' + (tk && tk.done ? ' done' : '') }, icon(tk && tk.done ? 'check' : 'goals', 'mini'), h('span', { class: 't' }, t)); })));
  // people: birthdays this week and who's due a hello
  const ppl = store.list('person'), bd = ppl.filter(p => p.birthday && p.birthday.length >= 5 && (() => { const d = `${T.slice(0, 4)}-${p.birthday.slice(-5)}`; const n = diffDays(T, d); return n >= 0 && n <= 7; })());
  const hello = ppl.filter(p => p.keep_weeks && Math.floor(diffDays(p.last_contact || '2000-01-01', T) / 7) >= p.keep_weeks).slice(0, 1);
  if (bd.length || hello.length) R.append(h('a', { class: 'card', href: '#/people', style: { textDecoration: 'none', color: 'inherit', borderStyle: 'dashed' } }, bd.map(p => h('div', {}, `${p.name}'s birthday is ${diffDays(T, `${T.slice(0, 4)}-${p.birthday.slice(-5)}`) === 0 ? 'today' : 'this week'}.`)), hello.map(p => h('div', { class: 'muted' }, `Haven't spoken to ${p.name} in a while.`))));
  // on this day (journal & trip photos from earlier years)
  const md = T.slice(5), past = [...store.list('note', n => n.daily && n.daily.slice(5) === md && n.daily < T && (n.body || '').replace(/[#\-\s]/g, '').length > 30).map(n => ({ y: n.daily.slice(0, 4), t: (n.body || '').replace(/#+\s*/g, '').trim().slice(0, 110) })), ...store.list('visit', v => v.start && v.start.slice(5) === md && v.start < T).map(v => ({ y: v.start.slice(0, 4), t: 'In ' + v.country + (v.what ? ': ' + v.what.slice(0, 80) : '') }))];
  if (past.length) R.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'On this day')), past.slice(0, 2).map(x => h('div', { class: 'item' }, h('b', { style: { fontWeight: 400, width: '44px' } }, x.y), h('span', { class: 'muted' }, x.t)))));
  // weather nudge: rain/heat vs. outdoor plans today
  const outdoor = items.find(i => /padel|football|tennis|run|hike|beach|karting|golf|cycling/i.test(i.title));
  if (outdoor) store.api('/api/weather').then(w => { const rain = (w.daily?.precipitation_probability_max?.[0] || 0) > 60, hot = (w.daily?.temperature_2m_max?.[0] || 0) >= 38; if ((rain || hot) && R.isConnected) R.prepend(h('a', { class: 'card', href: '#/calendar', style: { textDecoration: 'none', color: 'inherit', borderColor: 'var(--warn)' } }, h('b', { style: { fontWeight: 400 } }, rain ? `Rain looks likely — “${outdoor.title}” at ${fmtTime(outdoor.start)}?` : `It’s going to be ${Math.round(w.daily.temperature_2m_max[0])}° — move “${outdoor.title}” to the evening?`), h('div', { class: 'muted small' }, 'Tap to adjust your calendar.'))); }).catch(() => {});
  // opt-in nudges (rule-based, computed locally; each toggled separately in Assistant → Privacy & style)
  const nudges = [];
  if (pro.stress) { const n = store.list('mood_log', m => m.day >= addDays(T, -6) && (m.tags || []).includes('stressed')).length; if (n >= 4) nudges.push(['You’ve said “stressed” ' + n + ' times this week.', 'Want a lighter week? I can help move a few things.', '#/do']); }
  if (pro.goals) store.list('goal', g => g.status === 'active' && g.quarterly && g.updated_at < new Date(Date.now() - 14 * 864e5).toISOString()).slice(0, 1).forEach(g => nudges.push([`“${g.title}” hasn’t moved in two weeks.`, 'One small step today?', '#/goals']));
  if (pro.gaps) { const mn = store.list('mood_log', m => m.day === T && m.energy != null).sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0]; const nb = nowBlock(T); if (mn && mn.energy <= 2 && !nb.now && (!nb.next || nb.next.start > addMinStr(now, 180))) nudges.push(['You’ve got a few free hours and low energy.', 'Here’s something gentle from your own lists.', '#/do']); }
  nudges.slice(0, 2).forEach(([a, b, href]) => R.append(h('a', { class: 'card', href, style: { textDecoration: 'none', color: 'inherit', borderStyle: 'dashed' } }, h('b', { style: { fontWeight: 400 } }, a), h('div', { class: 'muted small' }, b))));
  // trip countdown
  const nextTrip = store.list('trip', t => t.start && t.start >= T && t.status !== 'done').sort((a, b) => a.start.localeCompare(b.start))[0];
  if (nextTrip) { const n = Math.round((new Date(nextTrip.start) - new Date(T)) / 864e5); R.append(h('a', { class: 'card', href: '#/travel/t/' + nextTrip.id, style: { '--dom': 'var(--d-travel)', textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'card-head' }, h('h3', {}, nextTrip.name), h('span', { class: 'count' }, n === 0 ? 'today' : `in ${n} day${n > 1 ? 's' : ''}`)), h('div', { class: 'faint small' }, niceDate(nextTrip.start, true) + (nextTrip.checklist ? ` · ${nextTrip.checklist.filter(c => c.done).length}/${nextTrip.checklist.length} ready` : '')))); }
  R.append(moodCard({ compact: true }));

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
  const HID = { 'Today’s page': 'timeline', 'Due': 'due', 'How are you?': 'mood', 'Habits': 'habits', 'Body': 'body', 'What should I do?': 'do', 'This week’s three': 'top3', 'On this day': 'onthisday' };
  const hidden = new Set((window.__settings && window.__settings.today_hidden) || []);
  if (hidden.size) el.querySelectorAll('section.card').forEach(c => { const k = HID[(c.querySelector('h3') || {}).textContent] || HID[((c.querySelector('h3') || {}).textContent || '').replace(/^How are you this .*/, 'How are you?')]; if (k && hidden.has(k)) c.remove(); });
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
