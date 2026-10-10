// Life admin: the quiet stuff that bites if forgotten. Maintenance, warranties, subscriptions, decisions, someday, annual checklist, emergency card, spaced review, meals.
import { h, today, addDays, niceDate, diffDays, ago, uid, localToUtc, cfg, wdName, dow, money } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg, confirmBox, promptBox } from '../ui.js';
import { saveTask } from '../tasks-core.js';
import { types } from '../lists-core.js';

let tab = 'maint';
const TABS = [['maint', 'Home & car'], ['warranty', 'Policies & warranties'], ['subs', 'Subscriptions'], ['decide', 'Decisions'], ['someday', 'Someday'], ['annual', 'Yearly checklist'], ['emergency', 'Emergency card'], ['learn', 'Review cards'], ['meals', 'Meals']];
const remId = id => 'd' + id.slice(1);
const setReminder = (id, title, dateStr, source) => { if (!dateStr) return; const at = localToUtc(dateStr, '09:00', cfg.tz); if (at > new Date()) store.put('reminder', { title, remind_at: at.toISOString(), source }, remId(id)); };
const mk = (p, f, k, label, type = 'text', ph = '') => { f[k] = h('input', { class: 'in', type, value: p[k] ?? '', placeholder: ph, step: 'any' }); return field(label, f[k]); };
function dialog(title, p, build, onSave, onDelete) {
  modal((d, close) => { const f = {}; const body = build(f); d.append(h('h2', {}, title), h('div', { class: 'stack' }, body), h('div', { class: 'actions' }, onDelete ? h('button', { class: 'btn danger', onclick: () => { onDelete(); close(); } }, icon('trash')) : '', h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { const out = {}; Object.entries(f).forEach(([k, i]) => out[k] = i.type === 'number' ? (i.value === '' ? null : +i.value) : i.value || null); if (onSave(out) !== false) close(); } }, 'Save'))); }, { wide: true });
}
const head = (b, label, onAdd) => b.append(h('div', { class: 'row' }, h('span', { class: 'muted grow' }), h('button', { class: 'btn primary', onclick: onAdd }, icon('plus'), label)));
const dueChip = (d, T) => { const n = diffDays(T, d); return h('span', { class: 'chip ' + (n < 0 ? 'bad' : n < 30 ? 'warn' : '') }, n < 0 ? `${-n} days overdue` : n === 0 ? 'today' : `in ${n} days`); };

function maint(b) {
  const T = today(), edit = id => { const p = id ? store.get(id) : { category: 'home' }; dialog(id ? 'Edit' : 'New recurring item', p, f => [mk(p, f, 'name', 'What', 'text', 'AC service, car insurance, filter change…'), h('div', { class: 'grid2' }, mk(p, f, 'interval_days', 'Every (days)', 'number', '180'), mk(p, f, 'last_done', 'Last done', 'date')), h('div', { class: 'grid2' }, mk(p, f, 'cost', `Usual cost (${cfg.currency})`, 'number'), mk(p, f, 'category', 'Home / car')), mk(p, f, 'notes', 'Notes')], o => { if (!o.name) return false; const r = store.put('maintenance_item', o, id); const nx = o.last_done && o.interval_days ? addDays(o.last_done, o.interval_days) : null; setReminder(r.id, o.name + ' is due', nx, 'maintenance'); }, id && (() => store.del(id))); };
  head(b, 'Add item', () => edit());
  const items = store.list('maintenance_item').map(m => ({ m, next: m.last_done && m.interval_days ? addDays(m.last_done, m.interval_days) : null })).sort((a, c) => (a.next || '9').localeCompare(c.next || '9'));
  if (!items.length) { b.append(empty('home', 'Nothing recurring yet', 'AC service, car registration and insurance renewal, filter changes — add them once.')); return; }
  b.append(h('div', { class: 'card' }, items.map(({ m, next }) => h('div', { class: 'item' }, h('div', { class: 'grow', style: { cursor: 'pointer' }, onclick: () => edit(m.id) }, m.name, h('div', { class: 'meta' }, m.category, m.last_done ? 'last ' + niceDate(m.last_done, true) : 'never done', m.cost ? money(m.cost) : '')), next ? dueChip(next, T) : h('span', { class: 'chip' }, 'no schedule'), h('button', { class: 'btn sm', onclick: () => { store.put('maintenance_item', { last_done: T }, m.id); if (m.interval_days) setReminder(m.id, m.name + ' is due', addDays(T, m.interval_days), 'maintenance'); toast('Done — next one scheduled'); } }, icon('check'), 'Done today')))));
}
function warranty(b) {
  const T = today(), KINDS = ['insurance', 'warranty', 'lease', 'registration', 'manual', 'phone number', 'other'];
  const edit = id => { const p = id ? store.get(id) : { doc_type: 'warranty' }; dialog(id ? 'Edit' : 'New', p, f => { f.doc_type = h('select', { class: 'in' }, KINDS.map(k => h('option', { value: k, selected: k === p.doc_type }, k))); return [mk(p, f, 'name', 'Name', 'text', 'Home insurance, TV warranty, car registration…'), field('Type', f.doc_type), mk(p, f, 'number', 'Policy / serial number (stored encrypted)'), mk(p, f, 'expiry', 'Ends / renews', 'date'), mk(p, f, 'notes', 'Notes')]; }, o => { if (!o.name) return false; const r = store.put('vault_doc', o, id); if (o.expiry) setReminder(r.id, o.name + ' ends in 30 days', addDays(o.expiry, -30), 'warranty'); }, id && (() => store.del(id))); };
  head(b, 'Add', () => edit());
  const ds = store.list('vault_doc').sort((a, c) => (a.expiry || '9').localeCompare(c.expiry || '9')); if (!ds.length) { b.append(empty('shield', 'Policies, warranties, leases', 'Keep the numbers and end dates; get a reminder 30 days before.')); return; }
  b.append(h('div', { class: 'card' }, ds.map(d => h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: () => edit(d.id) }, h('div', { class: 'grow' }, d.name, h('div', { class: 'meta' }, d.doc_type, d.number ? '••••' + String(d.number).slice(-4) : '')), d.expiry ? dueChip(d.expiry, T) : ''))));
}
async function subs(b) {
  let w = null; try { w = await store.api('/api/wealth/summary'); } catch { /* */ }
  if (!w || w.net_worth == null) { b.append(empty('clock', 'Subscriptions live in your wealth app', 'Connect it in Settings and renewals show up here — read-only, so nothing is entered twice.')); return; }
  const up = (w.upcoming || []).sort((a, c) => (a.due || '').localeCompare(c.due || ''));
  b.append(h('p', { class: 'muted' }, 'Read-only from your wealth app.'), h('div', { class: 'card' }, up.length ? up.map(u => h('div', { class: 'item' }, h('div', { class: 'grow' }, u.name, h('div', { class: 'meta' }, u.kind || '')), u.amount ? h('b', { style: { fontWeight: 400 } }, money(u.amount, w.currency)) : '', u.due ? dueChip(u.due, today()) : '')) : h('p', { class: 'faint', style: { margin: 0 } }, 'Nothing upcoming.')));
}
function decide(b) {
  const T = today(), edit = id => { const p = id ? store.get(id) : {}; dialog(id ? 'Decision' : 'Log a decision', p, f => { f.reasoning = h('textarea', { class: 'in', value: p.reasoning || '' }); f.expected = h('textarea', { class: 'in', value: p.expected || '' }); f.outcome = h('textarea', { class: 'in', value: p.outcome || '' }); return [mk(p, f, 'title', 'The decision'), field('Why this one (options considered)', f.reasoning), field('What I expect to happen', f.expected), mk(p, f, 'revisit_on', 'Look back on', 'date'), field('What actually happened (fill in later)', f.outcome)]; }, o => { if (!o.title) return false; const r = store.put('decision', o, id); if (o.revisit_on && !o.outcome) setReminder(r.id, 'Revisit decision: ' + o.title, o.revisit_on, 'decision'); }, id && (() => store.del(id))); };
  head(b, 'Log a decision', () => edit());
  const ds = store.list('decision').sort((a, c) => (c.created_at).localeCompare(a.created_at)); if (!ds.length) { b.append(empty('book', 'Decisions worth remembering', 'Write down the why and what you expect. Look back later and learn how you decide.')); return; }
  b.append(h('div', { class: 'card' }, ds.map(d => h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: () => edit(d.id) }, h('div', { class: 'grow' }, d.title, h('div', { class: 'meta' }, d.outcome ? 'outcome noted' : d.revisit_on ? 'revisit ' + niceDate(d.revisit_on, true) : '', ago(d.created_at))), !d.outcome && d.revisit_on && d.revisit_on <= T ? h('span', { class: 'chip warn' }, 'time to look back') : ''))));
}
function someday(b, ctx) {
  const T = today(), ym = T.slice(0, 7), reviewed = store.list('review', r => r.period === 'someday' && r.month === ym)[0], ts = store.list('task', t => t.someday && !t.done);
  b.append(h('p', { class: 'muted' }, 'A parking lot so ideas don’t clutter your tasks. Look through it once a month.'), h('div', { class: 'row' }, reviewed ? h('span', { class: 'chip good' }, 'reviewed this month') : h('button', { class: 'btn', onclick: () => { store.put('review', { period: 'someday', month: ym }); toast('Marked as reviewed'); } }, icon('check'), 'I’ve looked through it')));
  if (!ts.length) { b.append(empty('star', 'Nothing parked', 'In Tasks, mark something “Someday / maybe”.')); return; }
  b.append(h('div', { class: 'card' }, ts.map(t => h('div', { class: 'item' }, h('div', { class: 'grow' }, t.title, h('div', { class: 'meta' }, 'parked ' + ago(t.created_at))), h('button', { class: 'btn sm', onclick: () => saveTask({ someday: false, due: addDays(T, 7) }, t.id) }, 'Do it next week'), h('button', { class: 'btn sm ghost', onclick: () => { store.del(t.id); toast('Dropped', () => store.restore(t.id)); } }, 'Drop')))));
}
const ANNUAL = [['Renew passport check (6+ months left?)', 'passport'], ['Renew insurance (health, car, home, travel)', 'insurance'], ['Renew domain names', 'domains'], ['Review subscriptions — cancel what you don’t use', 'subs'], ['Update will & beneficiaries', 'will'], ['Medical & dental check-up', 'checkup'], ['Review emergency contacts & card', 'emergency'], ['Back up photos and documents', 'backup'], ['Review passwords & 2-factor recovery', 'security']];
function annual(b) {
  const T = today(), have = store.list('task', t => (t.tags || []).includes('annual'));
  b.append(h('p', { class: 'muted' }, 'Add any to your tasks with a date; they repeat every year.'));
  b.append(h('div', { class: 'card' }, ANNUAL.map(([title, key]) => { const t = have.find(x => (x.tags || []).includes(key)); const dt = h('input', { class: 'in', type: 'date', value: t?.due || addDays(T, 60), style: { maxWidth: '170px' }, 'aria-label': 'Date for ' + title });
    return h('div', { class: 'item' }, h('div', { class: 'grow' }, title, t ? h('div', { class: 'meta' }, 'on your list · ' + niceDate(t.due, true)) : ''), t ? h('span', { class: 'chip good' }, 'added') : h('span', { class: 'row' }, dt, h('button', { class: 'btn sm', onclick: () => { saveTask({ title, due: dt.value, tags: ['annual', key], recur: { freq: 'year', interval: 1 }, priority: 3, ctx: 'personal', done: false, remind: 'none' }); toast('Added — repeats yearly'); } }, 'Add'))); })));
}

// ---- emergency card: encrypted in the browser with a PIN; the server only ever stores ciphertext; readable offline after the PIN ----
const EID = 'e3e3e3e3-0000-4000-8000-000000000001', b64 = u => btoa(String.fromCharCode(...u)), un = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function key(pin, salt) { const m = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
export async function sealCard(pin, data) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pin, salt), new TextEncoder().encode(JSON.stringify(data))); return { salt: b64(salt), iv: b64(iv), blob: b64(new Uint8Array(ct)) }; }
export async function openCard(pin, rec) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un(rec.iv) }, await key(pin, un(rec.salt)), un(rec.blob)); return JSON.parse(new TextDecoder().decode(pt)); }
async function emergency(b, ctx) {
  const rec = store.get(EID), show = h('div', {}); b.append(show);
  const form = (data, pin) => { const f = {}, tx = (k, label, ph) => { f[k] = h('input', { class: 'in', value: data[k] || '', placeholder: ph }); return field(label, f[k]); }, ct = h('textarea', { class: 'in', value: data.contacts || '', placeholder: 'One per line: Name — phone' }), emb = h('textarea', { class: 'in', value: data.embassy || '', placeholder: 'Country — embassy phone' });
    show.replaceChildren(h('section', { class: 'card' }, h('div', { class: 'stack' }, tx('blood', 'Blood group'), tx('allergies', 'Allergies & conditions'), field('Emergency contacts', ct), tx('insurance', 'Insurance (provider & number)'), field('Embassy / consulate numbers', emb), tx('meds', 'Medications')), h('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: async () => { const d = { contacts: ct.value, embassy: emb.value }; Object.entries(f).forEach(([k, i]) => d[k] = i.value); store.put('emergency', await sealCard(pin, d), EID); toast('Saved & locked'); ctx.refresh(); } }, 'Save & lock'))); };
  const view = (d, pin) => show.replaceChildren(h('section', { class: 'card taped emerg' }, h('h2', {}, 'In an emergency'), [['Blood group', d.blood], ['Allergies / conditions', d.allergies], ['Medications', d.meds], ['Insurance', d.insurance]].filter(x => x[1]).map(([k, v]) => h('p', { class: 'em-row' }, h('span', {}, k), h('b', {}, v))), d.contacts ? h('p', { class: 'em-row' }, h('span', {}, 'Contacts'), h('b', { style: { whiteSpace: 'pre-wrap' } }, d.contacts)) : '', d.embassy ? h('p', { class: 'em-row' }, h('span', {}, 'Embassy'), h('b', { style: { whiteSpace: 'pre-wrap' } }, d.embassy)) : '', h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => form(d, pin) }, icon('edit'), 'Edit'), h('button', { class: 'btn', onclick: () => ctx.refresh() }, icon('lock'), 'Lock'))));
  if (!rec) { const pin = h('input', { class: 'in', type: 'password', inputmode: 'numeric', placeholder: 'Choose a PIN (4+ digits)', style: { maxWidth: '260px' }, autocomplete: 'off' }); show.append(h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Blood group, allergies, contacts, insurance — readable offline, locked behind a PIN you choose. It’s encrypted in your browser: the server only ever stores scrambled data, so a forgotten PIN cannot be recovered.'), pin, h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: () => { if (pin.value.length < 4) return toast('At least 4 digits'); form({}, pin.value); } }, 'Set up card'))); return; }
  const pin = h('input', { class: 'in', type: 'password', inputmode: 'numeric', placeholder: 'PIN', style: { maxWidth: '200px' }, autocomplete: 'off', 'aria-label': 'PIN' }), msg = h('p', { class: 'bad small', role: 'alert' }), go = async () => { try { view(await openCard(pin.value, rec), pin.value); } catch { msg.textContent = 'That’s not the PIN.'; pin.value = ''; } };
  pin.addEventListener('keydown', e => e.key === 'Enter' && go()); show.append(h('section', { class: 'card' }, h('div', { class: 'row' }, icon('lock'), pin, h('button', { class: 'btn primary', onclick: go }, 'Unlock')), msg));
}

// ---- spaced repetition on notes tagged "review" (simple Leitner-ish intervals) ----
function learn(b, ctx) {
  const T = today(), notes = store.list('note', n => (n.tags || []).includes('review')), cards = Object.fromEntries(store.list('srs_card').map(c => [c.note, c]));
  const due = notes.filter(n => !cards[n.id] || cards[n.id].due <= T);
  b.append(h('p', { class: 'muted' }, 'Tag a note with “review” and it joins the deck. See the title, recall it, then check.'));
  if (!notes.length) { b.append(empty('book', 'No cards yet', 'Add the tag “review” to the notes you want to remember.')); return; }
  if (!due.length) { b.append(h('div', { class: 'card taped' }, h('h2', {}, 'All caught up'), h('p', { class: 'muted', style: { margin: 0 } }, `${notes.length} card${notes.length > 1 ? 's' : ''} in the deck. Next one is due ${niceDate(Object.values(cards).map(c => c.due).sort()[0] || T)}.`))); return; }
  const n = due[0], c = cards[n.id] || { interval: 0, ease: 2.3 }, back = h('div', { class: 'hide' }, h('hr', { class: 'hr' }), h('div', { style: { whiteSpace: 'pre-wrap' } }, (n.body || '').slice(0, 800)), h('div', { class: 'row', style: { marginTop: '12px' } }, [['Again', 0], ['Good', 1], ['Easy', 2]].map(([l, q]) => h('button', { class: 'btn' + (q === 1 ? ' primary' : ''), onclick: () => { const iv = q === 0 ? 1 : Math.max(1, Math.round((c.interval || 1) * (q === 1 ? c.ease : c.ease * 1.5))); store.put('srs_card', { note: n.id, interval: iv, ease: Math.max(1.3, c.ease + (q === 0 ? -.2 : q === 2 ? .1 : 0)), due: addDays(T, iv) }, cards[n.id]?.id); ctx.refresh(); } }, l))));
  b.append(h('div', { class: 'card taped' }, h('div', { class: 'small muted' }, `${due.length} due`), h('h2', {}, n.title || (n.body || '').split('\n')[0]), h('button', { class: 'btn', onclick: e => { back.classList.remove('hide'); e.target.remove(); } }, 'Show the note'), back));
}

function meals(b, ctx) {
  const T = today(), ws = addDays(T, -((dow(T) + 6) % 7)), plan = store.list('meal_plan', p => p.start === ws)[0] || { days: {} };
  const eat = store.list('list').filter(l => l.type === 'eat').flatMap(l => store.list('list_item', i => i.list === l.id)), names = eat.map(i => i.title);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)), dl = h('datalist', { id: 'dishes' }, names.map(n => h('option', { value: n })));
  const sug = h('p', { class: 'muted' });
  b.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => { const past = new Set(Object.values(plan.days || {})); const pool = names.filter(n => !past.has(n)); const pick = (pool.length ? pool : names)[Math.floor(Math.random() * (pool.length ? pool.length : names.length))]; sug.textContent = pick ? `How about ${pick}?` : 'Add some dishes to a “Things to eat” list first.'; } }, icon('dish'), 'What’s for dinner?')), sug, dl);
  b.append(h('div', { class: 'card' }, days.map(d => h('div', { class: 'item' }, h('span', { class: 'time-col', style: { width: '90px' } }, wdName(dow(d)).slice(0, 3) + ' ' + d.slice(8)), h('input', { class: 'in', list: 'dishes', value: plan.days?.[d] || '', placeholder: 'Dinner', 'aria-label': 'Dinner ' + d, onchange: e => { const nd = { ...(store.list('meal_plan', p => p.start === ws)[0]?.days || {}), [d]: e.target.value }; store.put('meal_plan', { start: ws, days: nd }, store.list('meal_plan', p => p.start === ws)[0]?.id); } })))));
}

export default async function render(el, ctx) {
  el.append(h('div', { class: 'page-head' }, h('a', { class: 'btn icon sm ghost', href: '#/more', 'aria-label': 'Back' }, icon('chevL')), h('h1', { class: 'squig' }, 'Life admin')), h('div', { style: { margin: '0 0 18px', overflowX: 'auto' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box); await ({ maint, warranty, subs, decide, someday, annual, emergency, learn, meals })[tab](box, ctx);
}
