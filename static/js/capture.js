// The capture sheet: one box, parsed live into removable chips, lands in Inbox (or straight to a task).
import { h, debounce } from './util.js';
import { icon } from './icons.js';
import { modal, toast } from './ui.js';
import { parse } from './nlp.js';
import { store } from './store.js';
import { fromParsed, saveTask } from './tasks-core.js';
import { state } from './state.js';

const URLRE = /^https?:\/\/\S+$/i;

export function openCapture(prefill = '') {
  modal((d, close) => {
    const inp = h('input', { class: 'in cap-input', placeholder: 'What’s on your mind?  “call mum tomorrow 3pm #family !high”', 'aria-label': 'Capture', value: prefill, autocomplete: 'off', enterkeyhint: 'done', autofocus: true });
    const chips = h('div', { class: 'parsed', 'aria-live': 'polite' });
    let p = parse(prefill), dropped = new Set();
    const paint = () => {
      p = parse(inp.value); chips.replaceChildren();
      if (URLRE.test(inp.value.trim())) { chips.append(h('span', { class: 'chip dom', style: { '--dom': 'var(--d-notes)' } }, icon('link'), 'saved as a link')); return; }
      p.chips.forEach(c => { if (dropped.has(c.label)) return; chips.append(h('span', { class: 'chip on' }, c.label, h('button', { class: 'x', 'aria-label': 'Remove ' + c.label, onclick: () => { dropped.add(c.label); drop(c); paint(); } }, '×'))); });
      if (!p.chips.length && inp.value) chips.append(h('span', { class: 'faint small' }, 'Plain note — I’ll sort it with you in Inbox.'));
    };
    const drop = c => { // removing a chip = keep that text as part of the title instead of interpreting it
      inp.value = inp.value; // title keeps the raw words; handled in `result()` by ignoring dropped kinds
    };
    const result = () => {
      const q = { ...p }; for (const c of p.chips) if (dropped.has(c.label)) { if (c.kind === 'date') q.due = null; if (c.kind === 'time') q.time = null; if (c.kind === 'recur') q.recur = null; if (c.kind === 'ctx') q.ctx = null; if (c.kind === 'prio') q.priority = null; if (c.kind === 'project') q.project = null; if (c.kind === 'tag') q.tags = q.tags.filter(t => '#' + t !== c.label); }
      return q;
    };
    const save = async asTask => {
      const text = inp.value.trim(); if (!text) return;
      const q = result();
      if (state.mode === 'work' && !q.ctx) q.ctx = 'work';
      if (URLRE.test(text)) { const rec = store.put('inbox', { text, link: text, source: 'app' }); close(true); toast('Saved the link'); linkMeta(rec.id, text); return; }
      if (asTask) { saveTask(fromParsed(q), undefined); toast('Task added'); }
      else { store.put('inbox', { text: q.title || text, raw: text, parsed: { due: q.due, time: q.time, recur: q.recur, ctx: q.ctx, priority: q.priority, project: q.project, tags: q.tags }, source: 'app' }); toast('In your inbox'); }
      close(true);
    };
    inp.addEventListener('input', paint);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(e.ctrlKey || e.metaKey); } });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = SR ? h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Dictate', onclick: () => { const r = new SR(); r.lang = 'en-GB'; r.onresult = e => { inp.value = (inp.value + ' ' + e.results[0][0].transcript).trim(); paint(); }; r.onerror = () => toast('Couldn’t hear that'); r.start(); mic.classList.add('primary'); r.onend = () => mic.classList.remove('primary'); } }, icon('mic')) : '';
    d.append(h('h2', {}, 'Capture'), inp, chips,
      h('div', { class: 'actions' }, mic, h('span', { class: 'faint small grow' }, h('kbd', {}, 'Enter'), ' inbox · ', h('kbd', {}, 'Ctrl+Enter'), ' task'),
        h('button', { class: 'btn', onclick: () => save(true) }, icon('tasks'), 'Make task'), h('button', { class: 'btn primary', onclick: () => save(false) }, icon('inbox'), 'To inbox')));
    paint();
  }, { label: 'Capture' });
}

async function linkMeta(id, url) {
  try { const j = await store.api('/api/linkmeta?url=' + encodeURIComponent(url)); if (j.title) store.put('inbox', { text: j.title, desc: j.desc || '' }, id); } catch { /* offline: keep bare URL */ }
}
