// One trip: itinerary, bookings, documents (offline-able), packing, budget, pre-trip checklist, journal, recap.
import { h, today, addDays, niceDate, diffDays, fmtTime, cfg, uid, money } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox, actMenu } from '../ui.js';
import { world } from '../worldmap.js';
import { tripDialog } from './travel.js';
import { rules, passports, home } from '../travel-data.js';
import { buildChecklist, routeKm, flightHours, km } from '../travelcore.js';
import { loadLeaflet } from '../maps.js';
import { shareLink } from '../share.js';
import { coverStrip, iconSpan, decorDialog } from '../decor.js';
import { linksPanel } from '../links.js';
import { types } from '../lists-core.js';

let tab = 'itinerary';
const TABS = [['itinerary', 'Itinerary'], ['bookings', 'Bookings'], ['docs', 'Documents'], ['packing', 'Packing'], ['budget', 'Budget'], ['check', 'Before you go'], ['journal', 'Journal'], ['recap', 'Recap']];
const BK = [['flight', 'Flight', 'travel'], ['hotel', 'Stay', 'home'], ['train', 'Train', 'send'], ['car', 'Car', 'pin'], ['activity', 'Activity', 'star'], ['insurance', 'Insurance', 'shield']];
const days = t => { const out = []; if (!t.start) return out; for (let d = t.start; d <= (t.end || t.start) && out.length < 120; d = addDays(d, 1)) out.push(d); return out; };

let fxCache = null;
async function rates(base) { if (fxCache && fxCache.base === base) return fxCache.rates; try { const j = await store.api('/api/fx?base=' + base); fxCache = { base, rates: j.rates || {} }; try { localStorage.setItem('fx:' + base, JSON.stringify(j.rates || {})); } catch { /* quota */ } } catch { try { fxCache = { base, rates: JSON.parse(localStorage.getItem('fx:' + base) || '{}') }; } catch { fxCache = { base, rates: {} }; } } return fxCache.rates; }
const conv = (amt, cur, base, r) => cur === base ? amt : r[cur] ? amt / r[cur] : amt;   // rates are "1 base = r[cur] cur"

function editBooking(tid, id, def = {}) {
  const b = id ? store.get(id) : { trip: tid, type: 'flight', ...def };
  modal((d, close) => {
    const f = { ...b }, title = h('input', { class: 'in', value: b.title || '', placeholder: 'e.g. EK 318 DXB → NRT' }), conf = h('input', { class: 'in', value: b.conf || '', placeholder: 'Confirmation number' });
    const date = h('input', { class: 'in', type: 'date', value: b.start || '' }), time = h('input', { class: 'in', type: 'time', value: b.start_time || '' }), end = h('input', { class: 'in', type: 'date', value: b.end || '' }), term = h('input', { class: 'in', value: b.terminal || '', placeholder: 'Terminal / gate / room' }), link = h('input', { class: 'in', type: 'url', value: b.link || '', placeholder: 'Check-in / manage link' }), cost = h('input', { class: 'in', type: 'number', value: b.cost ?? '', inputmode: 'decimal' }), cur = h('input', { class: 'in', value: b.currency || store.get(tid)?.currency || cfg.currency, style: { maxWidth: '90px' } });
    const type = seg(BK.map(([k, l]) => [k, l]), f.type, v => f.type = v);
    d.append(h('h2', {}, id ? 'Edit booking' : 'Add booking'), h('div', { class: 'stack' }, type, title, conf, h('div', { class: 'grid2' }, field('Date', date), field('Time', time)), field('Until (check-out, return…)', end), h('div', { class: 'grid2' }, field('Terminal / gate', term), field('Link', link)), h('div', { class: 'grid2' }, field('Cost', cost), field('Currency', cur))),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); toast('Removed', () => store.restore(id)); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (!title.value.trim()) return title.focus(); const r = store.put('booking', { trip: tid, type: f.type, title: title.value.trim(), conf: conf.value, start: date.value || null, start_time: time.value || null, end: end.value || null, terminal: term.value, link: link.value, cost: cost.value === '' ? null : +cost.value, currency: cur.value }, id); if (r.cost && !id) store.put('trip_expense', { trip: tid, label: r.title, category: f.type, amount: r.cost, currency: r.currency, planned: false, booking: r.id }); close(); } }, 'Save')));
  });
}

async function itinerary(box, t, w) {
  const ds = days(t); if (!ds.length) { box.append(empty('calendar', 'Set trip dates first', 'Edit the trip and add start and end dates to get a day-by-day page.')); return; }
  const bks = store.list('booking', b => b.trip === t.id), items = store.list('trip_item', i => i.trip === t.id);
  ds.forEach((d, n) => {
    const todays = items.filter(i => i.date === d).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.time || '').localeCompare(b.time || '')), bd = bks.filter(b => b.start === d).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    const inp = h('input', { class: 'in', 'data-live': '1', placeholder: 'Add a plan… (10:00 Louvre)', 'aria-label': 'Add to ' + d, onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { const m = /^(\d{1,2}:\d{2})\s+(.*)/.exec(e.target.value.trim()); store.put('trip_item', { trip: t.id, date: d, time: m ? m[1].padStart(5, '0') : null, title: m ? m[2] : e.target.value.trim(), order: Date.now() }); } } });
    const card = h('section', { class: 'card', style: { '--dom': 'var(--d-travel)' } }, h('div', { class: 'card-head' }, h('h3', {}, `Day ${n + 1}`), h('span', { class: 'count' }, niceDate(d, true)), h('button', { class: 'btn sm ghost', style: { marginLeft: 'auto' }, onclick: () => dayMap(todays) }, icon('pin'), 'Map')),
      bd.map(b => h('div', { class: 'item', onclick: () => editBooking(t.id, b.id), style: { cursor: 'pointer' } }, icon((BK.find(x => x[0] === b.type) || BK[0])[2]), h('div', { class: 'grow' }, b.title, h('div', { class: 'meta' }, b.start_time ? fmtTime(b.start_time) : '', b.terminal, b.conf ? '# ' + b.conf : '')))),
      todays.map(i => h('div', { class: 'item', draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/titem', i.id), ondragover: e => e.preventDefault(), ondrop: e => { const from = e.dataTransfer.getData('text/titem'); if (!from) return; const list = todays.filter(x => x.id !== from), at = list.findIndex(x => x.id === i.id); const mv = store.get(from); list.splice(at, 0, mv); list.forEach((x, k) => store.put('trip_item', { order: k, date: d }, x.id)); } },
        h('span', { class: 'time-col' }, i.time ? fmtTime(i.time) : ''), h('div', { class: 'grow' }, i.title, i.place ? h('div', { class: 'meta' }, i.place) : ''), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => { store.del(i.id); toast('Removed', () => store.restore(i.id)); } }, icon('x')))), inp);
    box.append(card);
  });
}
async function dayMap(items) {
  const L = await loadLeaflet(); modal((d, close) => { const box = h('div', { class: 'map', style: { height: '50vh' } }); d.append(h('h2', {}, 'The day on a map'), box, h('p', { class: 'faint small' }, 'Items with a place get a pin: add coordinates by writing “Name @35.71,139.79” in the title box.'), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Close')));
    const pts = items.map(i => { const m = /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(i.title + ' ' + (i.place || '')); return m ? { i, p: [+m[1], +m[2]] } : null; }).filter(Boolean); const map = L.map(box).setView(pts[0]?.p || [20, 0], pts.length ? 12 : 2); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    pts.forEach(({ i, p }) => L.marker(p, { icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22] }) }).addTo(map).bindTooltip(i.title.replace(/@.*/, ''))); if (pts.length > 1) { L.polyline(pts.map(x => x.p), { color: '#d4574c', dashArray: '4 6' }).addTo(map); map.fitBounds(pts.map(x => x.p), { padding: [30, 30] }); } setTimeout(() => map.invalidateSize(), 200); }, { wide: true });
}

function bookings(box, t) {
  const props = store.list('booking_proposal', p => p.trip === t.id || !p.trip).filter(p => !p.dismissed);
  if (props.length) box.append(h('section', { class: 'card', style: { borderColor: 'var(--pen)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Found in your Travel email'), h('span', { class: 'count' }, 'review before saving')), props.map(p => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', { style: { fontWeight: 400 } }, p.title), h('div', { class: 'meta' }, p.conf ? '# ' + p.conf : '', p.start || '', p.type), p.snippet ? h('div', { class: 'faint small' }, p.snippet) : ''), h('button', { class: 'btn sm primary', onclick: () => { editBooking(t.id, null, { title: p.title, conf: p.conf, start: p.start, type: p.type || 'flight' }); store.put('booking_proposal', { dismissed: true }, p.id); } }, 'Review'), h('button', { class: 'btn sm ghost', onclick: () => store.put('booking_proposal', { dismissed: true }, p.id) }, 'Dismiss')))));
  box.append(h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => editBooking(t.id) }, icon('plus'), 'Add booking')));
  const bs = store.list('booking', b => b.trip === t.id).sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  if (!bs.length) { box.append(empty('travel', 'No bookings yet', 'Add flights, stays and activities — or forward confirmation emails to your “Travel” label.')); return; }
  box.append(h('div', { class: 'card' }, bs.map(b => h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: e => { if (!e.target.closest('a')) editBooking(t.id, b.id); } }, icon((BK.find(x => x[0] === b.type) || BK[0])[2]), h('div', { class: 'grow' }, b.title, h('div', { class: 'meta' }, b.start ? niceDate(b.start, true) + (b.start_time ? ' ' + fmtTime(b.start_time) : '') : '', b.terminal, b.conf ? '# ' + b.conf : '', b.cost ? money(b.cost, b.currency) : '')), b.link ? h('a', { class: 'btn sm', href: b.link, target: '_blank', rel: 'noopener noreferrer' }, 'Check in') : ''))));
}

const DOCS = 'life-docs';
async function cacheDoc(id) { const r = await fetch('/api/files/' + id, { credentials: 'same-origin' }); if (!r.ok) throw new Error('fetch'); const c = await caches.open(DOCS); await c.put('/api/files/' + id, r); }
async function openDoc(id, name) { let r; try { r = await fetch('/api/files/' + id, { credentials: 'same-origin' }); if (!r.ok) throw 0; } catch { const c = await caches.open(DOCS); r = await c.match('/api/files/' + id); } if (!r) return toast('Not saved offline yet'); const b = await r.blob(); window.open(URL.createObjectURL(b), '_blank'); }
function tileUrls(lat, lon) { // a small set around the destination: zoom 10-13, 3x3 each (36 tiles). Be a polite OSM citizen.
  const out = []; for (const z of [10, 11, 12, 13]) { const n = 2 ** z, x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(`https://a.tile.openstreetmap.org/${z}/${x + dx}/${y + dy}.png`); } return out;
}
async function travelMode(t, w) {
  toast('Getting this trip ready for offline…'); let docs = 0, tiles = 0;
  for (const d of store.list('trip_doc', x => x.trip === t.id)) { try { await cacheDoc(d.file); docs++; } catch { /* offline */ } }
  const c = w.byA2[(t.countries || [])[0]];
  if (c && navigator.serviceWorker?.controller) { const reg = await navigator.serviceWorker.ready; const done = new Promise(res => navigator.serviceWorker.addEventListener('message', e => e.data?.type === 'tiles-done' && (tiles = e.data.n, res()), { once: true })); reg.active.postMessage({ type: 'cache-tiles', urls: tileUrls(...c.centre) }); await Promise.race([done, new Promise(r => setTimeout(r, 25000))]); }
  store.put('trip', { offline_ready: new Date().toISOString() }, t.id); toast(`Ready: itinerary, packing & checklist are on this device · ${docs} document(s) · ${tiles} map tiles near ${c ? c.name : 'your destination'}`);
}
function docs(box, t) {
  const up = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'hide', onchange: async () => { for (const f of up.files) { const fd = new FormData(); fd.append('file', f); try { const r = await store.upload('/api/files', fd); store.put('trip_doc', { trip: t.id, name: r.name, file: r.id, mime: r.mime }); } catch (e) { toast(e.message); } } } }); up.multiple = true;
  box.append(h('p', { class: 'muted' }, 'Tickets, e-visas, vouchers. Stored encrypted on your server; “Save offline” keeps a copy on this phone for the airport.'), h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => up.click() }, icon('upload'), 'Add files'), up, h('button', { class: 'btn', onclick: async () => { let n = 0; for (const d of store.list('trip_doc', x => x.trip === t.id)) { try { await cacheDoc(d.file); n++; } catch { /* skip */ } } toast(`${n} saved offline`); } }, icon('download'), 'Save all offline')));
  const ds = store.list('trip_doc', d => d.trip === t.id); if (!ds.length) { box.append(empty('shield', 'No documents', 'Add tickets and vouchers here.')); return; }
  box.append(h('div', { class: 'card' }, ds.map(d => h('div', { class: 'item' }, icon('notes'), h('div', { class: 'grow' }, d.name), h('button', { class: 'btn sm', onclick: () => openDoc(d.file, d.name) }, 'Open'), h('button', { class: 'btn sm', onclick: () => cacheDoc(d.file).then(() => toast('Saved offline'), () => toast('Needs a connection')) }, 'Save offline'), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => store.del(d.id) }, icon('x'))))));
}

async function packing(box, t, w) {
  const items = store.list('packing_item', p => p.trip === t.id), groups = {};
  items.forEach(p => (groups[p.group || 'misc'] ||= []).push(p));
  const add = h('input', { class: 'in cap-input', placeholder: 'Add to packing list…', 'aria-label': 'Add packing item', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { store.put('packing_item', { trip: t.id, text: e.target.value.trim(), group: 'misc', done: false }); e.target.value = ''; } } });
  const tpls = store.list('list', l => l.type === 'packing');
  box.append(add, h('div', { class: 'row wrap' }, tpls.map(l => h('button', { class: 'btn sm', onclick: () => { const its = store.list('list_item', i => i.list === l.id), have = new Set(items.map(p => p.text.toLowerCase())); let n = 0; its.forEach(i => { if (!have.has(i.title.toLowerCase())) { store.put('packing_item', { trip: t.id, text: i.title + (i.qty ? ' ×' + i.qty : ''), group: i.group || 'misc', done: false }); n++; } }); toast(`Added ${n} from “${l.name}”`); } }, icon('lists'), 'Use ' + l.name)),
    h('button', { class: 'btn sm', onclick: async () => { const c = w.byA2[(t.countries || [])[0]]; if (!c) return toast('Add a destination first'); try { const wx = await store.api(`/api/weather?lat=${c.centre[0].toFixed(2)}&lon=${c.centre[1].toFixed(2)}`); const max = Math.max(...wx.daily.temperature_2m_max), rain = Math.max(...wx.daily.precipitation_probability_max), sug = []; if (rain > 50) sug.push(['umbrella / rain jacket', 'clothes']); if (max < 12) sug.push(['warm coat', 'clothes'], ['gloves', 'clothes']); if (max > 30) sug.push(['sunscreen', 'toiletries'], ['hat', 'clothes']); if (!sug.length) return toast(`Mild: ${Math.round(max)}°, ${rain}% rain — nothing extra`); sug.forEach(([text, group]) => store.put('packing_item', { trip: t.id, text, group, done: false })); toast(`Forecast ${Math.round(max)}°, ${rain}% rain — added ${sug.length}`); } catch { toast('Forecast needs a connection'); } } }, icon('sun'), 'Weather check')));
  if (!items.length) { box.append(empty('lists', 'Nothing to pack yet', 'Add items, or make a “Packing template” list and reuse it on every trip.')); return; }
  Object.keys(groups).sort().forEach(g => box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, g), h('span', { class: 'count' }, `${groups[g].filter(x => x.done).length}/${groups[g].length}`)), groups[g].map(p => h('div', { class: 'item' + (p.done ? ' done' : '') }, h('input', { type: 'checkbox', class: 'chk', checked: p.done, onchange: e => store.put('packing_item', { done: e.target.checked }, p.id) }), h('span', { class: 't grow' }, p.text), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => store.del(p.id) }, icon('x')))))));
}

async function budget(box, t) {
  const base = t.currency || cfg.currency, r = await rates(base), ex = store.list('trip_expense', e => e.trip === t.id);
  const sum = pl => ex.filter(e => !!e.planned === pl).reduce((s, e) => s + conv(e.amount, e.currency, base, r), 0), planned = sum(true) + (t.budget || 0) * 0, actual = sum(false), cap = t.budget || sum(true);
  box.append(h('section', { class: 'card' }, h('div', { class: 'stat-row' }, h('div', { class: 'stat' }, h('b', {}, money(cap, base)), h('span', {}, t.budget ? 'budget' : 'planned')), h('div', { class: 'stat' }, h('b', { style: { color: cap && actual > cap ? 'var(--bad)' : 'inherit' } }, money(actual, base)), h('span', {}, 'spent')), cap ? h('div', { class: 'stat' }, h('b', {}, money(Math.max(0, cap - actual), base)), h('span', {}, 'left')) : ''), cap ? h('div', { class: 'pbar', 'aria-hidden': 'true', style: { marginTop: '10px' } }, h('i', { style: { width: Math.min(100, actual / cap * 100) + '%' } })) : '', Object.keys(r).length ? h('p', { class: 'faint small', style: { margin: '8px 0 0' } }, 'Converted at today’s rates (cached).') : h('p', { class: 'faint small', style: { margin: '8px 0 0' } }, 'No exchange rates available — other currencies are shown unconverted.')));
  const lab = h('input', { class: 'in', placeholder: 'What for' }), amt = h('input', { class: 'in', type: 'number', placeholder: 'Amount', inputmode: 'decimal', style: { maxWidth: '120px' } }), cur = h('input', { class: 'in', value: base, style: { maxWidth: '80px' } }), kind = h('select', { class: 'in', style: { maxWidth: '130px' } }, h('option', { value: 'actual' }, 'Spent'), h('option', { value: 'planned' }, 'Planned'));
  const addE = () => { if (!lab.value.trim() || !amt.value) return; store.put('trip_expense', { trip: t.id, label: lab.value.trim(), amount: +amt.value, currency: cur.value.toUpperCase() || base, planned: kind.value === 'planned' }); lab.value = amt.value = ''; };
  amt.addEventListener('keydown', e => e.key === 'Enter' && addE());
  box.append(h('div', { class: 'row wrap' }, lab, amt, cur, kind, h('button', { class: 'btn primary', onclick: addE }, 'Add')), h('div', { class: 'card' }, ex.length ? ex.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(e => h('div', { class: 'item' }, h('div', { class: 'grow' }, e.label, h('div', { class: 'meta' }, e.planned ? 'planned' : 'spent', e.category || '')), h('b', { style: { fontWeight: 400 } }, money(e.amount, e.currency)), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => store.del(e.id) }, icon('x')))) : h('p', { class: 'faint', style: { margin: 0 } }, 'No entries.')));
}

async function check(box, t, w) {
  const entry = {};   // entry rules for MY passport, per country (server-cached; skipped quietly offline or before Settings has a passport)
  const load = async () => { for (const a of t.countries || []) { try { const c = await store.api('/api/visa?to=' + a.toLowerCase()); if (c && c.verdict) entry[a] = c; } catch { /* offline */ } } };
  const mk = () => buildChecklist(t, { today: today(), docs: passports().concat(store.list('travel_doc', d => d.type !== 'passport')), rules: store.list('visa_rule'), entry, countryName: a => w.byA2[a]?.name || a });
  const merge = async () => { await load(); merge2(); };
  const merge2 = () => { const old = Object.fromEntries((t.checklist || []).map(c => [c.key, c])); const fresh = mk().map(c => ({ ...c, done: old[c.key] ? old[c.key].done || c.done : c.done })); store.put('trip', { checklist: fresh }, t.id); };
  if (!t.checklist) { await merge(); return; }
  box.append(h('div', { class: 'row' }, h('span', { class: 'muted grow' }, 'Built from your documents and the places you’re going.'), h('button', { class: 'btn sm', onclick: merge }, icon('refresh'), 'Re-check')));
  box.append(h('div', { class: 'card' }, t.checklist.map(c => h('div', { class: 'item' + (c.done ? ' done' : '') }, h('input', { type: 'checkbox', class: 'chk', checked: c.done, onchange: e => store.put('trip', { checklist: t.checklist.map(x => x.key === c.key ? { ...x, done: e.target.checked } : x) }, t.id) }), h('div', { class: 'grow' }, h('span', { class: 't' }, c.title), c.note ? h('div', { class: 'meta', style: c.status === 'warn' ? { color: 'var(--warn)' } : null }, c.note) : '')))));
}

function journal(box, t) {
  const ds = days(t).length ? days(t) : [today()], ta = h('textarea', { class: 'in', placeholder: 'What happened today?' }), sel = h('select', { class: 'in', style: { maxWidth: '200px' } }, ds.map(d => h('option', { value: d, selected: d === (ds.includes(today()) ? today() : ds[0]) }, niceDate(d, true))));
  const up = h('input', { type: 'file', accept: 'image/*', class: 'hide' }); let photos = [];
  up.onchange = async () => { const fd = new FormData(); fd.append('file', up.files[0]); try { const r = await store.upload('/api/files', fd); photos.push(r.id); toast('Photo attached'); } catch (e) { toast(e.message); } };
  box.append(h('div', { class: 'card' }, h('div', { class: 'row wrap' }, sel, h('button', { class: 'btn sm', onclick: () => up.click() }, icon('upload'), 'Photo'), up), ta, h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: () => { if (!ta.value.trim() && !photos.length) return; store.put('trip_journal', { trip: t.id, date: sel.value, text: ta.value.trim(), photos }); ta.value = ''; photos = []; } }, 'Save entry')));
  store.list('trip_journal', j => j.trip === t.id).sort((a, b) => b.date.localeCompare(a.date)).forEach(j => box.append(h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, niceDate(j.date, true)), h('button', { class: 'btn icon sm ghost', style: { marginLeft: 'auto' }, 'aria-label': 'Delete', onclick: () => store.del(j.id) }, icon('x'))), h('p', { style: { whiteSpace: 'pre-wrap', margin: '0 0 8px' } }, j.text), (j.photos || []).length ? h('div', { class: 'row wrap' }, j.photos.map(p => h('img', { class: 'thumb', src: '/api/files/' + p, alt: '' }))) : '')));
}

async function recap(box, t, w) {
  const hm = home(), d = routeKm(hm, (t.countries || []).map(a => w.byA2[a]?.centre)), ds = days(t).length, base = t.currency || cfg.currency, r = await rates(base), spent = store.list('trip_expense', e => e.trip === t.id && !e.planned).reduce((s, e) => s + conv(e.amount, e.currency, base, r), 0), j = store.list('trip_journal', x => x.trip === t.id);
  box.append(h('section', { class: 'card taped' }, h('h2', {}, t.name), h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } }, [[ds, 'days'], [Math.round(d).toLocaleString(), 'km (rough)'], [money(spent, base), 'spent'], [(t.countries || []).length, 'countries'], [j.length, 'journal entries']].map(([n, l]) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, l)))), h('p', { class: 'muted sp-t' }, 'Distance is straight lines between country centres, out and back from home.')));
  if (t.status !== 'done') box.append(h('button', { class: 'btn primary', onclick: () => { const per = (t.countries || []).length || 1; (t.countries || []).forEach(a => { if (!store.list('visit', v => v.trip === t.id && v.country === a).length) store.put('visit', { country: a, start: t.start, end: t.end, trip: t.id, spend: spent ? Math.round(spent / per) : null, with: t.travellers || '', what: '' }); }); store.put('trip', { status: 'done' }, t.id); toast('Trip recorded — the map is updated'); } }, icon('check'), 'Mark as done & add to my map'));
  else box.append(h('p', { class: 'muted' }, 'Recorded on your map.'));
}

export default async function render(el, ctx) {
  const t = store.get(ctx.rest[1]); if (!t) { el.append(empty('travel', 'That trip is gone', null, h('a', { class: 'btn', href: '#/travel?tab=trips' }, 'All trips'))); return; }
  const w = await world(), n = t.start ? diffDays(today(), t.start) : null;
  el.append(coverStrip(t, { tall: true }));
  el.append(h('div', { class: 'page-head' }, h('a', { class: 'btn icon sm ghost', href: '#/travel', 'aria-label': 'Back' }, icon('chevL')), h('h1', { class: 'squig', style: { '--dom': 'var(--d-travel)' } }, iconSpan(t), t.name), h('span', { class: 'sub' }, t.start ? niceDate(t.start, true) + (t.end && t.end !== t.start ? ' → ' + niceDate(t.end, true) : '') : '', ' ', n != null && n >= 0 ? h('span', { class: 'chip dom', style: { '--dom': 'var(--d-travel)' } }, n === 0 ? 'today' : `in ${n} days`) : ''), actMenu(h('button', { class: 'btn sm', 'aria-label': 'Icon and cover', title: 'Icon & cover', onclick: () => decorDialog(store.get(t.id), () => ctx.refresh()) }, icon('image'), 'Icon & cover'), h('button', { class: 'btn sm', 'aria-label': 'Duplicate trip', title: 'Duplicate trip (plans and packing, not bookings)', onclick: () => { const { id: _i, kind: _k, created_at: _c, updated_at: _u, deleted_at: _d, _t, notified, offline_ready, checklist, ...rest } = store.get(t.id); const c = store.put('trip', { ...rest, name: t.name + ' (copy)', status: 'planned' }); store.list('trip_item', x => x.trip === t.id).forEach(x => { const { id: a, kind: b, created_at: c1, updated_at: c2, deleted_at: c3, _t: c4, ...r2 } = x; store.put('trip_item', { ...r2, trip: c.id }); }); store.list('packing_item', x => x.trip === t.id).forEach(x => store.put('packing_item', { trip: c.id, text: x.text, group: x.group, done: false })); toast('Trip duplicated'); location.hash = '#/travel/t/' + c.id; } }, icon('copy'), 'Duplicate trip'), h('button', { class: 'btn sm', onclick: () => travelMode(t, w) }, icon('download'), t.offline_ready ? 'Offline ✓' : 'Travel mode'), h('button', { class: 'btn sm', onclick: () => shareLink('trip', t.id) }, icon('link'), 'Share'), h('button', { class: 'btn sm', onclick: () => tripDialog(t) }, icon('edit'), 'Edit'))),
    h('div', { style: { margin: '0 0 18px', overflowX: 'auto' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box);
  await ({ itinerary, bookings, docs, packing, budget, check, journal, recap })[tab](box, t, w);
  el.append(linksPanel(store.get(t.id), { onChange: () => ctx.refresh() }));
}
