// Assistant page: chat, memory ("what it knows about me"), privacy controls with request preview, action log with undo, usage meter.
import { h, ago, cfg } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox, promptBox } from '../ui.js';
import { chatPanel } from '../chat.js';
import { describe, undo } from '../ai-actions.js';

let tab = 'chat', panel = null;
const TABS = [['chat', 'Chat'], ['memory', 'What it knows'], ['privacy', 'Privacy & style'], ['actions', 'What it did'], ['usage', 'Usage']];
const MODS = [['tasks', 'Tasks'], ['notes', 'Notes'], ['lists', 'Lists'], ['goals', 'Goals'], ['travel', 'Travel (never document numbers)'], ['wealth', 'Wealth app summary (read-only)']];
const PROACTIVE = [['morning', 'Morning briefing sentence on Today'], ['evening', 'Evening shutdown prompt'], ['weekly', 'Weekly review draft'], ['gaps', 'Suggest something in a free gap when energy is low'], ['trip', 'Trip prep nudges'], ['goals', 'Gentle accountability on goals I flag'], ['stress', 'Notice when I keep saying “stressed”']];
const save = async patch => { await store.api('/api/settings', { method: 'POST', body: JSON.stringify(patch) }); window.__settings = { ...window.__settings, ...patch }; };

async function chatTab(box, ctx, st) {
  if (!st.configured) box.append(h('div', { class: 'card', style: { borderColor: 'var(--warn)' } }, h('b', {}, 'Not connected yet. '), 'Add your OpenAI key in Settings → Voice & assistant. Everything else works without it, and capture/parsing falls back to simple rules.'));
  const p = panel || (panel = chatPanel({ getContext: () => ({ screen: 'assistant' }) }));
  const prev = store.list('assistant_conversation').sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  box.append(h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('button', { class: 'btn sm', onclick: () => { panel = null; ctx.refresh(); } }, icon('plus'), 'New chat'), h('button', { class: 'btn sm icon', 'aria-label': 'Preview what’s sent', title: 'Preview what’s sent', onclick: async () => { try { const j = await store.api('/api/ai/preview', { method: 'POST', body: JSON.stringify({ messages: [], tier: 'chat' }) }); modal((d, close) => d.append(h('h2', {}, 'Exactly what gets sent'), h('p', { class: 'muted small' }, `To ${j.model} · modules: ${j.modules.join(', ') || 'none'} · health ${j.health ? 'ON' : 'off'} · numbers like cards, IBANs and passports are removed first.`), h('pre', { class: 'preview' }, j.system), h('p', { class: 'small muted' }, 'Tools: ' + j.tools.join(', ')), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Close'))), { wide: true }); } catch (e) { toast(e.message); } } }, icon('eye')),
    prev.length ? h('select', { class: 'in', style: { flex: 1, minWidth: 0, width: 'auto' }, 'aria-label': 'Earlier chats', onchange: e => { const r = store.get(e.target.value); if (r) p.load(r); } }, h('option', { value: '' }, 'Earlier chats…'), prev.slice(0, 15).map(c => h('option', { value: c.id }, `${c.title} · ${ago(c.updated_at)}`))) : ''));
  p.el.classList.add('fit');
  box.append(p.el);
  const fit = () => { const r = box.previousElementSibling || box; document.documentElement.style.setProperty('--chat-top', Math.round(box.getBoundingClientRect().top + (box.firstElementChild ? box.firstElementChild.getBoundingClientRect().height : 0) + 8) + 'px'); };
  requestAnimationFrame(fit); addEventListener('resize', fit);
}

function memoryTab(box) {
  box.append(h('p', { class: 'muted' }, 'Everything the assistant remembers about you. Nothing hidden — edit or delete any line. It adds to this only when you confirm.'));
  const inp = h('input', { class: 'in', placeholder: 'Add something it should know (diet, preferences, constraints)…', 'aria-label': 'Add memory', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { store.put('assistant_memory', { text: e.target.value.trim() }); e.target.value = ''; } } });
  const ms = store.list('assistant_memory').sort((a, b) => a.created_at.localeCompare(b.created_at));
  box.append(inp, h('div', { class: 'card' }, ms.length ? ms.map(m => h('div', { class: 'item' }, h('div', { class: 'grow', contenteditable: 'plaintext-only', onblur: e => { const t = e.target.textContent.trim(); if (t && t !== m.text) store.put('assistant_memory', { text: t }, m.id); } }, m.text), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Forget', onclick: () => { store.del(m.id); toast('Forgotten', () => store.restore(m.id)); } }, icon('trash')))) : h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing yet.')));
}

function privacyTab(box, ctx) {
  const s = window.__settings || {}, mods = new Set(s.ai_enabled_modules || []), tog = (label, on, fn, hint) => h('label', { class: 'row', style: { alignItems: 'flex-start' } }, h('input', { type: 'checkbox', class: 'chk', checked: !!on, onchange: e => fn(e.target.checked) }), h('span', {}, label, hint ? h('div', { class: 'faint small' }, hint) : ''));
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'What the assistant can see')), h('div', { class: 'stack-s' }, MODS.map(([k, l]) => tog(l, mods.has(k), async on => { on ? mods.add(k) : mods.delete(k); await save({ ai_enabled_modules: [...mods] }); })),
    tog('Health & mood data', s.ai_health, async on => { await save({ ai_health: on }); toast(on ? 'Health data is now included' : 'Health data excluded'); }, 'Off by default. When on, daily summaries (sleep, steps, mood) are included — use “Preview what’s sent” to see exactly what.')), h('p', { class: 'faint small' }, 'Passport, ID, card and account numbers are always stripped before anything is sent.')));
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Style')), h('div', { class: 'stack' }, h('div', {}, seg([['friend', 'Friend'], ['coach', 'Coach'], ['nonsense', 'No-nonsense']], s.persona || 'friend', v => save({ persona: v }))),
    tog('Auto-approve low-risk actions (tasks, notes, reminders, list items, mood)', s.ai_auto_low, on => save({ ai_auto_low: on }), 'Everything it does is logged and undoable. Trips, events, edits and “mark done” always ask.'))));
  const pro = s.ai_proactive || {};
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Proactive (all off until you say so)')), h('div', { class: 'stack-s' }, PROACTIVE.map(([k, l]) => tog(l, pro[k], async on => { pro[k] = on; await save({ ai_proactive: { ...pro } }); })))));
  const m = (k, l) => field(l, h('input', { class: 'in', value: s[k] || '', onchange: e => save({ [k]: e.target.value }) }));
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Models & cap')), h('div', { class: 'grid2' }, m('oa_model', 'Everyday model'), m('oa_fast_model', 'Fast (parsing, triage, briefing)'), m('oa_strong_model', 'Strong (planning, voice brain-dumps, weekly review)'), field('Monthly cap (USD)', h('input', { class: 'in', type: 'number', value: s.ai_monthly_cap_usd ?? 10, step: 1, onchange: e => save({ ai_monthly_cap_usd: +e.target.value }) }))), h('p', { class: 'faint small' }, 'Model names are never hard-coded: change them here when new ones ship. The cost meter uses list prices from when this was built (editable under Settings → ai_prices).')));
}

function actionsTab(box) {
  const as = store.list('assistant_action').sort((a, b) => (b.at || b.created_at).localeCompare(a.at || a.created_at)).slice(0, 60);
  box.append(h('p', { class: 'muted' }, 'Everything the assistant did on your say-so. Undo puts things back.'));
  if (!as.length) { box.append(empty('assistant', 'Nothing yet', 'When it creates a task or note for you, it shows up here.')); return; }
  box.append(h('div', { class: 'card' }, as.map(a => h('div', { class: 'item' }, h('div', { class: 'grow' }, a.summary || describe(a.name, a.input), h('div', { class: 'meta' }, ago(a.at || a.created_at), a.status === 'undone' ? 'undone' : '')), a.status === 'applied' ? h('button', { class: 'btn sm', onclick: () => { undo(a); store.put('assistant_action', { status: 'undone' }, a.id); toast('Undone'); } }, icon('undo'), 'Undo') : ''))));
}

function usageTab(box, st) {
  const u = st.usage || {}, cap = +st.cap || 0, pct = cap ? Math.min(100, u.cost / cap * 100) : 0;
  box.append(h('section', { class: 'card' }, h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } }, [[`$${(u.cost || 0).toFixed(2)}`, 'this month (estimate)'], [cap ? `$${cap}` : 'none', 'hard cap'], [u.calls || 0, 'requests'], [Math.round(((u.in || 0) + (u.out || 0)) / 1000) + 'k', 'tokens']].map(([n, l]) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, l)))), cap ? h('div', { class: 'pbar', 'aria-hidden': 'true', style: { marginTop: '10px' } }, h('i', { style: { width: pct + '%' } })) : '', st.over_cap ? h('p', { style: { color: 'var(--bad)' } }, 'Cap reached. The assistant is paused until next month or until you raise the cap. Capture and parsing still work.') : ''));
  box.append(h('p', { class: 'faint small' }, `Models: ${st.models.chat} (everyday) · ${st.models.fast} (fast) · ${st.models.plan} (planning)${st.mock ? ' — MOCK MODE' : ''}`));
}

export default async function render(el, ctx) {
  let st = { configured: false, models: {}, usage: {}, cap: 0 }; try { st = await store.api('/api/ai/status'); } catch { /* offline */ }
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Assistant'), h('span', { class: 'sub' }, st.configured ? '' : 'not connected')), h('div', { style: { margin: '0 0 18px', overflowX: 'auto' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box);
  await ({ chat: (b) => chatTab(b, ctx, st), memory: memoryTab, privacy: b => privacyTab(b, ctx), actions: actionsTab, usage: b => usageTab(b, st) })[tab](box);
}
