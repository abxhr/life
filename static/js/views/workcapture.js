// Work capture (phone/home side): get the offline page, scan its QR hand-off, paste text, manage write-only tokens, see which tier works.
import { h, ago } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, field, confirmBox, promptBox } from '../ui.js';
import { parse } from '../nlp.js';
import { makeCollector, itemId, linesFromText } from '../qrhandoff.js';
import { loadJsQR } from '../maps.js';

async function importItems(list, source) {
  let added = 0;
  for (const it of list) {
    const text = (it.t || it).trim(); if (!text) continue;
    const id = await itemId(text);
    if (store.getAny(id)) continue;                          // seen before (even if since deleted): never duplicate
    const p = parse(text);
    store.put('inbox', { text: p.title || text, raw: text, source, context: 'work', parsed: { due: p.due, time: p.time, recur: p.recur, ctx: 'work', priority: p.priority, project: p.project, tags: p.tags } }, id); added++;
  }
  store.api('/api/work/seen', { method: 'POST', body: JSON.stringify({ tier: source === 'work-qr' ? 'qr' : 'paste' }) }).catch(() => {});
  return added;
}

function scan(onDone) {
  modal(async (d, close) => {
    const video = h('video', { playsinline: true, muted: true, style: { width: '100%', borderRadius: '8px', background: '#000' } }), info = h('p', { class: 'muted' }, 'Point at the code on the work screen. If there are several, hold on until it says done.');
    d.append(h('h2', {}, 'Scan from the work PC'), video, info, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { stop(); close(); } }, 'Close')));
    let stream, alive = true; const stop = () => { alive = false; stream && stream.getTracks().forEach(t => t.stop()); };
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { info.textContent = 'The camera isn’t available (needs HTTPS or localhost, and permission). Use “paste text” instead.'; return; }
    video.srcObject = stream; await video.play(); const jsQR = await loadJsQR(), cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true }), col = makeCollector();
    const tick = async () => {
      if (!alive) return;
      if (video.readyState === 4) { cv.width = video.videoWidth; cv.height = video.videoHeight; cx.drawImage(video, 0, 0); const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (r && r.data.startsWith('LC1:')) { const s = col.add(r.data);
          if (s.state === 'partial') info.textContent = `Got ${s.have} of ${s.need}…`;
          else if (s.state === 'bad') info.textContent = s.reason === 'checksum' ? 'A code looked damaged. Keep scanning.' : 'Not a Life code.';
          else { stop(); const n = await importItems(s.items, 'work-qr'); toast(n ? `${n} to-do${n > 1 ? 's' : ''} in your inbox` : 'Already imported — nothing new'); close(); onDone(); return; } } }
      requestAnimationFrame(tick);
    };
    tick();
  }, { label: 'Scan' });
}

export default async function render(el, ctx) {
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig', style: { '--dom': 'var(--d-work)' } }, 'Work capture'), h('span', { class: 'sub' }, 'to-dos out of the office network')));
  const stack = h('div', { class: 'stack' }); el.append(stack);
  const policy = h('div', { class: 'card', style: { borderColor: 'var(--warn)' } }, h('b', {}, 'Before you start. '), 'Check your company’s IT/security policy. Keep what you put here to your own to-do reminders (“send Q3 deck to finance”), not confidential company information or client data. None of this tries to get around your company’s network controls.');
  stack.append(policy);

  // 1 get page
  const ep = h('input', { class: 'in', placeholder: 'optional — https://life.yourdomain.com (only if work can reach it)', type: 'url', 'aria-label': 'Server address' });
  stack.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, '1 · The offline page')), h('p', { class: 'muted' }, 'One HTML file. Save it to the work desktop (USB, personal email attachment if allowed, or your phone → PC however your policy permits) and open it in the browser. No install, no server, no external requests.'),
    field('Server address for direct sync (leave blank for offline-only)', ep),
    h('div', { class: 'row wrap sp-t' }, h('button', { class: 'btn primary', onclick: () => { const q = ep.value.trim() ? '?endpoint=' + encodeURIComponent(ep.value.trim()) : ''; location.href = '/api/work/page' + q; toast('Downloading work-capture.html'); } }, icon('download'), 'Download work-capture.html'))));

  // 2 hand-off
  const paste = h('textarea', { class: 'in', placeholder: 'Paste the text copied from the work page (one to-do per line)…', 'aria-label': 'Pasted to-dos' });
  stack.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, '2 · Bring them to your phone')), h('p', { class: 'muted' }, 'On the work page tap “Send to phone (QR)”, then scan it here. Repeat scans never create duplicates.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => scan(() => ctx.refresh()) }, icon('qr'), 'Scan QR')), h('hr', { class: 'hr' }), paste,
    h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: async () => { const n = await importItems(linesFromText(paste.value), 'work-text'); paste.value = ''; toast(n ? `${n} added to inbox` : 'Nothing new'); ctx.refresh(); } }, icon('inbox'), 'Add pasted to-dos to inbox')));

  // 3 tiers & tokens
  let st = {}, tokens = []; try { [st, tokens] = await Promise.all([store.api('/api/work/status'), store.api('/api/tokens')]); } catch { /* offline */ }
  const tier = (name, what, when) => h('div', { class: 'item' }, h('span', { class: 'dot', style: { background: when ? 'var(--good)' : 'var(--ink-3)', marginTop: '10px' } }), h('div', { class: 'grow' }, h('b', { style: { fontWeight: 400 } }, name), h('div', { class: 'meta' }, when ? `worked ${ago(when)}` : 'not seen yet — ' + what)));
  stack.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, '3 · Which way works on your network?')), h('p', { class: 'muted small' }, 'Test each from the work PC; this list lights up when something arrives.'),
    tier('Tier 0 · offline page', 'it just works locally; nothing to receive'), tier('Tier 1 · QR scan', 'tap “Send to phone” on the work page', st.qr), tier('Tier 1b · pasted text', 'use “Copy as text” on the work page', st.paste), tier('Tier 2 · direct sync', 'press “Test connection” on the work page', st.direct),
    h('p', { class: 'faint small' }, 'Tier 3 (email-in from a personal device) is described in SETUP-WORK-PC.md — only if your policy allows, and only for non-sensitive one-liners.')));
  const tb = h('div', { class: 'stack-s' });
  const paintT = () => tb.replaceChildren(...(tokens.length ? tokens.map(t => h('div', { class: 'item' }, h('div', { class: 'grow' }, t.label, h('div', { class: 'meta' }, `made ${ago(t.created_at)} · used ${t.uses}× · ${t.revoked_at ? 'revoked' : t.last_used ? 'last ' + ago(t.last_used) : 'never used'}`)), t.revoked_at ? '' : h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Revoke this token?', 'The work page using it will stop syncing.', { ok: 'Revoke', danger: true })) { await store.api('/api/tokens/' + t.id, { method: 'DELETE' }); t.revoked_at = new Date().toISOString(); paintT(); } } }, 'Revoke'))) : [h('p', { class: 'faint' }, 'No tokens yet.')]));
  paintT();
  const newToken = async () => {
    const label = await promptBox('Name this token', { value: 'iphone', placeholder: 'e.g. iphone, work-pc', ok: 'Create' }); if (!label) return;
    const j = await store.api('/api/tokens', { method: 'POST', body: JSON.stringify({ label }) });
    tokens.unshift({ id: j.id, label, created_at: new Date().toISOString(), uses: 0 }); paintT();
    modal((d, close) => { const t = h('input', { class: 'in', readonly: true, value: j.token, 'aria-label': 'Token', onfocus: e => e.target.select() });
      d.append(h('h2', {}, 'Your token'), h('p', { class: 'muted small' }, 'Copy it now — it’s shown only once.'), t, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(j.token).then(() => toast('Copied')).catch(() => t.select()); } }, icon('copy'), 'Copy'), h('button', { class: 'btn primary', onclick: close }, 'Done'))); }, { label: 'New token' });
  };
  stack.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Capture tokens'), h('button', { class: 'btn sm', onclick: newToken }, icon('plus'), 'New token')), h('p', { class: 'muted small' }, 'Write-only: a token can add inbox items (and file shared posts into your lists) and nothing else — it can’t read a single note, task, health or money record. Rate-limited, revocable, logged.'), tb));
}
