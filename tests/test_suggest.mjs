import assert from 'node:assert/strict';
import { suggest, surprise, weekendPlan } from '../static/js/suggest.js';
const today = '2026-10-10';
const data = {
  tasks: [{ id: 't1', title: 'Renew passport', due: '2026-10-05', priority: 1, est: 30 }, { id: 't2', title: 'Write report', due: today, est: 180 }, { id: 't3', title: 'Buy cable', est: 10, ctx: 'errands' }],
  goals: [{ id: 'g1', title: 'Run 100km', status: 'active', quarterly: true, milestones: [{ title: 'Run 5km Saturday', done: false }] }],
  habits: [{ id: 'h1', name: 'Read 20 min', done: false, streak: 6, freq: 'daily' }],
  items: [{ id: 'i1', listType: 'play', activity: 'padel', title: 'Padel at Dubai Hills', status: 'want to try', area: 'Dubai Hills' }, { id: 'i2', listType: 'restaurant', title: 'Pompi', status: 'want to go', price: '$$', cuisine: 'Italian' }],
  people: [{ id: 'p1', name: 'Mum', keep_weeks: 1, last_contact: '2026-09-10' }], trips: [], feedback: {}, body: { battery: 80, sleep: 7.5 },
};
const base = { mins: 30, energy: 3, where: 'home', company: 'solo', hour: 11, today, weather: {} };
let r = suggest(base, data);
assert.equal(r.top[0].title, 'Renew passport'); assert.match(r.top[0].reason, /overdue/);
assert.ok(!r.top.some(o => o.title === 'Write report'), '180-min task does not fit 30 min');
assert.equal(new Set(r.top.map(o => o.kind)).size, r.top.length, 'diverse kinds');
r = suggest(base, { ...data, body: { battery: 20, sleep: 5 } }); assert.equal(r.top[0].kind, 'rest', 'low readiness -> rest');
r = suggest({ ...base, mins: 180, where: 'out', company: 'friends', weather: { rain: true } }, data); assert.ok(r.all.find(o => o.key === 'item:i1').score < 20, 'rain drops outdoor padel below the cut');
r = suggest({ ...base, mins: 180, where: 'out', company: 'friends' }, data); assert.ok(r.all.find(o => o.key === 'item:i1').score > 60, 'friends + fine weather boosts padel');
const k = suggest(base, data).top[0].key; r = suggest(base, { ...data, feedback: { [k]: 2 } }); assert.notEqual(r.top[0].key, k, '"not this" demotes');
assert.ok(surprise(suggest(base, data).all, () => 0.01));
assert.ok(weekendPlan(data, { ...base, company: 'partner' }).length >= 3);
console.log('suggest OK');
