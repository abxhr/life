// Import / export beyond the full-backup zip: tasks as CSV, notes from Markdown files. Your data is never locked in.
import { h, today } from './util.js';
import { store } from './store.js';
import { toast, confirmBox } from './ui.js';
import { parseCSV, toCSV } from './csv.js';
import { saveTask } from './tasks-core.js';

const download = (name, text, type) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
export function exportTasksCSV() {
  const rows = store.list('task').sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).map(t => [t.title, t.due, t.due_time, ({ 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' })[t.priority || 3], t.ctx, t.project, (t.tags || []).join('; '), t.done ? 'yes' : '', t.notes, t.recur ? JSON.stringify(t.recur) : '']);
  download('life-tasks.csv', '﻿' + toCSV(['Title', 'Due', 'Time', 'Priority', 'Context', 'Project', 'Tags', 'Done', 'Notes', 'Repeat'], rows), 'text/csv'); toast(`Exported ${rows.length} tasks`);
}
export function importTasksCSV() {
  const f = h('input', { type: 'file', accept: '.csv,text/csv', onchange: async () => {
    const rows = parseCSV(await f.files[0].text()); if (rows.length < 2) return toast('That CSV has no rows');
    const H = rows[0].map(x => x.toLowerCase().trim()), col = n => H.indexOf(n), P = { urgent: 1, high: 2, medium: 3, med: 3, low: 4 };
    if (col('title') < 0 && col('name') < 0) return toast('Needs a “Title” column');
    const body = rows.slice(1).filter(r => (r[col('title') >= 0 ? col('title') : col('name')] || '').trim());
    if (!(await confirmBox(`Import ${body.length} task(s)?`, 'Columns used: ' + ['title', 'due', 'time', 'priority', 'context', 'project', 'tags', 'done', 'notes'].filter(c => col(c) >= 0 || (c === 'title' && col('name') >= 0)).join(', ') + '.', { ok: 'Import' }))) return;
    body.forEach(r => { const g = n => (col(n) >= 0 ? (r[col(n)] || '').trim() : ''); saveTask({ title: g('title') || g('name'), due: /^\d{4}-\d{2}-\d{2}$/.test(g('due')) ? g('due') : null, due_time: /^\d{1,2}:\d{2}$/.test(g('time')) ? g('time').padStart(5, '0') : null, priority: P[g('priority').toLowerCase()] || 3, ctx: g('context') || 'personal', project: g('project') || null, tags: g('tags').split(/[;,]/).map(s => s.trim()).filter(Boolean), done: /^(yes|true|1|x)$/i.test(g('done')), notes: g('notes') }); });
    toast(`Imported ${body.length} tasks`);
  } });
  f.click();
}
export function importMarkdownNotes() {
  const f = h('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: true, onchange: async () => {
    let n = 0; for (const file of f.files) { const text = await file.text(); const m = /^#\s+(.+)\n?/.exec(text); store.put('note', { title: m ? m[1].trim() : file.name.replace(/\.(md|markdown|txt)$/i, ''), body: m ? text.slice(m[0].length) : text, type: 'plain', tags: ['imported'] }); n++; }
    toast(`Imported ${n} note${n === 1 ? '' : 's'}`);
  } });
  f.click();
}
