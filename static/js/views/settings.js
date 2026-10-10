// Settings, Data health, export/backup, capture tokens, demo data.
import { h, ago, cfg, uid } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast, confirmBox, promptBox, field, seg, modal } from '../ui.js';
import { state } from '../state.js';
import { SECTIONS } from '../app.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TZS = ['Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];

export default async function render(el) {
  let s; try { s = await store.api('/api/settings'); } catch { el.append(h('p', {}, 'Settings need a connection.')); return; }
  const save = async patch => { Object.assign(s, patch); try { await store.api('/api/settings', { method: 'POST', body: JSON.stringify(patch) }); window.__settings = s; Object.assign(cfg, { tz: s.timezone, name: s.name, currency: s.currency, workDays: s.work_days, workStart: s.work_start, workEnd: s.work_end, eveningFrom: s.evening_from }); toast('Saved'); } catch (e) { toast('Couldn’t save: ' + e.message); } };
  const txt = (key, label, type = 'text') => field(label, h('input', { class: 'in', type, value: s[key] ?? '', onchange: e => save({ [key]: type === 'number' ? +e.target.value : e.target.value }) }));
  const sec = (title, ...kids) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, title)), h('div', { class: 'stack' }, kids));
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Settings')));
  const wrap = h('div', { class: 'stack' }); el.append(wrap);

  wrap.append(sec('You', h('div', { class: 'grid2' }, txt('name', 'What should I call you?'), field('Timezone', h('select', { class: 'in', onchange: e => save({ timezone: e.target.value }) }, [...new Set([s.timezone, ...TZS])].map(z => h('option', { value: z, selected: z === s.timezone }, z)))), txt('currency', 'Home currency')),
    h('div', {}, h('div', { class: 'small muted' }, 'Work days'), h('div', { class: 'row wrap' }, DAYS.map((d, i) => h('button', { class: 'chip' + (s.work_days.includes(i) ? ' on' : ''), onclick: e => { const set = new Set(s.work_days); set.has(i) ? set.delete(i) : set.add(i); save({ work_days: [...set].sort() }); e.target.classList.toggle('on'); } }, d)))),
    h('div', { class: 'grid2' }, txt('work_start', 'Work starts', 'time'), txt('work_end', 'Work ends', 'time'), txt('evening_from', 'Evening review from', 'time'), txt('quiet_from', 'Quiet hours from', 'time'), txt('quiet_to', 'Quiet hours until', 'time'))));

  wrap.append(sec('Look & feel',
    h('div', { class: 'row wrap' }, h('span', {}, 'Theme'), seg([['system', 'System'], ['light', 'Paper'], ['dark', 'Night']], state.theme, v => state.setTheme(v)), h('span', { class: 'right' }, 'Density'), seg([['comfortable', 'Comfortable'], ['compact', 'Compact']], state.density, v => state.setDensity(v))),
    h('div', {}, h('div', { class: 'small muted' }, 'Mobile tab bar (pick four; Capture and More are always there)'), h('div', { class: 'row wrap' }, SECTIONS.filter(x => x[0] !== 'settings').map(([id, l]) => h('button', { class: 'chip' + (s.tabs.includes(id) ? ' on' : ''), onclick: e => { let t = s.tabs.filter(x => x !== id); if (!s.tabs.includes(id)) t = [...s.tabs, id]; if (t.length > 4) t = t.slice(-4); if (t.length < 4 && s.tabs.includes(id)) { toast('Keep four tabs'); return; } s.tabs = t; save({ tabs: t }); document.querySelectorAll('.view .chip').forEach(c => c.classList.toggle('on', t.includes(SECTIONS.find(z => z[1] === c.textContent)?.[0]))); } }, l))))));

  // calendars
  const feedBox = h('div', { class: 'stack-s' });
  const paintFeeds = () => { feedBox.replaceChildren(...(s.feeds || []).map(f => h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: f.color } }), h('span', { class: 'grow' }, f.name, h('span', { class: 'faint small' }, f.work ? '  · work' : '  · personal')), h('button', { class: 'btn sm ghost', onclick: async () => { s.feeds = s.feeds.filter(x => x.id !== f.id); await save({ feeds: s.feeds }); paintFeeds(); } }, icon('trash'), 'Remove')))); if (!(s.feeds || []).length) feedBox.append(h('p', { class: 'faint' }, 'No calendars yet. In Google Calendar: Settings → your calendar → “Secret address in iCal format”. Paste it here — no OAuth needed.')); };
  paintFeeds();
  wrap.append(sec('Calendars (read-only, ICS)', feedBox, h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => modal((d, close) => {
    const name = h('input', { class: 'in', placeholder: 'e.g. Work' }), url = h('input', { class: 'in', placeholder: 'https://calendar.google.com/…/basic.ics', type: 'url' }), color = h('input', { type: 'color', value: '#2c3fd8', 'aria-label': 'Colour' }), work = h('input', { type: 'checkbox', class: 'chk' });
    d.append(h('h2', {}, 'Add a calendar feed'), h('div', { class: 'stack' }, field('Name', name), field('Secret iCal address', url), h('div', { class: 'row' }, color, h('label', { class: 'row' }, work, 'This is my work calendar'))), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { if (!/^https?:\/\//.test(url.value)) { url.focus(); return; } s.feeds = [...(s.feeds || []), { id: uid().slice(0, 8), name: name.value || 'Calendar', url: url.value.trim(), color: color.value, work: work.checked }]; await save({ feeds: s.feeds }); store.api('/api/ics/refresh', { method: 'POST', body: '{}' }).catch(() => {}); paintFeeds(); close(); } }, 'Add')));
  }) }, icon('plus'), 'Add feed'), h('button', { class: 'btn', onclick: async e => { e.target.disabled = true; await store.api('/api/ics/refresh', { method: 'POST', body: '{}' }).catch(() => {}); toast('Refreshed'); e.target.disabled = false; } }, icon('refresh'), 'Refresh now'))));

  wrap.append(sec('Reminders & Telegram', h('p', { class: 'muted small', style: { margin: 0 } }, 'Telegram is the most reliable channel (it works even when the PWA is closed). Create a bot with @BotFather, put its token in .env as TELEGRAM_BOT_TOKEN, then send it a message and paste your chat id here. See SETUP-TELEGRAM.md.'),
    txt('telegram_chat_id', 'Telegram chat id'), h('button', { class: 'btn', onclick: async () => { try { const j = await store.api('/api/notify/test', { method: 'POST', body: '{}' }); toast(j.telegram ? 'Sent — check Telegram' : (j.error || 'Failed')); } catch (e) { toast(e.message); } } }, icon('bell'), 'Send test notification'),
    h('button', { class: 'btn', onclick: async () => { if (!('Notification' in window)) return toast('This browser can’t show notifications'); const p = await Notification.requestPermission(); toast('Notifications: ' + p); if (p === 'granted') new Notification('Life', { body: 'Reminders will show up like this while Life is open.' }); } }, icon('bell'), 'Allow in-browser alerts')));

  // data health
  const hb = h('div', { class: 'stack-s' }); wrap.append(sec('Data health', hb));
  try {
    const hh = await store.api('/api/health'); const st = store.status();
    hb.append(h('div', { class: 'item' }, h('span', { class: 'dot', style: { background: st.lastErr ? 'var(--warn)' : 'var(--good)' } }), h('div', { class: 'grow' }, 'Sync with server', h('div', { class: 'meta' }, st.lastErr ? `paused (${st.lastErr}) — ${st.pending} waiting` : `${st.pending} waiting · last ${ago(st.lastSync)}`)), h('button', { class: 'btn sm', onclick: () => store.sync() }, 'Retry')));
    hh.states.forEach(x => hb.append(h('div', { class: 'item' }, h('span', { class: 'dot', style: { background: x.last_error ? 'var(--bad)' : x.last_ok ? 'var(--good)' : 'var(--ink-3)' } }), h('div', { class: 'grow' }, x.name.replace('_', ' '), h('div', { class: 'meta' }, x.last_error ? `failed: ${x.last_error}` : x.last_ok ? `ok ${ago(x.last_ok)} ${x.info ? '· ' + x.info : ''}` : x.info || 'not set up yet')))));
    hb.append(h('p', { class: 'faint small' }, `${Object.values(hh.counts).reduce((a, b) => a + b, 0)} records · database ${hh.db_kb} KB · work capture tier: ${hh.tier}`));
  } catch (e) { hb.append(h('p', { class: 'faint' }, 'Health needs a connection.')); }
  const logBox = h('div', { class: 'hide stack-s' });
  wrap.append(sec('Sync log', h('button', { class: 'btn sm', onclick: async () => { logBox.classList.toggle('hide'); const l = await store.api('/api/sync-log'); logBox.replaceChildren(...(l.length ? l.map(x => h('div', { class: 'small' }, ago(x.ts) + ' — ' + x.msg)) : [h('p', { class: 'faint' }, 'No conflicts. Quiet.')])); } }, 'Show conflicts'), logBox));

  // data
  wrap.append(sec('Your data', h('p', { class: 'muted small', style: { margin: 0 } }, 'It’s yours. Export everything (JSON + Markdown notes) any time. A nightly backup keeps the last 14 days in data/backups.'),
    h('div', { class: 'row wrap' }, h('a', { class: 'btn', href: '/api/export', download: '' }, icon('download'), 'Export everything'),
      h('button', { class: 'btn', onclick: () => { const f = h('input', { type: 'file', accept: '.zip', onchange: async () => { const fd = new FormData(); fd.append('file', f.files[0]); try { const j = await store.upload('/api/import', fd); toast(`Imported ${j.count} items`); store.wipeLocal().then(() => store.sync()); } catch (e) { toast(e.message); } } }); f.click(); } }, icon('upload'), 'Import export'),
      h('button', { class: 'btn', onclick: async () => { await store.api('/api/backup', { method: 'POST', body: '{}' }); toast('Backup written'); } }, 'Back up now')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: async () => { const j = await store.api('/api/demo', { method: 'POST', body: '{}' }); toast(`Loaded ${j.n} demo items`); store.sync(); } }, 'Load demo data'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Remove demo data?', 'Only items marked demo are deleted.', { ok: 'Remove', danger: true })) { await store.api('/api/demo', { method: 'DELETE' }); store.sync(); toast('Demo data removed'); } } }, 'Remove demo data'))));

  wrap.append(sec('Password', h('button', { class: 'btn', onclick: () => modal((d, close) => {
    const o = h('input', { class: 'in', type: 'password', autocomplete: 'current-password' }), n = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    d.append(h('h2', {}, 'Change password'), h('div', { class: 'stack' }, field('Current', o), field('New (8+ characters)', n)), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { await store.api('/api/password', { method: 'POST', body: JSON.stringify({ old: o.value, new: n.value }) }); toast('Password changed'); close(); } catch (e) { toast(e.message); } } }, 'Change')));
  }) }, icon('lock'), 'Change password'), h('button', { class: 'btn', onclick: async () => { await store.api('/api/logout', { method: 'POST', body: '{}' }); location.reload(); } }, 'Lock'), h('a', { class: 'btn', href: '#/work' }, icon('briefcase'), 'Work capture & tokens')));
}
