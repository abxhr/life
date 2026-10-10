// Task domain logic shared by Today, Inbox, Tasks, Calendar and the capture sheet.
import { store } from './store.js';
import { cfg, today, localToUtc, addDays, nowIso, uid } from './util.js';
import { nextFuture } from './recur.js';

export const PRIO = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };
export const CTX = [['personal', 'Personal'], ['work', 'Work'], ['work-outside-work', 'Work, outside work'], ['errands', 'Errands'], ['home', 'Home']];

export function remindAt(t) { // -> UTC ISO or null, from due/due_time + t.remind rule
  if (!t.due || !t.remind || t.remind === 'none') return null;
  const time = t.due_time || '09:00';
  const base = localToUtc(t.due, time, cfg.tz).getTime();
  const off = { at: 0, '15': 15, '60': 60, '1d': 24 * 60 }[t.remind];
  if (off == null) return null;
  const at = t.remind === '1d' ? localToUtc(addDays(t.due, -1), '09:00', cfg.tz).getTime() : base - off * 60000;
  return new Date(at).toISOString();
}

export function fromParsed(p, extra = {}) {
  const t = { title: p.title || 'Untitled', due: p.due || null, due_time: p.time || null, priority: p.priority || 3, ctx: p.ctx || 'personal', tags: p.tags || [], project: p.project || null, recur: p.recur || null, done: false, ...extra };
  if (t.tags.includes('work') && t.ctx === 'personal') t.ctx = 'work';
  if (t.tags.includes('today') && !t.due) t.due = today();
  if (t.due_time) t.remind = 'at';
  t.remind_at = remindAt(t);
  return t;
}

export function saveTask(patch, id) {
  const cur = id ? store.get(id) : {};
  const m = { ...cur, ...patch };
  patch.remind_at = remindAt(m);
  patch.last_fired = null; patch.acked = false;
  return store.put('task', patch, id);
}

export function completeTask(t) {
  if (t.recur) { // recurring: roll to next occurrence, log this one
    const next = nextFuture(t.recur, t.due || today(), today(), { doneOn: today() });
    store.put('done_log', { task: t.id, title: t.title, ctx: t.ctx, at: nowIso(), day: today(), project: t.project });
    saveTask({ due: next, done: false }, t.id);
    return { rolled: next };
  }
  store.put('task', { done: true, done_at: nowIso(), remind_at: null }, t.id);
  store.put('done_log', { task: t.id, title: t.title, ctx: t.ctx, at: nowIso(), day: today(), project: t.project });
  return {};
}
export function uncomplete(t) { store.put('task', { done: false, done_at: null }, t.id); saveTask({}, t.id); }

export const subtask = title => ({ id: uid().slice(0, 8), title, done: false });
export function isOverdue(t) { return !t.done && t.due && t.due < today(); }
export function sortTasks(a, b) {
  return (a.due || '9999').localeCompare(b.due || '9999') || (a.due_time || '99').localeCompare(b.due_time || '99') || (a.priority || 3) - (b.priority || 3) || a.created_at.localeCompare(b.created_at);
}
export function projects() { return [...new Set(store.list('task').map(t => t.project).filter(Boolean))].sort(); }
