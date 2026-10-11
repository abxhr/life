// Chat panel used by the Assistant page and the Ctrl/Cmd+J sheet. Streams text; mutating tool calls arrive as confirm cards.
import { h, clear, nowIso } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, toast, field } from './ui.js';
import { describe, apply } from './ai-actions.js';
import { micButton, canRecord } from './voice.js';

const REF = /\[ref:(\w+):([\w-]+)\]/g;
const REFHREF = { task: id => '#/tasks?edit=' + id, note: id => '#/notes/' + id, goal: () => '#/goals', trip: id => '#/travel/t/' + id, list: id => '#/lists/' + id };
export function renderText(t) {
  const out = []; let i = 0, m; REF.lastIndex = 0;
  while ((m = REF.exec(t))) { if (m.index > i) out.push(t.slice(i, m.index)); const hf = (REFHREF[m[1]] || (() => '#/today'))(m[2]); out.push(h('a', { class: 'chip', href: hf, style: { margin: '0 2px' } }, icon('link', 'mini'), m[1])); i = REF.lastIndex; }
  if (i < t.length) out.push(t.slice(i)); return out;
}

export function chatPanel({ getContext, compact } = {}) {
  let api = [], view = [], busy = false, convId = null, doneResults = [], pending = null, tier = 'chat';
  const list = h('div', { class: 'chat-list', 'aria-live': 'polite' }), input = h('textarea', { class: 'in chat-in', rows: 1, placeholder: 'Ask or tell me…', 'aria-label': 'Message the assistant' });
  const send = h('button', { class: 'btn primary', 'aria-label': 'Send', onclick: () => go() }, icon('send'));
  const status = h('div', { class: 'faint small', style: { minHeight: '1.4em' } });
  const mic = canRecord() ? micButton(t => { input.value = (input.value + ' ' + t).trim(); status.textContent = 'Thinking…'; store.api('/api/ai/route', { method: 'POST', body: JSON.stringify({ text: input.value }) }).then(j => { tier = j.tier || 'chat'; }).catch(() => {}).finally(go); }) : '';
  const root = h('div', { class: 'chat' + (compact ? ' compact' : '') }, list, status, h('div', { class: 'row', style: { alignItems: 'flex-end' } }, mic, input, send));

  const persist = () => { const t = (view.find(v => v.role === 'user')?.text || 'Chat').slice(0, 50); const r = store.put('assistant_conversation', { title: t, api: JSON.stringify(api), view: JSON.stringify(view.map(v => ({ role: v.role, text: v.text, notes: v.notes }))) }, convId || undefined); convId = r.id; };
  const bubble = (role, text) => { const b = h('div', { class: 'bubble ' + role }, role === 'assistant' ? renderText(text) : text); return b; };
  const paint = () => { clear(list); view.forEach(v => { if (v.card) list.append(v.card); else list.append(v.el = bubble(v.role, v.text)); }); list.scrollTop = list.scrollHeight; };
  const addAssistantShell = () => { const v = { role: 'assistant', text: '' }; view.push(v); v.el = bubble('assistant', ''); list.append(v.el); return v; };

  async function run() {
    busy = true; send.disabled = true; status.textContent = 'Thinking…';
    const cur = addAssistantShell();
    try {
      await store.stream('/api/ai/chat', { messages: api, context: getContext ? getContext() : null, tier }, ev => {
        if (ev.type === 'text') { cur.text += ev.delta; const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80; cur.el.replaceChildren(...renderText(cur.text)); if (near) list.scrollTop = list.scrollHeight; }
        else if (ev.type === 'status') status.textContent = ({ search_notes: 'Searching your notes…', list_items: 'Looking through your lists…', list_tasks: 'Checking your tasks…', query_calendar: 'Checking your calendar…', read_health: 'Reading your health summary…' })[ev.tool] || 'Looking it up…';
        else if (ev.type === 'error') { cur.text = ev.error; cur.el.replaceChildren(h('span', { style: { color: 'var(--bad)' } }, ev.error)); }
        else if (ev.type === 'end') {
          if (ev.stop === 'refusal') { cur.text = ev.text; cur.el.textContent = ev.text; return; }
          if (ev.assistant_content) api.push({ role: 'assistant', content: ev.assistant_content });
          if (ev.stop === 'confirm') { pending = { cards: ev.pending, results: [...(ev.done_results || [])], left: ev.pending.length, confirms: [], open: new Set(), dead: false }; ev.pending.forEach(p => showCard(p)); if (ev.pending.length > 1) { const P = pending, all = h('button', { class: 'btn primary', onclick: () => { [...P.confirms].forEach(f => f()); all.remove(); } }, 'Confirm all ' + ev.pending.length); list.append(all); view.push({ card: all }); list.scrollTop = list.scrollHeight; } }
        }
      });
      if (!cur.text) { view = view.filter(v => v !== cur); cur.el.remove(); }
    } catch (e) { cur.text = e.message; cur.el.replaceChildren(h('span', { style: { color: 'var(--bad)' } }, e.message)); }
    busy = false; tier = 'chat'; send.disabled = false; status.textContent = ''; persist();
  }

  function showCard(p) {
    const P = pending; let inp = { ...p.input }, decided = false;
    const body = h('div', {}, describe(p.name, inp)), act = h('div', { class: 'row', style: { marginTop: '8px' } });
    const card = h('div', { class: 'card taped confirm', style: { margin: '10px 0 10px 12px' } }, h('div', { class: 'small muted' }, 'Confirm'), body, act); view.push({ card }); list.append(card);
    P.open.add(act);
    const decide = (ok, summary, applied) => {
      if (decided || P.dead) return; decided = true; P.open.delete(act); act.replaceChildren(h('span', { class: ok ? 'chip good' : 'chip' }, ok ? '✓ ' + summary : 'Cancelled'));
      if (ok) store.put('assistant_action', { name: p.name, input: inp, summary, created: applied.created, prev: applied.prev, completed: applied.completed, status: 'applied', at: nowIso() });
      P.results.push({ type: 'tool_result', tool_use_id: p.id, content: ok ? summary : 'The user cancelled this action.', is_error: !ok && undefined });
      if (--P.left === 0) { api.push({ role: 'user', content: P.results }); pending = null; run(); }
    };
    const confirm = () => { const r = apply(p.name, inp); if (!r.ok) { body.textContent = r.summary; return decide(false); } decide(true, r.summary, r); };
    act.append(h('button', { class: 'btn sm primary', onclick: confirm }, 'Confirm'), h('button', { class: 'btn sm', onclick: () => editInput() }, 'Edit'), h('button', { class: 'btn sm ghost', onclick: () => decide(false) }, 'Cancel'));
    const editInput = () => modal((d, close) => { const f = {}; const fields = Object.keys(inp).filter(k => k !== 'id' && typeof inp[k] !== 'object').map(k => { f[k] = h('input', { class: 'in', value: inp[k] ?? '' }); return field(k, f[k]); }); d.append(h('h2', {}, 'Edit before confirming'), h('div', { class: 'stack' }, fields), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { Object.keys(f).forEach(k => { inp[k] = typeof p.input[k] === 'number' ? +f[k].value : f[k].value; }); body.textContent = describe(p.name, inp); close(); } }, 'Done'))); });
    P.confirms.push(confirm);
    if (p.low_risk && window.__settings?.ai_auto_low) setTimeout(confirm, 50);
    list.scrollTop = list.scrollHeight;
  }

  async function go() {
    const text = input.value.trim(); if (!text || busy) return;
    if (pending) { pending.dead = true; pending.open.forEach(a => a.replaceChildren(h('span', { class: 'chip' }, 'Skipped'))); pending = null; } input.value = ''; input.style.height = '';
    api.push({ role: 'user', content: text }); view.push({ role: 'user', text }); list.append(bubble('user', text)); run();
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });

  const api_ = {
    el: root, focus: () => input.focus(),
    newChat() { api = []; view = []; convId = null; pending = null; paint(); persist_reset(); },
    ask(text) { input.value = text; go(); },
    load(rec) { convId = rec.id; api = JSON.parse(rec.api || '[]'); view = JSON.parse(rec.view || '[]'); paint(); },
  };
  const persist_reset = () => { /* new conversation record is created on first message */ };
  if (!list.children.length) list.append(h('div', { class: 'empty', style: { padding: '24px 8px' } }, icon('assistant'), h('span', { class: 'big' }, 'Ask me about your life'), h('p', { style: { margin: 0 } }, 'Try: “what’s on this week?”, “add task renew passport friday”, or “which restaurants did I save in Rome?”')));
  input.addEventListener('focus', () => { if (list.querySelector('.empty')) list.querySelector('.empty').remove(); }, { once: true });
  return api_;
}

export function openAssistant(extra, ask) {
  modal((d, close) => {
    d.classList.add('wide', 'assistant-sheet');
    const ctx = () => { const [name, ...rest] = (location.hash.slice(2) || 'today').split('?')[0].split('/'); const c = { screen: name }; if (rest[0]) c.item_id = rest[0]; if (extra) Object.assign(c, extra); return c; };
    const p = chatPanel({ getContext: ctx, compact: true });
    d.append(h('div', { class: 'row' }, h('h2', { style: { flex: 1 } }, 'Assistant'), h('a', { class: 'btn sm ghost', href: '#/assistant', onclick: close }, 'Open full page'), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Close', onclick: close }, icon('x'))), p.el);
    setTimeout(() => (ask ? p.ask(ask) : matchMedia('(max-width: 860px)').matches || p.focus()), 50);
  }, { wide: true, label: 'Assistant' });
}
