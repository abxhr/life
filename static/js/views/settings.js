// Settings, Data health, export/backup, capture tokens, demo data.
import { h, ago, cfg, uid } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { toast, confirmBox, promptBox, field, seg, modal } from '../ui.js';
import { state } from '../state.js';
import { SECTIONS } from '../app.js';
import { passkeysSupported, registerPasskey } from '../webauthn.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TZS = ['Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser can’t do push. On iPhone, add Life to the Home Screen first.');
  try {
    const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Notifications are blocked for this site');
    const reg = await navigator.serviceWorker.ready, { key } = await store.api('/api/push/key'), pad = '='.repeat((4 - key.length % 4) % 4), raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
    await store.api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) }); toast('Push is on for this device');
  } catch (e) { toast('Couldn’t enable push: ' + e.message); }
}

export default async function render(el) {
  let s; try { s = await store.api('/api/settings'); } catch { el.append(h('p', {}, 'Settings need a connection.')); return; }
  const save = async patch => { Object.assign(s, patch); try { await store.api('/api/settings', { method: 'POST', body: JSON.stringify(patch) }); window.__settings = s; Object.assign(cfg, { tz: s.timezone, name: s.name, currency: s.currency, workDays: s.work_days, workStart: s.work_start, workEnd: s.work_end, eveningFrom: s.evening_from }); toast('Saved'); } catch (e) { toast('Couldn’t save: ' + e.message); } };
  const txt = (key, label, type = 'text') => field(label, h('input', { class: 'in', type, value: s[key] ?? '', onchange: e => save({ [key]: type === 'number' ? +e.target.value : e.target.value }) }));
  const secret = (key, label, ph = '') => field(label, h('input', { class: 'in', type: 'password', value: s[key] || '', placeholder: ph, autocomplete: 'off', onchange: e => save({ [key]: e.target.value.trim() }) }));   // shows “set” once saved; stored encrypted
  let CL = []; try { CL = Object.values(await (await fetch('/static/vendor/world-meta.json')).json()).map(m => [m[0], m[1]]).sort((a, b) => a[1].localeCompare(b[1])); } catch { /* offline: the selects just stay empty */ }
  const ctry = (key, label) => field(label, h('select', { class: 'in', onchange: e => save({ [key]: e.target.value }) }, h('option', { value: '' }, '—'), CL.map(([a, n]) => h('option', { value: a.toLowerCase(), selected: a.toLowerCase() === (s[key] || '') }, n))));
  const OPEN = new Set(['You', 'Data health']);   // everything else starts folded: Settings should be quick to scan on a phone
  const sec = (title, ...kids) => h('details', { class: 'card setsec', open: OPEN.has(title) || null }, h('summary', {}, icon('chevD', 'mini car'), h('h3', {}, title)), h('div', { class: 'stack', style: { marginTop: '10px' } }, kids));
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig' }, 'Settings')));
  const wrap = h('div', { class: 'stack' }); el.append(wrap);

  wrap.append(sec('You', h('div', { class: 'grid2' }, txt('name', 'What should I call you?'), field('Timezone', h('select', { class: 'in', onchange: e => save({ timezone: e.target.value }) }, [...new Set([s.timezone, ...TZS])].map(z => h('option', { value: z, selected: z === s.timezone }, z)))), txt('currency', 'Home currency'), ctry('nationality', 'Passport (nationality)'), ctry('residency', 'Country you live in')),
    h('div', {}, h('div', { class: 'small muted' }, 'Work days'), h('div', { class: 'row wrap' }, DAYS.map((d, i) => h('button', { class: 'chip' + (s.work_days.includes(i) ? ' on' : ''), onclick: e => { const set = new Set(s.work_days); set.has(i) ? set.delete(i) : set.add(i); save({ work_days: [...set].sort() }); e.target.classList.toggle('on'); } }, d)))),
    h('div', { class: 'grid2' }, txt('work_start', 'Work starts', 'time'), txt('work_end', 'Work ends', 'time'), txt('evening_from', 'Evening review from', 'time'), txt('quiet_from', 'Quiet hours from', 'time'), txt('quiet_to', 'Quiet hours until', 'time'))));

  wrap.append(sec('Look & feel',
    h('div', { class: 'row wrap' }, h('span', {}, 'Theme'), seg([['system', 'System'], ['light', 'Paper'], ['dark', 'Night']], state.theme, v => state.setTheme(v)), h('span', { class: 'right' }, 'Density'), seg([['comfortable', 'Comfortable'], ['compact', 'Compact']], state.density, v => state.setDensity(v))),
    h('div', { class: 'row wrap' }, h('span', {}, 'Pen colour'), [['ultramarine', 'Blue'], ['teal', 'Teal'], ['plum', 'Plum'], ['forest', 'Forest']].map(([k, l]) => h('button', { class: 'chip' + (state.accent === k ? ' on' : ''), 'aria-pressed': String(state.accent === k), onclick: e => { state.setAccent(k); e.target.parentElement.querySelectorAll('.chip').forEach(c => { c.classList.toggle('on', c === e.target); c.setAttribute('aria-pressed', String(c === e.target)); }); } }, l))),
    h('div', {}, h('div', { class: 'small muted' }, 'Show on Today'), h('div', { class: 'row wrap' }, [['timeline', 'Today’s page'], ['due', 'Due'], ['mood', 'Mood'], ['habits', 'Habits'], ['body', 'Body'], ['do', 'What should I do?'], ['top3', 'Weekly three'], ['onthisday', 'On this day']].map(([k, l]) => h('button', { class: 'chip' + (!(s.today_hidden || []).includes(k) ? ' on' : ''), 'aria-pressed': String(!(s.today_hidden || []).includes(k)), onclick: e => { const hid = new Set(s.today_hidden || []); hid.has(k) ? hid.delete(k) : hid.add(k); s.today_hidden = [...hid]; save({ today_hidden: [...hid] }); e.target.classList.toggle('on'); e.target.setAttribute('aria-pressed', String(!hid.has(k))); } }, l)))),
    h('div', {}, h('div', { class: 'small muted' }, 'Mobile tab bar (pick four; Capture and More are always there)'), h('div', { class: 'row wrap' }, SECTIONS.filter(x => x[0] !== 'settings').map(([id, l]) => h('button', { class: 'chip' + (s.tabs.includes(id) ? ' on' : ''), onclick: e => { let t = s.tabs.filter(x => x !== id); if (!s.tabs.includes(id)) t = [...s.tabs, id]; if (t.length > 4) t = t.slice(-4); if (t.length < 4 && s.tabs.includes(id)) { toast('Keep four tabs'); return; } s.tabs = t; save({ tabs: t }); document.querySelectorAll('.view .chip').forEach(c => c.classList.toggle('on', t.includes(SECTIONS.find(z => z[1] === c.textContent)?.[0]))); } }, l))))));

  const { automationsPanel } = await import('../automations.js');
  wrap.append(sec('Buttons & automations', automationsPanel()));
  // wealth app, home location, editable rules (advanced)
  const wealthTok = h('input', { class: 'in', type: 'password', value: s.wealth_token || '', placeholder: 'token', autocomplete: 'off', onchange: e => save({ wealth_token: e.target.value }) });
  wrap.append(sec('Wealth app (read-only, optional)', h('p', { class: 'muted small', style: { margin: 0 } }, 'See WEALTH-API.md. If it can’t be reached, those cards just stay hidden.'), h('div', { class: 'grid2' }, txt('wealth_url', 'Wealth app URL', 'url'), field('API token', wealthTok))));
  wrap.append(sec('Garmin (optional)', h('p', { class: 'muted small', style: { margin: 0 } }, 'Pulls sleep, steps and heart rate every few hours. If Garmin asks for a code, enter it on the Health page. See SETUP-GARMIN.md.'),
    h('div', { class: 'grid2' }, txt('garmin_email', 'Garmin email', 'email'), secret('garmin_password', 'Garmin password'))));
  const imdbBox = h('div', { class: 'stack-s' });
  const paintImdb = async () => { try { const j = await store.api('/api/imdb/status');
    imdbBox.replaceChildren(h('p', { class: 'muted small', style: { margin: 0 } }, j.running ? 'Downloading… this takes a minute.' : j.available ? `IMDb ratings are on your films and series (data from ${j.updated}).` : 'Not downloaded yet. This fetches IMDb’s free ratings file (about 7 MB, from datasets.imdbws.com) once, only when you press the button.'),
      j.error ? h('p', { class: 'small', style: { margin: 0, color: 'var(--bad)' } }, j.error) : '',
      h('button', { class: 'btn', disabled: j.running || null, onclick: async () => { await store.api('/api/imdb/update', { method: 'POST', body: '{}' }); toast('Downloading IMDb ratings…'); setTimeout(paintImdb, 3000); } }, icon('download'), j.available ? 'Update IMDb ratings' : 'Download IMDb ratings'));
    if (j.running) setTimeout(paintImdb, 4000); } catch { /* offline */ } };
  paintImdb();
  wrap.append(sec('Film & series ratings', imdbBox));
  wrap.append(sec('Voice & assistant', h('p', { class: 'muted small', style: { margin: 0 } }, 'One OpenAI API key powers the assistant and voice transcription. What the assistant can see is still controlled in Assistant → Privacy. Without an OpenAI key, voice is transcribed on your PC, and the assistant can use an Anthropic key instead.'),
    field('OpenAI API key', h('input', { class: 'in', type: 'password', value: s.openai_key || '', placeholder: 'sk-…', autocomplete: 'off', onchange: e => save({ openai_key: e.target.value.trim() }) })),
    secret('anthropic_api_key', 'Anthropic API key (optional)', 'sk-ant-…'),
    secret('omdb_key', 'OMDb key (optional, free at omdbapi.com): real year, cast, language and IMDb rating for shared films and series')));
  const rulesTa = h('textarea', { class: 'in', style: { minHeight: '160px', fontFamily: 'var(--f-ui)', fontSize: '.9rem' }, value: JSON.stringify(s.stay_rules || [{ id: 'schengen', name: 'Schengen 90/180', kind: 'rolling', limit: 90, window: 180, countries: ['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH'] }, { id: 'uk', name: 'UK visitor (6 months per visit)', kind: 'per_visit', limit: 180, countries: ['GB'] }], null, 1) });
  const areasTa = h('textarea', { class: 'in', value: (s.areas || ['health', 'career', 'money', 'relationships', 'family', 'learning', 'fun / adventure', 'home', 'peace']).join('\n') });
  wrap.append(sec('Advanced', h('div', { class: 'grid2' }, txt('home_lat', 'Home latitude (flight times)', 'number'), txt('home_lon', 'Home longitude', 'number')), field('Life wheel areas (one per line)', areasTa), h('button', { class: 'btn sm', onclick: () => save({ areas: areasTa.value.split('\n').map(x => x.trim()).filter(Boolean) }) }, 'Save areas'),
    field('Counted-stay rules (JSON) — rules change; verify against the official source', rulesTa), h('button', { class: 'btn sm', onclick: () => { try { const v = JSON.parse(rulesTa.value); if (!Array.isArray(v) || v.some(r => !r.name || !r.limit || !Array.isArray(r.countries) || !['rolling', 'per_visit'].includes(r.kind))) throw new Error('Each rule needs name, kind (rolling|per_visit), limit, countries[]'); save({ stay_rules: v }); } catch (e) { toast('Not saved: ' + e.message); } } }, 'Save rules')));
  // calendars
  const feedBox = h('div', { class: 'stack-s' });
  const paintFeeds = () => { feedBox.replaceChildren(...(s.feeds || []).map(f => h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: f.color } }), h('span', { class: 'grow' }, f.name, h('span', { class: 'faint small' }, f.work ? '  · work' : '  · personal')), h('button', { class: 'btn sm ghost', onclick: async () => { s.feeds = s.feeds.filter(x => x.id !== f.id); await save({ feeds: s.feeds }); paintFeeds(); } }, icon('trash'), 'Remove')))); if (!(s.feeds || []).length) feedBox.append(h('p', { class: 'faint' }, 'No calendars yet. In Google Calendar: Settings → your calendar → “Secret address in iCal format”. Paste it here — no OAuth needed.')); };
  paintFeeds();
  wrap.append(sec('Calendars (read-only, ICS)', feedBox, h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => modal((d, close) => {
    const name = h('input', { class: 'in', placeholder: 'e.g. Work' }), url = h('input', { class: 'in', placeholder: 'https://calendar.google.com/…/basic.ics', type: 'url' }), color = h('input', { type: 'color', value: '#2c3fd8', 'aria-label': 'Colour' }), work = h('input', { type: 'checkbox', class: 'chk' });
    d.append(h('h2', {}, 'Add a calendar feed'), h('div', { class: 'stack' }, field('Name', name), field('Secret iCal address', url), h('div', { class: 'row' }, color, h('label', { class: 'row' }, work, 'This is my work calendar'))), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { if (!/^https?:\/\//.test(url.value)) { url.focus(); return; } s.feeds = [...(s.feeds || []), { id: uid().slice(0, 8), name: name.value || 'Calendar', url: url.value.trim(), color: color.value, work: work.checked }]; await save({ feeds: s.feeds }); store.api('/api/ics/refresh', { method: 'POST', body: '{}' }).catch(() => {}); paintFeeds(); close(); } }, 'Add')));
  }) }, icon('plus'), 'Add feed'), h('button', { class: 'btn', onclick: async e => { e.target.disabled = true; await store.api('/api/ics/refresh', { method: 'POST', body: '{}' }).catch(() => {}); toast('Refreshed'); e.target.disabled = false; } }, icon('refresh'), 'Refresh now'))));

  wrap.append(sec('Email-in (optional)', h('p', { class: 'muted small', style: { margin: 0 } }, 'Email a one-line to-do to your Gmail with the label “Life” (use a Gmail app password, not your normal one). Only these sender addresses are accepted; subject = the to-do. Not for confidential information.'),
    h('div', { class: 'grid2' }, txt('gmail_user', 'Gmail address', 'email'), secret('gmail_app_password', 'Gmail app password')),
    field('Allowed senders (comma separated)', h('input', { class: 'in', value: (s.email_in_allowed || []).join(', '), placeholder: 'me@gmail.com', onchange: e => save({ email_in_allowed: e.target.value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean) }) })),
    h('button', { class: 'btn', onclick: async e => { e.target.disabled = true; try { const j = await store.api('/api/gmail/sync', { method: 'POST', body: '{}' }); toast(j.error ? j.error : `Checked: ${j.travel || 0} booking proposal(s), ${j.inbox || 0} to-do(s)`); store.sync(); } catch (er) { toast(er.message); } e.target.disabled = false; } }, icon('refresh'), 'Check Gmail now')));
  // ---- Use it on your iPhone: install, share-to-Life Shortcut, Calendar, Siri ----
  const copyBtn = (txt, label = 'Copy') => h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(txt); toast('Copied'); } catch { toast('Press and hold the text to copy'); } } }, icon('copy'), label);
  const mono = t => h('input', { class: 'in', readonly: true, value: t, 'aria-label': 'Value to copy', onfocus: e => e.target.select(), style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.8rem' } });
  const iph = h('div', { class: 'stack-s' });
  const shortcutDialog = async () => {
    let j; try { j = await store.api('/api/tokens', { method: 'POST', body: JSON.stringify({ label: 'iPhone Shortcut' }) }); } catch (e) { return toast(e.message); }
    const url = location.origin + '/api/share-in', auth = 'Bearer ' + j.token;
    modal((d, close) => d.append(h('h2', {}, 'Save to Life: the Shortcut'), h('p', { class: 'muted small' }, 'The token is shown once. Copy each value into the Shortcut as below.'),
      h('div', { class: 'stack-s' },
        field('1 · URL', h('div', { class: 'row' }, h('div', { class: 'grow' }, mono(url)), copyBtn(url))),
        field('2 · Header  Authorization', h('div', { class: 'row' }, h('div', { class: 'grow' }, mono(auth)), copyBtn(auth))),
        h('ol', { class: 'small', style: { paddingLeft: '20px', margin: 0 } },
          h('li', {}, 'Shortcuts app → + → name it “Save to Life” → ⓘ → turn on Show in Share Sheet, types: URLs, Text, Images.'),
          h('li', {}, 'Add action Get Contents of URL: paste the URL, Method POST, Headers → Authorization = the value above, Request Body = Form.'),
          h('li', {}, 'Add Form fields: “text” (Text) = Shortcut Input, and, to share screenshots or photos, “images” (File) = Shortcut Input.'),
          h('li', {}, 'Then Get Dictionary Value “message” → Show Notification.'),
          h('li', {}, 'In Instagram: paper plane → Share to… → Save to Life.')),
        h('button', { class: 'btn', onclick: async () => { try { const r = await fetch(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) }); const x = await r.json(); toast(x.message || x.error || 'No answer'); } catch { toast('Couldn’t reach Life from here'); } } }, icon('check'), 'Test this token')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: close }, 'Done'))), { wide: true, label: 'Shortcut' });
  };
  const paintIph = async () => {
    let f = {}; try { f = await store.api('/api/feed'); } catch { /* offline */ }
    iph.replaceChildren(
      isIosDevice && !standaloneApp ? h('p', { class: 'small', style: { margin: 0 } }, h('b', { style: { fontWeight: 400 } }, '1 · Add to Home Screen: '), 'in Safari tap Share → Add to Home Screen, then open Life from the new icon. You get full screen, notifications and Face ID.') : h('p', { class: 'small', style: { margin: 0 } }, h('b', { style: { fontWeight: 400 } }, '1 · Installed ✓ '), 'Life is running as an app.'),
      h('p', { class: 'small', style: { margin: 0 } }, h('b', { style: { fontWeight: 400 } }, '2 · Notifications and Face ID: '), 'set them up in the “Phone notifications” and “Face ID” sections below.'),
      h('div', { class: 'stack-s' }, h('p', { class: 'small', style: { margin: 0 } }, h('b', { style: { fontWeight: 400 } }, '3 · Share anything into Life: '), 'a post, a link, a screenshot. Instagram posts, web pages and photos are read and filed into the right list.'), h('div', {}, h('button', { class: 'btn primary', onclick: shortcutDialog }, icon('send'), 'Set up the “Save to Life” Shortcut'))),
      h('div', { class: 'stack-s' }, h('p', { class: 'small', style: { margin: 0 } }, h('b', { style: { fontWeight: 400 } }, '4 · iPhone Calendar: '), 'your tasks, events, reminders, trips, birthdays and passport/visa expiries, kept up to date (titles and dates only).'),
        f.on ? h('div', { class: 'row wrap' }, h('a', { class: 'btn primary', href: f.webcal }, icon('calendar'), 'Subscribe in Calendar'), copyBtn(f.ics, 'Copy link'), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Make a new link?', 'The old link stops working; subscribe again with the new one.', { ok: 'New link' })) { await store.api('/api/feed/rotate', { method: 'POST', body: '{}' }); paintIph(); } } }, 'Reset link'))
          : h('div', {}, h('button', { class: 'btn primary', onclick: async () => { await store.api('/api/feed/rotate', { method: 'POST', body: '{}' }); paintIph(); } }, icon('calendar'), 'Create my calendar link'))),
      f.on ? h('div', { class: 'stack-s' }, h('p', { class: 'small', style: { margin: 0 } }, h('b', { style: { fontWeight: 400 } }, '5 · “Hey Siri, what’s my day?” '), 'Shortcuts → + → Get Contents of URL (below) → Speak Text. Add it to the Lock Screen or Home Screen as a widget.'), h('div', { class: 'row' }, h('div', { class: 'grow' }, mono(f.today)), copyBtn(f.today))) : '');
  };
  const isIosDevice = /iPhone|iPad/.test(navigator.userAgent), standaloneApp = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  paintIph();
  wrap.append(sec('Use it on your iPhone', iph));
  const fid = h('div', { class: 'stack-s' });
  const paintFid = async () => {
    let keys = []; try { keys = await store.api('/api/passkey'); } catch { /* offline */ }
    fid.replaceChildren(
      h('p', { class: 'muted small', style: { margin: 0 } }, passkeysSupported() ? 'Open Life with Face ID. Do this on your iPhone (open Life there): the key stays in your iPhone’s Keychain, and Life only keeps a public key it can check.' : 'This browser can’t do Face ID or passkeys.'),
      ...keys.map(k => h('div', { class: 'item' }, h('div', { class: 'grow' }, k.name, h('div', { class: 'meta' }, 'added ' + k.created)), h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('Remove this Face ID key?', keys.length === 1 ? 'Life will stop requiring Face ID.' : '', { ok: 'Remove', danger: true })) { await store.api('/api/passkey/' + encodeURIComponent(k.id), { method: 'DELETE' }); s.faceid_required = keys.length > 1 && s.faceid_required; paintFid(); } } }, 'Remove'))),
      h('button', { class: 'btn primary', disabled: !passkeysSupported() || null, onclick: async () => { const name = await promptBox('Name this device', { value: /iPhone|iPad/.test(navigator.userAgent) ? 'My iPhone' : 'This device', ok: 'Set up' }); if (!name) return; try { await registerPasskey(name); toast('Face ID is set up'); paintFid(); } catch (e) { toast(e.name === 'NotAllowedError' ? 'Cancelled' : e.message); } } }, icon('lock'), 'Set up Face ID on this device'),
      keys.length ? h('div', { class: 'stack-s' },
        h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: !!s.faceid_required, onchange: async e => { await save({ faceid_required: e.target.checked }); paintFid(); } }), 'Only open Life with Face ID'),
        s.faceid_required ? field('Lock again after being away for', h('select', { class: 'in', onchange: e => save({ lock_minutes: +e.target.value }) }, [[0, 'As soon as I leave the app'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes']].map(([v, l]) => h('option', { value: v, selected: +(s.lock_minutes ?? 5) === v }, l)))) : '',
        s.faceid_required ? h('p', { class: 'faint small', style: { margin: 0 } }, 'The password then works only from the computer Life runs on (your way back in if the phone is lost).') : '') : '');
  };
  paintFid();
  wrap.append(sec('Face ID', fid));
  const NCATS = [['reminders', 'Reminders'], ['agenda', 'Morning brief'], ['travel', 'Trips, flights, entry rules'], ['docs', 'Passport / visa / document expiry'], ['birthdays', 'Birthdays'], ['system', 'Problems (Garmin sign-in, backups)']];
  const nf = () => ({ channels: 'both', categories: {}, ...(s.notify || {}) });
  const isIos = /iPhone|iPad/.test(navigator.userAgent), standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  wrap.append(sec('Phone notifications',
    isIos && !standalone ? h('p', { class: 'small', style: { margin: 0, color: 'var(--warn, var(--ink))' } }, 'On iPhone, notifications only work from the installed app: in Safari tap Share → Add to Home Screen, open Life from the new icon, then come back here.') : h('p', { class: 'muted small', style: { margin: 0 } }, 'Reminders and alerts arrive as real notifications on this phone, even when the app is closed.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => enablePush() }, icon('bell'), 'Turn on for this device'), h('button', { class: 'btn', onclick: async () => { try { const j = await store.api('/api/push/test', { method: 'POST', body: '{}' }); toast(j.delivered ? 'Sent: check your phone' : (j.error || 'No device yet')); } catch (e) { toast(e.message); } } }, 'Send a test')),
    field('Send them by', h('select', { class: 'in', onchange: e => save({ notify: { ...nf(), channels: e.target.value } }) }, [['both', 'Phone notification and Telegram'], ['push', 'Phone notification only'], ['telegram', 'Telegram only']].map(([v, l]) => h('option', { value: v, selected: nf().channels === v }, l)))),
    h('div', {}, h('div', { class: 'small muted' }, 'What to tell me about (quiet hours are respected; urgent flights always come through)'), h('div', { class: 'row wrap' }, NCATS.map(([k, l]) => h('button', { class: 'chip' + (nf().categories[k] !== false ? ' on' : ''), 'aria-pressed': String(nf().categories[k] !== false), onclick: e => { const n = nf(), on = n.categories[k] !== false; n.categories = { ...n.categories, [k]: !on }; save({ notify: n }); e.currentTarget.classList.toggle('on', !on); e.currentTarget.setAttribute('aria-pressed', String(!on)); } }, l))))));
  wrap.append(sec('Reminders & Telegram', h('p', { class: 'muted small', style: { margin: 0 } }, 'Telegram is the most reliable channel (it works even when the PWA is closed). Create a bot with @BotFather, paste its token here, then send it a message and paste your chat id. See SETUP-TELEGRAM.md.'),
    secret('telegram_bot_token', 'Telegram bot token', '123456:ABC…'), secret('telegram_webhook_secret', 'Webhook secret (only if you forward Telegram messages into Life)'),
    txt('telegram_chat_id', 'Telegram chat id'), h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: !!s.agenda_push, onchange: e => save({ agenda_push: e.target.checked }) }), 'Send me today’s agenda on Telegram each morning (work days)'), txt('agenda_time', 'Agenda time', 'time'), h('p', { class: 'faint small', style: { margin: 0 } }, 'Message your bot any text to drop it in the inbox; send /agenda to get today on demand.'), h('button', { class: 'btn', onclick: async () => { try { const j = await store.api('/api/notify/test', { method: 'POST', body: '{}' }); toast(j.telegram ? 'Sent — check Telegram' : (j.error || 'Failed')); } catch (e) { toast(e.message); } } }, icon('bell'), 'Send test notification'),
    h('button', { class: 'btn', onclick: () => enablePush() }, icon('bell'), 'Enable push on this device'), h('button', { class: 'btn', onclick: async () => { try { const j = await store.api('/api/push/test', { method: 'POST', body: '{}' }); toast(j.delivered ? 'Push sent' : (j.error || 'No device yet')); } catch (e) { toast(e.message); } } }, 'Test push'), h('button', { class: 'btn', onclick: async () => { if (!('Notification' in window)) return toast('This browser can’t show notifications'); const p = await Notification.requestPermission(); toast('Notifications: ' + p); if (p === 'granted') new Notification('Life', { body: 'Reminders will show up like this while Life is open.' }); } }, icon('bell'), 'Allow in-browser alerts')));

  // data health
  const hb = h('div', { class: 'stack-s' }); wrap.append(sec('Data health', hb));
  try {
    const hh = await store.api('/api/health'); const st = store.status();
    hb.append(h('div', { class: 'item' }, h('span', { class: 'dot', style: { background: st.lastErr ? 'var(--warn)' : 'var(--good)' } }), h('div', { class: 'grow' }, 'Sync with server', h('div', { class: 'meta' }, st.lastErr ? `paused (${st.lastErr}) — ${st.pending} waiting` : `${st.pending} waiting · last ${ago(st.lastSync)}`)), h('button', { class: 'btn sm', onclick: () => store.sync() }, 'Retry')));
    const row = x => h('div', { class: 'item' }, h('span', { class: 'dot', style: { background: x.last_error ? 'var(--bad)' : x.last_ok ? 'var(--good)' : 'var(--ink-3)' } }), h('div', { class: 'grow' }, x.name.replace('_', ' '), h('div', { class: 'meta' }, x.last_error ? `failed: ${x.last_error}` : x.last_ok ? `ok ${ago(x.last_ok)} ${x.info ? '· ' + x.info : ''}` : x.info || 'not set up yet')));
    const live = hh.states.filter(x => x.last_ok || x.last_error), idle = hh.states.filter(x => !x.last_ok && !x.last_error);
    live.forEach(x => hb.append(row(x)));
    if (idle.length) hb.append(h('details', {}, h('summary', { class: 'muted small', style: { cursor: 'pointer' } }, `${idle.length} integrations not set up (optional)`), idle.map(row)));
    hb.append(h('p', { class: 'faint small' }, `${Object.values(hh.counts).reduce((a, b) => a + b, 0)} records · database ${hh.db_kb} KB · work capture tier: ${hh.tier}`));
  } catch (e) { hb.append(h('p', { class: 'faint' }, 'Health needs a connection.')); }
  const logBox = h('div', { class: 'hide stack-s' });
  wrap.append(sec('Sync log', h('button', { class: 'btn sm', onclick: async () => { logBox.classList.toggle('hide'); const l = await store.api('/api/sync-log'); logBox.replaceChildren(...(l.length ? l.map(x => h('div', { class: 'small' }, ago(x.ts) + ' — ' + x.msg)) : [h('p', { class: 'faint' }, 'No conflicts. Quiet.')])); } }, 'Show conflicts'), logBox));

  // data
  wrap.append(sec('Your data', h('p', { class: 'muted small', style: { margin: 0 } }, 'It’s yours. Export everything (JSON + Markdown notes) any time. A nightly backup keeps the last 14 days in data/backups.'),
    h('div', { class: 'row wrap' }, h('a', { class: 'btn', href: '/api/export', download: '' }, icon('download'), 'Export everything'),
      h('button', { class: 'btn', onclick: () => { const f = h('input', { type: 'file', accept: '.zip', onchange: async () => { const fd = new FormData(); fd.append('file', f.files[0]); try { const j = await store.upload('/api/import', fd); toast(`Imported ${j.count} items`); store.wipeLocal().then(() => store.sync()); } catch (e) { toast(e.message); } } }); f.click(); } }, icon('upload'), 'Import export'),
      h('button', { class: 'btn', onclick: () => import('../dataio.js').then(m => m.exportTasksCSV()) }, icon('download'), 'Tasks → CSV'), h('button', { class: 'btn', onclick: () => import('../dataio.js').then(m => m.importTasksCSV()) }, icon('upload'), 'Tasks ← CSV'), h('button', { class: 'btn', onclick: () => import('../dataio.js').then(m => m.importMarkdownNotes()) }, icon('upload'), 'Notes ← Markdown files'),
      h('button', { class: 'btn', onclick: async () => { await store.api('/api/backup', { method: 'POST', body: '{}' }); toast('Backup written'); } }, 'Back up now'),
      h('a', { class: 'btn', href: '/api/backup/download', download: '' }, icon('download'), 'Download a backup'),
      h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Include the encryption key?', 'Needed to read passport numbers, health values and file scans after a restore. Anyone with this file AND your data can read them, so keep it private (for example in iCloud Drive).', { ok: 'Download with key' })) location.href = '/api/backup/download?key=1'; } }, icon('lock'), 'Backup with key')),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: async () => { const j = await store.api('/api/demo', { method: 'POST', body: '{}' }); toast(`Loaded ${j.n} demo items`); store.sync(); } }, 'Load demo data'), h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Remove demo data?', 'Only items marked demo are deleted.', { ok: 'Remove', danger: true })) { await store.api('/api/demo', { method: 'DELETE' }); store.sync(); toast('Demo data removed'); } } }, 'Remove demo data'))));

  wrap.append(sec('Password', h('button', { class: 'btn', onclick: () => modal((d, close) => {
    const o = h('input', { class: 'in', type: 'password', autocomplete: 'current-password' }), n = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    d.append(h('h2', {}, 'Change password'), h('div', { class: 'stack' }, field('Current', o), field('New (8+ characters)', n)), h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { try { await store.api('/api/password', { method: 'POST', body: JSON.stringify({ old: o.value, new: n.value }) }); toast('Password changed'); close(); } catch (e) { toast(e.message); } } }, 'Change')));
  }) }, icon('lock'), 'Change password'), h('button', { class: 'btn', onclick: async () => { await store.api('/api/logout', { method: 'POST', body: '{}' }); location.reload(); } }, 'Lock'), h('a', { class: 'btn', href: '#/work' }, icon('briefcase'), 'Work capture & tokens')));
}
