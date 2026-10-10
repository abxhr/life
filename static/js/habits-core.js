// Habit logic: due-ness and streaks with a forgiving "streak shield" (one single-day miss is bridged per streak).
import { store } from './store.js';
import { today, addDays } from './util.js';

export const logsFor = id => new Set(store.list('habit_log', l => l.habit === id).map(l => l.day));
export function streak(h, logs = logsFor(h.id), T = today()) {
  if (h.freq === 'weekly') return weeklyStreak(h, logs, T);
  let d = logs.has(T) ? T : addDays(T, -1), n = 0, shield = true;
  while (n < 3650) {
    if (logs.has(d)) { n++; d = addDays(d, -1); }
    else if (shield && logs.has(addDays(d, -1))) { shield = false; d = addDays(d, -1); }   // forgive one lone miss
    else break;
  }
  return n;
}
function weeklyStreak(h, logs, T) { // consecutive weeks (Mon-Sun) that hit the target
  const per = h.per_week || 3; let n = 0, ws = addDays(T, -((new Date(T + 'T12:00:00Z').getUTCDay() + 6) % 7));
  for (let w = 0; w < 520; w++) { let c = 0; for (let i = 0; i < 7; i++) if (logs.has(addDays(ws, i))) c++; if (c >= per) n++; else if (w > 0) break; ws = addDays(ws, -7); }
  return n;
}
export function toggleHabit(h, day = today()) {
  const ex = store.list('habit_log', l => l.habit === h.id && l.day === day)[0];
  if (ex) store.del(ex.id); else store.put('habit_log', { habit: h.id, day });
  return !ex;
}
export const doneOn = (h, day = today()) => store.list('habit_log', l => l.habit === h.id && l.day === day).length > 0;
export function weekCount(h, T = today()) { const ws = addDays(T, -((new Date(T + 'T12:00:00Z').getUTCDay() + 6) % 7)); const logs = logsFor(h.id); let c = 0; for (let i = 0; i < 7; i++) if (logs.has(addDays(ws, i))) c++; return c; }
