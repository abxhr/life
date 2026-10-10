// Lists: typed collections with custom fields; list / table / grid / map / board views; surprise me; share as Markdown.
import { h, uid, niceDate, today, debounce } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox, promptBox } from '../ui.js';
import { types, isDone, doneStatus, toMarkdown, distanceKm, parseLatLon, BUILTIN } from '../lists-core.js';
import { loadLeaflet } from '../maps.js';
import { shareLink } from '../share.js';

const prefs = { view: {}, sort: {}, q: '' };
const stars = (n, on) => h('span', { class: 'stars', role: 'img', 'aria-label': `${n || 0} of 5` }, [1, 2, 3, 4, 5].map(i => h('button', { type: 'button', class: 'star' + (i <= (n || 0) ? ' on' : ''), 'aria-label': i + ' stars', onclick: on ? () => on(i === n ? 0 : i) : null, style: on ? null : { pointerEvents: 'none' } }, '★')));

export function editItem(listId, id, defaults = {}) {
  const list = store.get(listId), ty = types()[list.type]; const it = id ? store.get(id) : { title: '', status: ty.statuses[0], ...defaults };
  const settingsActs = (window.__settings && window.__settings.activities) || [];
  modal((d, close) => {
    const f = { ...it }, inputs = {};
    const title = h('input', { class: 'in', value: it.title, placeholder: 'Name', 'aria-label': 'Name' });
    const rows = ty.fields.map(fd => {
      let inp;
      if (fd.type === 'select' || fd.type === 'activity') { const opts = fd.type === 'activity' ? settingsActs : fd.options; inp = h('select', { class: 'in' }, h('option', { value: '' }, '—'), opts.map(o => h('option', { value: o, selected: it[fd.k] === o }, o))); }
      else if (fd.type === 'rating') inp = h('div', { class: 'row' }, ratingCtl(f, fd.k));
      else inp = h('input', { class: 'in', type: fd.type === 'number' ? 'number' : fd.type === 'url' ? 'url' : 'text', value: it[fd.k] ?? '', inputmode: fd.type === 'number' ? 'decimal' : null });
      inputs[fd.k] = inp; return field(fd.label, inp);
    });
    const status = seg(ty.statuses.map(s => [s, s]), f.status, v => f.status = v);
    const notes = h('textarea', { class: 'in', value: it.notes || '' }), tags = h('input', { class: 'in', value: (it.tags || []).join(', '), placeholder: 'tags, comma separated' });
    const loc = h('input', { class: 'in', value: it.lat ? `${it.lat}, ${it.lon}` : '', placeholder: 'lat, lon — or paste a maps link' });
    const doneNote = h('input', { class: 'in', value: it.done_note || '', placeholder: 'After you went: “loved the tiramisu”' });
    const save = () => {
      if (!title.value.trim()) return title.focus();
      const patch = { list: listId, title: title.value.trim(), status: f.status, notes: notes.value, tags: tags.value.split(',').map(s => s.trim()).filter(Boolean), done_note: doneNote.value };
      ty.fields.forEach(fd => { patch[fd.k] = fd.type === 'rating' ? (f[fd.k] || null) : fd.type === 'number' ? (inputs[fd.k].value === '' ? null : +inputs[fd.k].value) : inputs[fd.k].value || null; });
      const ll = parseLatLon(loc.value); patch.lat = ll ? ll.lat : null; patch.lon = ll ? ll.lon : null;
      const wasDone = it.status && isDone(it, ty); if (isDone({ status: f.status }, ty) && !wasDone) patch.done_at = today();
      store.put('list_item', patch, id); close();
    };
    title.addEventListener('keydown', e => e.key === 'Enter' && save());
    d.append(h('h2', {}, (id ? 'Edit ' : 'Add to ') + list.name), h('div', { class: 'stack' }, title, h('div', { class: 'grid2' }, rows), h('div', {}, h('div', { class: 'small muted' }, 'Status'), status),
      ty.map ? field('Pin on the map', loc) : '', field('Notes', notes), field('Tags', tags), isDone({ status: f.status }, ty) || it.done_note ? field('How did it go?', doneNote) : ''),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); toast('Removed', () => store.restore(id)); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')));
  }, { wide: true, label: 'List item' });
}
function ratingCtl(f, k) { const wrap = h('span', { class: 'stars' }); const paint = () => wrap.replaceChildren(...[1, 2, 3, 4, 5].map(i => h('button', { type: 'button', class: 'star' + (i <= (f[k] || 0) ? ' on' : ''), 'aria-label': i + ' stars', onclick: () => { f[k] = f[k] === i ? 0 : i; paint(); } }, '★'))); paint(); return wrap; }

function newListDialog(onMade) {
  modal((d, close) => {
    const ts = types(); let pick = 'restaurant';
    const name = h('input', { class: 'in', placeholder: 'e.g. Rome — must eat' });
    const grid = h('div', { class: 'grid2' }, Object.entries(ts).map(([id, t]) => h('button', { class: 'btn', style: { justifyContent: 'flex-start' }, 'aria-pressed': String(id === pick), onclick: e => { pick = id; [...grid.children].forEach(c => c.classList.remove('primary')); e.currentTarget.classList.add('primary'); if (!name.value) name.placeholder = t.name; } }, icon(t.icon), t.name)));
    grid.children[Object.keys(ts).indexOf(pick)].classList.add('primary');
    d.append(h('h2', {}, 'New list'), h('div', { class: 'stack' }, field('Name', name), h('div', {}, h('div', { class: 'small muted' }, 'What kind?'), grid), h('button', { class: 'btn sm', onclick: () => { close(); customType(onMade); } }, icon('plus'), 'Make my own type')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { const l = store.put('list', { name: name.value.trim() || ts[pick].name, type: pick }); close(); onMade(l); } }, 'Create')));
  }, { wide: true });
}
function customType(onMade) {
  modal((d, close) => {
    const name = h('input', { class: 'in', placeholder: 'Type name, e.g. Wines' }), fields = h('textarea', { class: 'in', placeholder: 'One field per line, e.g.\nRegion\nYear (number)\nStyle (select: red, white, rosé)' }), st = h('input', { class: 'in', value: 'want, tried' });
    d.append(h('h2', {}, 'Your own list type'), h('div', { class: 'stack' }, field('Name', name), field('Fields', fields), field('Statuses (comma separated; last = done)', st)), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
      if (!name.value.trim()) return; const fs = fields.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = /^(.*?)\s*\((number|select:\s*(.*)|url|rating)\)$/i.exec(l); const label = m ? m[1] : l, k = label.toLowerCase().replace(/\W+/g, '_'); if (!m) return { k, label, type: 'text' }; if (/^select/i.test(m[2])) return { k, label, type: 'select', options: m[3].split(',').map(s => s.trim()) }; return { k, label, type: m[2].toLowerCase() }; });
      const t = store.put('list_type', { name: name.value.trim(), fields: fs, statuses: st.value.split(',').map(s => s.trim()).filter(Boolean) }); close(); const l = store.put('list', { name: t.name, type: t.id }); onMade(l); } }, 'Create')));
  });
}

export default async function render(el, ctx) {
  const id = ctx.rest[0];
  if (!id) return index(el, ctx);
  const list = store.get(id); if (!list) { el.append(empty('lists', 'That list is gone', null, h('a', { class: 'btn', href: '#/lists' }, 'Back to lists'))); return; }
  const ty = types()[list.type] || BUILTIN.ideas;
  const view = prefs.view[id] || (ty.map ? 'list' : 'list'), sort = prefs.sort[id] || 'manual';
  let items = store.list('list_item', i => i.list === id);
  const q = prefs.q.toLowerCase();
  if (q) items = items.filter(i => JSON.stringify(i).toLowerCase().includes(q));
  const statusFilter = prefs['st' + id] || 'all'; if (statusFilter !== 'all') items = items.filter(i => i.status === statusFilter);
  const cmp = { manual: (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created_at.localeCompare(b.created_at), az: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0), recent: (a, b) => b.created_at.localeCompare(a.created_at), near: (a, b) => (a._d ?? 1e9) - (b._d ?? 1e9) }[sort];
  if (sort === 'near' && prefs.here) items.forEach(i => i._d = i.lat != null ? distanceKm(prefs.here, i) : 1e9);
  items.sort(cmp);

  el.append(h('div', { class: 'page-head' }, h('a', { class: 'btn icon sm ghost', href: '#/lists', 'aria-label': 'All lists' }, icon('chevL')), h('h1', { class: 'squig', style: { '--dom': 'var(--d-lists)' } }, list.name), h('span', { class: 'chip dom', style: { '--dom': 'var(--d-lists)' } }, ty.name), h('span', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: async () => { const nn = await promptBox('Rename list', { value: list.name }); if (nn) store.put('list', { name: nn }, id); } }, icon('edit')),
    h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Delete this list?', 'Items go with it (you can undo for a few seconds).', { ok: 'Delete', danger: true })) { const its = store.list('list_item', i => i.list === id); its.forEach(i => store.del(i.id)); store.del(id); location.hash = '#/lists'; toast('List deleted', () => { store.restore(id); its.forEach(i => store.restore(i.id)); }); } } }, icon('trash'))));
  const quick = h('input', { class: 'in cap-input', placeholder: ty.grouped ? 'Add item…' : 'Add to this list…', 'aria-label': 'Quick add', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { store.put('list_item', { list: id, title: e.target.value.trim(), status: ty.statuses[0], order: Date.now() }); e.target.value = ''; } } });
  const modes = [['list', 'List'], ['grid', 'Grid'], ['table', 'Table'], ...(ty.map ? [['map', 'Map']] : []), ['board', 'Board']];
  el.append(h('div', { class: 'row' }, quick, h('button', { class: 'btn icon primary', 'aria-label': 'Add with details', onclick: () => editItem(id) }, icon('plus'))));
  const tools = h('div', { class: 'row wrap', style: { margin: '14px 0' } }, seg(modes, view, v => { prefs.view[id] = v; ctx.refresh(); }),
    h('select', { class: 'in', style: { width: 'auto' }, 'aria-label': 'Sort', onchange: e => { prefs.sort[id] = e.target.value; if (e.target.value === 'near' && !prefs.here) navigator.geolocation?.getCurrentPosition(p => { prefs.here = { lat: p.coords.latitude, lon: p.coords.longitude }; ctx.refresh(); }, () => toast('Location not allowed')); ctx.refresh(); } }, [['manual', 'My order'], ['az', 'A–Z'], ['recent', 'Newest'], ['rating', 'Best rated'], ...(ty.map ? [['near', 'Nearby now']] : [])].map(([v, l]) => h('option', { value: v, selected: v === sort }, l))),
    h('select', { class: 'in', style: { width: 'auto' }, 'aria-label': 'Status', onchange: e => { prefs['st' + id] = e.target.value; ctx.refresh(); } }, h('option', { value: 'all' }, 'All'), ty.statuses.map(s => h('option', { value: s, selected: s === statusFilter }, s))),
    h('input', { class: 'in', style: { width: '160px' }, placeholder: 'Filter…', value: prefs.q, 'aria-label': 'Filter', oninput: debounce(e => { prefs.q = e.target.value; ctx.refresh(); setTimeout(() => { const i = document.querySelector('[aria-label=Filter]'); i && (i.focus(), i.setSelectionRange(99, 99)); }, 60); }, 250) }),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: () => { const open = items.filter(i => !isDone(i, ty)); if (!open.length) return toast('Nothing left to pick'); const p = open[Math.floor(Math.random() * open.length)]; modal((d, close) => d.append(h('h2', {}, 'How about…'), h('p', { class: 'hero-line', style: { fontSize: '2.4rem' } }, p.title), h('p', { class: 'muted' }, [p.cuisine, p.city || p.area, p.venue].filter(Boolean).join(' · ')), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { close(); editItem(id, p.id); } }, 'Open'), h('button', { class: 'btn primary', onclick: close }, 'Nice')))); } }, icon('zap'), 'Surprise me'),
    h('button', { class: 'btn sm', onclick: () => shareLink('list', id) }, icon('link'), 'Link'),
    h('button', { class: 'btn sm', onclick: async () => { const md = toMarkdown(list, items, ty); try { await navigator.clipboard.writeText(md); toast('Copied as Markdown'); } catch { modal((d, c) => d.append(h('h2', {}, 'Share'), h('textarea', { class: 'in', value: md, style: { minHeight: '200px' } }), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: c }, 'Close')))); } } }, icon('copy'), 'Share'),
    ty.grouped === 'aisle' ? h('button', { class: 'btn sm', onclick: () => { const n = items.filter(i => isDone(i, ty)); n.forEach(i => store.del(i.id)); toast(`Cleared ${n.length}`, () => n.forEach(i => store.restore(i.id))); } }, 'Clear got') : '');
  el.append(tools);
  const body = h('div', {}); el.append(body);
  if (!items.length) { body.append(empty(ty.icon, prefs.q || statusFilter !== 'all' ? 'Nothing matches' : 'Empty for now', ty.map ? 'Add a place, then pin it on the map.' : 'Type above and press Enter.')); return; }

  const sub = i => h('div', { class: 'meta' }, ty.fields.filter(f => i[f.k] && f.type !== 'rating' && f.k !== 'url').slice(0, 4).map(f => h('span', {}, f.type === 'number' && /price|target/.test(f.k) ? `${i[f.k]}` : i[f.k])), i.rating ? stars(i.rating) : '', (i.tags || []).map(t => h('span', {}, '#' + t)), i.done_at ? h('span', {}, 'done ' + niceDate(i.done_at)) : '');
  const rowFor = i => { const done = isDone(i, ty); const drag = sort === 'manual';
    return h('div', { class: 'item' + (done ? ' done' : ''), draggable: drag ? 'true' : null, 'data-id': i.id,
      ondragstart: e => e.dataTransfer.setData('text/item', i.id), ondragover: e => drag && e.preventDefault(), ondrop: e => { const from = e.dataTransfer.getData('text/item'); if (!from || from === i.id) return; const a = items.findIndex(x => x.id === from), b = items.findIndex(x => x.id === i.id); const moved = items.splice(a, 1)[0]; items.splice(b, 0, moved); items.forEach((x, n) => store.put('list_item', { order: n }, x.id)); } },
      h('input', { type: 'checkbox', class: 'chk', checked: done, 'aria-label': 'Done', onchange: e => { const to = e.target.checked ? doneStatus(ty) : ty.statuses[0]; store.put('list_item', { status: to, done_at: e.target.checked ? today() : null }, i.id); if (e.target.checked && !ty.grouped) editItem(id, i.id); } }),
      h('div', { class: 'grow', onclick: e => { if (e.target.closest('a,button,input')) return; editItem(id, i.id); }, style: { cursor: 'pointer' } }, h('span', { class: 't' }, i.title), sub(i), i.done_note ? h('div', { class: 'meta' }, '“' + i.done_note + '”') : ''),
      i.url ? h('a', { class: 'btn icon sm ghost', href: i.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open link' }, icon('link')) : '', i.phone ? h('a', { class: 'btn icon sm ghost', href: 'tel:' + i.phone, 'aria-label': 'Call' }, icon('send')) : ''); };
  if (ty.grouped) { const g = {}; items.forEach(i => (g[i[ty.grouped] || 'other'] ||= []).push(i)); Object.keys(g).sort().forEach(k => body.append(h('section', { class: 'card', style: { marginBottom: '14px' } }, h('div', { class: 'card-head' }, h('h3', {}, k), h('span', { class: 'count' }, g[k].length)), g[k].map(rowFor)))); }
  else if (view === 'list') body.append(h('div', { class: 'card' }, items.map(rowFor)));
  else if (view === 'grid') body.append(h('div', { class: 'grid2' }, items.map(i => h('button', { class: 'card', style: { textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }, onclick: () => editItem(id, i.id) }, h('h3', {}, i.title), sub(i), i.notes ? h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, i.notes.slice(0, 90)) : ''))));
  else if (view === 'table') body.append(h('div', { class: 'card', style: { overflowX: 'auto' } }, h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Name'), ty.fields.map(f => h('th', {}, f.label)), h('th', {}, 'Status')), items.map(i => h('tr', { onclick: () => editItem(id, i.id), style: { cursor: 'pointer' } }, h('td', {}, i.title), ty.fields.map(f => h('td', {}, f.type === 'rating' ? stars(i.rating) : i[f.k] ?? '')), h('td', {}, i.status))))));
  else if (view === 'board') { const cols = h('div', { class: 'grid2', style: { gridTemplateColumns: `repeat(${ty.statuses.length}, minmax(220px, 1fr))`, overflowX: 'auto' } }); ty.statuses.forEach(s => { const c = h('section', { class: 'card', style: { minHeight: '140px' }, ondragover: e => e.preventDefault(), ondrop: e => { const from = e.dataTransfer.getData('text/item'); if (from) store.put('list_item', { status: s, done_at: s === doneStatus(ty) ? today() : null }, from); } }, h('div', { class: 'card-head' }, h('h3', {}, s), h('span', { class: 'count' }, items.filter(i => i.status === s).length))); items.filter(i => i.status === s).forEach(i => c.append(h('div', { class: 'item', draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/item', i.id), onclick: () => editItem(id, i.id) }, h('div', { class: 'grow' }, i.title, sub(i))))); cols.append(c); }); body.append(cols); }
  else if (view === 'map') {
    const pins = items.filter(i => i.lat != null), box = h('div', { class: 'map', role: 'application', 'aria-label': 'Map of places' }); body.append(box, h('p', { class: 'faint small' }, `${pins.length} of ${items.length} pinned. Edit a place and paste “lat, lon” or a maps link to pin it; tap the map to add a pin.`));
    const L = await loadLeaflet(); const c = pins[0] ? [pins[0].lat, pins[0].lon] : [25.2, 55.27];
    const map = L.map(box).setView(c, pins.length ? 11 : 10); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    pins.forEach(i => L.marker([i.lat, i.lon], { icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22] }) }).addTo(map).bindTooltip(i.title).on('click', () => editItem(id, i.id)));
    if (pins.length > 1) map.fitBounds(pins.map(i => [i.lat, i.lon]), { padding: [30, 30] });
    setTimeout(() => map.invalidateSize(), 200); map.on('click', e => editItem(id, null, { lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) }));
    return () => map.remove();
  }
}

function index(el, ctx) {
  const lists = store.list('list').sort((a, b) => a.created_at.localeCompare(b.created_at)), ts = types();
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Lists'), h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => newListDialog(l => location.hash = '#/lists/' + l.id) }, icon('plus'), 'New list')));
  if (!lists.length) { el.append(empty('lists', 'No lists yet', 'Restaurants to try, places to play, things to eat, gifts, groceries — start one.', h('button', { class: 'btn primary', onclick: () => newListDialog(l => location.hash = '#/lists/' + l.id) }, 'Start a list'))); return; }
  el.append(h('div', { class: 'grid2' }, lists.map(l => { const t = ts[l.type] || BUILTIN.ideas, its = store.list('list_item', i => i.list === l.id), left = its.filter(i => !isDone(i, t)).length;
    return h('a', { class: 'card', href: '#/lists/' + l.id, style: { textDecoration: 'none', color: 'inherit', '--dom': 'var(--d-lists)' } }, h('div', { class: 'card-head' }, icon(t.icon), h('h3', {}, l.name)), h('div', { class: 'muted' }, `${left} to go · ${its.length - left} done`), h('div', { class: 'faint small' }, t.name)); })));
}
