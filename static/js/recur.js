// Recurrence: next due date after a given one. Dates are plain 'YYYY-MM-DD' in the user's timezone,
// so DST can't shift them; times are applied later via localToUtc (DST-aware). Month-ends clamp (31 Jan -> 28/29 Feb -> 31 Mar).
import { addDays, addMonths, dow, diffDays } from './util.js';

export function nextDue(rule, due, { doneOn, anchorDay } = {}) {
  if (!rule) return null;
  const base = rule.after ? (doneOn || due) : due;          // "after completion" counts from the day it was done
  const n = rule.interval || 1;
  switch (rule.freq) {
    case 'day': return addDays(base, n);
    case 'week': {
      if (rule.byday && rule.byday.length) {
        const set = [...rule.byday].sort((a, b) => a - b);
        let d = base; // next listed weekday strictly after base; wrap by `n` weeks from the week of base
        for (let i = 1; i <= 7; i++) { const c = addDays(base, i); if (set.includes(dow(c))) { d = c; break; } }
        if (n > 1) { const wkStart = x => addDays(x, -((dow(x) + 6) % 7)); if (diffDays(wkStart(base), wkStart(d)) > 0) d = addDays(d, 7 * (n - 1)); }
        return d;
      }
      return addDays(base, 7 * n);
    }
    case 'month': { const r = addMonths(base, n); const want = anchorDay || +due.slice(8); const [y, m] = r.split('-'); const last = new Date(Date.UTC(+y, +m, 0)).getUTCDate(); return `${y}-${m}-${String(Math.min(want, last)).padStart(2, '0')}`; }
    case 'year': return addMonths(base, 12 * n);
  }
  return null;
}
// skip any occurrences already in the past (e.g. a task left for a month)
export function nextFuture(rule, due, today, opt) { let d = nextDue(rule, due, opt), g = 0; while (d && d <= today && !rule.after && g++ < 400) d = nextDue(rule, d, opt); return d; }
