import assert from 'node:assert/strict';
import { canonicalDataset } from '../src/lib/data/canonical.js';
import { applySandboxEdits } from '../src/lib/data/sandbox-transforms.js';

const sourceId = 'lang_43a33aec'; // uOBDD_<
const sddId = 'lang_1afefbe2';
const compactSddId = 'lang_83e3b023';

const result = applySandboxEdits(
  canonicalDataset,
  [
    {
      kind: 'edge',
      sourceId,
      targetId: sddId,
      status: 'no-poly-unknown-quasi',
      description:
        'The lower bound is due to \\citet{Vinall-Smeeth_2024}. ' +
        'The target supports negation: \\supportspoly{\\langref{SDD}}{\\NOTC}.',
      refs: ['Vinall-Smeeth_2024']
    }
  ],
  { proofMode: 'eager' }
);

if (!result.ok) throw new Error(result.error);

const { adjacencyMatrix } = result.graphData;
const sourceIndex = adjacencyMatrix.indexByLanguage[sourceId];
const sddIndex = adjacencyMatrix.indexByLanguage[sddId];
const compactSddIndex = adjacencyMatrix.indexByLanguage[compactSddId];
const authored = adjacencyMatrix.matrix[sourceIndex]?.[sddIndex];
const derived = adjacencyMatrix.matrix[sourceIndex]?.[compactSddIndex];

assert.ok(authored, 'Expected the authored uOBDD_< -> SDD relation');
assert.deepEqual(
  authored.refs,
  ['Vinall-Smeeth_2024', 'Darwiche_2011'],
  'Propagation must hydrate entity-reference citations before it snapshots authored facts'
);

assert.ok(derived, 'Expected propagation to derive uOBDD_< -> cSDD');
assert.deepEqual(
  derived.refs,
  ['Vinall-Smeeth_2024', 'Darwiche_2011', 'VanDenBroeck_2015'],
  'Derived proofs must inherit hydrated premise refs in deterministic premise order'
);

console.log('Propagation entity-reference hydration test passed.');
