// Notes: Markdown editor, backlinks, daily note, templates, versions, attachments, FTS search.
import { h, today, niceDate, debounce, ago, mdToNodes, wdName, dow } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, confirmBox, menu } from '../ui.js';
import { inMode } from '../state.js';
import { coverStrip, iconSpan, decorDialog } from '../decor.js';
import { linksPanel } from '../links.js';

const TEMPLATES = {
  plain: ['Plain', ''], meeting: ['Meeting', '## Attendees\n\n## Notes\n\n## Decisions\n\n## Actions\n- [ ] '], journal: ['Daily journal', '## Gratitude\n\n## One win\n\n## One lesson\n'],
  trip: ['Trip', '## Plan\n\n## Eat\n\n## See\n\n## Remember\n'], media: ['Book / movie', 'By: \nRating: /5\n\n## Notes\n\n## Highlights\n'], decision: ['Decision log', '## Decision\n\n## Options considered\n\n## Why this one\n\n## Expected outcome\n\n## Revisit on\n'], ideas: ['Ideas', '- \n- \n- '],
};
let q = '', filter = 'all';

export const dailyId = ds => '00000000-0000-4000-8000-' + ds.replace(/-/g, '').padStart(12, '0');
export function ensureDaily(ds = today()) {
  if (store.getAny(dailyId(ds))) return store.get(dailyId(ds));
  const d = new Date(ds + 'T12:00:00Z');
  return store.put('note', { title: ds, display: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }), body: TEMPLATES.journal[1], type: 'journal', daily: ds, tags: ['daily'] }, dailyId(ds));
}
const title = n => n.daily ? (n.display || n.title) : n.title || (n.body || '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || 'Untitled';
const backlinksOf = n => { const t = (n.title || '').toLowerCase(); if (!t) return []; return store.list('note', x => x.id !== n.id && (x.body || '').toLowerCase().includes(`[[${t}]]`)); };

export function newNote(type = 'plain', extra = {}) { return store.put('note', { title: '', body: TEMPLATES[type]?.[1] || '', type, tags: [], ...extra }); }

export default async function render(el, ctx) {
  ensureDaily();
  const id = ctx.rest[0];
  if (ctx.q.link && !ctx.soft) { const t = ctx.q.link.toLowerCase(); const hit = store.list('note').find(n => (n.title || '').toLowerCase() === t); const n = hit || newNote('plain', { title: ctx.q.link }); location.hash = '#/notes/' + n.id; return; }
  if (id === 'new') { const n = newNote(ctx.q.type || 'plain', ctx.q.work ? { tags: ['work'] } : {}); location.hash = '#/notes/' + n.id; return; }
  if (id === 'today') { location.hash = '#/notes/' + ensureDaily().id; return; }
  const narrow = innerWidth < 860;
  const wrap = h('div', { class: 'notes-grid' + (id ? ' has-note' : '') });
  el.append(wrap);
  const listPane = h('aside', { class: 'notes-list' }), ed = h('section', { class: 'notes-ed' });
  wrap.append(listPane, ed);

  // ---- list ----
  const search = h('input', { class: 'in', placeholder: 'Search notes…', value: q, 'aria-label': 'Search notes' });
  const listBox = h('div', {});
  const chips = h('div', { class: 'row wrap', style: { margin: '8px 0' } }, [['all', 'All'], ['pinned', 'Pinned'], ['archived', 'Archive']].map(([k, l]) => h('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; ctx.refresh(); } }, l)));
  listPane.append(h('div', { class: 'row' }, h('h1', { class: 'squig', style: { fontSize: '2rem' } }, 'Notes'), h('span', { class: 'grow' }), h('button', { class: 'btn sm', onclick: () => { location.hash = '#/notes/today'; } }, icon('calendar'), 'Today'), h('button', { class: 'btn sm primary', 'aria-label': 'New note', onclick: () => modal((d, close) => { d.append(h('h2', {}, 'New note'), h('div', { class: 'grid2' }, Object.entries(TEMPLATES).map(([k, [l]]) => h('button', { class: 'btn', onclick: () => { close(); const n = newNote(k); location.hash = '#/notes/' + n.id; } }, l))), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'))); }) }, icon('plus'))), search, chips, listBox);
  const paintList = async () => {
    let notes = store.list('note', n => inMode(n) && !n.archived === (filter !== 'archived') && (filter !== 'pinned' || n.pinned));
    if (q.trim().length > 1) { try { const r = await store.api('/api/search?q=' + encodeURIComponent(q)); const ids = new Set(r.filter(x => x.kind === 'note').map(x => x.id)); notes = notes.filter(n => ids.has(n.id)); } catch { const s = q.toLowerCase(); notes = notes.filter(n => ((n.title || '') + (n.body || '')).toLowerCase().includes(s)); } }
    notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated_at.localeCompare(a.updated_at));
    listBox.replaceChildren(...(notes.length ? notes.slice(0, 200).map(n => h('a', { class: 'note-row' + (n.id === id ? ' sel' : ''), href: '#/notes/' + n.id }, h('b', {}, iconSpan(n), title(n)), h('span', { class: 'meta' }, ago(n.updated_at), (n.tags || []).slice(0, 2).map(t => ' #' + t)), h('span', { class: 'snip' }, (n.body || '').replace(/[#*\[\]\-]/g, '').slice(0, 70)))) : [empty('notes', q ? 'Nothing found' : 'No notes yet', 'Press N, or tap +.')]));
  };
  search.addEventListener('input', debounce(() => { q = search.value; paintList(); }, 180)); paintList();

  // ---- editor ----
  const n = id && store.get(id);
  if (!n) { ed.append(empty('notes', 'Pick a note', 'Or write a new one — it saves as you type.')); return; }
  let mode = localStorage.getItem('notemode') || 'edit';
  const tin = h('input', { class: 'in note-title', value: n.daily ? (n.display || n.title) : n.title || '', placeholder: 'Title (optional)', 'aria-label': 'Title', oninput: debounce(e => store.put('note', { title: e.target.value }, id), 500) });
  if (n.daily) tin.readOnly = true;
  const body = h('textarea', { class: 'in note-body', value: n.body || '', 'aria-label': 'Note body', placeholder: 'Write… Markdown works: # heading, - list, - [ ] checklist, [[link to a note]]', oninput: debounce(e => store.put('note', { body: e.target.value }, id), 500) });
  const prev = h('div', { class: 'note-prev' }, mdToNodes(n.body));
  const tags = h('input', { class: 'in', value: (n.tags || []).join(', '), placeholder: 'Add tags (comma separated)', 'aria-label': 'Tags', style: { minHeight: '36px', fontSize: '1rem' }, onchange: e => store.put('note', { tags: e.target.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) }, id) });
  const insert = txt => { const s = body.selectionStart; body.setRangeText(txt, s, body.selectionEnd, 'end'); body.dispatchEvent(new Event('input')); body.focus(); };
  const attach = h('input', { type: 'file', class: 'hide', accept: 'image/*,application/pdf,text/plain', onchange: async () => { const f = attach.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { const r = await store.upload('/api/files', fd); insert(`\n${r.mime.startsWith('image/') ? '!' : ''}[${r.name}](/api/files/${r.id})\n`); toast('Attached'); } catch (e) { toast(e.message); } } });
  const show = m => { mode = m; localStorage.setItem('notemode', m); body.classList.toggle('hide', m !== 'edit'); prev.classList.toggle('hide', m === 'edit'); prev.replaceChildren(...mdToNodes(body.value)); tb.querySelectorAll('[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m))); };
  const assistFn = () => modal((d, close) => { d.append(h('h2', {}, 'Ask the assistant'), h('p', { class: 'muted small' }, 'You’ll see the result first; nothing is saved until you approve.'), h('div', { class: 'stack-s' }, [['summarise', 'Summarise'], ['tasks', 'Extract tasks'], ['cleanup', 'Clean up'], ['list', 'Turn into a list'], ['translate', 'Translate']].map(([k, l]) => h('button', { class: 'btn', style: { justifyContent: 'flex-start' }, onclick: async () => { close(); try { const j = await store.api('/api/ai/note-action', { method: 'POST', body: JSON.stringify({ action: k, text: body.value }) }); modal((d2, c2) => d2.append(h('h2', {}, l), h('div', { class: 'note-prev' }, mdToNodes(j.text)), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: c2 }, 'Discard'), h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(j.text); toast('Copied'); c2(); } }, 'Copy'), h('button', { class: 'btn', onclick: () => { insert('\n\n' + j.text + '\n'); c2(); } }, 'Append to note'), k === 'cleanup' ? h('button', { class: 'btn primary', onclick: () => { body.value = j.text; body.dispatchEvent(new Event('input')); show(mode); c2(); } }, 'Replace note') : '')), { wide: true }); } catch (e) { toast(e.message); } } }, l)))); });
  const dupFn = () => { const c = store.put('note', { title: (n.title ? n.title + ' (copy)' : ''), body: store.get(id).body, tags: n.tags || [], type: n.type || 'plain', icon: n.icon || null, cover: n.cover || null }); toast('Duplicated'); location.hash = '#/notes/' + c.id; } ;
  const delFn = async () => { if (await confirmBox('Delete this note?', 'You can undo for a few seconds, and it stays in version history on the server.', { ok: 'Delete', danger: true })) { store.del(id); location.hash = '#/notes'; toast('Note deleted', () => store.restore(id)); } };
  const kebab = h('button', { class: 'btn icon sm menu-btn', 'aria-label': 'More actions', onclick: () => menu(null, [
    { label: n.pinned ? 'Unpin from the top' : 'Pin to the top', icon: 'pin', run: () => store.put('note', { pinned: !n.pinned }, id) },
    { label: 'Ask the assistant…', icon: 'assistant', run: assistFn },
    { label: 'Icon & cover', icon: 'image', run: () => decorDialog(n, () => ctx.refresh()) },
    { label: 'Duplicate', icon: 'copy', run: dupFn }, { label: 'Earlier versions', icon: 'clock', run: () => history_(n) },
    { label: n.archived ? 'Unarchive' : 'Archive', icon: 'inbox', run: () => { store.put('note', { archived: !n.archived }, id); location.hash = '#/notes'; } },
    { label: 'Delete', icon: 'trash', danger: true, run: delFn }]) }, icon('dots'));
  const tb = h('div', { class: 'row', style: { margin: '8px 0' } }, narrow ? h('a', { class: 'btn icon sm ghost', href: '#/notes', 'aria-label': 'Back to notes' }, icon('chevL')) : '',
    h('div', { class: 'seg' }, h('button', { 'data-m': 'edit', onclick: () => show('edit') }, 'Write'), h('button', { 'data-m': 'view', onclick: () => show('view') }, 'Read')), h('span', { class: 'grow' }), kebab);
  const fmt = h('div', { class: 'fmtbar', role: 'toolbar', 'aria-label': 'Formatting' },
    h('button', { class: 'btn sm', title: 'Checklist', onclick: () => insert('\n- [ ] ') }, icon('check'), 'Task'), h('button', { class: 'btn sm', title: 'Heading', onclick: () => insert('\n## ') }, 'Heading'),
    h('button', { class: 'btn sm', title: 'Collapsible toggle', onclick: () => insert('\n::: toggle Title\nHidden text\n:::\n') }, icon('chevD'), 'Toggle'), h('button', { class: 'btn sm', title: 'Callout box', onclick: () => insert('\n> [!tip] Heads up\n> Say it here\n') }, icon('zap'), 'Callout'),
    h('button', { class: 'btn sm', title: 'Divider', onclick: () => insert('\n---\n') }, 'Line'), h('button', { class: 'btn sm', onclick: () => attach.click() }, icon('upload'), 'Attach'), attach);
  const bl = backlinksOf(n);
  ed.append(h('div', { class: 'card' }, coverStrip(n, { tall: true }), h('div', { class: 'row' }, iconSpan(n), h('div', { class: 'grow' }, tin)), tb, h('div', { style: { margin: '0 0 6px' } }, tags), fmt, body, prev, linksPanel(n, { onChange: () => ctx.refresh() }), bl.length ? h('div', { class: 'backlinks' }, h('div', { class: 'small muted' }, 'Linked from'), h('div', { class: 'row wrap' }, bl.map(b => h('a', { class: 'chip', href: '#/notes/' + b.id }, title(b))))) : ''));
  show(mode);
  if (n.type === 'plain' && !n.body && !n.title) setTimeout(() => body.focus(), 50);
}

function history_(n) {
  const vs = store.list('note_version', v => v.note === n.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  modal((d, close) => { d.append(h('h2', {}, 'Earlier versions'), vs.length ? h('div', { class: 'stack-s' }, vs.map(v => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'meta' }, ago(v.created_at)), h('div', { class: 'small' }, (v.body || '').slice(0, 120))), h('button', { class: 'btn sm', onclick: () => { store.put('note', { body: v.body }, n.id); close(); toast('Restored'); setTimeout(() => location.reload(), 300); } }, 'Restore')))) : h('p', { class: 'faint' }, 'No earlier versions yet. Each edit session keeps the last 20.'), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Close'))); }, { wide: true });
}
