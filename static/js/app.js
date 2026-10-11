// App shell: auth, layout (spine sidebar / mobile tabbar), hash router, command palette, shortcuts.
import { h, $, cfg, debounce, clear } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { modal, toast, empty } from './ui.js';
import { state, applyTheme, inMode } from './state.js';
import { openCapture } from './capture.js';
import { expenseDialog } from './expense.js';
import { unlockWithPasskey, passkeysSupported } from './webauthn.js';

applyTheme();
const root = $('#app');

export const SECTIONS = [
  ['today', 'Today', 'today', '--pen'], ['inbox', 'Inbox', 'inbox'], ['tasks', 'Tasks', 'tasks'], ['calendar', 'Calendar', 'calendar'],
  ['notes', 'Notes', 'notes', '--d-notes'], ['lists', 'Lists', 'lists', '--d-lists'], ['goals', 'Goals', 'goals', '--d-goals'], ['travel', 'Travel', 'travel', '--d-travel'],
  ['health', 'Health', 'health', '--d-health'], ['assistant', 'Assistant', 'assistant'], ['review', 'Review', 'review'], ['settings', 'Settings', 'settings'],
];
const VIEWS = { today: () => import('./views/today.js'), inbox: () => import('./views/inbox.js'), tasks: () => import('./views/tasks.js'), calendar: () => import('./views/calendar.js'),
  notes: () => import('./views/notes.js'), lists: () => import('./views/lists.js'), goals: () => import('./views/goals.js'), travel: () => import('./views/travel.js'),
  health: () => import('./views/health.js'), assistant: () => import('./views/assistant.js'), review: () => import('./views/review.js'), settings: () => import('./views/settings.js'),
  work: () => import('./views/workcapture.js'), do: () => import('./views/do.js'), admin: () => import('./views/admin.js'), trash: () => import('./views/trash.js'), people: () => import('./views/people.js'), vault: () => import('./views/vault.js') };

let cur = { name: '', cleanup: null }, mainEl, pageEl, authed = false;

// ---------------- boot ----------------
async function boot() {
  let me, net = true;
  try { me = await (await fetch('/api/me', { credentials: 'same-origin' })).json(); } catch { net = false; me = { authed: false }; }
  if (!net && lsGet('life_authed') === '1') { // offline: open straight from the on-device copy (the service worker served this page)
    if (lockExpired()) return lockScreen({ offline: true });
    try { window.__settings = JSON.parse(lsGet('life_settings') || '{}'); applySettings(window.__settings); } catch { /* defaults */ }
    await store.init(); authed = true; shell(); route(); import('./reminders-ui.js').then(m => m.startReminderWatcher()); import('./automations.js').then(m => m.startAutomations()); registerSW(); return;
  }
  if (!me.authed) { if (!me.locked) lsSet('life_authed', ''); return me.faceid ? lockScreen(net ? me : { ...me, offline: true }) : loginScreen(net ? me : { ...me, offline: true }); }
  store.setCsrf(me.csrf); lsSet('life_authed', '1'); lsSet('life_lock', JSON.stringify({ on: !!me.faceid, min: me.lock_minutes || 0, seen: Date.now() })); watchLock(me);
  try { const s = await store.api('/api/settings'); window.__settings = s; applySettings(s); lsSet('life_settings', JSON.stringify(s)); } catch { try { window.__settings = JSON.parse(lsGet('life_settings') || '{}'); applySettings(window.__settings); } catch { /* defaults */ } }
  await store.init(); authed = true;
  shell(); route(); store.sync();
  import('./reminders-ui.js').then(m => m.startReminderWatcher()); import('./automations.js').then(m => m.startAutomations());
  registerSW(); installNudge(); pullToRefresh();
}
function pullToRefresh() {   // iPhone: pull the page down from the top to sync now (the native bounce is off, so this replaces it)
  if (!('ontouchstart' in window)) return;
  const bar = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('refresh')); document.body.append(bar); let y0 = null, pulled = 0;
  addEventListener('touchstart', e => { y0 = scrollY <= 0 && e.touches.length === 1 && !document.querySelector('.scrim') && !e.target.closest('.chat-list, .cal-scroll, .map, textarea, .dialog') ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  addEventListener('touchmove', e => { if (y0 == null) return; pulled = e.touches[0].clientY - y0; if (pulled > 0) { bar.style.transform = `translate(-50%, ${Math.min(pulled * .5, 70)}px)`; bar.style.opacity = Math.min(pulled / 110, 1); bar.classList.toggle('go', pulled > 110); } }, { passive: true });
  addEventListener('touchend', async () => { const go = y0 != null && pulled > 110; y0 = null; if (go) { bar.classList.add('spin'); await store.sync(); toast('Up to date'); } bar.style.transform = ''; bar.style.opacity = 0; bar.classList.remove('go', 'spin'); });
}
function installNudge() {   // iPhone in Safari (not the installed app): say once how to install; notifications and Face ID need it
  const ios = /iPhone|iPad/.test(navigator.userAgent), standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone || lsGet('life_nudge')) return;
  const box = h('div', { class: 'card taped', role: 'status', style: { position: 'fixed', left: '12px', right: '12px', bottom: 'calc(var(--tabh, 58px) + 18px + env(safe-area-inset-bottom))', zIndex: 40, padding: '14px 16px' } },
    h('b', { style: { fontWeight: 400 } }, 'Make it an app'), h('p', { class: 'small', style: { margin: '4px 0 8px' } }, 'Tap the Share button, then “Add to Home Screen”. You get full screen, notifications and Face ID.'),
    h('button', { class: 'btn sm', onclick: () => { lsSet('life_nudge', '1'); box.remove(); } }, 'Got it'));
  document.body.append(box);
}
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const applySettings = s => Object.assign(cfg, { tz: s.timezone || cfg.tz, name: s.name || cfg.name, currency: s.currency || cfg.currency, workDays: s.work_days || cfg.workDays, workStart: s.work_start || cfg.workStart, workEnd: s.work_end || cfg.workEnd, eveningFrom: s.evening_from || cfg.eveningFrom });

// ---------------- Face ID lock ----------------
const lockCfg = () => { try { return JSON.parse(lsGet('life_lock') || 'null'); } catch { return null; } };
const lockExpired = () => { const l = lockCfg(); return !!(l && l.on && Date.now() - l.seen > l.min * 60000 + (l.min === 0 ? 10000 : 0)); };
function watchLock(me) {   // keep "last seen" fresh while the app is in use; coming back after the lock time, ask the server and show the lock screen
  if (!me.faceid) return;
  const touch = () => { const l = lockCfg(); if (l && !document.hidden) { l.seen = Date.now(); lsSet('life_lock', JSON.stringify(l)); } };
  ['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, debounce(touch, 4000), { passive: true, capture: true })); setInterval(touch, 15000);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { if (!me.lock_minutes) navigator.sendBeacon('/api/lock'); return; }   // "lock as soon as I leave": tell the server now
    if (lockExpired() || !me.lock_minutes) { try { const m = await (await fetch('/api/me', { credentials: 'same-origin' })).json(); if (!m.authed) location.reload(); else touch(); } catch { if (lockExpired()) location.reload(); } }
  });
}
function lockScreen(me) {
  const err = h('p', { class: 'bad small', role: 'alert' }), local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const unlock = async () => { err.textContent = ''; try { await unlockWithPasskey(); location.reload(); } catch (e) { err.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled. Tap to try again.' : (e.message || 'Couldn’t unlock.'); } };
  root.replaceChildren(h('div', { style: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '16px' } }, h('div', { class: 'card taped', style: { width: 'min(420px,100%)', padding: '32px 28px', textAlign: 'center' } },
    h('h1', { class: 'hero-line' }, 'Life'), h('p', { class: 'muted' }, me.offline ? 'Locked. Connect to the internet to unlock.' : 'Locked.'),
    h('button', { class: 'btn primary', style: { minHeight: '56px', width: '100%', fontSize: '1.2rem', justifyContent: 'center' }, disabled: (me.offline || !passkeysSupported()) || null, onclick: unlock }, icon('lock'), 'Unlock with Face ID'), err,
    local ? h('p', { class: 'small', style: { marginTop: '18px' } }, h('a', { href: '#', onclick: e => { e.preventDefault(); loginScreen({ ...me, offline: false }); } }, 'Use the password (this computer only)')) : '')));
}

function loginScreen(me) {
  const err = h('p', { class: 'bad small', role: 'alert' }), pw = h('input', { class: 'in', type: 'password', autocomplete: me.setup ? 'new-password' : 'current-password', 'aria-label': 'Password', autofocus: true });
  const go = async () => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ password: pw.value }) });
    const j = await r.json().catch(() => ({})); if (r.ok) location.reload(); else err.textContent = j.error || 'Something went wrong.';
  };
  pw.addEventListener('keydown', e => e.key === 'Enter' && go());
  root.replaceChildren(h('div', { style: { minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '16px' } }, h('div', { class: 'card taped', style: { width: 'min(420px,100%)', padding: '32px 28px' } },
    h('h1', { class: 'hero-line' }, 'Life'), h('p', { class: 'muted' }, me.offline ? 'Can’t reach the server right now.' : me.setup ? 'Welcome. Choose a password (8+ characters) to lock your notebook.' : 'Open your notebook.'),
    pw, err, h('div', { class: 'sp-t' }, h('button', { class: 'btn primary', onclick: go }, me.setup ? 'Set password' : 'Open')))));
}

// ---------------- shell ----------------
function shell() {
  const dom = { notes: '--d-notes', lists: '--d-lists', goals: '--d-goals', travel: '--d-travel', health: '--d-health' };
  const quick = h('div', { class: 'quick', id: 'quick' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, SECTIONS.map(([id, label, ic]) =>
    h('a', { href: '#/' + id, 'data-id': id, style: dom[id] ? { '--dom': `var(${dom[id]})` } : null }, icon(ic), h('span', {}, label), id === 'inbox' ? h('span', { class: 'badge hide', id: 'inbox-n' }) : '')), quick);
  const capIn = h('input', { placeholder: 'Capture… (C)', 'aria-label': 'Quick capture', readonly: true, onclick: () => openCapture(), onkeydown: e => { if (e.key === 'Enter') openCapture(); } });
  const modeSw = h('div', { class: 'mode-sw', role: 'group', 'aria-label': 'Mode' }, [['all', 'All'], ['personal', 'Personal'], ['work', 'Work']].map(([m, l]) => h('button', { 'data-m': m, onclick: () => state.setMode(m) }, l)));
  const syncPill = h('div', { class: 'sync-pill', id: 'sync-pill', role: 'status' });
  const spine = h('aside', { class: 'spine' }, h('div', { class: 'brand' }, 'Life', h('small', {}, 'the day, quietly')), h('div', { class: 'cap-box' }, capIn), nav,
    h('div', { class: 'spine-foot' }, modeSw, syncPill));
  const tabs = (window.__settings?.tabs || ['today', 'tasks', 'calendar', 'notes']).slice(0, 4);
  const tabLink = id => { const s = SECTIONS.find(x => x[0] === id); return h('a', { href: '#/' + id, 'data-id': id }, icon(s[2]), s[1]); };
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' }, tabLink(tabs[0]), tabLink(tabs[1]),
    h('button', { class: 'mid', 'aria-label': 'Capture', onclick: () => openCapture() }, h('span', { class: 'disc' }, icon('plus'))), tabLink(tabs[2]),
    h('a', { href: '#/more', 'data-id': 'more' }, icon('more'), 'More'));
  const top = h('header', { class: 'topbar' }, h('div', { class: 'brand' }, 'Life'), h('span', { class: 'grow' }), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Search', onclick: palette }, icon('search')),
    h('div', { class: 'mode-sw', style: { color: 'var(--ink)', borderColor: 'var(--ink-3)' } }, [['all', 'All'], ['personal', 'Me'], ['work', 'Work']].map(([m, l]) => h('button', { 'data-m': m, style: { color: 'inherit' }, onclick: () => state.setMode(m) }, l))));
  pageEl = h('div', { class: 'page' });
  mainEl = h('main', { class: 'page-wrap', id: 'main', tabindex: '-1' }, pageEl);
  root.replaceChildren(h('div', { class: 'shell' }, spine, h('div', {}, top, mainEl, h('div', { class: 'margin-line' })), tabbar));
  paintMode();
  document.addEventListener('modechange', () => { paintMode(); render(); });
  window.addEventListener('hashchange', route);
  let t; store.subscribe(() => { clearTimeout(t); t = setTimeout(onData, 120); });
  onData();
}
// ---- favourites (pinned pages & saved views) and recently opened ----
const hashNow = () => location.hash || '#/today';
const favs = () => store.list('favorite').sort((x, y) => (x.order || 0) - (y.order || 0) || x.created_at.localeCompare(y.created_at));
const recents = () => { try { return JSON.parse(localStorage.getItem('recents') || '[]'); } catch { return []; } };
function noteRecent(label) { const hr = hashNow(); const { rest, q } = parseHash(); if (!rest.length && !q.edit) return; if (favs().some(f => f.href === hr)) return; const r = recents().filter(x => x.href !== hr); r.unshift({ href: hr, label }); try { localStorage.setItem('recents', JSON.stringify(r.slice(0, 8))); } catch { /* private */ } }
export function toggleFav(label) { const hr = hashNow(), ex = favs().find(f => f.href === hr); if (ex) { store.del(ex.id); toast('Removed from favourites', () => store.restore(ex.id)); } else { store.put('favorite', { href: hr, label: label || document.title.replace(' · Life', '') }); toast('Pinned to the sidebar'); } }
function paintQuick() { const box = $('#quick'); if (!box) return; const f = favs(), r = recents().filter(x => !f.some(y => y.href === x.href)).slice(0, 5); box.replaceChildren(
  f.length ? h('div', { class: 'qh' }, 'Favourites') : '', ...f.map(x => h('a', { href: x.href, class: 'q' }, icon('star', 'mini'), h('span', {}, x.label))),
  r.length ? h('div', { class: 'qh' }, 'Recent') : '', ...r.map(x => h('a', { href: x.href, class: 'q' }, icon('clock', 'mini'), h('span', {}, x.label)))); }
const paintMode = () => document.querySelectorAll('.mode-sw button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === state.mode)));

let drawn = -1, lastScroll = 0;   // store revision on screen; last time the user was scrolling
addEventListener('scroll', () => { lastScroll = Date.now(); }, { passive: true, capture: true });
function onData(force) {
  paintQuick();
  const n = store.list('inbox').filter(inMode).length, b = $('#inbox-n'); if (b) { b.textContent = n; b.classList.toggle('hide', !n); }
  const mt = document.querySelector('.tabbar a[data-id="more"]'); if (mt) { let bd = mt.querySelector('.tb-badge'); if (n && !bd) { bd = h('i', { class: 'tb-badge' }); mt.append(bd); } if (bd) { bd.textContent = n; bd.classList.toggle('hide', !n); } }
  const st = store.status(), p = $('#sync-pill'); if (p) p.textContent = !navigator.onLine ? 'offline · ' + st.pending + ' waiting' : st.pending ? st.pending + ' change' + (st.pending > 1 ? 's' : '') + ' waiting' : st.lastErr ? 'sync paused' : 'saved';
  if (force !== true && store.rev() === drawn) return;   // sync start/finish or an echo of our own save: nothing new to show, so leave the page (and the user's scroll) alone
  if (Date.now() - lastScroll < 400) { setTimeout(onData, 450); return; }   // never swap the DOM out from under a swipe
  const a = document.activeElement, typing = a && pageEl && pageEl.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio|button)$/.test(a.type);   // ticking a box doesn't open a keyboard, so it must not block the redraw
  if (typing && !a.classList.contains('cap-input') && !a.dataset.live) return; // never yank the keyboard (quick-add boxes are the exception: they re-render and keep focus)
  if (document.querySelector('.scrim') || document.querySelector('.actmenu[open]')) return;   // never re-render under an open dialog or menu
  const lbl = typing && a.getAttribute('aria-label');
  render(true).then(() => { if (lbl) { const n = pageEl.querySelector(`[aria-label="${lbl}"]`); n && n.focus(); } });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) onData(true); });   // coming back to the app: refresh once
window.addEventListener('online', () => onData(true)); window.addEventListener('offline', () => onData(true));

// ---------------- router ----------------
export function go(path) { location.hash = '#/' + path.replace(/^#?\/?/, ''); }
export function parseHash() { const [p, q] = (location.hash.slice(2) || 'today').split('?'); const [name, ...rest] = p.split('/'); return { name: name || 'today', rest, q: Object.fromEntries(new URLSearchParams(q || '')) }; }
async function route() { await render(false); }
let token = 0;
async function render(soft) {
  if (!authed || !pageEl) return;
  const { name, rest, q } = parseHash(); const my = ++token; drawn = store.rev();
  if (name === 'capture') { history.replaceState(null, '', '#/today'); openCapture([q.title, q.text, q.url].filter(Boolean).join(' ')); return render(false); }
  document.querySelectorAll('[data-id]').forEach(a => a.removeAttribute('aria-current'));
  document.querySelectorAll(`[data-id="${name}"]`).forEach(a => a.setAttribute('aria-current', 'page'));
  if (name === 'more') return moreView();
  const loader = VIEWS[name] || VIEWS.today;
  let mod; try { mod = await loader(); } catch (e) { console.error(e); return pageEl.replaceChildren(empty('x', 'Couldn’t load this page', 'Check your connection and try again.')); }
  if (my !== token) return;
  const scroll = soft ? window.scrollY : 0;
  if (cur.cleanup) { try { cur.cleanup(); } catch { /* ignore */ } cur.cleanup = null; }
  const el = h('div', { class: 'view' });
  const ctx = { name, rest, q, go, refresh: () => render(true), mode: state.mode, soft };
  try { const c = await mod.default(el, ctx); if (typeof c === 'function') cur.cleanup = c; } catch (e) { console.error(e); el.replaceChildren(empty('x', 'This page hit a snag', e.message)); }
  if (my !== token) return;
  cur.name = name; pageEl.replaceChildren(el); window.scrollTo(0, scroll);
  document.title = (SECTIONS.find(s => s[0] === name)?.[1] || 'Life') + ' · Life';
  const hd = pageEl.querySelector('.page-head'); if (hd && !hd.querySelector('.fav')) { const isF = favs().some(f => f.href === hashNow()); const lab = (hd.querySelector('h1') || {}).textContent; hd.append(h('button', { class: 'btn icon sm ghost fav', 'aria-label': isF ? 'Unpin from favourites' : 'Pin to favourites', 'aria-pressed': String(isF), title: isF ? 'Unpin' : 'Pin to the sidebar', style: isF ? { color: 'var(--d-goals)' } : null, onclick: () => toggleFav(lab) }, icon('star'))); }
  noteRecent((hd && hd.querySelector('h1') || {}).textContent || document.title);
  paintQuick();
  if (!soft) { mainEl.focus({ preventScroll: true }); }
}
function moreView() {
  const f = favs(), n = store.list('inbox').filter(inMode).length, tabs = (window.__settings?.tabs || ['today', 'tasks', 'calendar', 'notes']).slice(0, 3);
  const tile = (id, label, ic, badge) => h('a', { class: 'tile', href: '#/' + id }, icon(ic), h('span', {}, label), badge ? h('i', { class: 'badge' }, badge) : '');
  const grp = (title, items) => h('section', {}, h('h3', { class: 'tile-h' }, title), h('div', { class: 'tiles' }, items.filter(x => !tabs.includes(x[0])).map(x => tile(...x))));
  pageEl.replaceChildren(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'More')),
    f.length ? h('section', {}, h('h3', { class: 'tile-h' }, 'Favourites'), h('div', { class: 'tiles' }, f.map(x => h('a', { class: 'tile', href: x.href }, icon('star'), h('span', {}, x.label))))) : '',
    grp('Every day', [['inbox', 'Inbox', 'inbox', n || ''], ['notes', 'Notes', 'notes'], ['lists', 'Lists', 'lists'], ['goals', 'Goals', 'goals'], ['review', 'Review', 'review']]),
    grp('Life', [['travel', 'Travel', 'travel'], ['health', 'Health', 'health'], ['people', 'People', 'user'], ['vault', 'Documents', 'shield'], ['admin', 'Life admin', 'home']]),
    grp('Tools', [['assistant', 'Assistant', 'assistant'], ['work', 'Work page', 'briefcase'], ['trash', 'Trash', 'trash'], ['settings', 'Settings', 'settings']]));
}

// ---------------- command palette & shortcuts ----------------
export function palette() {
  modal((d, close) => {
    const inp = h('input', { class: 'in', placeholder: 'Go to, create, or search…', 'aria-label': 'Command palette', autofocus: true }), res = h('div', { class: 'res', role: 'listbox' });
    let items = [], sel = 0;
    const acts = () => [...store.list('button').map(b => ({ l: 'Button: ' + b.label, ic: 'zap', run: () => import('./automations.js').then(m => m.pressButton(b)) })), ...favs().map(f => ({ l: f.label, ic: 'star', run: () => { location.hash = f.href; } })), ...SECTIONS.map(([id, l, ic]) => ({ l: 'Go to ' + l, ic, run: () => go(id) })),
      { l: 'New capture', ic: 'plus', run: () => openCapture() }, { l: 'New task', ic: 'tasks', run: () => { go('tasks'); setTimeout(() => document.dispatchEvent(new CustomEvent('new-task')), 200); } },
      { l: 'New note', ic: 'notes', run: () => go('notes/new') }, { l: 'Work capture page', ic: 'briefcase', run: () => go('work') }, { l: 'Focus mode (deep work)', ic: 'zap', run: () => import('./focus.js').then(m => m.openFocus()) }, { l: 'Log an expense (wealth app)', ic: 'send', run: () => expenseDialog() }, { l: 'Life admin', ic: 'home', run: () => go('admin') }, { l: 'Trash (restore deleted things)', ic: 'trash', run: () => go('trash') }, { l: 'People', ic: 'user', run: () => go('people') }, { l: 'Toggle dark mode', ic: 'moon', run: () => state.setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') }];
    const paint = () => { clear(res); items.forEach((it, i) => res.append(h('button', { role: 'option', 'aria-selected': String(i === sel), onclick: () => { close(); it.run(); } }, icon(it.ic || 'search'), h('span', { class: 'grow' }, it.l), it.sub ? h('span', { class: 'faint small' }, it.sub) : ''))); };
    const find = debounce(async () => {
      const q = inp.value.trim().toLowerCase(); const a = acts().filter(x => !q || x.l.toLowerCase().includes(q)).slice(0, 8);
      items = a; sel = 0; paint();
      if (q.length > 1) { try { const r = await store.api('/api/search?q=' + encodeURIComponent(q)); items = [...a, ...r.map(x => ({ l: x.title || x.snippet, sub: x.kind, ic: { task: 'tasks', note: 'notes', inbox: 'inbox', list_item: 'lists' }[x.kind] || 'search', run: () => go({ task: 'tasks', note: 'notes/' + x.id, inbox: 'inbox', list_item: 'lists' }[x.kind] || 'today') }))]; paint(); } catch { /* offline */ } }
    }, 120);
    inp.addEventListener('input', find);
    inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); paint(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); } if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); } });
    d.classList.add('palette'); d.append(inp, res); find();
  }, { label: 'Command palette' });
}
let gPending = 0;
document.addEventListener('keydown', e => {
  if (!authed) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); import('./chat.js').then(m => m.openAssistant()); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.scrim')) return;
  const k = e.key.toLowerCase();
  if (gPending && Date.now() - gPending < 1200) { gPending = 0; const m = { t: 'tasks', n: 'notes', l: 'lists', c: 'calendar', i: 'inbox', g: 'goals', h: 'health', v: 'travel', r: 'review', s: 'settings', a: 'assistant', d: 'today' }[k]; if (m) { go(m); e.preventDefault(); } return; }
  if (k === 'g') { gPending = Date.now(); return; }
  if (k === 'c') { e.preventDefault(); openCapture(); }
  else if (k === 't') { e.preventDefault(); go('tasks'); setTimeout(() => document.dispatchEvent(new CustomEvent('new-task')), 200); }
  else if (k === 'n') { e.preventDefault(); go('notes/new'); }
  else if (k === '/') { e.preventDefault(); palette(); }
  else if (k === '?') shortcutsSheet();
});
function shortcutsSheet() {
  const rows = [['C', 'Capture'], ['T', 'New task'], ['N', 'New note'], ['/ or Ctrl+K', 'Search & commands'], ['Ctrl+J', 'Assistant sheet (knows what you’re looking at)'], ['G then D/T/N/L/C/I/G/H/V/R/S', 'Go to Today, Tasks, Notes, Lists, Calendar, Inbox, Goals, Health, Travel, Review, Settings'], ['J / K', 'Move down / up in lists'], ['E', 'Edit selected'], ['X', 'Complete selected'], ['1–4', 'Set priority on selected'], ['?', 'This sheet']];
  modal((d, close) => { d.append(h('h2', {}, 'Keyboard'), h('table', { class: 'tbl' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, h('kbd', {}, a)), h('td', {}, b)))), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Close'))); });
}

// ---------------- service worker with "update available" ----------------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const ask = w => { const t = h('div', { class: 'toast' }, 'A newer version is ready.', h('button', { onclick: () => w.postMessage('skip') }, 'Refresh')); (document.querySelector('.toasts') || document.body.appendChild(h('div', { class: 'toasts' }))).append(t); };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); }); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
  let reloaded; navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
}

boot();

// iOS home-screen apps don't shrink the layout for the keyboard: publish its height so sheets can sit above it.
if (window.visualViewport) { // on-screen keyboard height -> --kb. Only while a field is focused: iOS can leave a stale value after a dropdown/keyboard closes, which squashed sheets and blocked scrolling
  const vv = visualViewport, root = document.documentElement, field = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
  const setKb = () => { const kb = field() ? Math.round(innerHeight - vv.height - vv.offsetTop) : 0; root.style.setProperty('--kb', (kb > 80 ? kb : 0) + 'px'); };
  vv.addEventListener('resize', setKb); vv.addEventListener('scroll', setKb);
  addEventListener('focusin', setKb); addEventListener('focusout', () => setTimeout(setKb, 250)); addEventListener('pageshow', setKb);
}
