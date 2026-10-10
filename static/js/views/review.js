// Review & reflection: weekly (auto-assembled), monthly, and the year-in-review (the payoff screen).
import { h, today, addDays, niceDate, dow, diffDays, cfg, monthName, wdName } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { modal, toast, empty, field, seg } from '../ui.js';
import { bars, line } from '../charts.js';
import { streak, logsFor } from '../habits-core.js';
import { progress, AREAS } from '../goals-core.js';
import { stats as travelStats } from '../travel-data.js';
import { world } from '../worldmap.js';
import { inMode } from '../state.js';

let tab = 'week', weekOffset = 0, yearSel = null, half = 'full';
const TABS = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']];
const mondayOf = ds => addDays(ds, -((dow(ds) + 6) % 7));
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const range = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };

export function weekFacts(ws) {
  const we = addDays(ws, 6), days = range(ws, we);
  const done = store.list('done_log', d => d.day >= ws && d.day <= we).filter(inMode), moods = store.list('mood_log', m => m.day >= ws && m.day <= we), gd = store.list('garmin_daily', g => g.day >= ws && g.day <= we), acts = store.list('garmin_activity', a => a.day >= ws && a.day <= we);
  return { ws, we, days, done, habits: store.list('habit', x => !x.archived).map(hb => { const l = logsFor(hb.id); return { name: hb.name, count: days.filter(d => l.has(d)).length, target: hb.freq === 'weekly' ? hb.per_week : 7, streak: streak(hb) }; }),
    moodByDay: days.map(d => { const m = moods.filter(x => x.day === d && x.mood != null); return m.length ? mean(m.map(x => x.mood)) : null; }), energyAvg: mean(moods.filter(m => m.energy != null).map(m => m.energy)), moodAvg: mean(moods.filter(m => m.mood != null).map(m => m.mood)),
    sleep: days.map(d => gd.find(g => g.day === d)?.sleep_h ?? null), steps: days.map(d => gd.find(g => g.day === d)?.steps ?? null), workouts: acts.length, km: acts.reduce((s, a) => s + (a.distance_km || 0), 0), activeMin: gd.reduce((s, g) => s + (g.active_min || 0), 0),
    inbox: store.list('inbox').length, gratitude: store.list('gratitude', g => g.day >= ws && g.day <= we), wins: store.list('win', w => w.day >= ws && w.day <= we) };
}

async function weekTab(box, ctx) {
  const T = today(), ws = addDays(mondayOf(T), weekOffset * 7), f = weekFacts(ws), rec = store.list('review', r => r.kind === 'week' && r.start === ws)[0] || {};
  box.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn icon sm', 'aria-label': 'Earlier week', onclick: () => { weekOffset--; ctx.refresh(); } }, icon('chevL')), h('b', { style: { font: '700 1.5rem var(--f-title)' } }, `${niceDate(ws, true)} – ${niceDate(f.we, true)}`), h('button', { class: 'btn icon sm', 'aria-label': 'Later week', disabled: weekOffset >= 0, onclick: () => { weekOffset++; ctx.refresh(); } }, icon('chevR')), h('span', { class: 'grow' }), weekOffset === 0 ? h('span', { class: 'faint small' }, 'Best on Sunday evening') : ''));
  box.append(h('section', { class: 'card taped' }, h('div', { class: 'card-head' }, h('h3', {}, 'The week in numbers')), h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } }, [[f.done.length, 'things finished'], [f.moodAvg != null ? f.moodAvg.toFixed(1) : '–', 'avg mood'], [f.energyAvg != null ? f.energyAvg.toFixed(1) : '–', 'avg energy'], [f.workouts, 'workouts'], [Math.round(f.km * 10) / 10, 'km'], [f.inbox ? f.inbox : '✓', f.inbox ? 'left in inbox' : 'inbox clear']].map(([n, l]) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, l))))));
  box.append(h('div', { class: 'grid2' }, h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Mood')), line(f.moodByDay, { min: 1, max: 5, label: 'Mood this week' })), h('section', { class: 'card', style: { '--dom': 'var(--d-health)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Sleep')), bars(f.sleep, { goal: 7.5, h: 60, fmt: v => v + ' h', label: 'Sleep this week' }))));
  if (f.habits.length) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Habits')), f.habits.map(x => h('div', { class: 'item' }, h('div', { class: 'grow' }, x.name), h('span', { class: 'chip ' + (x.count >= x.target ? 'good' : '') }, `${x.count}/${x.target}`), x.streak > 1 ? h('span', { class: 'faint small' }, x.streak + ' streak') : ''))));
  if (f.done.length) box.append(h('details', { class: 'card' }, h('summary', { style: { cursor: 'pointer' } }, `Finished (${f.done.length})`), f.done.slice(0, 40).map(d => h('div', { class: 'item done' }, icon('check'), h('span', { class: 't' }, d.title)))));
  // what's coming: trips and expiries in the next 30 days, spend highlight from the wealth app
  const soon = [...store.list('trip', t => t.start && t.start >= T && t.start <= addDays(T, 30)).map(t => `${t.name} — ${niceDate(t.start, true)}`), ...store.list('travel_doc', d => d.expiry && d.expiry >= T && d.expiry <= addDays(T, 90)).map(d => `${d.name} expires ${niceDate(d.expiry, true)}`)];
  let wealth = null; try { const w = await store.api('/api/wealth/summary'); if (w.net_worth != null) wealth = w; } catch { /* hidden when unreachable */ }
  if (soon.length || wealth) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Coming up')), soon.map(s => h('div', { class: 'item' }, icon('calendar', 'mini'), s)), wealth && (wealth.upcoming || []).slice(0, 3).map(u => h('div', { class: 'item' }, icon('clock', 'mini'), `${u.name} ${u.amount ? cfg.currency + ' ' + u.amount : ''} · ${u.due}`))));
  // reflection
  const ans = { good: rec.good || '', drained: rec.drained || '', focus: rec.focus || '' }, top3 = [...(rec.top3 || ['', '', ''])];
  const ta = (k, label) => field(label, h('textarea', { class: 'in', value: ans[k], oninput: e => ans[k] = e.target.value }));
  const open = store.list('task', t => !t.done && !t.someday && inMode(t)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 30);
  const t3 = [0, 1, 2].map(i => h('input', { class: 'in', list: 'opentasks', value: top3[i] || '', placeholder: `Top ${i + 1} for next week`, 'aria-label': `Top ${i + 1}`, oninput: e => top3[i] = e.target.value }));
  box.append(h('section', { class: 'card', style: { '--dom': 'var(--d-goals)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Looking back')), h('div', { class: 'stack' }, ta('good', 'What went well?'), ta('drained', 'What drained me?'), ta('focus', 'What’s my one focus next week?'),
    h('div', {}, h('div', { class: 'small muted' }, 'Next week’s top three'), h('div', { class: 'stack-s' }, t3), h('datalist', { id: 'opentasks' }, open.map(t => h('option', { value: t.title })))),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: async e => { e.target.disabled = true; try { const j = await store.api('/api/ai/weekly', { method: 'POST', body: JSON.stringify({ facts: { done: f.done.slice(0, 20).map(d => d.title), mood_avg: f.moodAvg, energy_avg: f.energyAvg, workouts: f.workouts, sleep: f.sleep, habits: f.habits, wins: f.wins.map(w => w.title), gratitude: f.gratitude.map(g => g.text) } }) }); if (j.text) { const m = (k) => new RegExp('##\\s*' + k + '[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)', 'i').exec(j.text)?.[1]?.trim(); ans.good = m('What went well') || ans.good; ans.drained = m('What drained') || ans.drained; ctx.draft = j.text; toast('Draft added — edit it in your own words'); ctx.refresh(); } else toast('The assistant isn’t available right now'); } catch (er) { toast(er.message); } e.target.disabled = false; } }, icon('assistant'), 'Draft with assistant'),
      h('button', { class: 'btn primary', onclick: () => {
        const tasks = top3.filter(x => x.trim()); const r = store.put('review', { kind: 'week', start: ws, ...ans, top3: tasks }, rec.id);
        const md = `# Week of ${ws}\n\n- Finished: ${f.done.length} · mood ${f.moodAvg?.toFixed(1) ?? '–'} · energy ${f.energyAvg?.toFixed(1) ?? '–'} · ${f.workouts} workouts\n\n## What went well\n${ans.good}\n\n## What drained me\n${ans.drained}\n\n## One focus\n${ans.focus}\n\n## Top three\n${tasks.map(t => '- [ ] ' + t).join('\n')}\n`;
        const note = store.put('note', { title: `Weekly review ${ws}`, body: md, type: 'plain', tags: ['review'] }, rec.note_id); store.put('review', { note_id: note.id }, r.id);
        tasks.forEach(t => { if (!store.list('task', x => x.title === t && !x.done).length) store.put('task', { title: t, due: addDays(ws, 7), priority: 2, ctx: 'personal', tags: ['top3'], done: false }); });
        toast('Saved to Notes — your top three are on next week'); } }, icon('check'), 'Save review')))));
}

async function monthTab(box, ctx) {
  const T = today(), ym = T.slice(0, 7), first = ym + '-01', done = store.list('done_log', d => d.day.startsWith(ym)), wins = store.list('win', w => w.day.startsWith(ym)), rating = store.list('area_rating', r => r.month === ym)[0];
  box.append(h('section', { class: 'card taped' }, h('div', { class: 'card-head' }, h('h3', {}, new Date(first + 'T12:00:00Z').toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }))), h('div', { class: 'stat-row', style: { flexWrap: 'wrap' } }, [[done.length, 'things finished'], [wins.length, 'wins'], [store.list('garmin_activity', a => a.day.startsWith(ym)).length, 'workouts'], [store.list('visit', v => (v.start || '').startsWith(ym)).length, 'trips']].map(([n, l]) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, l))))));
  box.append(h('section', { class: 'card', style: { '--dom': 'var(--d-goals)' } }, h('div', { class: 'card-head' }, h('h3', {}, 'Goals')), store.list('goal', g => g.status === 'active').map(g => { const p = progress(g); return h('div', { class: 'item' }, h('div', { class: 'grow' }, g.title, h('div', { class: 'pbar', style: { marginTop: '4px' } }, h('i', { style: { width: p.pct + '%' } }))), h('span', { class: 'muted small' }, p.pct + '%')); }), h('a', { class: 'btn sm', href: '#/goals?tab=wheel' }, rating ? 'Wheel rated ✓' : 'Rate your life wheel')));
  if (wins.length) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Wins')), wins.map(w => h('div', { class: 'item' }, icon('star', 'mini'), w.title))));
  const gj = store.list('gratitude', g => g.day.startsWith(ym)); if (gj.length) box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Good things jar'), h('span', { class: 'count' }, gj.length)), gj.slice(0, 8).map(g => h('div', { class: 'item' }, g.text))));
  const out = h('p', { class: 'muted' }, 'A short written summary from the assistant, if connected.');
  box.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Summary')), out, h('button', { class: 'btn', onclick: async e => { e.target.disabled = true; try { const j = await store.api('/api/ai/weekly', { method: 'POST', body: JSON.stringify({ facts: { period: 'month ' + ym, finished: done.length, wins: wins.map(w => w.title), goals: store.list('goal', g => g.status === 'active').map(g => ({ title: g.title, pct: progress(g).pct })), workouts: store.list('garmin_activity', a => a.day.startsWith(ym)).length } }) }); out.textContent = j.text || 'The assistant isn’t available right now.'; } catch (er) { out.textContent = er.message; } e.target.disabled = false; } }, icon('assistant'), 'Write a summary')));
}

async function yearTab(box, ctx) {
  const Y = yearSel || +today().slice(0, 4), a = half === 'h2' ? `${Y}-07-01` : `${Y}-01-01`, b = half === 'h1' ? `${Y}-06-30` : `${Y}-12-31`, w = await world();
  const inR = d => d && d >= a && d <= b, visits = store.list('visit', v => inR(v.start)), countries = [...new Set(visits.map(v => v.country))], acts = store.list('garmin_activity', x => inR(x.day)), gd = store.list('garmin_daily', g => inR(g.day)), done = store.list('done_log', d => inR(d.day)), wins = store.list('win', x => inR(x.day)), moods = store.list('mood_log', m => inR(m.day) && m.mood != null);
  const trips = store.list('trip', t => inR(t.start) && (t.status === 'done' || t.end < today())), travel = await travelStats();
  const media = store.list('list_item', i => inR(i.done_at)), books = media.filter(i => i.medium === 'book'), eats = media.filter(i => i.cuisine !== undefined || /been/.test(i.status || ''));
  const weeks = {}; done.forEach(d => { const k = mondayOf(d.day); weeks[k] = (weeks[k] || 0) + 1; }); const best = Object.entries(weeks).sort((x, y) => y[1] - x[1])[0];
  const moodByMonth = Array.from({ length: 12 }, (_, i) => { const m = moods.filter(x => x.day.slice(5, 7) === String(i + 1).padStart(2, '0')); return m.length ? mean(m.map(x => x.mood)) : null; });
  const snaps = store.list('wealth_snapshot', s => inR(s.day)).sort((p, q) => p.day.localeCompare(q.day)), habits = store.list('habit', x => !x.archived).map(hb => ({ hb, n: [...logsFor(hb.id)].filter(inR).length, s: streak(hb) })).sort((p, q) => q.n - p.n);
  const big = (n, l) => h('div', { class: 'yr-stat' }, h('b', {}, n), h('span', {}, l));
  box.append(h('div', { class: 'row wrap no-print' }, h('button', { class: 'btn icon sm', 'aria-label': 'Earlier year', onclick: () => { yearSel = Y - 1; ctx.refresh(); } }, icon('chevL')), seg([['full', 'Full year'], ['h1', 'Jan–Jun'], ['h2', 'Jul–Dec']], half, v => { half = v; ctx.refresh(); }), h('button', { class: 'btn icon sm', 'aria-label': 'Later year', onclick: () => { yearSel = Y + 1; ctx.refresh(); } }, icon('chevR')), h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => window.print() }, icon('download'), 'Save as PDF / print')));
  box.append(h('section', { class: 'yr' }, h('h1', { class: 'yr-title' }, half === 'full' ? `${Y}, the year` : half === 'h1' ? `${Y}, so far` : `${Y}, second half`), h('p', { class: 'yr-sub' }, `${niceDate(a, true)} – ${niceDate(b > today() ? today() : b, true)}`),
    h('div', { class: 'yr-grid' }, big(countries.length, countries.length === 1 ? 'country' : 'countries'), big(Math.round(travel.km / 1000) + 'k', 'km flown (all time)'), big(acts.length, 'workouts'), big(Math.round(acts.reduce((s, x) => s + (x.distance_km || 0), 0)), 'km moved'), big(done.length, 'things finished'), big(wins.length, 'wins'), big(books.length, 'books'), big(eats.length, 'places & dishes tried')),
    countries.length ? h('p', { class: 'yr-p' }, 'You went to ', h('b', {}, countries.map(c => w.byA2[c]?.name || c).join(', ')), '.') : '', trips.length ? h('p', { class: 'yr-p' }, `${trips.length} trip${trips.length > 1 ? 's' : ''}: ${trips.map(t => t.name).join(' · ')}.`) : '',
    best ? h('p', { class: 'yr-p' }, 'Your best week was ', h('b', {}, 'the week of ' + niceDate(best[0], true)), ` — ${best[1]} things finished.`) : '',
    moods.length ? h('div', { class: 'yr-block' }, h('h3', {}, 'Mood arc'), line(moodByMonth, { min: 1, max: 5, h: 80, w: 480, label: 'Monthly average mood' }), h('p', { class: 'faint small' }, `Average ${mean(moods.map(m => m.mood)).toFixed(1)} of 5 over ${moods.length} check-ins.`)) : '',
    gd.length ? h('div', { class: 'yr-block' }, h('h3', {}, 'Sleep & steps'), h('p', { class: 'yr-p' }, `Average sleep ${mean(gd.filter(g => g.sleep_h).map(g => g.sleep_h))?.toFixed(1) ?? '–'} h · average ${Math.round(mean(gd.filter(g => g.steps).map(g => g.steps)) || 0).toLocaleString()} steps a day.`)) : '',
    habits.some(x => x.n) ? h('div', { class: 'yr-block' }, h('h3', {}, 'Habits'), habits.filter(x => x.n).slice(0, 5).map(x => h('div', { class: 'item' }, h('div', { class: 'grow' }, x.hb.name), h('span', { class: 'muted' }, `${x.n} days`), x.s > 1 ? h('span', { class: 'chip' }, x.s + ' streak now') : ''))) : '',
    snaps.length > 1 ? h('div', { class: 'yr-block' }, h('h3', {}, 'Money'), line(snaps.map(s => s.net_worth), { w: 480, h: 80, label: 'Net worth' }), h('p', { class: 'yr-p' }, `From ${cfg.currency} ${Math.round(snaps[0].net_worth).toLocaleString()} to ${Math.round(snaps[snaps.length - 1].net_worth).toLocaleString()}.`)) : '',
    books.length ? h('div', { class: 'yr-block' }, h('h3', {}, 'Books'), h('p', { class: 'yr-p' }, books.map(x => x.title).join(' · '))) : '', eats.length ? h('div', { class: 'yr-block' }, h('h3', {}, 'Tried & loved'), h('p', { class: 'yr-p' }, eats.slice(0, 20).map(x => x.title).join(' · '))) : '',
    wins.length ? h('div', { class: 'yr-block' }, h('h3', {}, 'Wins'), wins.slice(0, 15).map(x => h('div', { class: 'item' }, icon('star', 'mini'), x.title))) : ''));
  if (!countries.length && !acts.length && !done.length && !wins.length) box.append(empty('review', 'A blank year so far', 'As you finish things, log moods and add trips, this page fills itself in.'));
}

export default async function render(el, ctx) {
  el.append(h('div', { class: 'page-head no-print' }, h('h1', { class: 'squig' }, 'Review')), h('div', { class: 'no-print', style: { margin: '0 0 18px' } }, seg(TABS, tab, v => { tab = v; ctx.refresh(); })));
  const box = h('div', { class: 'stack' }); el.append(box); await ({ week: weekTab, month: monthTab, year: yearTab })[tab](box, ctx);
}
