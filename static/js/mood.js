// Mood & energy check-in: one tap each, optional emotion tags and a line. One log per day, or per slot if prompts are on.
import { h, today, timeIn } from './util.js';
import { store } from './store.js';
import { toast } from './ui.js';

export const EMOTIONS = ['calm', 'anxious', 'motivated', 'tired', 'grateful', 'stressed', 'bored', 'social', 'lonely', 'happy', 'irritable', 'focused'];
export const LABEL = ['', 'rough', 'low', 'okay', 'good', 'great'];
export const slotNow = () => { const s = window.__settings || {}; if (!s.mood_prompts) return 'day'; const H = +timeIn().slice(0, 2); return H < 12 ? 'morning' : H < 18 ? 'afternoon' : 'evening'; };

let moodOpen = false;   // keep the extras open across re-renders while you tap through them
export function moodCard({ compact } = {}) {
  const T = today(), slot = slotNow(), cur = store.list('mood_log', x => x.day === T && (x.slot || 'day') === slot)[0];
  const save = p => store.put('mood_log', { day: T, slot, ...p, at: new Date().toISOString() }, cur?.id);
  const rate = (label, key) => h('div', { class: 'row wrap' }, h('span', { class: 'small muted', style: { width: '56px' } }, label), [1, 2, 3, 4, 5].map(n => h('button', { class: 'chip' + (cur && cur[key] === n ? ' on' : ''), 'aria-label': `${label} ${n}, ${LABEL[n]}`, 'aria-pressed': String(!!cur && cur[key] === n), title: LABEL[n], onclick: () => save({ [key]: n }) }, n)));
  const tags = h('div', { class: 'row wrap' }, EMOTIONS.map(t => h('button', { class: 'chip' + ((cur?.tags || []).includes(t) ? ' on' : ''), onclick: e => { const set = new Set(store.list('mood_log', x => x.id === cur?.id)[0]?.tags || cur?.tags || []); set.has(t) ? set.delete(t) : set.add(t); save({ tags: [...set] }); } }, t)));
  const note = h('input', { class: 'in', placeholder: 'One line (optional)…', value: cur?.note || '', 'aria-label': 'Mood note', onchange: e => { save({ note: e.target.value }); toast('Noted'); } });
  const card = h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, slot === 'day' ? 'How are you?' : `How are you this ${slot}?`), cur ? h('span', { class: 'count' }, 'logged') : ''), rate('Mood', 'mood'));
  card.append(h('details', { open: !compact || moodOpen, ontoggle: e => { if (compact) moodOpen = e.target.open; } }, h('summary', { class: 'small muted', style: { cursor: 'pointer', margin: '6px 0' } }, 'Energy, feelings, a note'), rate('Energy', 'energy'), tags, note));
  return card;
}
