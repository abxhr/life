// Focus / deep-work mode: hides everything except the one task and a timer; logs focused minutes per task.
import { h, today, nowIso } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { toast } from './ui.js';
import { completeTask } from './tasks-core.js';

export function openFocus(taskId) {
  let t = taskId ? store.get(taskId) : null;
  if (!t) { const T = today(); t = store.list('task', x => !x.done && !x.someday && (x.due === T || x.one_day === T)).sort((a, b) => (a.priority || 3) - (b.priority || 3))[0] || null; }
  const wrap = h('div', { class: 'focus', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Focus mode' });
  let mins = 25, left = mins * 60, timer = null, started = null, spent = 0;
  const clock = h('div', { class: 'focus-clock', 'aria-live': 'off' }), title = h('div', { class: 'focus-title' }, t ? t.title : 'Deep work');
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, paint = () => { clock.textContent = fmt(left); document.title = (timer ? fmt(left) + ' · ' : '') + 'Focus · Life'; };
  const log = () => { if (spent >= 60) { const m = Math.round(spent / 60); store.put('focus_session', { task: t?.id || null, title: t?.title || 'Deep work', minutes: m, day: today(), at: nowIso(), project: t?.project || null }); toast(`${m} focused minute${m > 1 ? 's' : ''} logged`); } spent = 0; };
  const stop = () => { clearInterval(timer); timer = null; };
  const tick = () => { left--; spent++; if (left <= 0) { stop(); log(); try { new Notification('Focus block done'); } catch { /* not allowed */ } toggle.textContent = 'Start again'; left = mins * 60; } paint(); };
  const toggle = h('button', { class: 'btn primary', onclick: () => { if (timer) { stop(); log(); toggle.textContent = 'Resume'; } else { timer = setInterval(tick, 1000); toggle.textContent = 'Pause'; } paint(); } }, 'Start');
  const len = h('div', { class: 'row', style: { justifyContent: 'center' } }, [15, 25, 50].map(m => h('button', { class: 'chip', onclick: () => { if (timer) return; mins = m; left = m * 60; paint(); } }, m + ' min')));
  const close = () => { stop(); log(); wrap.remove(); document.removeEventListener('keydown', key); document.title = 'Life'; };
  const key = e => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', key);
  wrap.append(h('button', { class: 'btn ghost focus-x', 'aria-label': 'Leave focus mode', onclick: close }, icon('x'), 'Leave'), h('div', { class: 'focus-in' }, h('div', { class: 'small' }, 'One thing'), title, clock, len, h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } }, toggle, t ? h('button', { class: 'btn', onclick: () => { completeTask(t); toast('Done. Nice.'); close(); } }, icon('check'), 'Done') : '')));
  document.body.append(wrap); paint(); toggle.focus();
}
