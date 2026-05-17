import type { GraphData } from '../../types.js';
import { expandBatchClaims } from '../batch-claims.js';
import { validateAdjacencyConsistency } from '../validation/semantic.js';
import { initNameMap } from '../../utils/language-id.js';
import { OPERATION_LEMMAS } from '../query-lemmas.js';
import {
  POLY_STATUS,
  QUASI_STATUS,
  rebuildIndexMap,
  computeReachability,
  resetDerivationCounter,
  getDerivationCount
} from './helpers.js';
import { phaseOneUpgrade, tryDowngrade } from './edge-propagation.js';
import {
  propagateQueriesViaSuccinctness,
  propagateQueriesViaLemmas,
  propagateQueryDowngrades,
  propagateDowngradesViaLemmaContrapositives,
  propagateSuccinctnessViaQueries,
  validateQueryConsistency
} from './query-propagation.js';

export { validateQueryConsistency } from './query-propagation.js';

/**
 * Implicit propagation pass: rebuild indices, enforce fixed-point quasi/poly upgrades (Phase 1),
 * then perform contradiction-based downgrades (Phase 2), query propagation (Phases 3-5),
 * and succinctness-by-query derivation (Phase 6).
 *
 * A global fixed-point loop ensures that Phase 6's new negative edges are fed back
 * into earlier phases until no more changes occur.
 */
export function propagateImplicitRelations(data: GraphData): GraphData {
  const { adjacencyMatrix } = data;
  adjacencyMatrix.indexByLanguage = rebuildIndexMap(adjacencyMatrix.languageIds);

  // Initialize the name map for id-to-name resolution
  initNameMap(data.languages);

  // Reset derivation counter for Lean proof ordering
  resetDerivationCounter();

  // Phase 0: consistency guard
  const consistencyResult = validateAdjacencyConsistency(data);
  if (!consistencyResult.ok) {
    throw new Error(consistencyResult.error ?? 'Adjacency consistency validation failed');
  }

  // Global fixed-point: Phases 1-2 → Phases 3-5 → Phase 6 → repeat if changed
  let globalChanged = true;
  while (globalChanged) {
    globalChanged = false;

    // Phase 1: fixed-point upgrades
    let changed = true;
    while (changed) {
      const reachQ = computeReachability(adjacencyMatrix, QUASI_STATUS);
      const reachP = computeReachability(adjacencyMatrix, POLY_STATUS);
      const upgrades = phaseOneUpgrade(adjacencyMatrix, reachP, reachQ);
      changed = upgrades > 0;
    }

    // Phase 2: contradiction-driven downgrades (repeat-until-stable)
    let downgraded = true;
    while (downgraded) {
      downgraded = false;
      const reachQ = computeReachability(adjacencyMatrix, QUASI_STATUS);
      const reachP = computeReachability(adjacencyMatrix, POLY_STATUS);
      for (let i = 0; i < adjacencyMatrix.languageIds.length; i += 1) {
        for (let j = 0; j < adjacencyMatrix.languageIds.length; j += 1) {
          if (i === j) continue;
          if (tryDowngrade(data, i, j, reachP, reachQ)) {
            downgraded = true;
          }
        }
      }
    }

    // Expand authored batch claims after edge closure so selector-based batches
    // can depend on both direct and derived succinctness edges.
    expandBatchClaims(data);

    // Phase 3-5: Query propagation
    propagateQueryOperations(data);

    // Phase 6: Succinctness by query — derive negative edges from query differences
    if (propagateSuccinctnessViaQueries(data)) {
      globalChanged = true;
    }
  }

  return data;
}

/**
 * Main query propagation function.
 * Runs phases 3-5 of Level 2 propagation.
 */
function propagateQueryOperations(data: GraphData): void {
  const { adjacencyMatrix } = data;

  // Phase 3+4: Fixed-point upgrades (poly first, then quasi)
  let polyChanged = true;
  while (polyChanged) {
    const reachP = computeReachability(adjacencyMatrix, POLY_STATUS);
    const reachQ = computeReachability(adjacencyMatrix, QUASI_STATUS);
    polyChanged = false;
    if (propagateQueriesViaSuccinctness(data, reachP, reachQ, true)) {
      polyChanged = true;
    }
    if (propagateQueriesViaLemmas(data, OPERATION_LEMMAS, true)) {
      polyChanged = true;
    }
  }

  let quasiChanged = true;
  while (quasiChanged) {
    const reachP = computeReachability(adjacencyMatrix, POLY_STATUS);
    const reachQ = computeReachability(adjacencyMatrix, QUASI_STATUS);
    quasiChanged = false;
    if (propagateQueriesViaSuccinctness(data, reachP, reachQ, false)) {
      quasiChanged = true;
    }
    if (propagateQueriesViaLemmas(data, OPERATION_LEMMAS, false)) {
      quasiChanged = true;
    }
  }

  // Phase 5: Downgrades (via succinctness and lemma contrapositives)
  let downgradeChanged = true;
  while (downgradeChanged) {
    const reachP = computeReachability(adjacencyMatrix, POLY_STATUS);
    const reachQ = computeReachability(adjacencyMatrix, QUASI_STATUS);
    downgradeChanged = false;
    if (propagateQueryDowngrades(data, reachP, reachQ)) {
      downgradeChanged = true;
    }
    if (propagateDowngradesViaLemmaContrapositives(data, OPERATION_LEMMAS)) {
      downgradeChanged = true;
    }
  }

  // Post-propagation validation: ensure no contradictions remain
  const consistency = validateQueryConsistency(data);
  if (!consistency.ok) {
    throw new Error(consistency.error ?? 'Query consistency validation failed after propagation');
  }
}
