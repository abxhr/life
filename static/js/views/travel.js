// Travel: the world map is the hero. Map / Trips / Cities / Where can I go. Country pages feel like passport pages.
import { h, today, addDays, niceDate, diffDays, cfg, uid, monthName } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox } from '../ui.js';
import { world, drawMap } from '../worldmap.js';
import { STATUS, states, stats, countryId, getCountry, setStatus, visitsOf, home, rules, passports, stayEntries } from '../travel-data.js';
import { km, flightHours, visaStale, stayCalc, tripFits, leaveNeeded, DEFAULT_RULES } from '../travelcore.js';
import { loadLeaflet } from '../maps.js';
import { coverStrip, iconSpan } from '../decor.js';

let tab = 'map', animated = false;
const TABS = [['map', 'Map'], ['trips', 'Trips'], ['cities', 'Cities'], ['go', 'Where can I go?']];
const VISA = [['visa-free', 'Visa-free'], ['on-arrival', 'On arrival'], ['e-visa', 'e-Visa'], ['visa-required', 'Visa required'], ['unknown', 'Unknown']];
const visaChip = s => h('span', { class: 'chip ' + ({ 'visa-free': 'good', 'on-arrival': 'good', 'e-visa': 'warn', 'visa-required': 'bad' }[s] || '') }, (VISA.find(v => v[0] === s) || ['', s])[1]);

export function editVisit(a2, id, w) {
  const v = id ? store.get(id) : { country: a2, start: '', end: '' };
  modal((d, close) => {
    const start = h('input', { class: 'in', type: 'date', value: v.start || '' }), end = h('input', { class: 'in', type: 'date', value: v.end || '' }), what = h('textarea', { class: 'in', value: v.what || '', placeholder: 'What did you do?' }), fav = h('input', { class: 'in', value: v.favourite || '', placeholder: 'Favourite things' }), spend = h('input', { class: 'in', type: 'number', value: v.spend ?? '', inputmode: 'decimal' }), wth = h('input', { class: 'in', value: v.with || '' }), next = h('input', { class: 'in', value: v.next_time || '', placeholder: 'Next time I’d…' });
    const f = { rating: v.rating || 0 }, stars = h('span', { class: 'stars' }), paint = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map(i => h('button', { type: 'button', class: 'star' + (i <= f.rating ? ' on' : ''), 'aria-label': i + ' stars', onclick: () => { f.rating = f.rating === i ? 0 : i; paint(); } }, '★'))); paint();
    const photos = [...(v.photos || [])], pbox = h('div', { class: 'row wrap' }), pp = () => pbox.replaceChildren(...photos.map(p => h('img', { src: '/api/files/' + p, class: 'thumb', alt: 'Trip photo' })));
    pp(); const up = h('input', { type: 'file', accept: 'image/*', class: 'hide', onchange: async () => { const fd = new FormData(); fd.append('file', up.files[0]); try { const r = await store.upload('/api/files', fd); photos.push(r.id); pp(); } catch (e) { toast(e.message); } } });
    d.append(h('h2', {}, (id ? 'Edit' : 'Add') + ' visit · ' + (w.byA2[a2]?.name || a2)), h('div', { class: 'stack' }, h('div', { class: 'grid2' }, field('From', start), field('To', end)), what, field('Favourites', fav), h('div', { class: 'grid2' }, field('Spend (' + cfg.currency + ')', spend), field('Who with', wth)), field('Next time', next), h('div', {}, h('div', { class: 'small muted' }, 'Rating'), stars), h('div', {}, pbox, h('button', { class: 'btn sm', onclick: () => up.click() }, icon('upload'), 'Add photo'), up)),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); toast('Visit removed', () => store.restore(id)); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { store.put('visit', { country: a2, start: start.value || null, end: end.value || start.value || null, what: what.value, favourite: fav.value, spend: spend.value === '' ? null : +spend.value, with: wth.value, next_time: next.value, rating: f.rating || null, photos }, id); close(); } }, 'Save')));
  }, { wide: true, label: 'Visit' });
}

export function editRule(a2, id) {
  const r = id ? store.get(id) : { country: a2, passport: '', status: 'unknown', stay_days: '', source_url: '', verified_on: today() }, pp = passports();
  modal((d, close) => {
    const pass = h('select', { class: 'in' }, pp.map(p => h('option', { value: p.nationality || p.name, selected: (p.nationality || p.name) === r.passport }, (p.nationality || '') + ' — ' + (p.name || 'passport'))), !pp.length ? h('option', { value: r.passport || 'My passport' }, 'My passport') : '');
    const status = h('select', { class: 'in' }, VISA.map(([v, l]) => h('option', { value: v, selected: v === r.status }, l))), stay = h('input', { class: 'in', type: 'number', value: r.stay_days || '', placeholder: 'days' }), src = h('input', { class: 'in', type: 'url', value: r.source_url || '', placeholder: 'Official government / embassy page' }), ver = h('input', { class: 'in', type: 'date', value: r.verified_on || today() }), notes = h('textarea', { class: 'in', value: r.notes || '' });
    d.append(h('h2', {}, 'Entry rule I found'), h('p', { class: 'muted small' }, 'You record it, you date it, you cite it. Rules change — Life will flag it when it’s over six months old.'), h('div', { class: 'stack' }, field('Passport', pass), h('div', { class: 'grid2' }, field('Requirement', status), field('Allowed stay (days)', stay)), field('Official source link', src), field('Last verified on', ver), field('Notes', notes)),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { store.put('visa_rule', { country: a2, passport: pass.value, status: status.value, stay_days: +stay.value || null, source_url: src.value, verified_on: ver.value, notes: notes.value }, id); close(); } }, 'Save')));
  });
}

async function countryPage(el, a2, ctx) {
  const w = await world(), c = w.byA2[a2]; if (!c) { el.append(empty('globe', 'Unknown country')); return; }
  const rec = getCountry(a2) || {}, st = states()[a2], vs = visitsOf(a2), cid = countryId(a2), hm = home(), dist = km(hm, c.centre);
  el.append(h('div', { class: 'page-head' }, h('a', { class: 'btn icon sm ghost', href: '#/travel', 'aria-label': 'Back to map' }, icon('chevL')), h('h1', { class: 'squig', style: { '--dom': 'var(--d-travel)' } }, c.name), h('span', { class: 'sub' }, c.continent), h('span', { class: 'grow' }),
    seg([['', 'None'], ...STATUS.filter(s => s[0] !== 'planned')], rec.status || '', v => setStatus(a2, v))));
  const grid = h('div', { class: 'grid2' }), L = h('div', { class: 'stack' }), R = h('div', { class: 'stack' }); grid.append(L, R); el.append(grid);
  // passport page + stamp
  const years = [...new Set(vs.map(v => (v.start || '').slice(0, 4)).filter(Boolean))].sort();
  L.append(h('section', { class: 'card passport', style: { '--dom': 'var(--d-travel)' } }, h('div', { class: 'stamp', 'aria-hidden': 'true' }, h('b', {}, a2), h('span', {}, years.length ? years.join(' · ') : st === 'want' ? 'wishlist' : '—')),
    h('div', { class: 'card-head' }, h('h3', {}, 'Visits'), h('span', { class: 'count' }, vs.length || ''), h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => editVisit(a2, null, w) }, icon('plus'), 'Add visit')),
    vs.length ? vs.map(v => h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: () => editVisit(a2, v.id, w) }, h('div', { class: 'grow' }, h('b', { style: { fontWeight: 400 } }, v.start ? niceDate(v.start, true) + (v.end && v.end !== v.start ? ' → ' + niceDate(v.end, true) : '') : 'Date unknown'), v.what ? h('div', { class: 'muted' }, v.what.slice(0, 140)) : '', h('div', { class: 'meta' }, v.favourite ? h('span', {}, '♥ ' + v.favourite) : '', v.spend ? h('span', {}, cfg.currency + ' ' + v.spend) : '', v.with ? h('span', {}, 'with ' + v.with) : '', v.rating ? h('span', {}, '★'.repeat(v.rating)) : ''), (v.photos || []).length ? h('div', { class: 'row wrap', style: { marginTop: '6px' } }, v.photos.map(p => h('img', { src: '/api/files/' + p, class: 'thumb', alt: '' }))) : ''))) : h('p', { class: 'faint', style: { margin: 0 } }, st === 'want' ? 'Not yet — that’s the fun part.' : 'No visits recorded.')));
  const notes = h('textarea', { class: 'in', value: rec.notes || '', placeholder: 'Notes, tips, what I’d do next time…', 'aria-label': 'Notes', onchange: e => store.put('country', { code: a2, notes: e.target.value }, cid) });
  L.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Notes')), notes));
  // want fields
  if (rec.status === 'want' || st === 'planned') {
    const inp = (k, label, ph) => field(label, h('input', { class: 'in', value: rec[k] || '', placeholder: ph, onchange: e => store.put('country', { code: a2, [k]: e.target.value }, cid) }));
    const months = h('div', { class: 'row wrap' }, Array.from({ length: 12 }, (_, i) => h('button', { class: 'chip' + ((rec.best_months || []).includes(i) ? ' on' : ''), onclick: e => { const s = new Set(getCountry(a2)?.best_months || []); s.has(i) ? s.delete(i) : s.add(i); store.put('country', { code: a2, best_months: [...s] }, cid); e.target.classList.toggle('on'); } }, monthName(i).slice(0, 3))));
    R.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Someday')), h('div', { class: 'stack' }, inp('why', 'Why I want to go', ''), h('div', {}, h('div', { class: 'small muted' }, 'Best season'), months), inp('budget', 'Rough budget (' + cfg.currency + ')', 'e.g. 12000'))));
  }
  R.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'From home')), h('div', { class: 'stat-row' }, h('div', { class: 'stat' }, h('b', {}, '~' + flightHours(dist) + ' h'), h('span', {}, 'flight, rough')), h('div', { class: 'stat' }, h('b', {}, Math.round(dist).toLocaleString()), h('span', {}, 'km'))), h('p', { class: 'faint small', style: { margin: '8px 0 0' } }, 'Straight-line to the country’s centre; real routes vary.')));
  // visa helper
  const rs = store.list('visa_rule', r => r.country === a2);
  const vh = h('section', { class: 'card', style: { '--dom': 'var(--d-travel)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Entry rules'), h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => editRule(a2) }, icon('plus'), 'Add what I found')));
  if (!rs.length) vh.append(h('p', { class: 'muted', style: { margin: 0 } }, 'Nothing recorded yet. Look it up on the official government or embassy site, then note it here with the date.'));
  rs.forEach(r => { const stale = visaStale(r.verified_on, today()); vh.append(h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: () => editRule(a2, r.id) }, h('div', { class: 'grow' }, h('div', { class: 'row wrap' }, h('b', { style: { fontWeight: 400 } }, r.passport), visaChip(r.status), r.stay_days ? h('span', { class: 'muted' }, r.stay_days + ' days') : ''), h('div', { class: 'meta' }, h('span', {}, 'verified ' + (r.verified_on ? niceDate(r.verified_on, true) : 'never')), stale ? h('span', { style: { color: 'var(--warn)' } }, 'stale — re-check') : '', r.source_url ? h('a', { href: r.source_url, target: '_blank', rel: 'noopener noreferrer', onclick: e => e.stopPropagation() }, 'official source') : '')))); });
  vh.append(h('p', { class: 'faint small', style: { margin: '8px 0 0' } }, 'Always verify with the embassy or official government site before booking. Life never guesses.'));
  R.append(vh);
  // linked list items
  const items = store.list('list_item', i => i.country === a2 || (i.tags || []).some(t => t.toLowerCase() === c.name.toLowerCase()));
  if (items.length) R.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Things to do & eat')), items.map(i => h('a', { class: 'item', href: '#/lists/' + i.list, style: { textDecoration: 'none', color: 'inherit' } }, i.title))));
}

async function mapTab(box, ctx) {
  const w = await world(), s = await stats(), st = states();
  const bar = h('div', { class: 'stats' }, [[s.count, 'countries'], [s.pct + '%', 'of the world'], [s.continents + '/6', 'continents'], [s.days || 0, 'days abroad'], [s.km ? Math.round(s.km / 1000) + 'k' : 0, 'km flown']].map(([n, l]) => h('div', { class: 'stat' }, h('b', { 'data-n': n }, n), h('span', {}, l))));
  const mapBox = h('div', { class: 'worldbox' }), api = drawMap(mapBox, w, st, { onPick: a2 => (location.hash = '#/travel/c/' + a2), animate: !animated }); animated = true;
  const find = h('input', { class: 'in', list: 'cl', placeholder: 'Find a country…', 'aria-label': 'Find a country', onchange: e => { const c = w.byName[e.target.value.toLowerCase()]; if (c) location.hash = '#/travel/c/' + c.a2; } }), dl = h('datalist', { id: 'cl' }, w.list.map(c => h('option', { value: c.name })));
  const legend = h('div', { class: 'row wrap small' }, [['been', 'been'], ['lived', 'lived'], ['want', 'want to go'], ['planned', 'planned'], ['none', 'not yet']].map(([k, l]) => h('span', { class: 'row', style: { gap: '6px' } }, h('i', { class: 'sw ct c-' + k }), l)));
  box.append(bar, h('div', { class: 'card worldcard' }, mapBox, h('div', { class: 'row wrap', style: { marginTop: '10px' } }, legend, h('span', { class: 'grow' }), find, dl, h('button', { class: 'btn icon sm', 'aria-label': 'Zoom in', onclick: api.zoomIn }, icon('plus')), h('button', { class: 'btn icon sm', 'aria-label': 'Zoom out', onclick: api.zoomOut }, h('b', {}, '–')), h('button', { class: 'btn sm', onclick: api.reset }, 'Reset'))));
  const yrs = Object.entries(s.byYear).sort((a, b) => b[0] - a[0]); if (yrs.length) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Places by year')), yrs.map(([y, set]) => h('div', { class: 'item' }, h('b', { style: { fontWeight: 400, width: '50px' } }, y), h('span', {}, [...set].map(a => w.byA2[a]?.name).filter(Boolean).join(', '))))));
  const want = Object.entries(st).filter(([, v]) => v === 'want').map(([a]) => w.byA2[a]).filter(Boolean);
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Bucket list'), h('span', { class: 'count' }, want.length || '')), want.length ? h('div', { class: 'row wrap' }, want.map(c => h('a', { class: 'chip', href: '#/travel/c/' + c.a2 }, c.name))) : h('p', { class: 'faint', style: { margin: 0 } }, 'Tap a country on the map and mark “Want to go”.')));
}

export function tripDialog(t, onSave) {
  modal(async (d, close) => {
    const w = await world(), f = { ...t, countries: [...(t.countries || [])] };
    const name = h('input', { class: 'in', value: t.name || '', placeholder: 'e.g. Japan in spring' }), start = h('input', { class: 'in', type: 'date', value: t.start || '' }), end = h('input', { class: 'in', type: 'date', value: t.end || '' });
    const chips = h('div', { class: 'row wrap' }), paint = () => chips.replaceChildren(...f.countries.map(a => h('span', { class: 'chip on' }, w.byA2[a]?.name || a, h('button', { class: 'x', 'aria-label': 'Remove', onclick: () => { f.countries = f.countries.filter(x => x !== a); paint(); } }, '×'))));
    paint(); const add = h('input', { class: 'in', list: 'cl2', placeholder: 'Add a destination country…', onchange: e => { const c = w.byName[e.target.value.toLowerCase()]; if (c && !f.countries.includes(c.a2)) { f.countries.push(c.a2); paint(); } e.target.value = ''; } }), dl = h('datalist', { id: 'cl2' }, w.list.map(c => h('option', { value: c.name })));
    const who = h('input', { class: 'in', value: t.travellers || '', placeholder: 'Who’s coming' }), purpose = h('input', { class: 'in', value: t.purpose || '', placeholder: 'Holiday, family, work…' }), bud = h('input', { class: 'in', type: 'number', value: t.budget ?? '', inputmode: 'decimal' }), cur = h('input', { class: 'in', value: t.currency || cfg.currency, style: { maxWidth: '90px' } });
    d.append(h('h2', {}, t.id ? 'Edit trip' : 'Plan a trip'), h('div', { class: 'stack' }, name, h('div', { class: 'grid2' }, field('From', start), field('To', end)), h('div', {}, h('div', { class: 'small muted' }, 'Destinations'), chips, add, dl), h('div', { class: 'grid2' }, field('Travellers', who), field('Purpose', purpose)), h('div', { class: 'grid2' }, field('Budget', bud), field('Currency', cur))),
      h('div', { class: 'actions' }, t.id ? h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete this trip?', 'Bookings and packing for it go too (undo for a few seconds).', { ok: 'Delete', danger: true })) { store.del(t.id); close(); location.hash = '#/travel'; toast('Trip deleted', () => store.restore(t.id)); } } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (!name.value.trim()) return name.focus(); const r = store.put('trip', { name: name.value.trim(), start: start.value || null, end: end.value || start.value || null, countries: f.countries, travellers: who.value, purpose: purpose.value, budget: bud.value === '' ? null : +bud.value, currency: cur.value || cfg.currency, status: t.status || 'planned' }, t.id); close(); onSave && onSave(r); } }, 'Save')));
  }, { wide: true, label: 'Trip' });
}

function tripsTab(box) {
  box.append(h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => tripDialog({}, t => (location.hash = '#/travel/t/' + t.id)) }, icon('plus'), 'Plan a trip')));
  const trips = store.list('trip').sort((a, b) => (a.start || '9').localeCompare(b.start || '9')), T = today(), up = trips.filter(t => (t.end || t.start || '9') >= T), past = trips.filter(t => (t.end || t.start || '9') < T).reverse();
  if (!trips.length) { box.append(empty('travel', 'Where next?', 'Plan a trip and get an itinerary, bookings, packing and a visa check in one place.')); return; }
  const card = t => { const n = t.start ? diffDays(T, t.start) : null; return h('a', { class: 'card trip', href: '#/travel/t/' + t.id, style: { '--dom': 'var(--d-travel)', textDecoration: 'none', color: 'inherit' } }, coverStrip(t), h('div', { class: 'card-head' }, h('h3', {}, iconSpan(t), t.name), n != null && n >= 0 ? h('span', { class: 'chip dom' }, n === 0 ? 'today' : `in ${n} day${n > 1 ? 's' : ''}`) : ''), h('div', { class: 'muted' }, t.start ? niceDate(t.start, true) + (t.end && t.end !== t.start ? ' → ' + niceDate(t.end, true) : '') : 'dates tbd'), h('div', { class: 'faint small' }, (t.countries || []).join(' · '))); };
  if (up.length) box.append(h('h2', {}, 'Coming up'), h('div', { class: 'grid2' }, up.map(card)));
  if (past.length) box.append(h('h2', {}, 'Past'), h('div', { class: 'grid2' }, past.map(card)));
}

async function citiesTab(box) {
  const cities = store.list('city'), L = await loadLeaflet(), mapBox = h('div', { class: 'map' });
  box.append(h('p', { class: 'muted' }, 'Tap the map to drop a pin for a city you’ve loved or want to see.'), mapBox, h('div', { class: 'card' }, cities.length ? cities.map(c => h('div', { class: 'item' }, h('span', { class: 'dot', style: { background: c.status === 'been' ? 'var(--pen)' : 'var(--d-goals)', marginTop: '10px' } }), h('span', { class: 'grow' }, c.name), h('span', { class: 'meta' }, c.status), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => store.del(c.id) }, icon('x')))) : h('p', { class: 'faint', style: { margin: 0 } }, 'No cities yet.')));
  const map = L.map(mapBox, { worldCopyJump: true }).setView(cities[0] ? [cities[0].lat, cities[0].lon] : [30, 20], cities.length ? 4 : 2); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
  cities.forEach(c => L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'pin' + (c.status === 'want' ? ' want' : ''), html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22] }) }).addTo(map).bindTooltip(c.name));
  setTimeout(() => map.invalidateSize(), 200);
  map.on('click', e => modal((d, close) => { const nm = h('input', { class: 'in', placeholder: 'City name', autofocus: true }), s = { v: 'want' }; d.append(h('h2', {}, 'Add city'), nm, seg([['been', 'Been'], ['want', 'Want to go']], 'want', v => s.v = v), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (nm.value.trim()) { store.put('city', { name: nm.value.trim(), lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4), status: s.v }); close(); } } }, 'Add'))); }));
  return () => map.remove();
}

async function goTab(box) {
  const w = await world(), pp = passports(), set = window.__settings || {}, wd = set.work_days || [1, 2, 3, 4, 5];
  const f = { from: addDays(today(), 30), to: addDays(today(), 37), budget: '', maxh: 8, passport: pp[0]?.nationality || '' };
  const out = h('div', { class: 'stack' });
  const inp = (k, type, label) => field(label, h('input', { class: 'in', type, value: f[k], onchange: e => f[k] = e.target.value }));
  const pass = h('select', { class: 'in', onchange: e => f.passport = e.target.value }, pp.length ? pp.map(p => h('option', { value: p.nationality || p.name }, (p.nationality || '') + ' ' + (p.name || ''))) : h('option', { value: '' }, 'No passport recorded'));
  const run = () => {
    const want = Object.entries(states()).filter(([, v]) => v === 'want').map(([a]) => w.byA2[a]).filter(Boolean), hm = home(), month = new Date(f.from + 'T12:00:00Z').getUTCMonth(), days = diffDays(f.from, f.to) + 1, leave = leaveNeeded(f.from, f.to, wd, (store.list('public_holiday').map(p => p.date)));
    const rows = want.map(c => { const rec = getCountry(c.a2) || {}, rule = store.list('visa_rule', r => r.country === c.a2 && (!f.passport || r.passport === f.passport))[0], hrs = flightHours(km(hm, c.centre)); const easy = rule && !visaStale(rule.verified_on, today()) && ['visa-free', 'on-arrival', 'e-visa'].includes(rule.status); const season = !(rec.best_months || []).length ? null : rec.best_months.includes(month);
      return { c, rec, rule, hrs, easy, season, ok: hrs <= +f.maxh && (!f.budget || !rec.budget || +rec.budget <= +f.budget) && easy }; }).sort((a, b) => (b.ok - a.ok) || (b.season - a.season) || a.hrs - b.hrs);
    out.replaceChildren(h('p', { class: 'muted' }, `${days} days, about ${leave} leave day${leave === 1 ? '' : 's'} needed.`), rows.length ? rows.map(r => h('a', { class: 'card', href: '#/travel/c/' + r.c.a2, style: { textDecoration: 'none', color: 'inherit', opacity: r.ok ? 1 : .55 } }, h('div', { class: 'card-head' }, h('h3', {}, r.c.name), r.rule ? visaChip(r.rule.status) : h('span', { class: 'chip' }, 'visa unknown')), h('div', { class: 'row wrap small muted' }, h('span', {}, '~' + r.hrs + ' h flight'), r.season === true ? h('span', { class: 'chip good' }, 'good season') : r.season === false ? h('span', { class: 'chip warn' }, 'off season') : '', r.rec.budget ? h('span', {}, '~' + cfg.currency + ' ' + r.rec.budget) : '', r.rule && visaStale(r.rule.verified_on, today()) ? h('span', { style: { color: 'var(--warn)' } }, 'rule is stale — re-check') : ''))) : empty('globe', 'No bucket-list countries yet', 'Mark a few on the map first.'));
  };
  box.append(h('section', { class: 'card' }, h('div', { class: 'grid2' }, inp('from', 'date', 'From'), inp('to', 'date', 'To'), inp('budget', 'number', 'Budget cap (' + cfg.currency + ')'), inp('maxh', 'number', 'Max flight hours'), field('Passport', pass)), h('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: run }, icon('search'), 'Show me')), out, h('p', { class: 'faint small' }, 'Only countries on your bucket list with a recent, recorded entry rule count as “easy”. Visa rules change — verify before booking.'));
  run();
}

export default async function render(el, ctx) {
  const [kind, id] = ctx.rest;
  if (kind === 'c') return countryPage(el, id, ctx);
  if (kind === 't') { const m = await import('./trip.js'); return m.default(el, ctx); }
  const ctxTab = ctx.q.tab; if (ctxTab && !ctx.soft) tab = ctxTab;
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig', style: { '--dom': 'var(--d-travel)' } }, 'Travel'), h('span', { class: 'grow' }), h('a', { class: 'btn sm', href: '#/vault' }, icon('shield'), 'Documents & visas')), h('div', { style: { margin: '0 0 18px', overflowX: 'auto' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box);
  const clean = await ({ map: mapTab, trips: tripsTab, cities: citiesTab, go: goTab })[tab](box, ctx);
  return clean;
}
