// Inbox: triage one card at a time. Heuristic proposal (AI proposal is added in the assistant phase).
import { h, today, niceDate, fmtTime, ago } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast, empty, modal, field } from '../ui.js';
import { inMode } from '../state.js';
import { fromParsed, saveTask } from '../tasks-core.js';
import { parse, recLabel } from '../nlp.js';

export const propose = it => {
  if (it.link) return 'note'; const p = it.parsed || {};
  if (p.due || p.recur || p.priority || p.ctx === 'work' || p.project) return 'task';
  if ((it.text || '').length > 140 || (it.text || '').includes('\n')) return 'note';
  return 'task';
};
const DEST = [['task', 'Task', 'tasks'], ['note', 'Note', 'notes'], ['list', 'List item', 'lists'], ['reminder', 'Reminder', 'bell'], ['goal', 'Goal', 'goals']];

export function triage(it, dest) {
  const p = it.parsed || parse(it.text);
  const q = { title: p.title || it.text, due: p.due, time: p.time, recur: p.recur, ctx: p.ctx || it.context, priority: p.priority, project: p.project, tags: p.tags || [] };
  if (dest === 'task') saveTask(fromParsed({ ...q, title: it.text }));
  else if (dest === 'reminder') store.put('reminder', { title: it.text, remind_at: q.due ? new Date().toISOString() : new Date(Date.now() + 3600e3).toISOString(), due: q.due });
  else if (dest === 'note') store.put('note', { title: it.link ? it.text : '', body: it.link ? `[${it.text}](${it.link})\n\n${it.desc || ''}` : it.text, tags: q.tags, type: it.link ? 'link' : 'plain' });
  else if (dest === 'goal') store.put('goal', { title: it.text, why: '', status: 'active', area: 'fun' });
  store.del(it.id);
}

export default function render(el, ctx) {
  const items = store.list('inbox').filter(inMode).sort((a, b) => (a.snoozed || 0) - (b.snoozed || 0) || a.created_at.localeCompare(b.created_at));
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Inbox'), h('span', { class: 'sub' }, items.length ? `${items.length} to sort` : 'all clear')));
  if (!items.length) { el.append(empty('inbox', 'Inbox zero', 'Anything you capture lands here until you sort it. Press C anywhere.')); return; }
  const it = items[0], prop = propose(it), p = it.parsed || {};
  const act = (dest, label) => h('button', { class: 'btn' + (dest === prop ? ' primary' : ''), onclick: () => { triage(it, dest); toast(label + ' ✓'); } }, icon(DEST.find(d => d[0] === dest)[2]), label);
  const card = h('div', { class: 'card taped rise', style: { maxWidth: '640px', padding: '28px' } },
    h('div', { class: 'small faint' }, `${ago(it.created_at)} · via ${it.source || 'app'}`),
    h('p', { class: 'hero-line', style: { fontSize: '2.2rem', margin: '10px 0' } }, it.text),
    it.link ? h('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer' }, it.link) : '',
    h('div', { class: 'parsed' }, p.due ? h('span', { class: 'chip' }, icon('calendar', 'mini'), niceDate(p.due) + (p.time ? ' ' + fmtTime(p.time) : '')) : '', p.recur ? h('span', { class: 'chip' }, recLabel(p.recur)) : '', p.project ? h('span', { class: 'chip' }, '+' + p.project) : '', (p.tags || []).map(t => h('span', { class: 'chip' }, '#' + t))),
    h('p', { class: 'muted small sp-t' }, 'I’d make this a ' + DEST.find(d => d[0] === prop)[1].toLowerCase() + '. One tap to confirm, or choose another:'),
    h('div', { class: 'row wrap' }, DEST.map(([d, l]) => act(d, l))),
    h('div', { class: 'row sp-t' }, h('button', { class: 'btn ghost', onclick: () => { store.put('inbox', { snoozed: Date.now() }, it.id); } }, 'Later'), h('button', { class: 'btn ghost danger', onclick: () => { store.del(it.id); toast('Deleted', () => store.restore(it.id)); } }, icon('trash'), 'Delete'), h('span', { class: 'grow' }), h('span', { class: 'faint small' }, 'keys 1–5 · Del')));
  el.append(card);
  if (!it.link && window.__settings) store.api('/api/ai/triage', { method: 'POST', body: JSON.stringify({ text: it.text }) }).then(j => { const m = { task: 'task', note: 'note', list_item: 'list', reminder: 'reminder', goal: 'goal' }[j && j.dest]; if (m && m !== prop && card.isConnected) { card.querySelectorAll('.row.wrap .btn').forEach((b, k) => b.classList.toggle('primary', DEST[k][0] === m)); const note = card.querySelector('p.muted.small'); if (note) note.textContent = 'The assistant suggests a ' + DEST.find(d => d[0] === m)[1].toLowerCase() + (j.reason ? ' (' + j.reason + ')' : '') + '. One tap to confirm, or choose another:'; } }).catch(() => {});
  if (items.length > 1) el.append(h('p', { class: 'muted sp-t' }, `Then ${items.length - 1} more: ` + items.slice(1, 4).map(i => i.text.slice(0, 28)).join(' · ')));
  const key = e => { if (/^(INPUT|TEXTAREA)/.test(document.activeElement.tagName) || document.querySelector('.scrim')) return; const n = '12345'.indexOf(e.key); if (n >= 0) { triage(it, DEST[n][0]); toast(DEST[n][1] + ' ✓'); } else if (e.key === 'Delete' || e.key === 'Backspace') { store.del(it.id); toast('Deleted', () => store.restore(it.id)); } };
  document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
}
