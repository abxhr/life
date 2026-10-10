import assert from 'node:assert/strict';
import { evalFormula, compile, rollup } from '../static/js/formula.js';
import { parseCSV, toCSV, rowsToItems, mapColumns } from '../static/js/csv.js';
import { mdToNodes } from '../static/js/md.js';

// ---- formulas ----
assert.equal(evalFormula('price * qty', { price: 12.5, qty: 4 }), 50);
assert.equal(evalFormula('(a + b) / 2', { a: 3, b: 4 }), 3.5);
assert.equal(evalFormula('-a + 10', { a: 3 }), 7);
assert.equal(evalFormula('2 + 3 * 4', {}), 14, 'precedence');
assert.equal(evalFormula('round(total / 3, 1)', { total: 10 }), 3.3);
assert.equal(evalFormula('if(rating >= 4, 1, 0)', { rating: 5 }), 1);
assert.equal(evalFormula('if(rating >= 4, 1, 0)', { rating: 2 }), 0);
assert.equal(evalFormula('daysSince(last)', { last: '2026-10-01' }, '2026-10-10'), 9);
assert.equal(evalFormula('daysUntil(due)', { due: '2026-10-15' }, '2026-10-10'), 5);
assert.equal(evalFormula('a / b', { a: 1, b: 0 }), null, 'divide by zero is empty, not Infinity');
assert.equal(evalFormula('missing * 3', {}), 0, 'blank fields count as 0');
assert.equal(evalFormula('max(a, b, 3)', { a: 1, b: 9 }), 9);
for (const bad of ['1 +', '(1', 'foo(', 'a $ b', 'evil(1)']) assert.throws(() => compile(bad), undefined, bad);
assert.throws(() => compile('process.exit()'), undefined, 'no property access: this is not eval');
// ---- rollups ----
const items = [{ p: 10, s: 'done' }, { p: 20, s: 'want' }, { p: '', s: 'done' }, { p: 'x', s: 'want' }];
const done = i => i.s === 'done';
assert.equal(rollup('sum', items, 'p'), 30); assert.equal(rollup('avg', items, 'p'), 15); assert.equal(rollup('min', items, 'p'), 10); assert.equal(rollup('max', items, 'p'), 20);
assert.equal(rollup('count', items, 'p'), 4); assert.equal(rollup('done', items, 'p', done), 2); assert.equal(rollup('percentDone', items, 'p', done), 50); assert.equal(rollup('avg', [], 'p'), null);
// ---- CSV ----
const rows = [['Name', 'Notes', 'Rating'], ['Pompi, "the" tiramisu', 'line1\nline2', 5], ['Plain', '', '']];
const text = toCSV(rows[0], rows.slice(1)); const back = parseCSV(text);
assert.deepEqual(back[1], ['Pompi, "the" tiramisu', 'line1\nline2', '5']); assert.deepEqual(back[2], ['Plain', '', '']); assert.equal(back.length, 3);
assert.deepEqual(parseCSV('﻿a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']], 'BOM + CRLF');
const fields = [{ k: 'cuisine', label: 'Cuisine', type: 'text' }, { k: 'rating', label: 'Rating', type: 'rating' }];
assert.deepEqual(mapColumns(['Restaurant Name', 'name', 'CUISINE', 'rating', 'junk'], fields), [null, 'title', 'cuisine', 'rating', null]);
const its = rowsToItems(parseCSV('Name,Cuisine,Rating,Tags\nPompi,Italian,5,"a; b"\n,Empty,1,\n'), fields);
assert.deepEqual(its, [{ title: 'Pompi', cuisine: 'Italian', rating: 5, tags: ['a', 'b'] }], 'rows without a title are skipped; numbers coerced; tags split');
// ---- markdown blocks: toggles, callouts, dividers (rendered as DOM, never HTML strings) ----
globalThis.document = { createElement: t => { const e = { nodeType: 1, tag: t, children: [], attrs: {}, style: {}, className: '', append(...k) { k.flat().forEach(x => this.children.push(x)); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }; return e; }, createTextNode: s => ({ nodeType: 3, text: String(s) }) };
const tags = n => (n.tag ? [n.tag, ...n.children.flatMap(tags)] : []);
const nodes = mdToNodes('::: toggle More details\nhidden text\n:::\n\n> [!tip] Remember\n> the milk\n\n---\n\nplain');
const all = nodes.flatMap(tags);
assert.ok(all.includes('details') && all.includes('summary'), 'toggle block'); assert.ok(nodes.some(n => n.className.includes('callout')), 'callout'); assert.ok(all.includes('hr'), 'divider');
// ---- automations (pure rules) ----
import { triggerMatches, scheduleDue, fill } from '../static/js/automation-core.js';
const A = (trigger) => ({ enabled: true, trigger });
assert.ok(triggerMatches(A({ type: 'task_done', project: 'japan' }), { type: 'task_done', rec: { project: 'Japan trip' } }), 'project filter is a case-insensitive contains');
assert.ok(!triggerMatches(A({ type: 'task_done', project: 'japan' }), { type: 'task_done', rec: { project: 'Work' } }));
assert.ok(!triggerMatches({ enabled: false, trigger: { type: 'task_done' } }, { type: 'task_done', rec: {} }), 'disabled rules never fire');
assert.ok(triggerMatches(A({ type: 'item_status', to: 'been, loved', list: 'rome' }), { type: 'item_status', rec: { status: 'been, loved' }, listName: 'Rome — must eat' }));
assert.ok(!triggerMatches(A({ type: 'item_status', to: 'been, loved' }), { type: 'item_status', rec: { status: 'want to go' }, listName: '' }));
assert.ok(!triggerMatches(A({ type: 'task_done' }), { type: 'item_status', rec: {} }), 'wrong event type');
const mon = { date: '2026-10-12', time: '08:30', dow: 1, dom: 12 }, sched = (t) => A({ type: 'schedule', ...t });
assert.ok(scheduleDue(sched({ freq: 'weekly', dow: 1, time: '08:00' }), mon, '2026-10-05'), 'Monday 08:30 after the 08:00 slot, last ran last week');
assert.ok(!scheduleDue(sched({ freq: 'weekly', dow: 1, time: '08:00' }), mon, '2026-10-12'), 'already ran today: never twice');
assert.ok(!scheduleDue(sched({ freq: 'weekly', dow: 1, time: '09:00' }), mon, null), 'before the time');
assert.ok(!scheduleDue(sched({ freq: 'weekly', dow: 2, time: '08:00' }), mon, null), 'wrong weekday');
assert.ok(scheduleDue(sched({ freq: 'daily', time: '07:00' }), mon, '2026-10-11')); assert.ok(scheduleDue(sched({ freq: 'monthly', dom: 12, time: '08:00' }), mon, null)); assert.ok(!scheduleDue(sched({ freq: 'monthly', dom: 1, time: '08:00' }), mon, null));
assert.equal(fill('Follow up on {title} ({date}) {nope}', { title: 'Send deck', date: '2026-10-12' }), 'Follow up on Send deck (2026-10-12) ');
// ---- near-a-place reminders ----
import { nearbyDue, metres } from '../static/js/geo-core.js';
const home = { lat: 25.2048, lon: 55.2708 }, shop = { lat: 25.2051, lon: 55.2711, radius: 300 }, far = { lat: 25.3, lon: 55.4, radius: 300 };
assert.ok(metres(home, shop) < 60 && metres(home, far) > 10000);
assert.deepEqual(nearbyDue(home, [{ id: 'a', near: shop }, { id: 'b', near: far }, { id: 'c', near: shop, done: true }, { id: 'd' }], new Set()).map(t => t.id), ['a'], 'only open tasks inside their radius');
assert.deepEqual(nearbyDue(home, [{ id: 'a', near: shop }], new Set(['a'])), [], 'only once per visit');
console.log('notion-style features OK');
