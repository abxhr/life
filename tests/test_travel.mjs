import assert from 'node:assert/strict';
import { stayCalc, tripFits, passportOkAt, bridges, leaveNeeded, km, flightHours, DEFAULT_RULES, visaStale, buildChecklist, isUN } from '../static/js/travelcore.js';
const sch = DEFAULT_RULES[0], uk = DEFAULT_RULES[1];

// ---- Schengen 90/180 ----
let e = [{ country: 'FR', entry: '2026-01-01', exit: '2026-01-30' }, { country: 'IT', entry: '2026-03-01', exit: '2026-03-30' }];   // 30 + 30 days
let c = stayCalc(e, sch, '2026-04-15'); assert.equal(c.used, 60); assert.equal(c.remaining, 30);
assert.equal(stayCalc([{ country: 'DE', entry: '2026-01-01', exit: '2026-01-01' }], sch, '2026-01-01').used, 1, 'entry day = exit day counts as 1');
assert.equal(stayCalc([{ country: 'GB', entry: '2026-01-01', exit: '2026-03-30' }], sch, '2026-04-15').used, 0, 'UK is not Schengen');
// full 90 used in a block, window slides: leaving 2026-03-31, 90 days Jan 1 – Mar 31 inclusive
e = [{ country: 'ES', entry: '2026-01-01', exit: '2026-03-31' }]; c = stayCalc(e, sch, '2026-04-01'); assert.equal(c.used, 90); assert.equal(c.remaining, 0);
assert.equal(c.nextFree, '2026-06-30', 'Jan 1 leaves the 180-day window on Jun 30');
assert.equal(stayCalc(e, sch, c.nextFree).used < 90, true);
assert.equal(stayCalc(e, sch, '2026-06-29').used >= 90, true);
// open-ended stay counts up to asOf
assert.equal(stayCalc([{ country: 'PT', entry: '2026-05-01', exit: null }], sch, '2026-05-10').used, 10);
// trip planning
assert.equal(tripFits([{ country: 'FR', entry: '2026-01-01', exit: '2026-02-15' }], sch, '2026-03-01', '2026-04-15').ok, false);   // 46 + 46 = 92
assert.equal(tripFits([{ country: 'FR', entry: '2026-01-01', exit: '2026-02-15' }], sch, '2026-03-01', '2026-04-10').ok, true);    // 46 + 41 = 87
assert.equal(tripFits([{ country: 'FR', entry: '2026-01-01', exit: '2026-02-15' }], sch, '2026-03-01', '2026-04-14').ok, false);   // 46 + 45 = 91
// UK per-visit
c = stayCalc([{ country: 'GB', entry: '2026-01-01', exit: null }], uk, '2026-01-10'); assert.equal(c.used, 10); assert.equal(c.remaining, 170); assert.equal(c.leaveBy, '2026-06-29');

// ---- passport validity ----
assert.equal(passportOkAt('2027-05-01', '2026-10-30').ok, true);
assert.equal(passportOkAt('2027-04-15', '2026-10-30').ok, false, 'less than 6 months after return');
assert.equal(passportOkAt('2027-04-30', '2026-10-30').ok, true, 'exactly 6 months');
assert.equal(visaStale('2026-01-01', '2026-10-10'), true); assert.equal(visaStale('2026-08-01', '2026-10-10'), false); assert.equal(visaStale(null, '2026-10-10'), true);

// ---- leave bridges (UAE Mon-Fri) ----
const wd = [1, 2, 3, 4, 5];
const b = bridges(['2026-12-02', '2026-12-03'], wd, 2026);          // Wed + Thu holiday -> 1 leave day (Fri) = Wed..Sun 5 days off
assert.ok(b.some(w => w.leave === 1 && w.off >= 5 && w.start <= '2026-12-02' && w.end >= '2026-12-06'));
assert.equal(leaveNeeded('2026-12-01', '2026-12-07', wd, ['2026-12-02', '2026-12-03']), 3);   // Tue, Fri, Mon

// ---- distance ----
const d = km([25.2, 55.27], [51.5, -0.12]); assert.ok(d > 5300 && d < 5500); assert.ok(flightHours(d) >= 7 && flightHours(d) <= 8.5);
assert.equal(isUN('FR'), true); assert.equal(isUN('TW'), false);

// ---- checklist ----
const items = buildChecklist({ start: '2026-11-01', end: '2026-11-10', countries: ['JP'] }, { today: '2026-10-10', docs: [{ id: 'p1', type: 'passport', nationality: 'IN', expiry: '2027-03-01' }], rules: [], countryName: () => 'Japan' });
assert.equal(items.find(i => i.key === 'passport:p1').status, 'warn'); assert.ok(items.find(i => i.key === 'visa:JP')); assert.equal(items.find(i => i.key === 'insurance').status, 'todo');
console.log('travel OK');

// ---- a visa you already hold satisfies that country's checklist item ----
{ const its = buildChecklist({ start: '2026-11-01', end: '2026-11-10', countries: ['JP', 'SA'] }, { today: '2026-10-10', docs: [{ id: 'p1', type: 'passport', nationality: 'IN', expiry: '2030-01-01' }, { id: 'v1', type: 'visa', name: 'Japan tourist visa', nationality: 'JP', expiry: '2030-06-01' }, { id: 'v2', type: 'visa', name: 'Saudi e-visa', nationality: 'SA', expiry: '2026-11-05' }], rules: [], countryName: c => ({ JP: 'Japan', SA: 'Saudi Arabia' })[c] });
  const jp = its.find(i => i.key === 'visa:JP:v1'), sa = its.find(i => i.key === 'visa:SA:v2');
  assert.equal(jp.status, 'ok'); assert.ok(!its.some(i => i.key === 'visa:JP'), 'no "go check the rules" nag when you hold the visa');
  assert.equal(sa.status, 'warn', 'visa that expires before you are back is flagged'); }
console.log('held visas OK');

// ---- the checklist follows what the airline data says for MY passport ----
{ const its = buildChecklist({ start: '2026-11-20', end: '2026-11-25', countries: ['JP', 'TH', 'FR'] }, { today: '2026-10-10', docs: [], rules: [], countryName: c => c,
    entry: { JP: { verdict: 'eta_or_evisa', steps: ['Have a return or onward ticket'] }, TH: { verdict: 'visa_free', reason: 'India passport holders do not need a visa here' }, FR: { verdict: 'visa_required' } } });
  const get = k => its.find(i => i.key === k);
  assert.equal(get('visa:JP').status, 'todo'); assert.match(get('visa:JP').title, /Apply online for JP.* by 2026-11-06/); assert.equal(get('visa:TH').status, 'ok');
  assert.equal(get('visa:FR').status, 'todo'); assert.match(get('visa:FR').title, /by 2026-10-21/); }
console.log('entry-driven checklist OK');
