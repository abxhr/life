// People: lightweight, not a CRM. Birthdays, how you know them, when you last spoke, gentle nudges, gift ideas, details that matter.
import { h, today, addDays, niceDate, diffDays, ago } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox } from '../ui.js';
import { linksPanel } from '../links.js';

const nextBirthday = (b, T) => { if (!b || b.length < 5) return null; const md = b.slice(-5); let y = +T.slice(0, 4); let d = `${y}-${md}`; if (d < T) d = `${y + 1}-${md}`; return d; };
export const weeksSince = (last, T) => last ? Math.floor(diffDays(last, T) / 7) : null;

function edit(id) {
  const p = id ? store.get(id) : { name: '', keep_weeks: 0 };
  modal((d, close) => {
    const f = {}, mk = (k, label, type = 'text', ph = '') => { f[k] = h('input', { class: 'in', type, value: p[k] ?? '', placeholder: ph }); return field(label, f[k]); };
    const details = h('textarea', { class: 'in', value: p.details || '', placeholder: 'Kids’ names, allergies, preferences…' }), gifts = h('textarea', { class: 'in', value: (p.gifts || []).join('\n'), placeholder: 'One gift idea per line' });
    const keep = h('select', { class: 'in' }, [[0, 'No reminder'], [1, 'Every week'], [2, 'Every 2 weeks'], [4, 'Every month'], [8, 'Every 2 months'], [12, 'Every 3 months']].map(([v, l]) => h('option', { value: v, selected: v === (p.keep_weeks || 0) }, l)));
    d.append(h('h2', {}, id ? 'Edit person' : 'Add a person'), h('div', { class: 'stack' }, mk('name', 'Name'), mk('how', 'How I know them', 'text', 'cousin, college friend, neighbour…'), h('div', { class: 'grid2' }, mk('birthday', 'Birthday', 'date'), mk('anniversary', 'Anniversary', 'date')), h('div', { class: 'grid2' }, field('Keep in touch', keep), mk('last_contact', 'Last spoke', 'date')), mk('phone', 'Phone', 'tel'), field('Details that matter', details), field('Gift ideas', gifts), id ? linksPanel(store.get(id)) : ''),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Remove ' + p.name + '?', 'Undo is available for a few seconds.', { ok: 'Remove', danger: true })) { store.del(id); close(); toast('Removed', () => store.restore(id)); } } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (!f.name.value.trim()) return f.name.focus(); const out = { details: details.value, keep_weeks: +keep.value, gifts: gifts.value.split('\n').map(s => s.trim()).filter(Boolean) }; Object.entries(f).forEach(([k, i]) => out[k] = i.value || null); out.name = f.name.value.trim(); store.put('person', out, id); close(); } }, 'Save')));
  }, { wide: true, label: 'Person' });
}

export default function render(el, ctx) {
  const T = today(), ps = store.list('person');
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'People'), h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => edit() }, icon('plus'), 'Add person')));
  if (!ps.length) { el.append(empty('user', 'The people who matter', 'Add birthdays and how often you’d like to be in touch. I’ll nudge gently — never nag.', h('button', { class: 'btn primary', onclick: () => edit() }, 'Add someone'))); return; }
  const soon = ps.map(p => ({ p, d: nextBirthday(p.birthday, T) })).filter(x => x.d && diffDays(T, x.d) <= 45).sort((a, b) => a.d.localeCompare(b.d));
  if (soon.length) el.append(h('section', { class: 'card taped', style: { marginBottom: '20px' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Birthdays coming up')), soon.map(({ p, d }) => h('div', { class: 'item' }, icon('star', 'mini'), h('div', { class: 'grow' }, p.name, p.gifts?.length ? h('div', { class: 'meta' }, 'Gift ideas: ' + p.gifts.slice(0, 3).join(', ')) : ''), h('b', { style: { fontWeight: 400 } }, diffDays(T, d) === 0 ? 'today' : niceDate(d))))));
  const sorted = [...ps].sort((a, b) => ((weeksSince(b.last_contact, T) ?? 99) - (b.keep_weeks || 99)) - ((weeksSince(a.last_contact, T) ?? 99) - (a.keep_weeks || 99)));
  el.append(h('div', { class: 'grid2' }, sorted.map(p => { const w = weeksSince(p.last_contact, T), due = p.keep_weeks && (w == null || w >= p.keep_weeks);
    return h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { style: { flex: 1 } }, p.name), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Edit ' + p.name, onclick: () => edit(p.id) }, icon('edit'))), h('div', { class: 'faint small' }, p.how || ''),
      h('div', { class: 'row wrap', style: { margin: '6px 0' } }, due ? h('span', { class: 'chip warn' }, w == null ? 'no contact logged' : `${w} weeks since you spoke`) : p.last_contact ? h('span', { class: 'chip' }, 'spoke ' + niceDate(p.last_contact)) : '', p.birthday ? h('span', { class: 'chip' }, 'birthday ' + niceDate(nextBirthday(p.birthday, T))) : ''),
      p.details ? h('p', { class: 'muted small', style: { margin: '0 0 8px' } }, p.details) : '', h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => { store.put('person', { last_contact: T }, p.id); toast('Noted — ' + p.name); } }, icon('check'), 'We spoke today'), p.phone ? h('a', { class: 'btn sm', href: 'tel:' + p.phone }, 'Call') : '')); })));
}
