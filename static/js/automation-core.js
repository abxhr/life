// Pure automation logic (no store, no DOM) so it can be unit-tested.
export const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const has = (hay, needle) => !needle || String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
export function triggerMatches(a, ev) {
  const t = a.trigger || {};
  if (!a.enabled || t.type !== ev.type) return false;
  if (ev.type === 'task_done') return has(ev.rec.project, t.project) && (!t.tag || (ev.rec.tags || []).includes(t.tag)) && (!t.context || ev.rec.ctx === t.context);
  if (ev.type === 'item_status') return (!t.to || ev.rec.status === t.to) && has(ev.listName, t.list);
  return false;
}
// schedule: due when the time has passed on a matching day and it hasn't run on that date yet
export function scheduleDue(a, now, lastRun) {
  const t = a.trigger || {}; if (!a.enabled || t.type !== 'schedule' || lastRun === now.date) return false;
  if (now.time < (t.time || '08:00')) return false;
  if (t.freq === 'weekly') return now.dow === (t.dow ?? 1);
  if (t.freq === 'monthly') return now.dom === (t.dom ?? 1);
  return true;   // daily
}

