// "spent 45 AED on lunch" -> wealth app quick-add (only if the wealth app exposes it; otherwise a clear message).
import { h } from './util.js';
import { store } from './store.js';
import { modal, toast } from './ui.js';

export function parseExpense(text) {
  const amt = /(\d+(?:[.,]\d+)?)/.exec(text); if (!amt) return null;
  const cur = /\b(aed|usd|inr|eur|gbp|sar|qar|kwd|bhd|omr)\b/i.exec(text);
  const note = text.replace(amt[0], '').replace(cur ? cur[0] : '', '').replace(/\b(spent|on|for|at)\b/gi, '').replace(/\s+/g, ' ').trim();
  return { amount: +amt[1].replace(',', '.'), currency: cur ? cur[1].toUpperCase() : undefined, note };
}
export function expenseDialog() {
  modal((d, close) => {
    const t = h('input', { class: 'in', placeholder: '“spent 45 AED on lunch”', autofocus: true });
    const send = async () => { const p = parseExpense(t.value); if (!p) return t.focus(); try { await store.api('/api/wealth/expense', { method: 'POST', body: JSON.stringify(p) }); toast('Sent to your wealth app'); close(); } catch (e) { toast(e.message); } };
    t.addEventListener('keydown', e => e.key === 'Enter' && send());
    d.append(h('h2', {}, 'Log an expense'), h('p', { class: 'muted small' }, 'Goes straight to your wealth app (it has to be connected in Settings).'), t, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: send }, 'Send')));
  });
}
