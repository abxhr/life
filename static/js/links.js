// Relations: any record can link to any other (`links: [{kind,id}]`). Backlinks are computed. Also: labels and routes for records.
import { h } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, toast } from './ui.js';

export const KINDS = { task: ['Task', 'tasks'], note: ['Note', 'notes'], list_item: ['List item', 'lists'], person: ['Person', 'user'], trip: ['Trip', 'travel'], goal: ['Goal', 'goals'], list: ['List', 'lists'], event: ['Event', 'calendar'], decision: ['Decision', 'book'], maintenance_item: ['Maintenance', 'home'], visit: ['Visit', 'globe'] };
export const labelFor = r => r ? (r.title || r.name || r.text || (r.body || '').split('\n')[0].replace(/^#+\s*/, '') || r.country || 'Untitled').toString().slice(0, 70) : 'Deleted item';
export function hrefFor(kind, r) {
  const id = r.id;
  return { task: `#/tasks?edit=${id}`, note: `#/notes/${id}`, list_item: `#/lists/${r.list}`, person: '#/people', trip: `#/travel/t/${id}`, goal: '#/goals', list: `#/lists/${id}`, event: '#/calendar', decision: '#/admin', maintenance_item: '#/admin', visit: `#/travel/c/${r.country}` }[kind] || '#/today';
}
export const linksOf = rec => (rec.links || []).map(l => ({ ...l, rec: store.get(l.id) })).filter(l => l.rec);
export function backlinksOf(rec) { const out = []; for (const k of Object.keys(KINDS)) for (const r of store.list(k, x => x.id !== rec.id && (x.links || []).some(l => l.id === rec.id))) out.push({ kind: k, rec: r }); return out; }
export function addLink(rec, target) { if ((rec.links || []).some(l => l.id === target.id)) return; store.put(rec.kind, { links: [...(rec.links || []), { kind: target.kind, id: target.id }] }, rec.id); }
export function removeLink(rec, id) { store.put(rec.kind, { links: (rec.links || []).filter(l => l.id !== id) }, rec.id); }

export function searchTargets(q, exclude) {
  q = q.toLowerCase().trim(); const out = [];
  for (const k of Object.keys(KINDS)) for (const r of store.list(k)) { if (r.id === exclude) continue; const lab = labelFor(r); if (!q || lab.toLowerCase().includes(q)) out.push({ kind: k, rec: r, label: lab }); }
  return out.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 40);
}
export function openLinker(rec, done) {
  modal((d, close) => {
    const inp = h('input', { class: 'in', placeholder: 'Link to a task, note, person, trip, place…', autofocus: true, 'aria-label': 'Search to link' }), res = h('div', { class: 'res' });
    const paint = () => res.replaceChildren(...searchTargets(inp.value, rec.id).map(t => h('button', { class: 'btn ghost', style: { width: '100%', justifyContent: 'flex-start' }, onclick: () => { addLink(store.get(rec.id), { kind: t.kind, id: t.rec.id }); toast('Linked'); close(); done && done(); } }, icon(KINDS[t.kind][1]), h('span', { class: 'grow', style: { textAlign: 'left' } }, t.label), h('span', { class: 'faint small' }, KINDS[t.kind][0]))));
    inp.addEventListener('input', paint); d.append(h('h2', {}, 'Link to…'), inp, h('div', { class: 'stack-s', style: { maxHeight: '50vh', overflow: 'auto', marginTop: '8px' } }, res)); paint();
  }, { label: 'Link' });
}
// a small "Linked" section for any editor / page
export function linksPanel(rec, { onChange } = {}) {
  const fresh = () => store.get(rec.id) || rec, ls = linksOf(fresh()), back = backlinksOf(fresh());
  const chip = (kind, r, removable) => h('span', { class: 'chip' }, icon(KINDS[kind][1], 'mini'), h('a', { href: hrefFor(kind, r), style: { textDecoration: 'none', color: 'inherit' }, onclick: () => document.querySelector('.scrim') && document.querySelector('.scrim').remove() }, labelFor(r)), removable ? h('button', { class: 'x', 'aria-label': 'Unlink ' + labelFor(r), onclick: () => { removeLink(fresh(), r.id); onChange && onChange(); } }, '×') : '');
  return h('div', { class: 'links-panel' }, h('div', { class: 'row wrap' }, h('b', { class: 'small muted', style: { fontWeight: 400 } }, 'Linked'), ls.map(l => chip(l.kind, l.rec, true)), h('button', { class: 'chip', onclick: () => openLinker(fresh(), onChange) }, icon('plus', 'mini'), 'link')), back.length ? h('div', { class: 'row wrap', style: { marginTop: '4px' } }, h('span', { class: 'small faint' }, 'Mentioned by'), back.map(b => chip(b.kind, b.rec, false))) : '');
}
