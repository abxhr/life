// Calendar: day / week / month / agenda. Merges native events, ICS feeds, time-blocked tasks, reminders, trips.
import { h, today, addDays, dow, niceDate, fmtTime, wdName, monthName, timeIn, cfg, uid, localToUtc } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, field, toast, seg } from '../ui.js';
import { dayItems, loadFeeds, toMin, addMin } from '../calcore.js';
import { inMode } from '../state.js';
import { editTask } from './tasks.js';
import { saveTask } from '../tasks-core.js';

let view = localStorage.getItem('calview') || (innerWidth < 860 ? 'day' : 'week'), anchor = today();
const PX = 48, H0 = 6, H1 = 24;
const weekStart = ds => addDays(ds, -((dow(ds) + 6) % 7)); // Monday

export function editEvent(id, defaults = {}) {
  const e = id ? store.get(id) : { title: '', date: today(), start: '09:00', end: '10:00', ...defaults };
  modal((d, close) => {
    const title = h('input', { class: 'in', value: e.title, placeholder: 'Event' }), date = h('input', { class: 'in', type: 'date', value: e.date }), end_date = h('input', { class: 'in', type: 'date', value: e.end_date || '' });
    const all = h('input', { type: 'checkbox', class: 'chk', checked: !!e.allday }), start = h('input', { class: 'in', type: 'time', value: e.start || '' }), end = h('input', { class: 'in', type: 'time', value: e.end || '' });
    const work = h('input', { type: 'checkbox', class: 'chk', checked: e.ctx === 'work' }), loc = h('input', { class: 'in', value: e.loc || '', placeholder: 'Where' });
    const float = h('select', { class: 'in' }, h('option', { value: 'floating', selected: e.tzmode !== 'fixed' }, 'Same wall-clock time wherever I am'), h('option', { value: 'fixed', selected: e.tzmode === 'fixed' }, 'Fixed to ' + cfg.tz));
    const save = () => { if (!title.value.trim()) return title.focus(); store.put('event', { title: title.value.trim(), date: date.value, end_date: end_date.value || null, allday: all.checked, start: all.checked ? null : start.value, end: all.checked ? null : end.value, ctx: work.checked ? 'work' : 'personal', loc: loc.value, tzmode: float.value }, id); close(); };
    title.addEventListener('keydown', ev => ev.key === 'Enter' && save());
    d.append(h('h2', {}, id ? 'Edit event' : 'New event'), h('div', { class: 'stack' }, title, h('div', { class: 'grid2' }, field('Date', date), field('Until (optional)', end_date)), h('label', { class: 'row' }, all, 'All day'),
      h('div', { class: 'grid2' }, field('Starts', start), field('Ends', end)), field('Where', loc), field('Time zone', float), h('label', { class: 'row' }, work, 'Work event')),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); toast('Event deleted', () => store.restore(id)); } }, icon('trash'), 'Delete') : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')));
  }, { label: 'Event' });
}

const colorOf = it => it.color || (it.work ? 'var(--d-work)' : it.type === 'block' ? 'var(--d-goals)' : it.type === 'reminder' ? 'var(--margin)' : 'var(--pen)');
const open = it => it.type === 'event' ? editEvent(it.id) : (it.type === 'block' || it.type === 'taskdue') ? editTask(it.id) : it.type === 'trip' ? (location.hash = '#/travel') : it.type === 'reminder' ? null : null;

function lanes(items) { // greedy overlap columns
  const out = []; let cluster = [], end = 0;
  const flush = () => { const cols = []; cluster.forEach(it => { let c = cols.findIndex(e => e <= toMin(it.start)); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = toMin(it.end || addMin(it.start, 30)); it._c = c; }); cluster.forEach(it => it._n = cols.length); out.push(...cluster); cluster = []; end = 0; };
  items.forEach(it => { if (cluster.length && toMin(it.start) >= end) flush(); cluster.push(it); end = Math.max(end, toMin(it.end || addMin(it.start, 30))); });
  flush(); return out;
}

function dayColumn(ds, feeds, narrow) {
  const col = h('div', { class: 'cal-col' + (ds === today() ? ' is-today' : ''), 'data-date': ds, style: { height: (H1 - H0) * PX + 'px' } });
  for (let hr = H0; hr < H1; hr++) col.append(h('div', { class: 'cal-hr', style: { top: (hr - H0) * PX + 'px', height: PX + 'px' } }));
  col.addEventListener('click', e => { if (e.target !== col && !e.target.classList.contains('cal-hr')) return; const y = e.offsetY + (e.target.classList.contains('cal-hr') ? parseInt(e.target.style.top) : 0); const m = Math.floor((y / PX * 60 + H0 * 60) / 30) * 30; editEvent(null, { date: ds, start: addMin('00:00', m), end: addMin('00:00', m + 60) }); });
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); }); col.addEventListener('dragleave', () => col.classList.remove('drop'));
  col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/task'); if (!id) return; const r = col.getBoundingClientRect(); const m = Math.round(((e.clientY - r.top) / PX * 60 + H0 * 60) / 15) * 15; saveTask({ scheduled: ds, sched_time: addMin('00:00', m) }, id); toast('Blocked ' + fmtTime(addMin('00:00', m))); });
  const timed = lanes(dayItems(ds, feeds).filter(i => !i.allday && i.start));
  timed.forEach(it => {
    const top = Math.max(0, (toMin(it.start) - H0 * 60) / 60 * PX), hgt = Math.max(22, (toMin(it.end || addMin(it.start, 30)) - toMin(it.start)) / 60 * PX - 2);
    col.append(h('button', { class: 'cal-ev ' + it.type, style: { top: top + 'px', height: hgt + 'px', left: (it._c / it._n * 100) + '%', width: (100 / it._n - 1) + '%', '--c': colorOf(it) }, onclick: e => { e.stopPropagation(); open(it); }, title: it.title }, h('b', {}, it.title), h('span', {}, fmtTime(it.start) + (it.loc ? ' · ' + it.loc : ''))));
  });
  if (ds === today()) { const n = timeIn(); col.append(h('div', { class: 'cal-now', style: { top: (toMin(n) - H0 * 60) / 60 * PX + 'px' } })); }
  return col;
}

export default async function render(el, ctx) {
  const from = view === 'month' ? addDays(anchor.slice(0, 8) + '01', -7) : addDays(anchor, -7), to = addDays(anchor, 62);
  const feeds = await loadFeeds(from, to);
  const range = () => view === 'day' ? niceDate(anchor, true) + ' · ' + wdName(dow(anchor)) : view === 'week' ? `${niceDate(weekStart(anchor))} – ${niceDate(addDays(weekStart(anchor), 6))}` : view === 'month' ? monthName(+anchor.slice(5, 7) - 1) + ' ' + anchor.slice(0, 4) : 'Next 30 days';
  const step = n => { anchor = view === 'month' ? addDays(anchor.slice(0, 8) + '15', n * 30).slice(0, 8) + '01' : addDays(anchor, n * (view === 'week' ? 7 : view === 'day' ? 1 : 30)); ctx.refresh(); };
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Calendar'), h('span', { class: 'sub' }, range()), h('span', { class: 'grow' }),
    h('div', { class: 'row' }, h('button', { class: 'btn icon sm', 'aria-label': 'Previous', onclick: () => step(-1) }, icon('chevL')), h('button', { class: 'btn sm', onclick: () => { anchor = today(); ctx.refresh(); } }, 'Today'), h('button', { class: 'btn icon sm', 'aria-label': 'Next', onclick: () => step(1) }, icon('chevR')),
      h('button', { class: 'btn sm primary', onclick: () => editEvent(null, { date: anchor }) }, icon('plus'), 'Event'))),
    h('div', { style: { margin: '0 0 16px', overflowX: 'auto' } }, seg([['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['agenda', 'Agenda']], view, v => { view = v; localStorage.setItem('calview', v); ctx.refresh(); })));
  if (view === 'day' || view === 'week') {
    const days = view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
    const tray = store.list('task', t => !t.done && !t.someday && inMode(t) && (!t.due || t.due <= addDays(today(), 7))).sort((a, b) => (a.due || 'z').localeCompare(b.due || 'z')).slice(0, 14);
    if (tray.length) el.append(h('details', { class: 'card tight', style: { marginBottom: '16px' } }, h('summary', { style: { cursor: 'pointer' } }, 'Drag a task onto the grid to time-block it'), h('div', { class: 'row wrap', style: { marginTop: '8px' } }, tray.map(t => h('span', { class: 'chip', draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/task', t.id), style: { cursor: 'grab' } }, t.title)))));
    const head = h('div', { class: 'cal-head', style: { gridTemplateColumns: `52px repeat(${days.length}, 1fr)` } }, h('span'), days.map(ds => { const ad = dayItems(ds, feeds).filter(i => i.allday); return h('div', { class: 'cal-dh' + (ds === today() ? ' is-today' : '') }, h('b', {}, wdName(dow(ds)).slice(0, 3) + ' ' + ds.slice(8)), ad.map(i => h('button', { class: 'chip', style: { '--c': colorOf(i), borderColor: colorOf(i) }, onclick: () => open(i) }, i.title))); }));
    const gutter = h('div', { class: 'cal-gutter', style: { height: (H1 - H0) * PX + 'px' } }, Array.from({ length: H1 - H0 }, (_, i) => h('span', { style: { top: i * PX + 'px' } }, fmtTime(String(H0 + i).padStart(2, '0') + ':00'))));
    const grid = h('div', { class: 'cal-grid', style: { gridTemplateColumns: `52px repeat(${days.length}, 1fr)` } }, gutter, days.map(ds => dayColumn(ds, feeds)));
    const scroller = h('div', { class: 'cal-scroll', tabindex: '0', role: 'region', 'aria-label': 'Schedule (scrollable)' }, head, grid); el.append(h('div', { class: 'card cal' }, scroller));
    requestAnimationFrame(() => { scroller.scrollTop = Math.max(0, (Math.max(7, +timeIn().slice(0, 2) - 1) - H0) * PX - 4); });   // open at "now", with the controls still in view
  } else if (view === 'month') {
    const first = anchor.slice(0, 8) + '01', start = weekStart(first), m = anchor.slice(5, 7);
    const grid = h('div', { class: 'month' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { class: 'mh' }, d)));
    for (let i = 0; i < 42; i++) { const ds = addDays(start, i), its = dayItems(ds, feeds);
      grid.append(h('button', { class: 'md' + (ds.slice(5, 7) !== m ? ' out' : '') + (ds === today() ? ' is-today' : ''), onclick: () => { anchor = ds; view = 'day'; ctx.refresh(); } }, h('b', {}, +ds.slice(8)), its.slice(0, 3).map(i => h('span', { class: 'mi', style: { '--c': colorOf(i) } }, i.title)), its.length > 3 ? h('span', { class: 'faint small' }, '+' + (its.length - 3)) : '')); }
    el.append(h('div', { class: 'card' }, grid));
  } else {
    const list = h('div', { class: 'stack' });
    let any = false;
    for (let i = 0; i < 30; i++) { const ds = addDays(today(), i), its = dayItems(ds, feeds); if (!its.length) continue; any = true;
      list.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, niceDate(ds)), h('span', { class: 'count' }, wdName(dow(ds)))), its.map(it => h('button', { class: 'item btn ghost', style: { width: '100%', justifyContent: 'flex-start', textAlign: 'left', borderRadius: '6px' }, onclick: () => open(it) }, h('span', { class: 'time-col' }, it.allday ? 'all day' : fmtTime(it.start)), h('span', { class: 'dot', style: { background: colorOf(it) } }), h('span', {}, it.title), it.loc ? h('span', { class: 'faint small' }, ' · ' + it.loc) : '')))); }
    if (!any) list.append(h('div', { class: 'empty' }, icon('calendar'), h('span', { class: 'big' }, 'A clear month'), h('p', {}, 'Add an event, or paste a calendar feed in Settings.')));
    el.append(list);
  }
}
