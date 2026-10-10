// Tasks: Today / Upcoming / Anytime / Someday / Projects (+board) / Context / Done log. Personal and work share one list; Mode filters.
import { h, today, addDays, niceDate, fmtTime, uid, cfg } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, seg, field, confirmBox, menu } from '../ui.js';
import { inMode, state } from '../state.js';
import { parse } from '../nlp.js';
import { recLabel } from '../nlp.js';
import { linksPanel } from '../links.js';
import { parseLatLon } from '../lists-core.js';
import { PRIO, CTX, fromParsed, saveTask, completeTask, uncomplete, sortTasks, isOverdue, projects, subtask } from '../tasks-core.js';

let tab = 'today', proj = null, board = false, selId = null, groupBy = 'project';
const expanded = new Set(), folded = new Set();   // expanded: shown past 150 rows · folded: collapsed groups (this session)   // groups the user expanded past the first 150 rows (long lists stay fast)
const TABS = [['today', 'Today'], ['upcoming', 'Upcoming'], ['anytime', 'Anytime'], ['someday', 'Someday'], ['project', 'Projects'], ['context', 'Contexts'], ['done', 'Done']];
const domOf = t => t.ctx === 'work' || t.ctx === 'work-outside-work' ? 'var(--d-work)' : null;

export function taskRow(t, { onChange, showCtx } = {}) {
  const subs = t.subtasks || [], sd = subs.filter(s => s.done).length;
  const cb = h('input', { type: 'checkbox', class: 'chk', checked: !!t.done, 'aria-label': 'Complete ' + t.title, onchange: e => {
    const row = e.target.closest('.item');
    if (e.target.checked) { const r = completeTask(t); row.classList.add('done'); toast(r.rolled ? `Done — next one ${niceDate(r.rolled)}` : 'Done', () => { if (r.rolled) { saveTask({ due: t.due }, t.id); } else uncomplete(t); }); }
    else uncomplete(t);
    onChange && onChange();
  } });
  const meta = h('div', { class: 'meta' },
    t.due ? h('span', { class: isOverdue(t) ? 'warn-text' : '', style: isOverdue(t) ? { color: 'var(--warn)' } : null }, icon('calendar', 'mini'), ' ' + niceDate(t.due) + (t.due_time ? ' · ' + fmtTime(t.due_time) : '')) : '',
    t.recur ? h('span', {}, icon('repeat', 'mini'), ' ' + recLabel(t.recur)) : '',
    t.remind_at ? h('span', {}, icon('bell', 'mini')) : '', t.priority && t.priority < 3 ? h('span', { style: { color: t.priority === 1 ? 'var(--bad)' : 'var(--warn)' } }, icon('flag', 'mini'), ' ' + PRIO[t.priority]) : '',
    t.project ? h('span', {}, '+' + t.project) : '', showCtx && t.ctx !== 'personal' ? h('span', { style: { color: domOf(t) || 'inherit' } }, CTX.find(c => c[0] === t.ctx)?.[1] || t.ctx) : '',
    subs.length ? h('span', {}, `${sd}/${subs.length}`) : '', t.est ? h('span', {}, t.est + ' min') : '', (t.tags || []).map(x => h('span', {}, '#' + x)));
  const row = h('div', { class: 'item' + (t.done ? ' done' : '') + (selId === t.id ? ' sel' : ''), 'data-id': t.id, draggable: 'true', tabindex: '0',
    ondragstart: e => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; }, onclick: e => { if (e.target === cb) return; selId = t.id; editTask(t.id); } },
    cb, h('div', { class: 'grow' }, h('span', { class: 't' }, t.title), meta));
  if (domOf(t)) row.style.boxShadow = `inset 3px 0 0 ${domOf(t)}`, row.style.paddingLeft = '8px';
  return row;
}

export function editTask(id, defaults = {}) {
  const t = id ? store.get(id) : { title: '', priority: 3, ctx: state.mode === 'work' ? 'work' : 'personal', tags: [], subtasks: [], ...defaults };
  modal((d, close) => {
    const f = { ...t };
    const title = h('input', { class: 'in', value: f.title, 'aria-label': 'Title', placeholder: 'What needs doing?' });
    const notes = h('textarea', { class: 'in', value: f.notes || '', 'aria-label': 'Notes' });
    const due = h('input', { class: 'in', type: 'date', value: f.due || '' }), time = h('input', { class: 'in', type: 'time', value: f.due_time || '' }), sched = h('input', { class: 'in', type: 'date', value: f.scheduled || '' });
    const est = h('input', { class: 'in', type: 'number', min: 0, step: 5, value: f.est || '', inputmode: 'numeric' });
    const prio = seg([[1, 'Urgent'], [2, 'High'], [3, 'Normal'], [4, 'Low']], f.priority || 3, v => f.priority = v);
    const ctx = h('select', { class: 'in', onchange: e => f.ctx = e.target.value }, CTX.map(([v, l]) => h('option', { value: v, selected: v === f.ctx }, l)));
    const project = h('input', { class: 'in', value: f.project || '', list: 'projs', placeholder: 'none' }), pl = h('datalist', { id: 'projs' }, projects().map(p => h('option', { value: p })));
    const tags = h('input', { class: 'in', value: (f.tags || []).join(', '), placeholder: 'home, calls' });
    const remind = h('select', { class: 'in' }, [['none', 'No reminder'], ['at', 'At due time'], ['15', '15 min before'], ['60', '1 hour before'], ['1d', 'Morning before (9:00)']].map(([v, l]) => h('option', { value: v, selected: (f.remind || 'none') === v }, l)));
    const chan = h('select', { class: 'in' }, [['all', 'Everywhere (push, Telegram, in-app)'], ['telegram', 'Telegram only'], ['push', 'Push only'], ['inapp', 'In-app only']].map(([v, l]) => h('option', { value: v, selected: (f.channels || 'all') === v }, l)));
    const crit = h('input', { type: 'checkbox', class: 'chk', checked: !!f.critical });
    const recSel = h('select', { class: 'in' }, [['', 'Does not repeat'], ['every day', 'Every day'], ['every weekday', 'Every weekday'], ['every week', 'Every week'], ['every 2 weeks', 'Every 2 weeks'], ['every month', 'Every month'], ['every year', 'Every year'], ['__keep', f.recur ? 'Keep: ' + recLabel(f.recur) : 'Custom (type below)']].map(([v, l]) => h('option', { value: v, selected: f.recur ? v === '__keep' : v === '' }, l)));
    const recTxt = h('input', { class: 'in', placeholder: 'or type: every 3 days after done', 'aria-label': 'Custom repeat' });
    const someday = h('input', { type: 'checkbox', class: 'chk', checked: !!f.someday });
    const goals = store.list('goal', g => g.status !== 'dropped' && g.status !== 'achieved');
    const goalSel = h('select', { class: 'in' }, h('option', { value: '' }, 'No goal'), goals.map(g => h('option', { value: g.id, selected: g.id === f.goal_id }, g.title)));
    const subWrap = h('div', { class: 'stack-s' });
    const paintSubs = () => { subWrap.replaceChildren(...(f.subtasks || []).map(s => h('div', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: s.done, onchange: e => s.done = e.target.checked }), h('span', { class: 'grow' }, s.title), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove subtask', onclick: () => { f.subtasks = f.subtasks.filter(x => x !== s); paintSubs(); } }, icon('x'))))); };
    const subIn = h('input', { class: 'in', placeholder: 'Add a step…', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { (f.subtasks = f.subtasks || []).push(subtask(e.target.value.trim())); e.target.value = ''; paintSubs(); e.preventDefault(); } } });
    paintSubs();
    const near = h('input', { class: 'in', value: f.near ? `${f.near.lat}, ${f.near.lon}` : '', placeholder: 'lat, lon — or paste a maps link', 'aria-label': 'Remind me near' });
    const nearR = h('select', { class: 'in', style: { maxWidth: '150px' } }, [150, 300, 1000].map(r => h('option', { value: r, selected: (f.near?.radius || 300) === r }, r + ' m')));
    const nearBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { near.value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`; }, () => toast('Location not allowed')) : toast('No location on this device') }, icon('pin'), 'Use my location');
    const save = () => {
      if (!title.value.trim()) { title.focus(); return; }
      let recur = f.recur; const choice = recTxt.value.trim() || recSel.value;
      if (choice && choice !== '__keep') recur = parse('x ' + choice).recur; else if (!choice) recur = null;
      saveTask({ title: title.value.trim(), notes: notes.value, due: due.value || null, due_time: time.value || null, scheduled: sched.value || null, est: +est.value || null, priority: f.priority || 3, ctx: ctx.value, project: project.value.trim() || null,
        tags: tags.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean), remind: remind.value, channels: chan.value, critical: crit.checked, recur, subtasks: f.subtasks || [], near: (() => { const ll = parseLatLon(near.value); return ll ? { ...ll, radius: +nearR.value } : null; })(), someday: someday.checked, goal_id: goalSel.value || null,
        done: !!f.done }, id);
      close(true);
    };
    title.addEventListener('keydown', e => e.key === 'Enter' && save());
    d.append(h('h2', {}, id ? 'Edit task' : 'New task'), h('div', { class: 'stack' }, title, h('div', { class: 'grid2' }, field('Due', due), field('Time', time)),
      h('div', { class: 'grid2' }, field('Plan to do it on', sched), field('Takes (min)', est)), h('div', {}, h('div', { class: 'small muted' }, 'Priority'), prio),
      h('div', { class: 'grid2' }, field('Context', ctx), field('Project', project)), pl, field('Tags', tags), field('Repeat', recSel), recTxt,
      field('Send reminders via', chan), h('div', { class: 'grid2' }, field('Reminder', remind), h('label', { class: 'row', style: { alignSelf: 'end', minHeight: '44px' } }, crit, 'Critical: keep nagging until I act')),
      field('Notes', notes), h('div', {}, h('div', { class: 'small muted' }, 'Steps'), subWrap, subIn), field('Goal', goalSel), h('label', { class: 'row' }, someday, 'Someday / maybe — keep it out of my way'), h('div', {}, h('div', { class: 'small muted' }, 'Remind me when I’m near a place (works while Life is open)'), h('div', { class: 'row wrap' }, near, nearR, nearBtn)), id ? linksPanel(store.get(id)) : ''),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn', onclick: () => { const c = store.get(id); const { id: _i, kind: _k, created_at: _c, updated_at: _u, deleted_at: _d, _t, done_at, last_fired, acked, ...rest } = c; saveTask({ ...rest, title: c.title + ' (copy)', done: false, subtasks: (c.subtasks || []).map(x => ({ ...x, done: false })) }); close(true); toast('Duplicated'); } }, icon('copy'), 'Duplicate') : '', id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(true); toast('Task deleted', () => store.restore(id)); } }, icon('trash'), 'Delete') : '', h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')));
  }, { wide: true, label: 'Task' });
}

function group(title, items, el, opt = {}) {
  if (!items.length && !opt.keep) return;
  const card = h('section', { class: 'card ' + (opt.cls || ''), style: opt.dom ? { '--dom': opt.dom } : null }, h('div', { class: 'card-head gh', role: 'button', tabindex: '0', 'aria-expanded': String(!folded.has(title)), onclick: () => { folded.has(title) ? folded.delete(title) : folded.add(title); document.dispatchEvent(new Event('modechange')); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } }, icon('chevD', 'mini car'), h('h3', {}, title), h('span', { class: 'count' }, items.length || '')), ...(opt.pre ? [opt.pre] : []));
  if (folded.has(title)) { el.append(card); return; }
  const cap = expanded.has(title) ? Infinity : 150;
  items.slice(0, cap).forEach(t => card.append(taskRow(t, opt.row)));
  if (items.length > cap) card.append(h('button', { class: 'btn sm', onclick: () => { expanded.add(title); document.dispatchEvent(new Event('modechange')); } }, `Show ${items.length - cap} more`));
  if (!items.length && opt.emptyMsg) card.append(h('p', { class: 'faint' }, opt.emptyMsg));
  el.append(card);
}

export function overdueTriage(list, refresh) {
  return h('div', { class: 'stack-s' }, list.map(t => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('span', { class: 't' }, t.title), h('div', { class: 'meta' }, 'was ' + niceDate(t.due))),
    h('button', { class: 'chip', onclick: () => saveTask({ due: today() }, t.id) }, 'today'), h('button', { class: 'chip', onclick: () => saveTask({ due: addDays(today(), 1) }, t.id) }, 'tomorrow'),
    h('button', { class: 'chip', onclick: () => saveTask({ due: null, someday: true }, t.id) }, 'someday'), h('button', { class: 'chip', onclick: () => { store.del(t.id); toast('Dropped', () => store.restore(t.id)); } }, 'drop'))));
}

const syncHash = () => history.replaceState(null, '', '#/tasks?tab=' + tab + (proj ? '&proj=' + encodeURIComponent(proj) : ''));   // so the ☆ pins THIS view (saved views)

export default function render(el, ctx) {
  if (!ctx.soft && ctx.q.tab && TABS.some(x => x[0] === ctx.q.tab)) { tab = ctx.q.tab; proj = ctx.q.proj || null; }
  const all = () => store.list('task').filter(inMode);
  const T = today();
  const add = h('input', { class: 'in cap-input', placeholder: 'Add a task…  “send deck to finance fri 2pm @work !high”', 'aria-label': 'Add a task', onkeydown: e => {
    if (e.key === 'Enter' && e.target.value.trim()) { const p = parse(e.target.value); if (state.mode === 'work' && !p.ctx) p.ctx = 'work'; if (tab === 'today' && !p.due) p.due = T; saveTask(fromParsed(p)); e.target.value = ''; } } });
  const tabs = seg(TABS, tab, v => { tab = v; syncHash(); ctx.refresh(); });
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Tasks'), h('span', { class: 'sub' }, state.mode === 'work' ? 'work only' : state.mode === 'personal' ? 'personal only' : '')), add, h('div', { style: { margin: '12px 0 20px', overflowX: 'auto' } }, tabs));
  const body = h('div', { class: 'stack' }); el.append(body);
  const open = all().filter(t => !t.done);
  const wk = new Set(['work', 'work-outside-work']);
  if (tab === 'today') {
    const over = open.filter(t => t.due && t.due < T && !t.someday).sort(sortTasks);
    const now = open.filter(t => (t.due === T || t.scheduled === T) && !t.someday).sort(sortTasks);
    if (over.length) body.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'A few slipped'), h('span', { class: 'count' }, over.length)), h('p', { class: 'muted small', style: { margin: 0 } }, 'No stress. Move, park, or drop each one.'), overdueTriage(over)));
    group('Today', now, body, { keep: true, emptyMsg: 'Nothing due today. Add something above, or enjoy it.' });
    const doneToday = store.list('done_log', d => d.day === T).filter(inMode);
    if (doneToday.length) body.append(h('p', { class: 'faint' }, `${doneToday.length} done today ✓`));
  } else if (tab === 'upcoming') {
    const up = open.filter(t => t.due && t.due > T && !t.someday).sort(sortTasks), byDay = {};
    up.forEach(t => (byDay[t.due] ||= []).push(t));
    Object.keys(byDay).sort().forEach(d => group(niceDate(d), byDay[d], body));
    if (!up.length) body.append(empty('calendar', 'Nothing coming up', 'Tasks with a due date land here.'));
  } else if (tab === 'anytime') {
    group('Anytime', open.filter(t => !t.due && !t.someday).sort(sortTasks), body, { keep: true, emptyMsg: 'No undated tasks. Clean slate.' });
  } else if (tab === 'someday') {
    group('Someday / maybe', open.filter(t => t.someday).sort(sortTasks), body, { keep: true, emptyMsg: 'Park ideas here so they don’t nag you.' });
  } else if (tab === 'project') {
    const ps = [...new Set(open.map(t => t.project).filter(Boolean))].sort();
    const bar = h('div', { class: 'row wrap' }, h('button', { class: 'chip' + (proj === null ? ' on' : ''), onclick: () => { proj = null; syncHash(); ctx.refresh(); } }, 'All'), ps.map(p => h('button', { class: 'chip' + (proj === p ? ' on' : ''), onclick: () => { proj = p; syncHash(); ctx.refresh(); } }, p)),
      h('span', { class: 'grow' }), h('select', { class: 'in', style: { width: 'auto' }, 'aria-label': 'Group by', onchange: e => { groupBy = e.target.value; ctx.refresh(); } }, [['project', 'Group by project'], ['priority', 'Group by priority'], ['context', 'Group by context'], ['tag', 'Group by tag'], ['status', 'Group by status']].map(([v, l]) => h('option', { value: v, selected: v === groupBy }, l))), h('button', { class: 'btn sm' + (board ? ' primary' : ''), onclick: () => { board = !board; ctx.refresh(); } }, board ? 'List' : 'Board'));
    body.append(bar);
    const sel = open.filter(t => proj === null || t.project === proj);
    if (board) {
      const cols = [['todo', 'To do'], ['doing', 'Doing']];
      const grid = h('div', { class: 'grid2' });
      cols.forEach(([k, l]) => { const c = h('section', { class: 'card', style: { minHeight: '160px' }, ondragover: e => e.preventDefault(), ondrop: e => { const id = e.dataTransfer.getData('text/task'); if (id) store.put('task', { status: k }, id); } }, h('div', { class: 'card-head' }, h('h3', {}, l)));
        sel.filter(t => (t.status || 'todo') === k).sort(sortTasks).forEach(t => c.append(taskRow(t))); grid.append(c); });
      const doneC = h('section', { class: 'card', ondragover: e => e.preventDefault(), ondrop: e => { const id = e.dataTransfer.getData('text/task'); if (id) completeTask(store.get(id)); } }, h('div', { class: 'card-head' }, h('h3', {}, 'Done')), h('p', { class: 'faint' }, 'Drop here to finish'));
      body.append(grid, doneC);
    } else {
      if (groupBy === 'project') { const names = proj === null ? [...ps, null] : [proj]; names.forEach(p => group(p || 'No project', sel.filter(t => (t.project || null) === p).sort(sortTasks), body)); }
      else { const keyOf = { priority: t => PRIO[t.priority || 3], context: t => (CTX.find(c => c[0] === t.ctx) || [0, t.ctx || 'personal'])[1], status: t => (t.status || 'todo') === 'doing' ? 'Doing' : 'To do', tag: t => (t.tags || [])[0] ? '#' + t.tags[0] : 'No tag' }[groupBy], g = {}; sel.forEach(t => (g[keyOf(t)] ||= []).push(t)); Object.keys(g).sort().forEach(k => group(k, g[k].sort(sortTasks), body)); }
    }
    if (!sel.length) body.append(empty('tasks', 'No projects yet', 'Add “+Japan-trip” to a task and it shows up here.'));
  } else if (tab === 'context') {
    CTX.forEach(([c, l]) => group(l, open.filter(t => t.ctx === c).sort(sortTasks), body, { dom: wk.has(c) ? 'var(--d-work)' : null }));
  } else {
    const logs = store.list('done_log').filter(inMode).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
    if (!logs.length) body.append(empty('check', 'Nothing finished yet', 'Completed tasks are kept here as a quiet record of progress.'));
    let last = ''; let card;
    logs.forEach(l => { if (l.day !== last) { last = l.day; card = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, niceDate(l.day)))); body.append(card); } card.append(h('div', { class: 'item done' }, icon('check'), h('span', { class: 't' }, l.title), h('span', { class: 'meta' }, l.project ? '+' + l.project : ''))); });
  }
  // keyboard: J/K move, X complete, E edit, 1-4 priority
  const key = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.querySelector('.scrim') || e.ctrlKey || e.metaKey) return;
    const rows = [...el.querySelectorAll('.item[data-id]')]; if (!rows.length) return;
    let i = rows.findIndex(r => r.dataset.id === selId);
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') { i = k === 'j' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0); selId = rows[i].dataset.id; rows.forEach(r => r.classList.toggle('sel', r.dataset.id === selId)); rows[i].scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (selId && k === 'x') { const t = store.get(selId); if (t) { completeTask(t); toast('Done'); } }
    else if (selId && k === 'e') { editTask(selId); e.preventDefault(); }
    else if (selId && '1234'.includes(k) && k.length === 1) { store.put('task', { priority: +k }, selId); }
  };
  document.addEventListener('keydown', key);
  const nt = () => editTask(null, tab === 'today' ? { due: T } : {});
  document.addEventListener('new-task', nt);
  if (ctx.q.edit && !ctx.soft) editTask(ctx.q.edit);
  return () => { document.removeEventListener('keydown', key); document.removeEventListener('new-task', nt); };
}
