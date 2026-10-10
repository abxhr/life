// In-app dialogs, sheets, toasts, menus. Never alert/confirm/prompt.
import { h, $, clear } from './util.js';
import { icon } from './icons.js';

let layer;
const root = () => layer || (layer = document.body.appendChild(h('div', { id: 'layer' })));
const toasts = () => $('.toasts') || root().appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));

export function modal(build, { wide, onClose, label = 'Dialog' } = {}) {
  const prev = document.activeElement;
  const close = v => { scrim.remove(); document.removeEventListener('keydown', key, true); prev && prev.focus && prev.focus(); onClose && onClose(v); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Tab') { const f = [...dlg.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); } } };
  const dlg = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const scrim = h('div', { class: 'scrim', onmousedown: e => { if (e.target === scrim) close(); } }, dlg);
  build(dlg, close);
  root().append(scrim); document.addEventListener('keydown', key, true);
  const f = dlg.querySelector('[autofocus],input,textarea,select,button.primary,button'); f && setTimeout(() => f.focus(), 30);
  return close;
}
export const confirmBox = (title, body, { ok = 'Yes', danger } = {}) => new Promise(res => modal((d, close) => {
  d.append(h('h2', {}, title), body ? h('p', { class: 'muted' }, body) : '', h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => { res(false); close(); } }, 'Cancel'), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { res(true); close(); } }, ok)));
}, { onClose: v => v === undefined && res(false), label: title }));
export const promptBox = (title, { value = '', placeholder = '', ok = 'Save', multiline } = {}) => new Promise(res => modal((d, close) => {
  const i = h(multiline ? 'textarea' : 'input', { class: 'in', value, placeholder, 'aria-label': title });
  const go = () => { res(i.value.trim()); close(true); };
  i.addEventListener('keydown', e => { if (e.key === 'Enter' && (!multiline || e.ctrlKey)) go(); });
  d.append(h('h2', {}, title), i, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { res(null); close(true); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, ok)));
}, { onClose: v => v === undefined && res(null), label: title }));

export function toast(msg, undo) {
  const t = h('div', { class: 'toast' }, h('span', {}, msg));
  if (undo) t.append(h('button', { onclick: () => { undo(); t.remove(); } }, 'Undo'));
  toasts().append(t); setTimeout(() => t.remove(), undo ? 6000 : 3200);
}
export function menu(anchor, items) { // items: [{label, icon, run, danger}]
  const close = modal((d, c) => {
    d.append(...items.map(it => h('button', { class: 'btn ghost', style: { width: '100%', justifyContent: 'flex-start' }, onclick: () => { c(); it.run(); } }, it.icon ? icon(it.icon) : '', h('span', { class: it.danger ? 'bad' : '' }, it.label))));
  }, { label: 'Menu' });
  return close;
}
export function empty(iconName, big, sub, action) {
  return h('div', { class: 'empty' }, icon(iconName), h('span', { class: 'big' }, big), sub ? h('p', { style: { margin: '0 0 12px' } }, sub) : '', action || '');
}
export function skeleton(n = 4) { return h('div', { class: 'stack-s' }, Array.from({ length: n }, (_, i) => h('div', { class: 'skel', style: { width: 60 + (i * 13) % 35 + '%' } }))); }
export function field(label, input) { return h('label', { class: 'field' }, h('span', {}, label), input); }
export function seg(options, value, onchange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const paint = v => options.forEach((o, i) => wrap.children[i].setAttribute('aria-pressed', String(o[0] === v)));
  options.forEach(([val, label]) => wrap.append(h('button', { type: 'button', onclick: () => { paint(val); onchange(val); } }, label)));
  paint(value); return wrap;
}
