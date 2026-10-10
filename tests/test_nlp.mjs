import assert from 'node:assert/strict';
import { parse } from '../static/js/nlp.js';
import { nextDue, nextFuture } from '../static/js/recur.js';
import { localToUtc, addMonths, diffDays } from '../static/js/util.js';
const NOW = '2026-10-10'; // a Saturday
const p = (t, hm = '10:00') => parse(t, { now: NOW, nowHM: hm });
let r;
r = p('call mum tomorrow 3pm #family @home !high +Japan-trip'); // project greedy-caps
assert.equal(r.due, '2026-10-11'); assert.equal(r.time, '15:00'); assert.deepEqual(r.tags, ['family']); assert.equal(r.ctx, 'home'); assert.equal(r.priority, 2); assert.equal(r.title, 'Call mum'); assert.equal(r.project, 'Japan trip');
r = p('pay rent every month'); assert.deepEqual(r.recur, { freq: 'month', interval: 1, after: false }); assert.equal(r.title, 'Pay rent');
r = p('standup every monday'); assert.deepEqual(r.recur.byday, [1]); assert.equal(r.due, '2026-10-12');
r = p('gym every weekday 7am'); assert.deepEqual(r.recur.byday, [1, 2, 3, 4, 5]); assert.equal(r.time, '07:00');
r = p('water plants every 3 days after done'); assert.equal(r.recur.interval, 3); assert.equal(r.recur.after, true);
r = p('submit report in 2 weeks'); assert.equal(r.due, '2026-10-24'); assert.equal(r.title, 'Submit report');
r = p('dentist next friday'); assert.equal(r.due, '2026-10-16');
r = p('dentist friday'); assert.equal(r.due, '2026-10-16');
r = p('passport 12 mar'); assert.equal(r.due, '2027-03-12');
r = p('birthday 5/11'); assert.equal(r.due, '2026-11-05');
r = p('ship it in 90 min', '10:00'); assert.equal(r.time, '11:30'); assert.equal(r.due, NOW);
r = p('read book tonight'); assert.equal(r.time, '20:00'); assert.equal(r.due, NOW);
r = p('email finance at 9'); assert.equal(r.time, '21:00'.replace('21','09') === '09:00' ? '09:00' : r.time); // "at 9" -> 9 (>=7 stays am)
r = p('buy milk'); assert.equal(r.due, null); assert.equal(r.title, 'Buy milk');
r = p('something @outside #work'); assert.equal(r.ctx, 'work-outside-work');
// recurrence
assert.equal(nextDue({ freq: 'month', interval: 1 }, '2026-01-31'), '2026-02-28');
assert.equal(nextDue({ freq: 'month', interval: 1 }, '2026-02-28', { anchorDay: 31 }), '2026-03-31');
assert.equal(nextDue({ freq: 'month', interval: 1 }, '2028-01-31'), '2028-02-29');
assert.equal(nextDue({ freq: 'week', interval: 1, byday: [1, 3] }, '2026-10-12'), '2026-10-14');
assert.equal(nextDue({ freq: 'week', interval: 1, byday: [1, 3] }, '2026-10-14'), '2026-10-19');
assert.equal(nextDue({ freq: 'week', interval: 2, byday: [1] }, '2026-10-12'), '2026-10-26');
assert.equal(nextDue({ freq: 'day', interval: 3, after: true }, '2026-10-01', { doneOn: '2026-10-10' }), '2026-10-13');
assert.equal(nextFuture({ freq: 'day', interval: 1 }, '2026-10-01', NOW), '2026-10-11');
assert.equal(nextDue({ freq: 'year', interval: 1 }, '2024-02-29'), '2025-02-28');
// DST: Europe/London 2026-03-29 01:30 does not exist; 2026-10-25 01:30 happens twice. Dubai has no DST.
assert.equal(localToUtc('2026-10-10', '09:00', 'Asia/Dubai').toISOString(), '2026-10-10T05:00:00.000Z');
assert.equal(localToUtc('2026-07-01', '09:00', 'Europe/London').toISOString(), '2026-07-01T08:00:00.000Z');
assert.equal(localToUtc('2026-12-01', '09:00', 'Europe/London').toISOString(), '2026-12-01T09:00:00.000Z');
assert.equal(diffDays('2026-02-28', '2026-03-01'), 1);
console.log('nlp/recur/time OK');
// ---- QR hand-off: encode with the real work-page code, decode with the phone code ----
globalThis.window = {}; globalThis.document = { addEventListener() {} };
await import('../static/work/work-capture.js');
const { makeCollector, itemId, linesFromText } = await import('../static/js/qrhandoff.js');
const items = Array.from({ length: 40 }, (_, i) => ({ id: 'id' + i, title: 'Send report number ' + i + ' to finance', tags: ['today'], due: '2026-10-12', time: '14:00', done: 0 }));
items.push({ id: 'x', title: 'finished', tags: [], done: 1 }); items.push({ id: 'y', title: 'gone', tags: [], deleted: 1 });
const enc = window.__lifeQR.encodeItems(items);
assert.equal(enc.count, 40); assert.ok(enc.out.length > 3, 'multi-chunk');
let col = makeCollector(), res; const shuffled = [...enc.out].reverse();
for (const c of shuffled) res = col.add(c);               // order-independent
assert.equal(res.state, 'done'); assert.equal(res.items.length, 40); assert.match(res.items[0].t, /Send report number 0 to finance #today 2026-10-12 14:00/);
res = makeCollector().add(enc.out[0].replace(/:[^:]*$/, ':AAAA')); assert.equal(res.state, 'partial'); // wrong data, incomplete
const bad = [...enc.out]; bad[1] = bad[1].slice(0, -3) + 'AAA'; col = makeCollector(); for (const c of bad) res = col.add(c); assert.equal(res.state, 'bad'); // checksum catches corruption
assert.equal(await itemId(' Call Mum '), await itemId('call mum'));   // repeat scans -> same id -> no duplicate
assert.deepEqual(linesFromText('- a\n* b\n1. c\n[ ] d\n\n'), ['a', 'b', 'c', 'd']);
console.log('QR hand-off OK');
