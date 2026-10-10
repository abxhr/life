// Buttons & automations. Rules run in the app (offline-friendly) and are visible/editable: nothing hidden.
//   when a task is done / a list item's status changes  ->  do something        every Monday 08:00  ->  do something
//   buttons: one-tap templates for tasks you create often ("Call mum", "Water plants", "Log gym").
import { h, today, addDays, dateIn, timeIn, dow, cfg, nowIso } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, toast, field, seg, empty } from './ui.js';
import { saveTask } from './tasks-core.js';
import { addWin } from './goals-core.js';
import { fill, triggerMatches, scheduleDue } from './automation-core.js';

export { fill, triggerMatches, scheduleDue };

// ---------- actions ----------
function runAction(a, ev) {
  const x = a.action || {}, rec = ev.rec || {}, vars = { title: rec.title || rec.name || '', date: today(), project: rec.project || '', list: ev.listName || '' };
  switch (x.type) {
    case 'create_task': saveTask({ title: fill(x.title, vars) || 'Follow up', due: x.due_in_days != null && x.due_in_days !== '' ? addDays(today(), +x.due_in_days) : null, priority: +x.priority || 3, ctx: x.context || rec.ctx || 'personal', project: x.project || rec.project || null, tags: ['auto'], done: false, source: 'automation' }); break;
    case 'create_note': store.put('note', { title: fill(x.title, vars), body: fill(x.body, vars), type: 'plain', tags: ['auto'] }); break;
    case 'add_win': addWin(fill(x.title, vars) || 'Done', 'automation'); break;
    case 'set_done_date': if (rec.id) store.put(rec.kind || 'list_item', { done_at: today() }, rec.id); break;
    case 'set_field': if (rec.id && x.field) store.put(rec.kind || 'task', { [x.field]: fill(x.value, vars) }, rec.id); break;
  }
}
let busy = false;
function fire(ev) { if (busy) return; busy = true; try { for (const a of store.list('automation')) if (triggerMatches(a, ev)) { try { runAction(a, ev); } catch (e) { console.error('automation', a.name, e); } } } finally { busy = false; } }   // actions never trigger further automations

function listName(listId) { return (store.get(listId) || {}).name || ''; }
export function startAutomations() {
  store.addHook((kind, rec, changed, prev) => {
    if (kind === 'task' && changed.includes('done') && rec.done && !prev.done) fire({ type: 'task_done', rec });
    if (kind === 'list_item' && changed.includes('status') && prev.status !== undefined && rec.status !== prev.status) fire({ type: 'item_status', rec, listName: listName(rec.list) });
  });
  const tick = () => { const n = new Date(), now = { date: dateIn(n), time: timeIn(n), dow: dow(dateIn(n)), dom: +dateIn(n).slice(8) }; for (const a of store.list('automation')) if (scheduleDue(a, now, a.last_run)) { busy = true; try { runAction(a, { rec: {} }); } finally { busy = false; } store.put('automation', { last_run: now.date }, a.id); toast('Automation ran: ' + a.name); } };
  setTimeout(tick, 4000); setInterval(tick, 60000);
}

// ---------- buttons ----------
export function pressButton(b) {
  const t = saveTask({ title: b.title || b.label, due: b.due_in_days != null && b.due_in_days !== '' ? addDays(today(), +b.due_in_days) : today(), priority: +b.priority || 3, ctx: b.context || 'personal', project: b.project || null, tags: b.tags || [], done: false, source: 'button' });
  toast(`Added “${t.title}”`, () => store.del(t.id));
}
export function buttonsRow() {
  const bs = store.list('button').sort((a, b) => a.created_at.localeCompare(b.created_at)); if (!bs.length) return '';
  return h('div', { class: 'row wrap', style: { margin: '0 0 14px' }, 'aria-label': 'Quick buttons' }, bs.map(b => h('button', { class: 'btn sm', onclick: () => pressButton(b) }, icon('zap'), b.label)));
}

// ---------- settings panel ----------
const TRIG = [['task_done', 'When I finish a task'], ['item_status', 'When a list item’s status changes'], ['schedule', 'On a schedule']];
const ACT = [['create_task', 'Create a task'], ['create_note', 'Create a note'], ['add_win', 'Add a win'], ['set_done_date', 'Set its done date to today'], ['set_field', 'Set a field on it']];
const TEMPLATES = [
  ['Every Sunday evening: weekly review task', { name: 'Weekly review task', trigger: { type: 'schedule', freq: 'weekly', dow: 0, time: '18:00' }, action: { type: 'create_task', title: 'Do my weekly review', due_in_days: 0, priority: 2 } }],
  ['Every Monday morning: plan the week', { name: 'Plan the week', trigger: { type: 'schedule', freq: 'weekly', dow: 1, time: '08:00' }, action: { type: 'create_task', title: 'Plan the week', due_in_days: 0 } }],
  ['After finishing a task in a project: follow up in 3 days', { name: 'Follow up', trigger: { type: 'task_done', project: '' }, action: { type: 'create_task', title: 'Follow up on {title}', due_in_days: 3 } }],
  ['When a list item is marked done: stamp today’s date', { name: 'Stamp done date', trigger: { type: 'item_status', to: '' }, action: { type: 'set_done_date' } }],
  ['When a task is done: add it to my wins', { name: 'Tasks → wins', trigger: { type: 'task_done', tag: 'win' }, action: { type: 'add_win', title: '{title}' } }],
];
function editAuto(a) {
  const x = a || { name: '', enabled: true, trigger: { type: 'schedule', freq: 'weekly', dow: 1, time: '08:00' }, action: { type: 'create_task', title: '' } };
  modal((d, close) => {
    const f = { ...x, trigger: { ...x.trigger }, action: { ...x.action } }, inp = (obj, k, label, type = 'text', ph = '') => field(label, h('input', { class: 'in', type, value: obj[k] ?? '', placeholder: ph, oninput: e => obj[k] = e.target.value }));
    const body = h('div', { class: 'stack' }), paint = () => {
      const t = f.trigger, ac = f.action, sel = (obj, k, opts) => h('select', { class: 'in', onchange: e => { obj[k] = e.target.value; paint(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === obj[k] }, l)));
      body.replaceChildren(inp(f, 'name', 'Name', 'text', 'e.g. Weekly review'), field('When', sel(t, 'type', TRIG)),
        t.type === 'task_done' ? h('div', { class: 'grid2' }, inp(t, 'project', 'Only in project (optional)'), inp(t, 'tag', 'Only with tag (optional)')) : '',
        t.type === 'item_status' ? h('div', { class: 'grid2' }, inp(t, 'to', 'Becomes (e.g. been, loved)'), inp(t, 'list', 'Only in list containing (optional)')) : '',
        t.type === 'schedule' ? h('div', { class: 'grid2' }, field('How often', sel(t, 'freq', [['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']])), inp(t, 'time', 'At', 'time'), t.freq === 'weekly' ? field('On', h('select', { class: 'in', onchange: e => t.dow = +e.target.value }, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((n, i) => h('option', { value: i, selected: i === (t.dow ?? 1) }, n)))) : '', t.freq === 'monthly' ? inp(t, 'dom', 'Day of month', 'number') : '') : '',
        field('Then', sel(ac, 'type', t.type === 'schedule' ? ACT.filter(a => ['create_task', 'create_note', 'add_win'].includes(a[0])) : ACT)),
        ['create_task', 'add_win', 'create_note'].includes(ac.type) ? inp(ac, 'title', 'Title (you can use {title}, {date}, {project})') : '', ac.type === 'create_note' ? inp(ac, 'body', 'Body') : '',
        ac.type === 'create_task' ? h('div', { class: 'grid2' }, inp(ac, 'due_in_days', 'Due in (days, blank = none)', 'number'), inp(ac, 'project', 'Project (optional)')) : '',
        ac.type === 'set_field' ? h('div', { class: 'grid2' }, inp(ac, 'field', 'Field name'), inp(ac, 'value', 'Value')) : '');
    }; paint();
    d.append(h('h2', {}, a ? 'Edit automation' : 'New automation'), body, h('div', { class: 'actions' }, a ? h('button', { class: 'btn danger', onclick: () => { store.del(a.id); close(); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (!f.name.trim()) f.name = TRIG.find(t => t[0] === f.trigger.type)[1]; store.put('automation', { name: f.name, enabled: f.enabled !== false, trigger: f.trigger, action: f.action }, a?.id); close(); } }, 'Save')));
  }, { wide: true, label: 'Automation' });
}
function editButton(b) {
  const x = b || { label: '', title: '', due_in_days: 0, context: 'personal', priority: 3 };
  modal((d, close) => {
    const f = { ...x }, i = (k, l, t = 'text', ph = '') => field(l, h('input', { class: 'in', type: t, value: f[k] ?? '', placeholder: ph, oninput: e => f[k] = e.target.value }));
    d.append(h('h2', {}, b ? 'Edit button' : 'New button'), h('div', { class: 'stack' }, i('label', 'Button label', 'text', 'Call mum'), i('title', 'Task it creates (blank = same as label)'), h('div', { class: 'grid2' }, i('due_in_days', 'Due in (days; 0 = today)', 'number'), i('project', 'Project (optional)'))),
      h('div', { class: 'actions' }, b ? h('button', { class: 'btn danger', onclick: () => { store.del(b.id); close(); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (!f.label.trim()) return; store.put('button', { label: f.label.trim(), title: f.title || f.label.trim(), due_in_days: f.due_in_days === '' ? null : +f.due_in_days, project: f.project || null, context: f.context || 'personal', priority: 3 }, b?.id); close(); } }, 'Save')));
  });
}
export function automationsPanel() {
  const wrap = h('div', { class: 'stack' }), paint = () => {
    const as = store.list('automation'), bs = store.list('button');
    wrap.replaceChildren(h('p', { class: 'muted small', style: { margin: 0 } }, 'Rules run while Life is open (and catch up when you open it). They never trigger each other, and you can see and switch off every one.'),
      as.length ? h('div', {}, as.map(a => h('div', { class: 'item' }, h('input', { type: 'checkbox', class: 'chk', checked: a.enabled !== false, 'aria-label': 'Enabled: ' + a.name, onchange: e => store.put('automation', { enabled: e.target.checked }, a.id) }), h('div', { class: 'grow', style: { cursor: 'pointer' }, onclick: () => editAuto(a) }, a.name, h('div', { class: 'meta' }, TRIG.find(t => t[0] === a.trigger?.type)?.[1], '→', ACT.find(t => t[0] === a.action?.type)?.[1], a.last_run ? 'last ran ' + a.last_run : ''))))) : h('p', { class: 'faint', style: { margin: 0 } }, 'No automations yet.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => editAuto() }, icon('plus'), 'New automation'), h('select', { class: 'in', style: { width: 'auto' }, 'aria-label': 'Add from template', onchange: e => { const t = TEMPLATES[+e.target.value]; if (t) { store.put('automation', { ...t[1], enabled: true }); toast('Added'); } e.target.value = ''; } }, h('option', { value: '' }, 'Add from a template…'), TEMPLATES.map((t, i) => h('option', { value: i }, t[0])))),
      h('hr', { class: 'hr' }), h('b', { style: { fontWeight: 400 } }, 'Buttons'), h('p', { class: 'muted small', style: { margin: 0 } }, 'One-tap task templates, shown on Today and in the command palette.'),
      bs.length ? h('div', { class: 'row wrap' }, bs.map(b => h('button', { class: 'chip', onclick: () => editButton(b) }, icon('zap', 'mini'), b.label))) : '', h('button', { class: 'btn', onclick: () => editButton() }, icon('plus'), 'New button'));
  }; paint(); store.subscribe(() => { if (wrap.isConnected) paint(); }); return wrap;
}
