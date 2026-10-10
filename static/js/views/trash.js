// Trash: everything you deleted, restorable. Only here can anything be removed for good.
import { h, ago } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast, empty, confirmBox } from '../ui.js';
import { KINDS, labelFor } from '../links.js';

export default function render(el, ctx) {
  const items = store.trashed();
  el.append(h('div', { class: 'page-head' }, h('a', { class: 'btn icon sm ghost', href: '#/more', 'aria-label': 'Back' }, icon('chevL')), h('h1', { class: 'squig' }, 'Trash'), h('span', { class: 'grow' }),
    items.length ? h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmBox('Empty the trash?', `${items.length} item(s) will be deleted for good. This can’t be undone.`, { ok: 'Delete forever', danger: true })) { const ids = items.map(i => i.id); try { await store.api('/api/trash/purge', { method: 'POST', body: JSON.stringify({ ids }) }); store.forget(ids); toast('Trash emptied'); } catch (e) { toast(e.message); } } } }, icon('trash'), 'Empty trash') : ''));
  el.append(h('p', { class: 'muted' }, 'Deleted items wait here until you remove them for good. Notes also keep their last 20 versions.'));
  if (!items.length) { el.append(empty('trash', 'Nothing in the trash', 'Deleted tasks, notes, lists and trips show up here so you can bring them back.')); return; }
  el.append(h('div', { class: 'card' }, items.slice(0, 300).map(r => h('div', { class: 'item' }, icon((KINDS[r.kind] || [0, 'notes'])[1]), h('div', { class: 'grow' }, labelFor(r), h('div', { class: 'meta' }, (KINDS[r.kind] || [r.kind])[0], 'deleted ' + ago(r.deleted_at))),
    h('button', { class: 'btn sm', onclick: () => { store.restore(r.id); toast('Restored'); } }, icon('undo'), 'Restore'),
    h('button', { class: 'btn sm ghost', onclick: async () => { try { await store.api('/api/trash/purge', { method: 'POST', body: JSON.stringify({ ids: [r.id] }) }); store.forget([r.id]); } catch (e) { toast(e.message); } } }, 'Delete forever')))));
}
