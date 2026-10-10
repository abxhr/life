// Expiring read-only share links for ONE list or ONE trip itinerary (no confirmation numbers, no costs; nothing else is reachable).
import { h } from './util.js';
import { store } from './store.js';
import { modal, toast, seg } from './ui.js';

export function shareLink(kind, id) {
  modal((d, close) => {
    let days = 7; const out = h('div', {});
    const make = async () => { try { const j = await store.api('/api/share', { method: 'POST', body: JSON.stringify({ kind, id, days }) }); const url = location.origin + j.url; out.replaceChildren(h('input', { class: 'in', value: url, readOnly: true, 'aria-label': 'Share link', onfocus: e => e.target.select() }), h('p', { class: 'faint small' }, 'Anyone with this link can read this one page until ' + new Date(j.expires).toLocaleDateString() + '. It works only if your server is reachable from their device (e.g. a public HTTPS address).'), h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Copied'); } catch { toast('Select and copy it'); } } }, 'Copy')); } catch (e) { toast(e.message); } };
    d.append(h('h2', {}, kind === 'trip' ? 'Share this itinerary' : 'Share this list'), h('p', { class: 'muted' }, kind === 'trip' ? 'Days, plans and bookings (times and terminals only). No confirmation numbers, links or costs.' : 'Items and their details, read-only.'), seg([[3, '3 days'], [7, '7 days'], [30, '30 days']], days, v => days = v), h('div', { class: 'sp-t' }, h('button', { class: 'btn primary', onclick: make }, 'Create link')), h('div', { class: 'sp-t' }, out), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  });
}
