import assert from 'node:assert/strict';
import { normTitle, sameItem } from '../static/js/dedupe.js';
assert.equal(normTitle('The Amélie (2001)'), 'amelie'); assert.equal(normTitle('Maisan 15 (Pizza variant)'), 'maisan 15');
assert.ok(sameItem({ title: 'The Amélie' }, { title: 'amelie (2001)' }) && sameItem({ title: 'Zuma', city: 'DIFC, Dubai' }, { title: 'ZUMA', city: 'Dubai' }));
assert.ok(sameItem({ title: 'Spider-Man: Into the Spider-Verse' }, { title: 'spider man into the spider verse' }));
assert.ok(!sameItem({ title: 'Zuma', city: 'Dubai' }, { title: 'Zuma', city: 'London' }), 'same name, other city');
assert.ok(!sameItem({ title: 'Dune', year: '1984' }, { title: 'Dune', year: 2021 }), 'remake'); assert.ok(!sameItem({ title: 'Fargo', medium: 'movie' }, { title: 'Fargo', medium: 'show' }));
assert.ok(!sameItem({ title: '' }, { title: '' }) && !sameItem({ title: 'A' }, { title: 'B' }));
console.log('dedupe OK');
