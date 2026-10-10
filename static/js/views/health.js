// Health: the overall picture, not a fitness lab. Garmin overview, mood & energy, quick logs, insights, health admin, sync.
import { h, today, addDays, niceDate, dow, ago, diffDays, cfg, fmtTime, localToUtc } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox } from '../ui.js';
import { bars, line, heat } from '../charts.js';
import { moodCard, LABEL } from '../mood.js';
import { insights, buildDays } from '../insights.js';

let tab = 'overview', range = 30;
const TABS = [['overview', 'Overview'], ['mood', 'Mood'], ['logs', 'Logs'], ['admin', 'Health admin'], ['sync', 'Garmin & import']];
const hm = h2 => `${Math.floor(h2)}h${String(Math.round((h2 % 1) * 60)).padStart(2, '0')}`;
const series = (key, n) => { const T = today(), m = Object.fromEntries(store.list('garmin_daily').map(d => [d.day, d[key]])); return Array.from({ length: n }, (_, i) => m[addDays(T, i - n + 1)] ?? null); };
const wkStart = ds => addDays(ds, -((dow(ds) + 6) % 7));
const stat = (v, l, sub) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l), sub ? h('em', { class: 'faint small', style: { display: 'block', fontStyle: 'normal' } }, sub) : '');

function overview(box, ctx) {
  const gd = store.list('garmin_daily').sort((a, b) => b.day.localeCompare(a.day)), last = gd[0], acts = store.list('garmin_activity').sort((a, b) => b.day.localeCompare(a.day));
  if (!gd.length && !acts.length) { box.append(empty('health', 'No body data yet', 'Connect Garmin, or import a file from Garmin Connect. Mood and energy work without it.', h('button', { class: 'btn primary', onclick: () => { tab = 'sync'; ctx.refresh(); } }, 'Set up Garmin'))); }
  else {
    const T = today(), act = acts[0];
    box.append(h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Right now'), h('span', { class: 'count' }, last ? (last.day === T ? 'today' : niceDate(last.day)) : '')), h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } },
      stat(last?.sleep_h ? hm(last.sleep_h) : '–', 'sleep', last?.sleep_score ? 'score ' + last.sleep_score : ''), stat(last?.body_battery ?? last?.readiness ?? '–', last?.body_battery != null ? 'body battery' : 'readiness'), stat(last?.steps ? last.steps.toLocaleString() : '–', 'steps'), stat(last?.rhr ?? '–', 'resting HR', last?.hrv ? `HRV ${last.hrv}` : ''),
      act ? stat(act.type.replace(/_/g, ' '), 'last activity', `${act.distance_km ? act.distance_km + ' km · ' : ''}${Math.round(act.duration_min)} min · ${niceDate(act.day)}`) : '')));
    const r = seg([[7, '7 days'], [30, '30 days'], [90, '90 days']], range, v => { range = v; ctx.refresh(); });
    box.append(h('div', { class: 'row' }, r));
    const mood = Array.from({ length: range }, (_, i) => { const d = addDays(T, i - range + 1), ms = store.list('mood_log', x => x.day === d && x.mood != null); return ms.length ? ms.reduce((s, x) => s + x.mood, 0) / ms.length : null; });
    const chart = (title, svg, sub) => h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, title), sub ? h('span', { class: 'count' }, sub) : ''), svg);
    box.append(h('div', { class: 'grid2' }, chart('Sleep', bars(series('sleep_h', range), { goal: 7.5, fmt: v => v + ' h', label: 'Sleep hours per night' }), 'goal 7.5 h'), chart('Steps', bars(series('steps', range), { goal: 8000, fmt: v => Math.round(v).toLocaleString(), label: 'Steps per day' }), 'goal 8,000'), chart('Mood', line(mood, { min: 1, max: 5, label: 'Mood over time' }), 'calm timeline')));
    const ws = wkStart(T), tot = (from, to) => { const a = acts.filter(x => x.day >= from && x.day <= to), d = gd.filter(x => x.day >= from && x.day <= to); return { km: a.reduce((s, x) => s + (x.distance_km || 0), 0), n: a.length, act: d.reduce((s, x) => s + (x.active_min || 0), 0), min: a.reduce((s, x) => s + (x.duration_min || 0), 0) }; };
    const tw = tot(ws, T), lw = tot(addDays(ws, -7), addDays(ws, -1));
    box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'This week')), h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } }, stat(tw.n, 'workouts', `last week ${lw.n}`), stat(Math.round(tw.km * 10) / 10, 'km', `last week ${Math.round(lw.km * 10) / 10}`), stat(tw.act || Math.round(tw.min), 'active min', `last week ${lw.act || Math.round(lw.min)}`))));
    let sg = 0; for (let d = T, miss = 0; miss < 1 && sg < 400; d = addDays(d, -1)) { const g = gd.find(x => x.day === d); if (g && g.steps >= 7000) sg++; else if (d !== T) miss++; }
    if (sg >= 2) box.append(h('p', { class: 'muted' }, `${sg} days in a row over 7,000 steps.`));
    if (acts.length) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Recent activities')), acts.slice(0, 8).map(a => h('div', { class: 'item' }, h('div', { class: 'grow' }, (a.name || a.type).replace(/_/g, ' '), h('div', { class: 'meta' }, niceDate(a.day), a.distance_km ? a.distance_km + ' km' : '', Math.round(a.duration_min) + ' min', a.avg_hr ? a.avg_hr + ' bpm' : '', a.calories ? a.calories + ' kcal' : ''))))));
  }
  const ins = insights(buildDays(store, dow));
  box.append(h('section', { class: 'card taped' }, h('div', { class: 'card-head' }, h('h3', {}, 'Patterns')), ins.length ? ins.map(i => h('div', { class: 'item' }, h('div', { class: 'grow' }, i.text, h('div', { class: 'meta' }, i.note)))) : h('p', { class: 'muted', style: { margin: 0 } }, 'Nothing to say yet. Patterns appear once there are at least five days on each side of a comparison — keep logging mood, and they’ll show up.')));
}

function moodTab(box, ctx) {
  box.append(moodCard());
  const s = window.__settings || {}, on = h('input', { type: 'checkbox', class: 'chk', checked: !!s.mood_prompts, onchange: async e => { await store.api('/api/settings', { method: 'POST', body: JSON.stringify({ mood_prompts: e.target.checked }) }); window.__settings = { ...window.__settings, mood_prompts: e.target.checked }; toast(e.target.checked ? 'Three gentle check-ins a day' : 'One check-in a day'); ctx.refresh(); } });
  box.append(h('label', { class: 'row' }, on, 'Check in up to three times a day (morning, afternoon, evening)'));
  const T = today(), days = Array.from({ length: 91 }, (_, i) => addDays(T, i - 90)), map = {};
  store.list('mood_log', m => m.mood != null).forEach(m => (map[m.day] ||= []).push(m.mood)); Object.keys(map).forEach(d => map[d] = map[d].reduce((a, b) => a + b, 0) / map[d].length);
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Last 13 weeks')), heat(map, days), h('p', { class: 'faint small', style: { margin: '8px 0 0' } }, 'Darker = better. Gaps are fine.')));
  const recent = store.list('mood_log').sort((a, b) => (b.at || b.day).localeCompare(a.at || a.day)).slice(0, 14);
  if (recent.length) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Recent')), recent.map(m => h('div', { class: 'item' }, h('div', { class: 'grow' }, `${niceDate(m.day)}${m.slot && m.slot !== 'day' ? ' · ' + m.slot : ''}: mood ${m.mood ?? '–'} (${LABEL[m.mood] || ''}), energy ${m.energy ?? '–'}`, h('div', { class: 'meta' }, (m.tags || []).map(t => h('span', {}, t)), m.note ? h('span', {}, '“' + m.note + '”') : ''))))));
}

const LOGS = [['water', 'Water', 250, 'ml'], ['caffeine', 'Caffeine', 1, 'drink'], ['alcohol', 'Alcohol', 1, 'drink']];
function logsTab(box, ctx) {
  const T = today(), logs = store.list('manual_log', l => l.day === T);
  box.append(h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Quick log')), h('div', { class: 'row wrap' }, LOGS.map(([k, l, v, u]) => h('button', { class: 'btn', onclick: () => store.put('manual_log', { day: T, type: k, value: v, unit: u, at: new Date().toISOString() }) }, icon('plus'), `${l}${k === 'water' ? ' +250 ml' : ''}`)),
    h('button', { class: 'btn', onclick: () => ask('Weight (kg)', 'number', v => store.put('manual_log', { day: T, type: 'weight', value: +v, unit: 'kg' })) }, 'Weight'), h('button', { class: 'btn', onclick: () => ask('Medication / supplement', 'text', v => store.put('manual_log', { day: T, type: 'med', note: v })) }, 'Med / supplement'),
    h('button', { class: 'btn', onclick: () => ask('Symptom or pain (what & how bad 1–5)', 'text', v => store.put('manual_log', { day: T, type: 'symptom', note: v })) }, 'Symptom / pain'),
    window.__settings?.cycle_tracking ? h('button', { class: 'btn', onclick: () => ask('Cycle note', 'text', v => store.put('manual_log', { day: T, type: 'cycle', note: v })) }, 'Cycle') : '')));
  const sum = (t) => logs.filter(l => l.type === t).reduce((s, l) => s + (+l.value || 0), 0);
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Today')), h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } }, stat(sum('water') ? (sum('water') / 1000).toFixed(2) + ' L' : '0', 'water'), stat(sum('caffeine'), 'caffeine'), stat(sum('alcohol'), 'alcohol')),
    logs.sort((a, b) => (b.at || '').localeCompare(a.at || '')).map(l => h('div', { class: 'item' }, h('div', { class: 'grow' }, `${l.type}${l.value ? ' · ' + l.value + (l.unit ? ' ' + l.unit : '') : ''}${l.note ? ' — ' + l.note : ''}`), h('button', { class: 'btn icon sm ghost', 'aria-label': 'Remove', onclick: () => store.del(l.id) }, icon('x'))))));
  box.append(h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'chk', checked: !!window.__settings?.cycle_tracking, onchange: async e => { await store.api('/api/settings', { method: 'POST', body: JSON.stringify({ cycle_tracking: e.target.checked }) }); window.__settings = { ...window.__settings, cycle_tracking: e.target.checked }; ctx.refresh(); } }), 'Show cycle notes in quick log'));
}
const ask = (title, type, ok) => modal((d, close) => { const i = h('input', { class: 'in', type, step: 'any', autofocus: true }); const go = () => { if (i.value.trim()) ok(i.value.trim()); close(); }; i.addEventListener('keydown', e => e.key === 'Enter' && go()); d.append(h('h2', {}, title), i, h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'Save'))); });

const RT = [['appt', 'Appointment', 'calendar'], ['vaccine', 'Vaccination', 'shield'], ['rx', 'Prescription', 'heart'], ['bloodtest', 'Blood test', 'health'], ['doctor', 'Doctor', 'user'], ['insurance', 'Insurance', 'lock']];
function editRec(rt, id) {
  const x = id ? store.get(id) : { rtype: rt, name: '' };
  modal((d, close) => {
    const f = {}, mk = (k, label, type = 'text', ph = '') => { f[k] = h('input', { class: 'in', type, value: x[k] ?? '', placeholder: ph, step: 'any' }); return field(label, f[k]); };
    const lay = { appt: () => [mk('name', 'What / who'), mk('date', 'Date', 'date'), mk('time', 'Time', 'time'), mk('place', 'Where')], vaccine: () => [mk('name', 'Vaccine'), mk('date', 'Last given', 'date'), mk('due', 'Next due', 'date')], rx: () => [mk('name', 'Medicine'), mk('dose', 'Dose'), mk('refill', 'Refill by', 'date')], bloodtest: () => [mk('name', 'Test (e.g. Vitamin D)'), mk('value', 'Value', 'number'), mk('unit', 'Unit'), mk('date', 'Date', 'date')], doctor: () => [mk('name', 'Name'), mk('phone', 'Phone', 'tel'), mk('place', 'Clinic')], insurance: () => [mk('name', 'Provider'), mk('policy', 'Policy number (encrypted)'), mk('phone', 'Claims phone')] }[x.rtype]();
    const notes = h('textarea', { class: 'in', value: x.notes || '' }), up = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'hide', onchange: async () => { const fd = new FormData(); fd.append('file', up.files[0]); try { const r = await store.upload('/api/files', fd); x.file = r.id; toast('Attached'); } catch (e) { toast(e.message); } } });
    d.append(h('h2', {}, (id ? 'Edit ' : 'Add ') + RT.find(r => r[0] === x.rtype)[1].toLowerCase()), h('div', { class: 'stack' }, lay, field('Notes (encrypted)', notes), h('div', {}, h('button', { class: 'btn sm', onclick: () => up.click() }, icon('upload'), x.file ? 'Replace file' : 'Attach file'), up)),
      h('div', { class: 'actions' }, id ? h('button', { class: 'btn danger', onclick: () => { store.del(id); close(); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        const p = { rtype: x.rtype, notes: notes.value || null, file: x.file || null }; Object.entries(f).forEach(([k, i]) => { if (i.value !== '') p[k] = i.type === 'number' ? i.value : i.value; }); if (!p.name) return f.name.focus();
        const rec = store.put('health_record', p, id);
        const when = p.date && x.rtype === 'appt' ? new Date(localToUtc(p.date, p.time || '09:00').getTime() - 24 * 3600e3) : p.due ? localToUtc(p.due, '09:00') : p.refill ? localToUtc(addDays(p.refill, -3), '09:00') : null;
        if (when && when > new Date()) store.put('reminder', { title: `${RT.find(r => r[0] === x.rtype)[1]}: ${p.name}`, remind_at: when.toISOString(), source: 'health:' + rec.id }, 'b' + rec.id.slice(1));
        close(); } }, 'Save')));
  }, { wide: true });
}
async function adminTab(box) {
  let ser = {}; try { ser = await store.api('/api/health/series'); } catch { /* offline */ }
  const recs = store.list('health_record');
  RT.forEach(([k, l, ic]) => { const rs = recs.filter(r => r.rtype === k).sort((a, b) => (a.date || a.due || a.refill || '').localeCompare(b.date || b.due || b.refill || ''));
    box.append(h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, icon(ic), h('h3', {}, l + 's'), h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => editRec(k) }, icon('plus'), 'Add')),
      rs.length ? rs.map(r => h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: () => editRec(k, r.id) }, h('div', { class: 'grow' }, r.name, h('div', { class: 'meta' }, r.date ? niceDate(r.date, true) + (r.time ? ' ' + fmtTime(r.time) : '') : '', r.due ? 'due ' + niceDate(r.due, true) : '', r.refill ? 'refill by ' + niceDate(r.refill, true) : '', r.dose, r.phone, r.place, k === 'bloodtest' && r.value ? '••• ' + (r.unit || '') : ''), k === 'bloodtest' && ser[r.name]?.length > 1 ? line(ser[r.name].map(x => x.value), { w: 160, h: 36, label: r.name + ' trend' }) : ''))) : h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing yet.'))); });
}

function syncTab(box, ctx) {
  const code = h('input', { class: 'in', placeholder: 'Verification code from Garmin', inputmode: 'numeric', style: { maxWidth: '260px' } });
  box.append(h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Garmin sync')), h('p', { class: 'muted' }, 'Read-only, every few hours. Garmin’s official Health API is for approved business partners, so Life uses the community “garminconnect” library with your own login. It’s unofficial and can break when Garmin changes things — if so, the file import below keeps working.'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async e => { e.target.disabled = true; try { const j = await store.api('/api/garmin/sync', { method: 'POST', body: JSON.stringify({ days: 14 }) }); toast(j.ok ? `Synced ${j.days} day(s)` : j.reason === 'mfa' ? 'Garmin wants a code — enter it below' : j.reason === 'not configured' ? 'Add GARMIN_EMAIL and GARMIN_PASSWORD to .env first' : 'Sync failed: ' + j.reason); } catch (er) { toast(er.message); } e.target.disabled = false; store.sync(); } }, icon('refresh'), 'Sync now')), h('div', { class: 'row wrap sp-t' }, code, h('button', { class: 'btn', onclick: async () => { try { const j = await store.api('/api/garmin/mfa', { method: 'POST', body: JSON.stringify({ code: code.value }) }); toast(j.ok ? 'Connected' : 'Done'); code.value = ''; } catch (er) { toast(er.message); } } }, 'Send code')), h('p', { class: 'faint small' }, 'Steps to set up are in SETUP-GARMIN.md. Status lives under Settings → Data health.')));
  const file = h('input', { type: 'file', accept: '.csv,.tcx,.fit', class: 'hide', onchange: async () => { const fd = new FormData(); fd.append('file', file.files[0]); try { const j = await store.upload('/api/garmin/import', fd); toast(`Imported ${j.imported} activities`); store.sync(); } catch (e) { toast(e.message); } } });
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Import a file')), h('p', { class: 'muted' }, 'In Garmin Connect: Activities → Export CSV, or export a single activity as TCX or FIT. Parsed on your server; nothing goes anywhere else.'), h('button', { class: 'btn', onclick: () => file.click() }, icon('upload'), 'Choose .csv / .tcx / .fit'), file));
}

export default async function render(el, ctx) {
  el.append(h('div', { class: 'page-head' }, h('h1', { class: 'squig', style: { '--dom': 'var(--d-health)' } }, 'Health'), h('span', { class: 'sub' }, 'the overall picture')), h('div', { style: { margin: '0 0 18px', overflowX: 'auto' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box);
  await ({ overview, mood: moodTab, logs: logsTab, admin: adminTab, sync: syncTab })[tab](box, ctx);
}
