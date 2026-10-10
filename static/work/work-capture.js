/* Life — Work Capture (single self-contained file; no network unless you enable direct sync).
   Tier 0: local to-do list (browser storage). Tier 1: QR hand-off to your phone. Tier 2: optional write-only direct sync.
   Keep it to your own to-do reminders; do not paste confidential company information. */
(function () {
  'use strict';
  var CFG = window.LIFE_CFG || { endpoint: '', token: '' };
  var KEY = 'life-work-capture-v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, attrs) {
    var e = document.createElement(tag), a = attrs || {};
    Object.keys(a).forEach(function (k) { if (k === 'class') e.className = a[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), a[k]); else if (a[k] !== false && a[k] != null) e.setAttribute(k, a[k] === true ? '' : a[k]); });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; (Array.isArray(c) ? c : [c]).forEach(function (x) { e.append(x && x.nodeType ? x : document.createTextNode(String(x))); }); }
    return e;
  }
  /* ---------- storage (falls back to memory if the browser blocks it) ---------- */
  var mem = null;
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || { items: [], settings: {} }; } catch (e) { return mem || { items: [], settings: {} }; } }
  var db = load(); mem = db;
  function save() { mem = db; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { warn('Browser storage is blocked — use “Save backup file” so nothing is lost.'); } }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  var endpoint = (db.settings.endpoint || CFG.endpoint || '').replace(/\/$/, ''), token = db.settings.token || CFG.token || '';

  /* ---------- helpers ---------- */
  function crc32(str) { var t = crc32.t || (crc32.t = (function () { var c, t = [], n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })()); var c = -1, b = new TextEncoder().encode(str); for (var i = 0; i < b.length; i++) c = (c >>> 8) ^ t[(c ^ b[i]) & 255]; return ((c ^ -1) >>> 0).toString(16).padStart(8, '0'); }
  function b64u(s) { var b = new TextEncoder().encode(s), r = ''; for (var i = 0; i < b.length; i++) r += String.fromCharCode(b[i]); return btoa(r).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function textOf(it) { return it.title + (it.tags && it.tags.length ? ' ' + it.tags.map(function (t) { return '#' + t; }).join(' ') : '') + (it.due ? ' ' + it.due : '') + (it.time ? ' ' + it.time : ''); }
  var toastT; function warn(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 4500); }

  /* ---------- Tier 2: direct sync (write-only token) ---------- */
  var tier2 = { state: db.settings.tier2 || 'unknown', msg: db.settings.tier2msg || 'Not tested yet.' };
  function setTier2(state, msg) { tier2 = { state: state, msg: msg }; db.settings.tier2 = state; db.settings.tier2msg = msg; save(); renderStatus(); }
  function test() {
    if (!endpoint) return setTier2('off', 'No server address set. Tiers 0 and 1 still work.');
    setTier2('testing', 'Testing…');
    return fetch(endpoint + '/api/ping', { mode: 'cors', cache: 'no-store' }).then(function (r) { return r.ok ? setTier2('ok', 'Reachable — items will sync automatically.') : setTier2('blocked', 'Server answered with an error (' + r.status + ').'); })
      .catch(function () { return fetch(endpoint + '/api/ping', { mode: 'no-cors', cache: 'no-store' }).then(function () { setTier2('blocked', 'Reachable but the browser blocked the reply (CORS/proxy). Use QR hand-off.'); }, function () { setTier2('blocked', 'Blocked — your network cannot reach it, or needs a proxy. Use QR hand-off (Tier 1).'); }); });
  }
  function push() {
    if (tier2.state !== 'ok' || !token) return Promise.resolve();
    var pending = db.items.filter(function (i) { return !i.sent && !i.deleted; });
    if (!pending.length) return Promise.resolve();
    return fetch(endpoint + '/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ items: pending.map(function (i) { return { text: textOf(i), ref: i.id }; }) }) })
      .then(function (r) { if (r.status === 401) { setTier2('blocked', 'Token was revoked or is wrong. Make a new page in Life → Work capture.'); return; } if (!r.ok) throw 0; pending.forEach(function (i) { i.sent = Date.now(); }); save(); render(); })
      .catch(function () { setTier2('blocked', 'Lost the connection — keeping everything locally.'); });
  }

  /* ---------- Tier 1: QR hand-off ---------- */
  var qrTimer = null;
  function encodeItems(items) {
    var open = items.filter(function (i) { return !i.done && !i.deleted; });
    var payload = JSON.stringify({ v: 1, items: open.map(function (i) { return { id: i.id, t: textOf(i) }; }) });
    var data = b64u(payload), set = crc32(payload), n = Math.max(1, Math.ceil(data.length / 420)), out = [];
    for (var i = 0; i < n; i++) out.push('LC1:' + set + ':' + (i + 1) + ':' + n + ':' + data.slice(i * 420, (i + 1) * 420));
    return { out: out, count: open.length };
  }
  function chunks() { return encodeItems(db.items); }
  window.__lifeQR = { encodeItems: encodeItems, crc32: crc32 };
  function showQR() {
    var c = chunks(); if (!c.count) return warn('Nothing pending to send.');
    var box = $('#qrbox'); box.hidden = false; var i = 0;
    function draw() {
      var qr = qrcode(0, 'M'); qr.addData(c.out[i]); qr.make();
      var svg = new DOMParser().parseFromString(qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true }), 'image/svg+xml').documentElement;
      var holder = $('#qrimg'); holder.replaceChildren(svg); $('#qrinfo').textContent = 'Code ' + (i + 1) + ' of ' + c.out.length + ' · ' + c.count + ' item' + (c.count > 1 ? 's' : '');
    }
    draw(); clearInterval(qrTimer);
    if (c.out.length > 1) qrTimer = setInterval(function () { i = (i + 1) % c.out.length; draw(); }, 1800);
    $('#qrclose').onclick = function () { clearInterval(qrTimer); box.hidden = true; };
    $('#qrdone').onclick = function () { db.items.forEach(function (x) { if (!x.done && !x.deleted) x.sent = Date.now(); }); save(); clearInterval(qrTimer); box.hidden = true; render(); };
  }

  /* ---------- UI ---------- */
  function renderStatus() {
    var s = $('#tiers'); if (!s) return;
    s.replaceChildren(
      el('div', { class: 'tier ok' }, el('b', {}, 'Tier 0 · this page'), ' always works. Your list lives in this browser.'),
      el('div', { class: 'tier ok' }, el('b', {}, 'Tier 1 · QR to phone'), ' needs no network. Tap “Send to phone”.'),
      el('div', { class: 'tier ' + (tier2.state === 'ok' ? 'ok' : tier2.state === 'blocked' ? 'bad' : '') }, el('b', {}, 'Tier 2 · direct sync'), ' — ' + tier2.msg + ' ', el('button', { class: 'btn sm', onclick: function () { test().then(push); } }, 'Test connection')));
  }
  function render() {
    var list = $('#list'), now = new Date(), open = db.items.filter(function (i) { return !i.deleted; });
    var due = open.filter(function (i) { return !i.done && i.due && new Date(i.due + 'T' + (i.time || '23:59')) <= now; });
    var ban = $('#due'); ban.hidden = !due.length; ban.replaceChildren.apply(ban, due.length ? [el('b', {}, 'Due now: '), due.map(function (i) { return i.title; }).join(' · ')] : []);
    document.title = (due.length ? '(' + due.length + ') ' : '') + 'Work to-dos';
    var filter = db.settings.filter || 'open';
    var shown = open.filter(function (i) { if (filter === 'all') return true; if (filter === 'done') return !!i.done; return !i.done && (filter === 'open' || i.tags.indexOf(filter) >= 0); });
    list.replaceChildren.apply(list, shown.length ? shown.map(row) : [el('p', { class: 'muted' }, 'Nothing here. Type a to-do above — one line is enough.')]);
    var pend = db.items.filter(function (i) { return !i.sent && !i.done && !i.deleted; }).length;
    $('#pending').textContent = pend ? pend + ' not yet on your phone' : 'everything handed off';
    document.querySelectorAll('[data-f]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.f === filter)); });
  }
  function row(i) {
    var cb = el('input', { type: 'checkbox', class: 'chk', 'aria-label': 'Done: ' + i.title, onchange: function (e) { i.done = e.target.checked ? Date.now() : 0; save(); render(); } }); cb.checked = !!i.done;
    return el('div', { class: 'item' + (i.done ? ' done' : '') }, cb,
      el('div', { class: 'grow' }, el('span', { class: 't' }, i.title), el('div', { class: 'meta' }, i.due ? el('span', {}, i.due + (i.time ? ' ' + i.time : '')) : null, i.tags.map(function (t) { return el('span', {}, '#' + t); }), i.sent ? el('span', {}, '✓ handed off') : null, i.note ? el('span', {}, i.note) : null)),
      el('button', { class: 'btn icon sm ghost', 'aria-label': 'Edit', onclick: function () { edit(i); } }, '✎'), el('button', { class: 'btn icon sm ghost', 'aria-label': 'Delete', onclick: function () { i.deleted = Date.now(); save(); render(); } }, '×'));
  }
  function edit(i) {
    var t = prompt2('Edit to-do', i.title, function (v) { if (v) { i.title = v; i.sent = 0; save(); render(); } });
  }
  function prompt2(title, val, ok) { // in-page dialog (no alert/prompt)
    var inp = el('input', { class: 'in', value: val }), d = el('div', { class: 'scrim' }, el('div', { class: 'dialog' }, el('h2', {}, title), inp, el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: function () { d.remove(); } }, 'Cancel'), el('button', { class: 'btn primary', onclick: function () { d.remove(); ok(inp.value.trim()); } }, 'Save'))));
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { d.remove(); ok(inp.value.trim()); } if (e.key === 'Escape') d.remove(); }); document.body.append(d); inp.focus();
  }
  function add(text) {
    var tags = [], due = '', time = '', t = text;
    t = t.replace(/(^|\s)#([\w-]+)/g, function (m, a, b) { tags.push(b.toLowerCase()); return a; });
    var today = new Date(); function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    if (/\btomorrow\b/i.test(t)) { var d = new Date(today); d.setDate(d.getDate() + 1); due = iso(d); t = t.replace(/\btomorrow\b/i, ''); } else if (/\btoday\b/i.test(t) || tags.indexOf('today') >= 0) { due = iso(today); t = t.replace(/\btoday\b/i, ''); }
    var m = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t); if (m) { var H = +m[1] % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0); time = String(H).padStart(2, '0') + ':' + (m[2] || '00'); t = t.replace(m[0], ''); if (!due) due = iso(today); }
    var dm = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t); if (dm) { due = dm[1]; t = t.replace(dm[0], ''); }
    t = t.replace(/\s+/g, ' ').trim(); if (!t) return;
    db.items.unshift({ id: uid(), title: t[0].toUpperCase() + t.slice(1), tags: tags, due: due, time: time, done: 0, sent: 0, created: Date.now() }); save(); render(); push();
  }
  function file(name, text, type) { var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name }); document.body.append(a); a.click(); a.remove(); }

  document.addEventListener('DOMContentLoaded', function () {
    var inp = $('#add'); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && inp.value.trim()) { add(inp.value); inp.value = ''; } });
    document.querySelectorAll('[data-q]').forEach(function (b) { b.addEventListener('click', function () { inp.value = (inp.value + ' ' + b.dataset.q).trim() + ' '; inp.focus(); }); });
    document.querySelectorAll('[data-f]').forEach(function (b) { b.addEventListener('click', function () { db.settings.filter = b.dataset.f; save(); render(); }); });
    $('#qr').addEventListener('click', showQR);
    $('#copy').addEventListener('click', function () { var txt = db.items.filter(function (i) { return !i.done && !i.deleted; }).map(function (i) { return '- ' + textOf(i); }).join('\n'); if (!txt) return warn('Nothing pending.'); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { warn('Copied. Paste it into Life on your phone (Inbox → paste).'); }, function () { var ta = el('textarea', { class: 'in', style: 'min-height:140px' }); ta.value = txt; var d = el('div', { class: 'scrim' }, el('div', { class: 'dialog' }, el('h2', {}, 'Copy this'), ta, el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: function () { d.remove(); } }, 'Done')))); document.body.append(d); ta.select(); }); });
    $('#backup').addEventListener('click', function () { file('work-todos-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(db, null, 1), 'application/json'); });
    $('#restore').addEventListener('change', function (e) { var f = e.target.files[0]; if (!f) return; f.text().then(function (t) { try { var j = JSON.parse(t); if (j.items) { var have = {}; db.items.forEach(function (i) { have[i.id] = 1; }); j.items.forEach(function (i) { if (!have[i.id]) db.items.push(i); }); save(); render(); warn('Restored.'); } } catch (x) { warn('That file is not a backup.'); } }); });
    $('#endpoint').value = endpoint; $('#endpoint').addEventListener('change', function (e) { endpoint = e.target.value.trim().replace(/\/$/, ''); db.settings.endpoint = endpoint; save(); test().then(push); });
    $('#token').value = token ? '••••••••' : ''; $('#token').addEventListener('change', function (e) { if (e.target.value && e.target.value.indexOf('•') < 0) { token = e.target.value.trim(); db.settings.token = token; save(); } });
    if ('Notification' in window && Notification.permission === 'default') $('#notify').hidden = false;
    $('#notify').addEventListener('click', function () { Notification.requestPermission(); $('#notify').hidden = true; });
    renderStatus(); render(); if (endpoint) test().then(push);
    setInterval(function () { render(); var d = db.items.filter(function (i) { return !i.done && !i.deleted && i.due && !i.notified && new Date(i.due + 'T' + (i.time || '23:59')) <= new Date(); }); d.forEach(function (i) { i.notified = 1; try { if (Notification.permission === 'granted') new Notification('Due: ' + i.title); } catch (e) {} }); if (d.length) save(); }, 30000);
  });
})();
