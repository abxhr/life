// Extras for list items: action links, moving between lists, multi-select, "surprise me" with filters, duplicate finder.
import { h, today } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, toast } from './ui.js';
import { types, isDone, doneStatus } from './lists-core.js';
import { sameItem } from './dedupe.js';

const q = encodeURIComponent;

// ---------- links on an item: maps, call, trailer, where to watch, IMDb, the post it came from ----------
export function itemLinks(it, listType) {
  const link = (label, href, ic) => h('a', { class: 'btn sm', href, target: href.startsWith('tel:') ? null : '_blank', rel: 'noopener noreferrer' }, icon(ic), label);
  const out = [], post = (/Post: (https?:\/\/\S+)/.exec(it.notes || '') || [])[1];
  if (listType === 'restaurant' || listType === 'play' || it.lat != null) {
    const where = [it.title, it.city || it.area].filter(Boolean).join(' ');
    out.push(link('Apple Maps', `https://maps.apple.com/?q=${q(where)}` + (it.lat != null ? `&ll=${it.lat},${it.lon}` : ''), 'pin'), link('Google Maps', it.url && /maps/.test(it.url) ? it.url : `https://www.google.com/maps/search/?api=1&query=${q(where)}`, 'pin'));
    if (it.phone) out.push(link('Call', 'tel:' + it.phone.replace(/[^\d+]/g, ''), 'send'));
  }
  if (listType === 'media' && it.medium !== 'book') {
    const name = [it.title, it.year].filter(Boolean).join(' ');
    out.push(link('Trailer', `https://www.youtube.com/results?search_query=${q(name + ' trailer')}`, 'eye'), link('Where to watch', `https://www.justwatch.com/${(window.__settings || {}).timezone === 'Asia/Dubai' ? 'ae/' : ''}search?q=${q(it.title)}`, 'link'),
      link('IMDb', it.imdb_id ? `https://www.imdb.com/title/${it.imdb_id}/` : `https://www.imdb.com/find/?q=${q(it.title)}`, 'star'));
  }
  if (post) out.push(link('The post', post, 'link'));
  return out.length ? h('div', { class: 'row wrap', style: { gap: '6px' } }, out) : '';
}

// ---------- move items to another list (statuses are mapped when the kinds differ) ----------
export function moveItems(ids, destId) {
  const dest = store.get(destId); if (!dest) return 0; const ty = types()[dest.type] || types().ideas;
  ids.forEach(id => { const it = store.get(id); if (!it) return; const src = store.get(it.list), sty = src && types()[src.type];
    const done = sty ? isDone(it, sty) : false; let status = it.status;
    if (!ty.statuses.includes(status)) status = done ? doneStatus(ty) : ty.statuses[0];
    store.put('list_item', { list: destId, status, done_at: done ? it.done_at || today() : null }, id); });
  return ids.length;
}
export function pickList(title, exceptId, onPick) {
  modal((d, close) => d.append(h('h2', {}, title), h('div', { class: 'stack-s' }, store.list('list').filter(l => l.id !== exceptId).sort((a, b) => a.name.localeCompare(b.name)).map(l => h('button', { class: 'btn', style: { justifyContent: 'flex-start' }, onclick: () => { close(); onPick(l); } }, icon((types()[l.type] || {}).icon || 'lists'), l.name))), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'))), { label: title });
}

// ---------- multi-select: tap rows (or long-press one) then act on all of them ----------
export const pick = { on: false, ids: new Set(), bar: null };
export function endPick() { pick.on = false; pick.ids.clear(); pick.bar && pick.bar.remove(); pick.bar = null; document.body.classList.remove('picking'); }
export function startPick(id, refresh) { pick.on = true; if (id) pick.ids.add(id); document.body.classList.add('picking'); paintBar(refresh); refresh && refresh(); }
export function togglePick(id, row, refresh) { pick.ids.has(id) ? pick.ids.delete(id) : pick.ids.add(id); row && row.classList.toggle('picked', pick.ids.has(id)); paintBar(refresh); }
function paintBar(refresh) {
  pick.bar && pick.bar.remove(); if (!pick.on) return;
  const ids = [...pick.ids], n = ids.length, listId = ids.length ? (store.get(ids[0]) || {}).list : null;
  pick.bar = h('div', { class: 'pickbar card', role: 'toolbar', 'aria-label': 'Selected items' }, h('b', { style: { fontWeight: 400 } }, n ? `${n} selected` : 'Tap items to select'),
    h('button', { class: 'btn sm', disabled: !n || null, onclick: () => { ids.forEach(i => { const it = store.get(i), l = it && store.get(it.list); if (!l) return; const ty = types()[l.type] || types().ideas; if (!isDone(it, ty)) store.put('list_item', { status: doneStatus(ty), done_at: today() }, i); }); toast('Marked done'); endPick(); refresh && refresh(); } }, icon('check'), 'Done'),
    h('button', { class: 'btn sm', disabled: !n || null, onclick: () => pickList('Move to…', listId, l => { toast(`Moved ${moveItems(ids, l.id)} to ${l.name}`); endPick(); refresh && refresh(); }) }, icon('lists'), 'Move'),
    h('button', { class: 'btn sm danger', disabled: !n || null, onclick: () => { ids.forEach(i => store.del(i)); toast(`Removed ${n}`, () => ids.forEach(i => store.restore(i))); endPick(); refresh && refresh(); } }, icon('trash'), 'Delete'),
    h('button', { class: 'btn sm ghost', onclick: () => { endPick(); refresh && refresh(); } }, 'Cancel'));
  document.body.append(pick.bar);
}
export function longPress(el, fn) {   // touch: hold a row for half a second
  let t = null; const stop = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', e => { if (e.target.closest('input,button,a')) return; t = setTimeout(() => { t = null; fn(); }, 520); }, { passive: true });
  ['touchmove', 'touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, stop, { passive: true }));
}

// ---------- "Surprise me" with filters ----------
const FILTERS = { restaurant: [['cuisine', 'Cuisine', v => [v]], ['price', 'Price', v => [v]], ['city', 'Area', v => [v]]], media: [['genre', 'Genre', v => v.split(/,\s*/)], ['language', 'Language', v => v.split(/,\s*/)], ['medium', 'Type', v => [v]]] };
export function surpriseDialog(items, ty, listType, openItem) {
  const open = items.filter(i => !isDone(i, ty)), groups = (FILTERS[listType] || []).map(([k, label, split]) => [k, label, split, [...new Set(open.flatMap(i => i[k] ? split(String(i[k])) : []))].sort()]).filter(g => g[3].length > 1);
  const on = Object.fromEntries(groups.map(g => [g[0], new Set()]));
  modal((d, close) => {
    const result = h('div', { class: 'stack-s' });
    const match = i => groups.every(([k, , split]) => !on[k].size || (i[k] && split(String(i[k])).some(v => on[k].has(v))));
    const roll = () => { const pool = open.filter(match); if (!pool.length) return result.replaceChildren(h('p', { class: 'muted' }, 'Nothing matches those filters.')); const p = pool[Math.floor(Math.random() * pool.length)];
      result.replaceChildren(h('p', { class: 'hero-line', style: { fontSize: '2.2rem', margin: 0 } }, p.title), h('p', { class: 'muted', style: { margin: 0 } }, [p.cuisine || p.genre, p.city || p.area || p.language, p.price, p.imdb && '★ ' + p.imdb].filter(Boolean).join(' · ')),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => { close(); openItem(p.id); } }, 'Open'), h('button', { class: 'btn', onclick: roll }, icon('zap'), 'Another'), h('span', { class: 'faint small' }, `${pool.length} to choose from`))); };
    d.append(h('h2', {}, 'How about…'), ...groups.map(([k, label, , vals]) => h('div', {}, h('div', { class: 'small muted' }, label), h('div', { class: 'row wrap' }, vals.map(v => h('button', { class: 'chip', 'aria-pressed': 'false', onclick: e => { on[k].has(v) ? on[k].delete(v) : on[k].add(v); e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', String(on[k].has(v))); roll(); } }, v))))),
      result, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: close }, 'Nice')));
    roll();
  }, { label: 'Surprise me' });
}

// ---------- duplicates on this list ----------
export function duplicatesDialog(items) {
  const groups = []; items.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).forEach(it => { const g = groups.find(g => sameItem(g[0], it)); g ? g.push(it) : groups.push([it]); });
  const dups = groups.filter(g => g.length > 1);
  if (!dups.length) return toast('No duplicates here');
  modal((d, close) => d.append(h('h2', {}, `${dups.length} duplicate${dups.length > 1 ? 's' : ''}`), h('p', { class: 'muted small' }, 'Keeps the oldest one, fills its blanks from the others, and removes the rest (Undo for a few seconds).'),
    h('div', { class: 'stack-s' }, dups.map(g => h('div', { class: 'item' }, h('div', { class: 'grow' }, g.map(x => h('div', {}, x.title, h('span', { class: 'faint small' }, '  ' + [x.city, x.year].filter(Boolean).join(' · '))))), h('button', { class: 'btn sm primary', onclick: e => {
      const [keep, ...rest] = g, fill = {}; rest.forEach(r => Object.entries(r).forEach(([k, v]) => { if (!['id', 'kind', 'created_at', 'updated_at', 'deleted_at', '_t', 'list', 'order'].includes(k) && v != null && v !== '' && (keep[k] == null || keep[k] === '' || (Array.isArray(keep[k]) && !keep[k].length))) fill[k] = v; }));
      if (Object.keys(fill).length) store.put('list_item', fill, keep.id); rest.forEach(r => store.del(r.id)); toast(`Merged into “${keep.title}”`, () => rest.forEach(r => store.restore(r.id))); e.currentTarget.closest('.item').remove(); } }, 'Merge')))),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: close }, 'Done'))), { wide: true, label: 'Duplicates' });
}
