import type { GraphData, DirectedSuccinctnessRelation, KCAdjacencyMatrix, DescriptionComponent, ProofTrace } from '../../types.js';
import {
  validateAdjacencyConsistency,
  guaranteesPoly,
  guaranteesQuasi,
  collectRefsUnion
} from '../validation/semantic.js';
import { idToName } from '../../utils/language-id.js';
import {
  DEBUG_PROPAGATION,
  POLY_STATUS,
  QUASI_STATUS,
  computeReachability,
  reconstructPathIndices,
  ensurePath,
  phraseForStatus,
  formatContradictingPremise,
  formatInlineAssumption,
  languageRefForId,
  negativeCompilationRef,
  positiveCompilationRef,
  collectAssumptionsUnion,
  describePath,
  buildNoPolyQuasiDescription,
  contradictionError,
  nextDerivationOrder
} from './helpers.js';

/**
 * Extract or create a noPolyDescription from an existing relation.
 * Used when the relation has a "no poly" claim (no-poly-unknown-quasi or no-poly-quasi).
 */
function extractNoPolyDescription(relation: DirectedSuccinctnessRelation | null): DescriptionComponent | null {
  if (!relation) return null;
  
  // If structured proof already exists, use it
  if (relation.noPolyDescription) {
    return relation.noPolyDescription;
  }
  
  // For no-poly-unknown-quasi or no-poly-quasi without structured proof,
  // the description justifies the "no poly" claim
  if (relation.status === 'no-poly-unknown-quasi' || relation.status === 'no-poly-quasi') {
    return {
      description: relation.description ?? '',
      refs: relation.refs ?? [],
      derived: relation.derived ?? false,
      ...(relation.derivationOrder !== undefined && { derivationOrder: relation.derivationOrder }),
      ...(relation.proofTrace && { proofTrace: relation.proofTrace })
    };
  }
  
  return null;
}

/**
 * Extract or create a quasiDescription from an existing relation.
 * Used when the relation has a "quasi exists" claim (unknown-poly-quasi or no-poly-quasi).
 */
function extractQuasiDescription(relation: DirectedSuccinctnessRelation | null): DescriptionComponent | null {
  if (!relation) return null;
  
  // If structured proof already exists, use it
  if (relation.quasiDescription) {
    return relation.quasiDescription;
  }
  
  // For unknown-poly-quasi or no-poly-quasi without structured proof,
  // the description justifies the "quasi exists" claim
  if (relation.status === 'unknown-poly-quasi' || relation.status === 'no-poly-quasi') {
    return {
      description: relation.description ?? '',
      refs: relation.refs ?? [],
      derived: relation.derived ?? false,
      ...(relation.derivationOrder !== undefined && { derivationOrder: relation.derivationOrder }),
      ...(relation.proofTrace && { proofTrace: relation.proofTrace })
    };
  }
  
  return null;
}

/**
 * Apply a standard upgrade (not no-poly-quasi).
 */
function applySimpleUpgrade(
  matrix: KCAdjacencyMatrix,
  path: number[],
  newStatus: string,
  derivedDescription: string,
  proofTrace: ProofTrace
): void {
  if (path.length === 0) return;
  const { languageIds } = matrix;
  const source = path[0];
  const target = path[path.length - 1];
  const refs = collectRefsUnion(path, matrix);
  const assumption = collectAssumptionsUnion(path, matrix);
  const pathIds = path.map((idx) => languageIds[idx]);
  const pathDesc = describePath(pathIds, matrix);
  // Append merged assumption to conclusion for provenance
  const conclusionWithAssumption = assumption
    ? derivedDescription.replace(/\.\s*$/, '') + formatInlineAssumption(assumption) + '.'
    : derivedDescription;
  const description = `${pathDesc} ${conclusionWithAssumption}`.trim();
  matrix.matrix[source][target] = {
    status: newStatus,
    refs,
    assumption,
    hidden: false,
    derived: true,
    description,
    derivationOrder: nextDerivationOrder(),
    proofTrace
  } satisfies DirectedSuccinctnessRelation;
}

/**
 * Apply upgrade from no-poly-unknown-quasi to no-poly-quasi.
 * Preserves the original noPolyDescription and adds a derived quasiDescription.
 */
function applyNoPolyQuasiUpgrade(
  matrix: KCAdjacencyMatrix,
  sourceIdx: number,
  targetIdx: number,
  path: number[],
  originalRelation: DirectedSuccinctnessRelation
): void {
  const { languageIds } = matrix;
  const srcId = languageIds[sourceIdx];
  const tgtId = languageIds[targetIdx];
  
  // Extract original noPolyDescription
  const noPolyDescription = extractNoPolyDescription(originalRelation) ?? {
    description: originalRelation.description ?? '',
    refs: originalRelation.refs ?? [],
    derived: originalRelation.derived ?? false
  };
  
  // Create derived quasiDescription
  const pathIds = path.map((idx) => languageIds[idx]);
  const pathDesc = describePath(pathIds, matrix);
  const pathAssumption = collectAssumptionsUnion(path, matrix);
  const quasiConclusion = pathAssumption
    ? `Therefore ${positiveCompilationRef(srcId, tgtId, 'quasi')}${formatInlineAssumption(pathAssumption)}.`
    : `Therefore ${positiveCompilationRef(srcId, tgtId, 'quasi')}.`;
  const quasiDesc = `${pathDesc} ${quasiConclusion}`;
  const quasiRefs = collectRefsUnion(path, matrix);
  const quasiDescription: DescriptionComponent = {
    description: quasiDesc,
    refs: quasiRefs,
    derived: true,
    derivationOrder: nextDerivationOrder(),
    proofTrace: { rule: 'transitivity', path: pathIds, level: 'quasi' }
  };
  
  // Combine refs from both proofs
  const allRefs = [...new Set([...noPolyDescription.refs, ...quasiDescription.refs])];
  
  // Merge assumptions: original assumption + path assumptions
  const originalAssumption = originalRelation.assumption;
  const allAssumptions = new Set<string>();
  if (originalAssumption) allAssumptions.add(originalAssumption);
  if (pathAssumption) {
    for (const c of pathAssumption.split(' AND ')) {
      allAssumptions.add(c.trim());
    }
  }
  const mergedAssumption = allAssumptions.size > 0 ? Array.from(allAssumptions).join(' AND ') : undefined;
  
  // derived = true only if BOTH proofs are derived
  const fullyDerived = noPolyDescription.derived && quasiDescription.derived;
  
  matrix.matrix[sourceIdx][targetIdx] = {
    status: 'no-poly-quasi',
    refs: allRefs,
    assumption: mergedAssumption,
    hidden: false,
    derived: fullyDerived,
    noPolyDescription,
    quasiDescription,
    description: buildNoPolyQuasiDescription(noPolyDescription, quasiDescription)
  } satisfies DirectedSuccinctnessRelation;
}

export function phaseOneUpgrade(
  matrix: KCAdjacencyMatrix,
  reachP: { reach: boolean[][]; parent: number[][] },
  reachQ: { reach: boolean[][]; parent: number[][] }
): number {
  const { languageIds } = matrix;
  const size = languageIds.length;
  let changes = 0;

  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (i === j) continue;
      const relation = matrix.matrix[i][j];
      const status = relation?.status ?? null;
      const srcId = languageIds[i];
      const tgtId = languageIds[j];
      const srcName = idToName(srcId);
      const tgtName = idToName(tgtId);

      // Quasi upgrades
      if (reachQ.reach[i][j] && !guaranteesQuasi(status)) {
        if (status === 'no-quasi') {
          const path = ensurePath(reconstructPathIndices(i, j, reachQ.parent[i]), i, j);
          const ids = path.map((idx) => languageIds[idx]);
          const desc = describePath(ids, matrix);
          contradictionError(
            `Contradiction: ${desc} Therefore ${positiveCompilationRef(srcId, tgtId, 'quasi')}, but ${negativeCompilationRef(srcId, tgtId, 'quasi')}.`
          );
        }
        const path = ensurePath(reconstructPathIndices(i, j, reachQ.parent[i]), i, j);
        const newStatus = status === 'no-poly-unknown-quasi' ? 'no-poly-quasi' : 'unknown-poly-quasi';
        if (DEBUG_PROPAGATION) {
          console.log(`[Propagation] UPGRADE ${srcName} -> ${tgtName}: ${status ?? 'null'} -> ${newStatus}`);
        }
        
        if (status === 'no-poly-unknown-quasi' && relation) {
          // Special case: use structured proof components
          applyNoPolyQuasiUpgrade(matrix, i, j, path, relation);
        } else {
          // Standard upgrade to unknown-poly-quasi
          const derivedDesc = `Therefore ${positiveCompilationRef(srcId, tgtId, 'quasi')}.`;
          const pathIds = path.map((idx) => languageIds[idx]);
          applySimpleUpgrade(matrix, path, newStatus, derivedDesc, { rule: 'transitivity', path: pathIds, level: 'quasi' });
        }
        changes += 1;
        continue; // allow re-evaluation in next fixed-point iteration
      }

      // Poly upgrades
      if (reachP.reach[i][j] && !guaranteesPoly(status)) {
        if (status === 'no-poly-quasi' || status === 'no-poly-unknown-quasi' || status === 'no-quasi') {
          const path = ensurePath(reconstructPathIndices(i, j, reachP.parent[i]), i, j);
          const ids = path.map((idx) => languageIds[idx]);
          const desc = describePath(ids, matrix);
          contradictionError(
            `Contradiction: ${desc} Therefore ${positiveCompilationRef(srcId, tgtId, 'poly')}, but ${negativeCompilationRef(srcId, tgtId, 'poly')}.`
          );
        }
        const path = ensurePath(reconstructPathIndices(i, j, reachP.parent[i]), i, j);
        const derivedDesc = `Therefore ${positiveCompilationRef(srcId, tgtId, 'poly')}.`;
        if (DEBUG_PROPAGATION) {
          console.log(`[Propagation] UPGRADE ${srcName} -> ${tgtName}: ${status ?? 'null'} -> poly`);
        }
        const polyPathIds = path.map((idx) => languageIds[idx]);
        applySimpleUpgrade(matrix, path, 'poly', derivedDesc, { rule: 'transitivity', path: polyPathIds, level: 'poly' });
        changes += 1;
      }
    }
  }

  return changes;
}

export function tryDowngrade(
  data: GraphData,
  source: number,
  target: number,
  reachP: { reach: boolean[][]; parent: number[][] },
  reachQ: { reach: boolean[][]; parent: number[][] }
): boolean {
  const { adjacencyMatrix } = data;
  const relation = adjacencyMatrix.matrix[source][target];
  const status = relation?.status ?? null;
  const languageIds = adjacencyMatrix.languageIds;
  const srcId = languageIds[source];
  const tgtId = languageIds[target];
  const srcName = idToName(srcId);
  const tgtName = idToName(tgtId);

  const isTestedEdge = (fromId: string, toId: string): boolean => fromId === srcId && toId === tgtId;

  const collectWitnessPathRefs = (witnessIds: string[]): string[] => {
    const refs = new Set<string>();
    for (let i = 0; i < witnessIds.length - 1; i++) {
      const fromId = witnessIds[i];
      const toId = witnessIds[i + 1];
      if (isTestedEdge(fromId, toId)) continue;
      const fromIdx = languageIds.indexOf(fromId);
      const toIdx = languageIds.indexOf(toId);
      const edgeRelation = adjacencyMatrix.matrix[fromIdx]?.[toIdx];
      for (const ref of edgeRelation?.refs ?? []) {
        refs.add(ref);
      }
    }
    return Array.from(refs);
  };

  const collectWitnessPathAssumption = (witnessIds: string[]): string | undefined => {
    const assumptions = new Set<string>();
    for (let i = 0; i < witnessIds.length - 1; i++) {
      const fromId = witnessIds[i];
      const toId = witnessIds[i + 1];
      if (isTestedEdge(fromId, toId)) continue;
      const fromIdx = languageIds.indexOf(fromId);
      const toIdx = languageIds.indexOf(toId);
      const edgeAssumption = adjacencyMatrix.matrix[fromIdx]?.[toIdx]?.assumption;
      if (edgeAssumption) {
        for (const c of edgeAssumption.split(' AND ')) {
          assumptions.add(c.trim());
        }
      }
    }
    return assumptions.size > 0 ? Array.from(assumptions).join(' AND ') : undefined;
  };

  const runConsistency = (nextStatus: string): { ok: boolean; witnessPath?: string[]; error?: string } => {
    const original = adjacencyMatrix.matrix[source][target];
    adjacencyMatrix.matrix[source][target] = {
      status: nextStatus,
      refs: original?.refs ?? [],
      hidden: original?.hidden ?? false,
      derived: true,
      description: original?.description
    } satisfies DirectedSuccinctnessRelation;
    const result = validateAdjacencyConsistency(data);
    // always restore the original relation after the trial
    adjacencyMatrix.matrix[source][target] = original ?? null;
    return result;
  };

  const buildContradictionDescription = (
    triedStatus: string,
    witnessIds: string[],
    mergedAssumption?: string
  ): string => {
    // witnessIds is the path that would exist if the tested edge had `triedStatus`
    // The contradiction is that the path endpoints have an incompatible status
    if (witnessIds.length < 2) {
      return `If ${languageRefForId(srcId)} compiled to ${languageRefForId(tgtId)} ${phraseForStatus(triedStatus)}, a contradiction arises${formatInlineAssumption(mergedAssumption)}.`;
    }

    const pathStart = witnessIds[0];
    const pathEnd = witnessIds[witnessIds.length - 1];

    // Get the actual status of the path endpoints (the contradiction)
    const startIdx = languageIds.indexOf(pathStart);
    const endIdx = languageIds.indexOf(pathEnd);
    const actualRelation = adjacencyMatrix.matrix[startIdx]?.[endIdx];
    const actualStatus = actualRelation?.status ?? 'unknown';
    const actualAssumption = actualRelation?.assumption;

    // Build premises: existing path edges (excluding the tested edge), each with inline assumptions
    const premises: string[] = [];
    for (let i = 0; i < witnessIds.length - 1; i++) {
      const fromId = witnessIds[i];
      const toId = witnessIds[i + 1];
      // Skip the edge we're testing
      if (fromId === languageIds[source] && toId === languageIds[target]) continue;
      const fromIdx = languageIds.indexOf(fromId);
      const toIdx = languageIds.indexOf(toId);
      const edgeRelation = adjacencyMatrix.matrix[fromIdx]?.[toIdx];
      const edgeStatus = edgeRelation?.status ?? 'unknown';
      premises.push(positiveCompilationRef(fromId, toId, edgeStatus));
    }

    // State the contradicting fact as a premise with its own inline assumption
    premises.push(formatContradictingPremise(pathStart, pathEnd, actualStatus, actualAssumption));

    const premisesPart = premises.join('. ') + '. ';
    const triedPhrase = phraseForStatus(triedStatus);
    const impliedPhrase = triedStatus === 'poly' ? 'in polynomial time' : 'in quasipolynomial time';
    const conclusion = triedStatus === 'poly'
      ? negativeCompilationRef(srcId, tgtId, 'poly')
      : negativeCompilationRef(srcId, tgtId, 'quasi');

    return `${premisesPart}If ${languageRefForId(srcId)} compiled to ${languageRefForId(tgtId)} ${triedPhrase}, then ${languageRefForId(pathStart)} would compile to ${languageRefForId(pathEnd)} ${impliedPhrase}, contradicting the above. Therefore ${conclusion}.`;
  };

  /**
   * Calculate the merged assumption from the witness path and contradicting edge.
   * This should be called before buildContradictionDescription.
   */
  const calculateMergedAssumption = (witnessIds: string[]): string | undefined => {
    const pathAssumption = collectWitnessPathAssumption(witnessIds);
    
    // Get the contradicting edge (from path start to path end)
    const pathStart = witnessIds[0];
    const pathEnd = witnessIds[witnessIds.length - 1];
    const startIdx = languageIds.indexOf(pathStart);
    const endIdx = languageIds.indexOf(pathEnd);
    const contradictingEdge = isTestedEdge(pathStart, pathEnd)
      ? null
      : adjacencyMatrix.matrix[startIdx]?.[endIdx];
    const contradictingAssumption = contradictingEdge?.assumption;
    
    // Merge all assumptions
    const allAssumptions = new Set<string>();
    if (pathAssumption) {
      for (const c of pathAssumption.split(' AND ')) {
        allAssumptions.add(c.trim());
      }
    }
    if (contradictingAssumption) {
      allAssumptions.add(contradictingAssumption);
    }
    return allAssumptions.size > 0 ? Array.from(allAssumptions).join(' AND ') : undefined;
  };

  const finalizeSimpleDowngrade = (
    nextStatus: string,
    triedStatus: string,
    witnessIds: string[]
  ): void => {
    const refs = new Set(collectWitnessPathRefs(witnessIds));
    const pathStart = witnessIds[0];
    const pathEnd = witnessIds[witnessIds.length - 1];
    const startIdx = languageIds.indexOf(pathStart);
    const endIdx = languageIds.indexOf(pathEnd);
    if (!isTestedEdge(pathStart, pathEnd)) {
      for (const ref of adjacencyMatrix.matrix[startIdx]?.[endIdx]?.refs ?? []) {
        refs.add(ref);
      }
    }
    
    // Calculate merged assumption from path + contradicting edge
    const assumption = calculateMergedAssumption(witnessIds);
    
    // Pass merged assumption to description builder so it appears in description text
    const newDesc = buildContradictionDescription(triedStatus, witnessIds, assumption);
    if (DEBUG_PROPAGATION) {
      console.log(`[Propagation] DOWNGRADE ${srcName} -> ${tgtName}: ${status ?? 'null'} -> ${nextStatus} (witness: ${witnessIds.map(idToName).join(' -> ')})`);
    }
    adjacencyMatrix.matrix[source][target] = {
      status: nextStatus,
      refs: Array.from(refs),
      assumption,
      hidden: false,
      derived: true,
      description: newDesc.trim(),
      derivationOrder: nextDerivationOrder(),
      proofTrace: { rule: 'contradiction', triedStatus, witnessPath: witnessIds }
    };
  };

  /**
   * Finalize downgrade from unknown-poly-quasi to no-poly-quasi.
   * Preserves the original quasiDescription and creates a derived noPolyDescription.
   */
  const finalizeNoPolyQuasiDowngrade = (
    witnessIds: string[]
  ): void => {
    // Extract original quasiDescription from the unknown-poly-quasi relation
    const quasiDescription = extractQuasiDescription(relation) ?? {
      description: relation?.description ?? '',
      refs: relation?.refs ?? [],
      derived: relation?.derived ?? false
    };
    
    // Relation-level assumptions still include the original quasi half, but the
    // newly derived no-poly proof should only use its own witness assumptions.
    const baseMergedAssumption = calculateMergedAssumption(witnessIds);
    const originalAssumption = relation?.assumption;
    const allAssumptions = new Set<string>();
    if (originalAssumption) allAssumptions.add(originalAssumption);
    if (baseMergedAssumption) {
      for (const c of baseMergedAssumption.split(' AND ')) {
        allAssumptions.add(c.trim());
      }
    }
    const mergedAssumption = allAssumptions.size > 0 ? Array.from(allAssumptions).join(' AND ') : undefined;
    
    // Create derived noPolyDescription from contradiction (with merged assumption)
    const noPolyDesc = buildContradictionDescription('poly', witnessIds, baseMergedAssumption);
    const noPolyRefs = collectWitnessPathRefs(witnessIds);
    const noPolyDerivOrder = nextDerivationOrder();
    const noPolyDescription: DescriptionComponent = {
      description: noPolyDesc,
      refs: noPolyRefs,
      derived: true,
      derivationOrder: noPolyDerivOrder,
      proofTrace: { rule: 'contradiction', triedStatus: 'poly', witnessPath: witnessIds }
    };
    
    // Combine refs from both proofs
    const allRefs = [...new Set([...noPolyDescription.refs, ...quasiDescription.refs])];
    
    // derived = true only if BOTH proofs are derived
    const fullyDerived = noPolyDescription.derived && quasiDescription.derived;
    
    if (DEBUG_PROPAGATION) {
      console.log(`[Propagation] DOWNGRADE ${srcName} -> ${tgtName}: ${status ?? 'null'} -> no-poly-quasi (witness: ${witnessIds.map(idToName).join(' -> ')})`);
    }
    
    adjacencyMatrix.matrix[source][target] = {
      status: 'no-poly-quasi',
      refs: allRefs,
      assumption: mergedAssumption,
      hidden: false,
      derived: fullyDerived,
      noPolyDescription,
      quasiDescription,
      description: buildNoPolyQuasiDescription(noPolyDescription, quasiDescription)
    };
  };

  // Case: null / unknown-both
  if (status === null || status === 'unknown-both') {
    // Trial poly
    const polyResult = runConsistency('poly');
    if (!polyResult.ok) {
      const witnessIds = polyResult.witnessPath ?? [languageIds[source], languageIds[target]];
      finalizeSimpleDowngrade('no-poly-unknown-quasi', 'poly', witnessIds);
      return true;
    }
    // Trial quasi
    const quasiResult = runConsistency('unknown-poly-quasi');
    if (!quasiResult.ok) {
      const witnessIds = quasiResult.witnessPath ?? [languageIds[source], languageIds[target]];
      finalizeSimpleDowngrade('no-quasi', 'unknown-poly-quasi', witnessIds);
      return true;
    }
    // restore original status (either null or unknown-both)
    adjacencyMatrix.matrix[source][target] = relation ?? null;
    return false;
  }

  // Case: unknown-poly-quasi
  if (status === 'unknown-poly-quasi') {
    const polyResult = runConsistency('poly');
    if (!polyResult.ok) {
      const witnessIds = polyResult.witnessPath ?? [languageIds[source], languageIds[target]];
      // Use structured proof for no-poly-quasi
      finalizeNoPolyQuasiDowngrade(witnessIds);
      return true;
    }
    adjacencyMatrix.matrix[source][target] = relation;
    return false;
  }

  // Case: no-poly-unknown-quasi
  if (status === 'no-poly-unknown-quasi') {
    const quasiResult = runConsistency('no-poly-quasi');
    if (!quasiResult.ok) {
      const witnessIds = quasiResult.witnessPath ?? [languageIds[source], languageIds[target]];
      finalizeSimpleDowngrade('no-quasi', 'no-poly-quasi', witnessIds);
      return true;
    }
    adjacencyMatrix.matrix[source][target] = relation;
    return false;
  }

  return false;
}
