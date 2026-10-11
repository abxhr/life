// The capture sheet: one box, parsed live into removable chips, lands in Inbox (or straight to a task).
import { h, debounce } from './util.js';
import { icon } from './icons.js';
import { modal, toast } from './ui.js';
import { parse } from './nlp.js';
import { store } from './store.js';
import { fromParsed, saveTask } from './tasks-core.js';
import { state } from './state.js';
import { micButton, canRecord } from './voice.js';

const URLRE = /^https?:\/\/\S+$/i;

export function openCapture(prefill = '') {
  modal((d, close) => {
    const inp = h('input', { class: 'in cap-input', placeholder: 'What’s on your mind?', 'aria-label': 'Capture', value: prefill, autocomplete: 'off', enterkeyhint: 'done', autofocus: true });
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
    const mic = canRecord() ? micButton(t => { inp.value = (inp.value + ' ' + t).trim(); paint(); }) : '';
    const tellAi = h('button', { class: 'btn', onclick: () => { const t = inp.value.trim(); close(true); import('./chat.js').then(m => m.openAssistant(null, t)); } }, icon('assistant'), 'Assistant');
    const toLists = h('button', { class: 'btn', title: 'Paste a link or caption (Instagram, TikTok…): the place or film is filed into the right list', onclick: async e => {
      const t = inp.value.trim(), b = e.currentTarget; if (!t) return inp.focus();
      b.disabled = true; b.lastChild.textContent = 'Reading…';
      try { const j = await store.api('/api/share-in', { method: 'POST', body: JSON.stringify({ text: t }) }); close(true); toast(j.message); store.sync(); }
      catch { b.disabled = false; b.lastChild.textContent = 'To lists'; toast('Couldn’t reach the server — try again online'); }
    } }, icon('lists'), 'To lists');
    const pasteBtn = navigator.clipboard && navigator.clipboard.readText ? h('button', { class: 'btn icon', 'aria-label': 'Paste from clipboard', title: 'Paste', onclick: async () => {
      try { const t = (await navigator.clipboard.readText()).trim(); if (!t) return toast('The clipboard is empty'); inp.value = t; paint(); inp.focus(); if (/https?:\/\//.test(t) || t.length > 80) toLists.classList.add('primary'); }
      catch { toast('Allow pasting, or press and hold the box and tap Paste'); } } }, icon('copy')) : '';
    inp.style.flex = '1'; inp.style.minWidth = '0';
    d.append(h('h2', {}, 'Capture'), h('div', { class: 'row', style: { flexWrap: 'nowrap', alignItems: 'flex-end' } }, inp, pasteBtn, mic), h('p', { class: 'faint small', style: { margin: '4px 0 0' } }, 'Dates, #tags, @places and !priority are picked up as you type. Paste an Instagram link or caption and tap “To lists”.'), chips,
      h('p', { class: 'faint small kbd-hint', style: { margin: '2px 0 0' } }, h('kbd', {}, 'Enter'), ' inbox · ', h('kbd', {}, 'Ctrl+Enter'), ' task'),
      h('div', { class: 'actions cap-actions' },
        tellAi, toLists, h('button', { class: 'btn', onclick: () => save(true) }, icon('tasks'), 'Make task'), h('button', { class: 'btn primary', onclick: () => save(false) }, icon('inbox'), 'To inbox')));
    paint();
  }, { label: 'Capture' });
}

async function linkMeta(id, url) {
  try { const j = await store.api('/api/linkmeta?url=' + encodeURIComponent(url)); if (j.title) store.put('inbox', { text: j.title, desc: j.desc || '' }, id); } catch { /* offline: keep bare URL */ }
}
