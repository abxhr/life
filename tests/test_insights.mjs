import assert from 'node:assert/strict';
import { insights } from '../static/js/insights.js';
const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// 8 short-sleep days (mood ~2.5) and 12 long-sleep days (mood ~3.9)
const days = [...mk(8, i => ({ day: 'a' + i, mood: 2.5, energy: 3, sleep_h: 5.5 })), ...mk(12, i => ({ day: 'b' + i, mood: 3.9, energy: 3, sleep_h: 7.4 }))];
let r = insights(days); assert.equal(r.length, 1); assert.match(r[0].text, /less than 6\.5 h of sleep your mood averages 2\.5 vs 3\.9/); assert.deepEqual(r[0].n, [8, 12]); assert.match(r[0].note, /not a diagnosis/);
assert.equal(insights(days.slice(0, 4)).length, 0, 'tiny samples say nothing');
assert.equal(insights(mk(20, i => ({ day: 'c' + i, mood: 3.2 + (i % 2) * .1, energy: 3, sleep_h: i < 10 ? 5 : 8 }))).length, 0, 'differences under 0.4 are noise');
r = insights(mk(20, i => ({ day: 'd' + i, mood: i < 10 ? 2 : 4, energy: i < 10 ? 2 : 4, workout: i >= 10, steps: i >= 10 ? 9000 : 3000 }))); assert.ok(r.some(x => x.factor === 'workout') && r.some(x => x.metric === 'energy'));
console.log('insights OK');
