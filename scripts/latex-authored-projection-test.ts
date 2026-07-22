import assert from 'node:assert/strict';
import { authoredRelation } from '../src/lib/data/authored-relation.js';
import type { DescriptionComponent, DirectedSuccinctnessRelation } from '../src/lib/types.js';

function component(description: string, refs: string[], derived: boolean): DescriptionComponent {
  return {
    description,
    refs,
    derived,
    origin: derived ? 'derived' : 'authored'
  };
}

function combined(
  noPolyDescription: DescriptionComponent,
  quasiDescription: DescriptionComponent
): DirectedSuccinctnessRelation {
  return {
    status: 'no-poly-quasi',
    description: 'generated combined description',
    refs: ['top-level-ref-that-must-not-leak'],
    derived: false,
    origin: 'authored',
    noPolyDescription,
    quasiDescription
  };
}

const authoredNoPoly = component('authored no-poly', ['NoPolyRef'], false);
const derivedNoPoly = component('derived no-poly', ['DerivedNoPolyRef'], true);
const authoredQuasi = component('authored quasi', ['QuasiRef'], false);
const derivedQuasi = component('derived quasi', ['DerivedQuasiRef'], true);

const quasiOnlyInput = combined(derivedNoPoly, authoredQuasi);
const quasiOnlySnapshot = structuredClone(quasiOnlyInput);
assert.deepEqual(authoredRelation(quasiOnlyInput), {
  status: 'unknown-poly-quasi',
  description: 'authored quasi',
  refs: ['QuasiRef'],
  derived: false,
  origin: 'authored'
});
assert.deepEqual(quasiOnlyInput, quasiOnlySnapshot, 'projection must not mutate propagated data');

assert.deepEqual(authoredRelation(combined(authoredNoPoly, derivedQuasi)), {
  status: 'no-poly-unknown-quasi',
  description: 'authored no-poly',
  refs: ['NoPolyRef'],
  derived: false,
  origin: 'authored'
});

assert.equal(authoredRelation(combined(derivedNoPoly, derivedQuasi)), null);

const bothAuthored = authoredRelation(combined(authoredNoPoly, authoredQuasi));
assert.equal(bothAuthored?.status, 'no-poly-quasi');
assert.deepEqual(bothAuthored?.refs, ['NoPolyRef', 'QuasiRef']);
assert.equal(bothAuthored?.noPolyDescription?.description, 'authored no-poly');
assert.equal(bothAuthored?.quasiDescription?.description, 'authored quasi');

assert.equal(authoredRelation({
  status: 'poly',
  description: 'derived relation',
  refs: [],
  derived: true,
  origin: 'derived'
}), null);

const legacyFlat: DirectedSuccinctnessRelation = {
  status: 'no-poly-quasi',
  description: 'legacy flat authored relation',
  refs: ['LegacyRef'],
  derived: false,
  origin: 'authored'
};
assert.equal(authoredRelation(legacyFlat), legacyFlat);

console.log('Authored relation projection tests passed.');
