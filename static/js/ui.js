// In-app dialogs, sheets, toasts, menus. Never alert/confirm/prompt.
import { h, $, clear } from './util.js';
import { icon } from './icons.js';

let layer;
const root = () => layer || (layer = document.body.appendChild(h('div', { id: 'layer' })));
const toasts = () => $('.toasts') || root().appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));

// Swipe a row on a touch screen: right = the good action (done), left = delete (the caller offers Undo). Vertical scrolling is untouched.
export function swipeRow(el, { right, left }) {
  if (!('ontouchstart' in window)) return el;
  let x0 = null, y0 = 0, dx = 0, mode = '';
  const reset = () => { el.style.transform = ''; el.classList.remove('swiping', 'sw-r', 'sw-l', 'sw-go'); delete el.dataset.swipe; };
  const swallow = () => { const f = e => { e.stopPropagation(); e.preventDefault(); }; el.addEventListener('click', f, { capture: true, once: true }); setTimeout(() => el.removeEventListener('click', f, true), 400); };
  el.addEventListener('touchstart', e => { mode = e.touches.length !== 1 || e.target.closest('input,button,a,select,textarea') ? 'x' : ''; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (mode === 'x' || x0 == null) return; const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
    if (!mode) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { mode = 'x'; return; } if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) mode = 'swipe'; else return; }
    if ((dx > 0 && !right) || (dx < 0 && !left)) dx = 0;
    e.preventDefault();
    el.classList.add('swiping'); el.classList.toggle('sw-r', dx > 0); el.classList.toggle('sw-l', dx < 0); el.classList.toggle('sw-go', Math.abs(dx) > 90);
    el.dataset.swipe = dx > 0 ? right.label || 'Done' : dx < 0 ? left.label || 'Delete' : ''; el.style.transform = `translateX(${Math.max(-140, Math.min(140, dx * .5))}px)`;
  }, { passive: false });
  el.addEventListener('touchend', () => { const go = mode === 'swipe' && Math.abs(dx) > 90, act = dx > 0 ? right : left; mode = ''; x0 = null; reset(); if (go && act) { act.run(); swallow(); } });
  el.addEventListener('touchcancel', () => { mode = ''; x0 = null; reset(); });
  return el;
}
export function modal(build, { wide, onClose, label = 'Dialog' } = {}) {
  const prev = document.activeElement;
  const close = v => { scrim.remove(); document.removeEventListener('keydown', key, true); prev && prev.focus && prev.focus(); onClose && onClose(v); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Tab') { const f = [...dlg.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); } } };
  const dlg = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const scrim = h('div', { class: 'scrim', onmousedown: e => { if (e.target === scrim) close(); } }, dlg);
  build(dlg, close);
  if (innerWidth <= 860 && 'ontouchstart' in window) {   // phone: a grab handle, and pulling the sheet down closes it
    const hd = h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }); dlg.prepend(hd); let y0 = null, dy = 0;
    hd.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; dy = 0; dlg.style.transition = 'none'; }, { passive: true });
    hd.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); dlg.style.transform = `translateY(${dy}px)`; scrim.style.background = `rgba(20,18,10,${.45 * (1 - Math.min(dy / 400, 1))})`; e.preventDefault(); }, { passive: false });
    hd.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; if (dy > 110) close(); else { dlg.style.transition = 'transform .2s'; dlg.style.transform = ''; scrim.style.background = ''; } });
  }
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

// a "⋯" button that opens its children as a tidy vertical menu (phone-friendly: no row of tiny icon buttons)
export function actMenu(...btns) { const d = h('details', { class: 'actmenu', ontoggle: () => { if (d.open) { const pop = d.querySelector('.actmenu-pop'), r = d.getBoundingClientRect(); pop.classList.toggle('left', r.right < 230 || r.left < innerWidth - r.right - 40 && r.left < 120); pop.style.transform = ''; const pr = pop.getBoundingClientRect(), dx = pr.left < 8 ? 8 - pr.left : pr.right > innerWidth - 8 ? innerWidth - 8 - pr.right : 0; if (dx) pop.style.transform = `translateX(${dx}px)`; } } }, h('summary', { class: 'btn icon sm', 'aria-label': 'More actions' }, icon('dots')), h('div', { class: 'actmenu-pop' }, btns)); d.addEventListener('click', e => { if (e.target.closest('.actmenu-pop button')) d.open = false; }); document.addEventListener('click', e => { if (d.open && !d.contains(e.target)) d.open = false; }); return d; }
