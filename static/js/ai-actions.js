// Applies assistant tool calls to the local store (after the user confirms), logs them, and can undo them.
import { store } from './store.js';
import { today, localToUtc, nowIso, cfg } from './util.js';
import { saveTask, completeTask, uncomplete } from './tasks-core.js';
import { setStatus } from './travel-data.js';
import { slotNow } from './mood.js';

const fmtWhen = i => [i.due || i.date, i.due_time || i.time || i.start].filter(Boolean).join(' ');
export function describe(name, i) {
  switch (name) {
    case 'create_task': return `Create task “${i.title}”${fmtWhen(i) ? ' · ' + fmtWhen(i) : ''}${i.priority && i.priority < 3 ? ' · priority ' + i.priority : ''}${i.project ? ' · ' + i.project : ''}`;
    case 'update_task': { const t = store.get(i.id); return `Update task “${t ? t.title : i.id}”: ${Object.entries(i).filter(([k]) => k !== 'id').map(([k, v]) => `${k} → ${v}`).join(', ')}`; }
    case 'complete_task': { const t = store.get(i.id); return `Mark “${t ? t.title : i.id}” done`; }
    case 'create_reminder': return `Remind you “${i.title}” · ${i.date} ${i.time || '09:00'}${i.critical ? ' (critical)' : ''}`;
    case 'create_event': return `Add event “${i.title}” · ${i.date}${i.start ? ' ' + i.start : ''}${i.end ? '–' + i.end : ''}`;
    case 'add_note': return `Save note${i.title ? ' “' + i.title + '”' : ''}: ${(i.body || '').slice(0, 80)}`;
    case 'add_list_item': return `Add “${i.title}” to ${i.list}`;
    case 'log_mood': return `Log mood ${i.mood ?? '–'}/5, energy ${i.energy ?? '–'}/5`;
    case 'mark_visited': return `Mark ${i.country} as visited${i.start ? ' · ' + i.start : ''}`;
    case 'create_trip': return `Plan trip “${i.name}”${i.start ? ' · ' + i.start : ''}`;
    case 'remember': return `Remember: ${i.text}`;
  }
  return name;
}

// returns {ok, summary, created: [ids], prev: {id: {field: old}}, completed: [ids]}
export function apply(name, i) {
  const created = [], prev = {}, completed = [];
  try {
    switch (name) {
      case 'create_task': {
        const t = saveTask({ title: i.title, due: i.due || null, due_time: i.due_time || null, priority: i.priority || 3, ctx: i.context || 'personal', notes: i.notes || '', project: i.project || null, tags: [], done: false, remind: i.due_time ? 'at' : 'none', source: 'assistant' });
        created.push(t.id); return { ok: true, summary: `Created task “${i.title}”`, created, prev, completed, id: t.id };
      }
      case 'update_task': {
        const t = store.get(i.id); if (!t) return { ok: false, summary: 'That task no longer exists.' };
        const patch = {}; for (const k of ['title', 'due', 'due_time', 'priority', 'notes']) if (i[k] !== undefined) { prev[i.id] = { ...(prev[i.id] || {}), [k]: t[k] ?? null }; patch[k] = i[k]; }
        saveTask(patch, i.id); return { ok: true, summary: `Updated “${t.title}”`, created, prev, completed };
      }
      case 'complete_task': { const t = store.get(i.id); if (!t) return { ok: false, summary: 'That task no longer exists.' }; completeTask(t); completed.push(t.id); return { ok: true, summary: `Marked “${t.title}” done`, created, prev, completed }; }
      case 'create_reminder': { const r = store.put('reminder', { title: i.title, remind_at: localToUtc(i.date, i.time || '09:00', cfg.tz).toISOString(), critical: !!i.critical, source: 'assistant' }); created.push(r.id); return { ok: true, summary: `Reminder set for ${i.date} ${i.time || '09:00'}`, created, prev, completed }; }
      case 'create_event': { const e = store.put('event', { title: i.title, date: i.date, start: i.start || null, end: i.end || null, allday: !i.start, loc: i.location || '', ctx: 'personal', source: 'assistant' }); created.push(e.id); return { ok: true, summary: `Added “${i.title}” on ${i.date}`, created, prev, completed }; }
      case 'add_note': { const n = store.put('note', { title: i.title || '', body: i.body, tags: i.tags || [], type: 'plain', source: 'assistant' }); created.push(n.id); return { ok: true, summary: 'Note saved', created, prev, completed, id: n.id }; }
      case 'add_list_item': {
        const q = (i.list || '').toLowerCase(), l = store.list('list').find(x => x.name.toLowerCase() === q) || store.list('list').find(x => x.name.toLowerCase().includes(q));
        if (!l) return { ok: false, summary: `No list called “${i.list}”. Create it first.` };
        const it = store.put('list_item', { list: l.id, title: i.title, notes: i.notes || '', status: undefined, order: Date.now(), source: 'assistant' }); created.push(it.id); return { ok: true, summary: `Added to ${l.name}`, created, prev, completed };
      }
      case 'log_mood': { const T = today(), slot = slotNow(), cur = store.list('mood_log', x => x.day === T && (x.slot || 'day') === slot)[0]; if (cur) prev[cur.id] = { mood: cur.mood ?? null, energy: cur.energy ?? null, note: cur.note ?? null }; const r = store.put('mood_log', { day: T, slot, mood: i.mood ?? cur?.mood, energy: i.energy ?? cur?.energy, note: i.note || cur?.note || '', at: nowIso() }, cur?.id); if (!cur) created.push(r.id); return { ok: true, summary: 'Mood logged', created, prev, completed }; }
      case 'mark_visited': { const a2 = (i.country || '').toUpperCase().slice(0, 2); const v = store.put('visit', { country: a2, start: i.start || null, end: i.end || i.start || null, what: i.notes || '', source: 'assistant' }); created.push(v.id); setStatus(a2, 'been'); return { ok: true, summary: `Marked ${a2} as visited`, created, prev, completed }; }
      case 'create_trip': { const t = store.put('trip', { name: i.name, start: i.start || null, end: i.end || i.start || null, countries: (i.countries || []).map(c => c.toUpperCase()), status: 'planned', currency: cfg.currency, source: 'assistant' }); created.push(t.id); return { ok: true, summary: `Trip “${i.name}” created`, created, prev, completed, id: t.id }; }
      case 'remember': { const m = store.put('assistant_memory', { text: i.text }); created.push(m.id); return { ok: true, summary: 'Remembered', created, prev, completed }; }
    }
  } catch (e) { return { ok: false, summary: 'Couldn’t do that: ' + e.message }; }
  return { ok: false, summary: 'Unknown action' };
}
export function undo(a) {
  (a.created || []).forEach(id => store.del(id));
  Object.entries(a.prev || {}).forEach(([id, p]) => { const k = store.getAny(id)?.kind || 'task'; if (k === 'task') saveTask(p, id); else store.put(k, p, id); });
  (a.completed || []).forEach(id => { const t = store.getAny(id); if (t) uncomplete(t); });
}
