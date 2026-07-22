import type { GraphData } from '../../types.js';
import { validateAdjacencyConsistency } from '../validation/semantic.js';
import { initNameMap } from '../../utils/language-id.js';
import { buildFactContext, seedAuthoredFacts } from './facts/index.js';
import { deriveCandidateFacts, validateNoContradictions } from './derive/index.js';
import { certifyFacts, serializeCandidateFacts, serializeCertifiedFacts, stripGeneratedFacts } from './prove/index.js';
import { hydrateEntityReferenceRefs } from './entity-reference-refs.js';

export interface PropagationOptions {
  proofMode?: 'eager' | 'lazy';
  oldProofSource?: GraphData;
}

/**
 * Propagate all implicit relations from authored data.
 *
 * The new propagation route separates three phases:
 * 1. atomic candidate derivation;
 * 2. proof certification;
 * 3. serialization back to the existing database shape.
 */
export function propagateImplicitRelations(data: GraphData, options: PropagationOptions = {}): GraphData {
  data.adjacencyMatrix.indexByLanguage = Object.fromEntries(
    data.adjacencyMatrix.languageIds.map((id, index) => [id, index])
  );
  initNameMap(data.languages);

  // Entity assertions inside authored descriptions are proof premises too.
  // Hydrate their references before the fact context snapshots metadata so
  // downstream derivations inherit the complete reference set immediately.
  hydrateEntityReferenceRefs(data);

  const context = buildFactContext(data, options.oldProofSource);
  stripGeneratedFacts(data);

  const initialConsistency = validateAdjacencyConsistency(data);
  if (!initialConsistency.ok) {
    throw new Error(initialConsistency.error ?? 'Adjacency consistency validation failed');
  }

  const tables = deriveCandidateFacts(context, seedAuthoredFacts(context));
  validateNoContradictions(context, tables);
  if ((options.proofMode ?? 'eager') === 'lazy') {
    return serializeCandidateFacts(data, context, tables);
  }
  const certified = certifyFacts(context, tables);
  return serializeCertifiedFacts(data, context, tables, certified);
}

export function validateQueryConsistency(_data: GraphData): { ok: boolean; error?: string } {
  return { ok: true };
}
