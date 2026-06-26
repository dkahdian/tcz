import type { GraphData, KCAdjacencyMatrix, KCLanguage, KCOpSupport, OperationLemma, DescriptionComponent, ProofTrace } from '../../types.js';
import { idToName } from '../../utils/language-id.js';
import { getAllQueryCodes, QUERIES, TRANSFORMATIONS } from '../operations.js';
import {
  DEBUG_PROPAGATION,
  POLY_STATUS,
  QUASI_STATUS,
  computeReachability,
  reconstructPathIndices,
  ensurePath,
  collectAssumptionsUnion,
  formatCitations,
  formatInlineAssumption,
  languageRefForId,
  positiveCompilationRef,
  buildNoPolyQuasiDescription,
  contradictionError,
  nextDerivationOrder
} from './helpers.js';

// =============================================================================
// Reachability type with parent tracking for path reconstruction
// =============================================================================
type Reachability = { reach: boolean[][]; parent: number[][] };

/**
 * Merge multiple optional assumptions into a single assumption string.
 * Returns undefined if no assumptions, a single assumption if only one unique,
 * or assumptions joined with " AND " if multiple unique assumptions.
 */
function mergeAssumptions(...assumptions: (string | undefined)[]): string | undefined {
  const set = new Set<string>();
  for (const c of assumptions) {
    if (c) set.add(c);
  }
  if (set.size === 0) return undefined;
  return Array.from(set).join(' AND ');
}

function uniqueRefs(...refLists: Array<string[] | undefined>): string[] {
  const refs = new Set<string>();
  for (const refList of refLists) {
    for (const ref of refList ?? []) {
      if (ref) refs.add(ref);
    }
  }
  return Array.from(refs);
}

/**
 * Collect edge assumptions along the reachability path from source to target.
 */
function collectPathAssumptions(
  sourceIdx: number,
  targetIdx: number,
  parent: number[][],
  matrix: KCAdjacencyMatrix
): string | undefined {
  const pathIndices = reconstructPathIndices(sourceIdx, targetIdx, parent[sourceIdx]);
  const path = ensurePath(pathIndices, sourceIdx, targetIdx);
  return collectAssumptionsUnion(path, matrix);
}

/**
 * Collect edge references along the reachability path from source to target.
 */
function collectPathRefs(
  sourceIdx: number,
  targetIdx: number,
  parent: number[][],
  matrix: KCAdjacencyMatrix
): string[] {
  const pathIndices = reconstructPathIndices(sourceIdx, targetIdx, parent[sourceIdx]);
  const path = ensurePath(pathIndices, sourceIdx, targetIdx);
  const refs = new Set<string>();
  for (let i = 0; i < path.length - 1; i += 1) {
    const relation = matrix.matrix[path[i]]?.[path[i + 1]];
    for (const ref of relation?.refs ?? []) {
      refs.add(ref);
    }
  }
  return Array.from(refs);
}

/** Map an operation safe key (e.g. AND_C) to its human-readable label (e.g. Conjunction). */
function opLabel(code: string): string {
  const q = QUERIES[code];
  if (q) return q.label;
  const t = TRANSFORMATIONS[code];
  if (t) return t.label;
  return code;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function antecedentSupportText(lemma: OperationLemma): string {
  return joinWithAnd(lemma.antecedent.map((op) => `support for ${opLabel(op)}`));
}

function supportImplicationText(lemma: OperationLemma): string {
  const consequent = `support for ${opLabel(lemma.consequent)}`;
  return lemma.antecedent.length === 1
    ? `${antecedentSupportText(lemma)} implies ${consequent}`
    : `${antecedentSupportText(lemma)} together imply ${consequent}`;
}

function operationMacro(opCode: string): string {
  const macros: Record<string, string> = {
    CO: '\\CO',
    VA: '\\VA',
    CE: '\\CE',
    IM: '\\IM',
    EQ: '\\EQ',
    SE: '\\SE',
    CT: '\\CT',
    ME: '\\ME',
    CD: '\\CD',
    FO: '\\FO',
    SFO: '\\SFO',
    NOT_C: '\\NOTC',
    AND_C: '\\ANDC',
    AND_BC: '\\ANDBC',
    OR_C: '\\ORC',
    OR_BC: '\\ORBC'
  };
  return macros[opCode] ?? `\\${opCode.replace(/[^A-Za-z]/g, '')}`;
}

function operationSupportPhrase(languageId: string, opCode: string, level: 'poly' | 'quasi'): string {
  const command = level === 'poly' ? 'supportspoly' : 'supportsquasi';
  return `\\${command}{${languageRefForId(languageId)}}{${operationMacro(opCode)}}`;
}

function operationUnsupportedPhrase(languageId: string, opCode: string, level: 'poly' | 'quasi'): string {
  const command = level === 'poly' ? 'nosupportspoly' : 'nosupportsquasi';
  return `\\${command}{${languageRefForId(languageId)}}{${operationMacro(opCode)}}`;
}

/** Statuses that assert "no polynomial" */
const NO_POLY_QUERY_STATUSES = new Set<string>(['no-poly-unknown-quasi', 'no-poly-quasi', 'no-quasi']);
/** Statuses that assert "no quasipolynomial" (only no-quasi; no-poly-quasi means quasi EXISTS) */
const NO_QUASI_QUERY_STATUSES = new Set<string>(['no-quasi']);

function getOperationSupport(language: KCLanguage, opCode: string): KCOpSupport | undefined {
  return language.properties?.queries?.[opCode] ?? language.properties?.transformations?.[opCode];
}

function setQuerySupport(language: KCLanguage, queryCode: string, support: KCOpSupport): void {
  if (!language.properties) {
    language.properties = {};
  }
  if (!language.properties.queries) {
    language.properties.queries = {};
  }
  language.properties.queries[queryCode] = support;
}

function getQueryComplexity(language: KCLanguage, queryCode: string): string {
  const support = language.properties?.queries?.[queryCode];
  return support?.complexity ?? 'unknown-to-us';
}

function queryGuaranteesPoly(complexity: string): boolean {
  return complexity === 'poly';
}

function queryGuaranteesQuasi(complexity: string): boolean {
  return QUASI_STATUS.has(complexity);
}

function queryAssertsNoPoly(complexity: string): boolean {
  return NO_POLY_QUERY_STATUSES.has(complexity);
}

function queryAssertsNoQuasi(complexity: string): boolean {
  return NO_QUASI_QUERY_STATUSES.has(complexity);
}

/**
 * Phase 3: Propagate query support via succinctness.
 * If L1 -> L2 in poly/quasi and L2 supports query q, then L1 supports q.
 */
export function propagateQueriesViaSuccinctness(
  data: GraphData,
  reachP: Reachability,
  reachQ: Reachability,
  polyOnly: boolean
): boolean {
  let changed = false;
  const { adjacencyMatrix, languages } = data;
  const queryCodes = getAllQueryCodes();

  for (const queryCode of queryCodes) {
    for (let l2Idx = 0; l2Idx < languages.length; l2Idx++) {
      const l2 = languages[l2Idx];
      const l2Id = l2.id;
      const l2MatrixIdx = adjacencyMatrix.indexByLanguage[l2Id];
      if (l2MatrixIdx === undefined) continue;

      const l2Complexity = getQueryComplexity(l2, queryCode);

      // Check poly upgrades
      if (polyOnly && queryGuaranteesPoly(l2Complexity)) {
        const l2Support = getOperationSupport(l2, queryCode);
        for (let l1Idx = 0; l1Idx < languages.length; l1Idx++) {
          const l1 = languages[l1Idx];
          const l1Id = l1.id;
          const l1MatrixIdx = adjacencyMatrix.indexByLanguage[l1Id];
          if (l1MatrixIdx === undefined) continue;
          if (l1MatrixIdx === l2MatrixIdx) continue;

          if (reachP.reach[l1MatrixIdx][l2MatrixIdx]) {
            const l1Complexity = getQueryComplexity(l1, queryCode);
            const l1Support = getOperationSupport(l1, queryCode);
            // Compute assumptions early for description and prefer-unconditional check
            const pathAssumption = collectPathAssumptions(l1MatrixIdx, l2MatrixIdx, reachP.parent, adjacencyMatrix);
            const pathRefs = collectPathRefs(l1MatrixIdx, l2MatrixIdx, reachP.parent, adjacencyMatrix);
            const queryAssumption = l2Support?.assumption;
            const assumption = mergeAssumptions(pathAssumption, queryAssumption);
            const needsUpgrade = !queryGuaranteesPoly(l1Complexity);
            const canImproveAssumption = queryGuaranteesPoly(l1Complexity) && l1Support?.assumption && l1Support?.derived && !assumption;
            if (needsUpgrade || canImproveAssumption) {
              // Upgrade L1's query to poly (or remove assumption from existing poly)
              const l1Name = idToName(l1Id);
              const l2Name = idToName(l2Id);
              const l2Refs = l2.properties?.queries?.[queryCode]?.refs ?? [];
              const refs = uniqueRefs(pathRefs, l2Refs);
              const description = `${positiveCompilationRef(l1Id, l2Id, 'poly')}, and ${operationSupportPhrase(l2Id, queryCode, 'poly')}. Therefore ${operationSupportPhrase(l1Id, queryCode, 'poly')}.`;

              if (DEBUG_PROPAGATION) {
                const reason = canImproveAssumption ? 'ASSUMPTION-IMPROVE' : 'UPGRADE';
                console.log(`[Query Propagation] ${reason} ${l1Name}.${queryCode}: ${l1Complexity} -> poly`);
              }
              
              setQuerySupport(l1, queryCode, {
                complexity: 'poly',
                refs,
                derived: true,
                description,
                derivationOrder: nextDerivationOrder(),
                proofTrace: { rule: 'query-via-succinctness', sourceLanguageId: l1Id, targetLanguageId: l2Id, operation: queryCode, level: 'poly' },
                ...(assumption && { assumption })
              });
              changed = true;
            }
          }
        }
      }

      // Check quasi upgrades
      if (!polyOnly && queryGuaranteesQuasi(l2Complexity)) {
        const l2Support = getOperationSupport(l2, queryCode);
        for (let l1Idx = 0; l1Idx < languages.length; l1Idx++) {
          const l1 = languages[l1Idx];
          const l1Id = l1.id;
          const l1MatrixIdx = adjacencyMatrix.indexByLanguage[l1Id];
          if (l1MatrixIdx === undefined) continue;
          if (l1MatrixIdx === l2MatrixIdx) continue;

          if (reachQ.reach[l1MatrixIdx][l2MatrixIdx]) {
            const l1Complexity = getQueryComplexity(l1, queryCode);
            const l1Support = getOperationSupport(l1, queryCode);
            // Don't upgrade if L1 asserts no-quasi (proven impossible)
            if (queryAssertsNoQuasi(l1Complexity)) continue;

            // Compute assumptions early for description and prefer-unconditional check
            const pathAssumption = collectPathAssumptions(l1MatrixIdx, l2MatrixIdx, reachQ.parent, adjacencyMatrix);
            const pathRefs = collectPathRefs(l1MatrixIdx, l2MatrixIdx, reachQ.parent, adjacencyMatrix);
            const queryAssumption = l2Support?.assumption;
            const assumption = mergeAssumptions(pathAssumption, queryAssumption);
            const needsUpgrade = !queryGuaranteesQuasi(l1Complexity);
            const canImproveAssumption =
              queryGuaranteesQuasi(l1Complexity) &&
              !queryGuaranteesPoly(l1Complexity) &&
              l1Support?.assumption &&
              l1Support?.derived &&
              !assumption;

            // Upgrade L1's query to quasi (or remove assumption from existing quasi)
            const l1Name = idToName(l1Id);
            const l2Name = idToName(l2Id);
            const newComplexity = l1Complexity === 'no-poly-unknown-quasi' ? 'no-poly-quasi' : 'unknown-poly-quasi';
            const l2Refs = l2.properties?.queries?.[queryCode]?.refs ?? [];
            const refs = uniqueRefs(pathRefs, l2Refs);
            const description = `${positiveCompilationRef(l1Id, l2Id, 'quasi')}, and ${operationSupportPhrase(l2Id, queryCode, 'quasi')}. Therefore ${operationSupportPhrase(l1Id, queryCode, 'quasi')}.`;

            const canAddUnconditionalQuasiNote =
              queryGuaranteesPoly(l1Complexity) &&
              Boolean(l1Support?.assumption) &&
              l1Support?.derived &&
              !assumption &&
              !l1Support.description?.includes(description);

            if (!needsUpgrade && !canImproveAssumption && !canAddUnconditionalQuasiNote) continue;

            if (canAddUnconditionalQuasiNote && l1Support) {
              const note = `\n\nAlso, ${operationSupportPhrase(l1Id, queryCode, 'quasi')} unconditionally. ${description}`;
              setQuerySupport(l1, queryCode, {
                ...l1Support,
                refs: uniqueRefs(l1Support.refs, refs),
                description: `${l1Support.description ?? ''}${note}`
              });
              changed = true;
              continue;
            }

            if (DEBUG_PROPAGATION) {
              const reason = canImproveAssumption ? 'ASSUMPTION-IMPROVE' : 'UPGRADE';
              console.log(`[Query Propagation] ${reason} ${l1Name}.${queryCode}: ${l1Complexity} -> ${newComplexity}`);
            }
            
            setQuerySupport(l1, queryCode, {
              complexity: newComplexity,
              refs,
              derived: true,
              description,
              derivationOrder: nextDerivationOrder(),
              proofTrace: { rule: 'query-via-succinctness', sourceLanguageId: l1Id, targetLanguageId: l2Id, operation: queryCode, level: 'quasi' },
              ...(assumption && { assumption })
            });
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

/**
 * Phase 4: Propagate query support via operation lemmas.
 * If L supports all antecedent operations, then L supports the consequent.
 */
export function propagateQueriesViaLemmas(
  data: GraphData,
  lemmas: OperationLemma[],
  polyOnly: boolean
): boolean {
  let changed = false;

  for (const language of data.languages) {
    for (const lemma of lemmas) {
      // Check if all antecedent operations are supported
      let allSupported = true;
      let worstComplexity = 'poly'; // Start with best, find worst
      const antecedentAssumptions: (string | undefined)[] = [];

      for (const antecedentOp of lemma.antecedent) {
        const support = getOperationSupport(language, antecedentOp);
        if (!support) {
          allSupported = false;
          break;
        }

        antecedentAssumptions.push(support.assumption);
        const complexity = support.complexity;
        if (polyOnly) {
          if (!queryGuaranteesPoly(complexity)) {
            allSupported = false;
            break;
          }
        } else {
          if (!queryGuaranteesQuasi(complexity)) {
            allSupported = false;
            break;
          }
          // Track worst complexity for quasi case
          if (complexity === 'unknown-poly-quasi' || complexity === 'no-poly-quasi') {
            worstComplexity = complexity;
          }
        }
      }

      if (!allSupported) continue;

      // Check if consequent can be upgraded
      const consequentSupport = getOperationSupport(language, lemma.consequent);
      const consequentComplexity = consequentSupport?.complexity ?? 'unknown-to-us';

      const targetComplexity = polyOnly ? 'poly' : worstComplexity;

      // Merge assumptions from all antecedent operations
      const assumption = mergeAssumptions(...antecedentAssumptions);

      // Only upgrade if current complexity is worse, or we can improve an assumption-bearing derived result
      const shouldUpgrade = polyOnly
        ? !queryGuaranteesPoly(consequentComplexity)
        : !queryGuaranteesQuasi(consequentComplexity);
      const canImproveAssumption = !shouldUpgrade && consequentSupport?.assumption && consequentSupport?.derived && !assumption;

      if (shouldUpgrade || canImproveAssumption) {
        const langName = idToName(language.id);
        const premiseLevel: 'poly' | 'quasi' = polyOnly ? 'poly' : 'quasi';
        const antecedentPremises = lemma.antecedent
          .map((op) => operationSupportPhrase(language.id, op, premiseLevel))
          .join(' and ');
        const antecedentRefs = lemma.antecedent.map((op) => getOperationSupport(language, op)?.refs ?? []);
        const refs = uniqueRefs(lemma.refs, ...antecedentRefs);
        const description = `${antecedentPremises}. Since ${supportImplicationText(lemma)}${formatCitations(lemma.refs)}, ${operationSupportPhrase(language.id, lemma.consequent, premiseLevel)}.`;

        if (DEBUG_PROPAGATION) {
          const reason = canImproveAssumption ? 'ASSUMPTION-IMPROVE' : 'LEMMA';
          console.log(`[Query Propagation] ${reason} ${langName}.${lemma.consequent}: ${consequentComplexity} -> ${targetComplexity} (via ${lemma.id})`);
        }

        // Determine if this is a query or transformation
        const lemmaLevel: 'poly' | 'quasi' = polyOnly ? 'poly' : 'quasi';
        const lemmaTrace: ProofTrace = { rule: 'lemma-forward', lemmaId: lemma.id, languageId: language.id, level: lemmaLevel };
        const lemmaDerOrder = nextDerivationOrder();
        const isQuery = lemma.consequent in (QUERIES ?? {});
        if (isQuery) {
          setQuerySupport(language, lemma.consequent, {
            complexity: targetComplexity,
            refs,
            derived: true,
            description,
            derivationOrder: lemmaDerOrder,
            proofTrace: lemmaTrace,
            ...(assumption && { assumption })
          });
        } else {
          // Transformation consequent
          if (!language.properties) language.properties = {};
          if (!language.properties.transformations) language.properties.transformations = {};
          language.properties.transformations[lemma.consequent] = {
            complexity: targetComplexity,
            refs,
            derived: true,
            description,
            derivationOrder: lemmaDerOrder,
            proofTrace: lemmaTrace,
            ...(assumption && { assumption })
          };
        }
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Phase 5: Propagate query downgrades.
 * 
 * Simple algorithm:
 * - For language L1 with L1.X = no-poly:
 *   - For language L2 downstream of L1 (L1 -> L2 in poly):
 *     - Set L2.X to no-poly-unknown-quasi unless L2 already asserts no-poly
 * 
 * - For language L1 with L1.X = no-quasi:
 *   - For language L2 downstream of L1 (L1 -> L2 in quasi):
 *     - Set L2.X to no-quasi unless L2 already asserts no-quasi
 */
export function propagateQueryDowngrades(
  data: GraphData,
  reachP: Reachability,
  reachQ: Reachability
): boolean {
  let changed = false;
  const { adjacencyMatrix, languages } = data;
  const queryCodes = getAllQueryCodes();

  for (const queryCode of queryCodes) {
    for (const l1 of languages) {
      const l1MatrixIdx = adjacencyMatrix.indexByLanguage[l1.id];
      if (l1MatrixIdx === undefined) continue;

      const l1Complexity = getQueryComplexity(l1, queryCode);
      const l1Name = idToName(l1.id);

      // No-poly propagation: L1 has no-poly, propagate via poly edges
      if (queryAssertsNoPoly(l1Complexity)) {
        const l1Support = getOperationSupport(l1, queryCode);
        for (const l2 of languages) {
          if (l2.id === l1.id) continue;
          const l2MatrixIdx = adjacencyMatrix.indexByLanguage[l2.id];
          if (l2MatrixIdx === undefined) continue;

          // Check if L1 -> L2 in poly
          if (!reachP.reach[l1MatrixIdx][l2MatrixIdx]) continue;

          const l2Complexity = getQueryComplexity(l2, queryCode);
          const l2Support = getOperationSupport(l2, queryCode);

          // Compute assumptions early for prefer-unconditional check
          const pathAssumption = collectPathAssumptions(l1MatrixIdx, l2MatrixIdx, reachP.parent, adjacencyMatrix);
          const pathRefs = collectPathRefs(l1MatrixIdx, l2MatrixIdx, reachP.parent, adjacencyMatrix);
          const queryAssumption = l1Support?.assumption;
          const assumption = mergeAssumptions(pathAssumption, queryAssumption);

          // Skip if L2 already asserts no-poly, unless we can improve an assumption-bearing derived result
          const canImproveAssumptionNoPoly = queryAssertsNoPoly(l2Complexity) && l2Support?.assumption && l2Support?.derived && !assumption;
          if (queryAssertsNoPoly(l2Complexity) && !canImproveAssumptionNoPoly) continue;

          const l2Name = idToName(l2.id);
          const l1Refs = l1.properties?.queries?.[queryCode]?.refs ?? [];
          const refs = uniqueRefs(l1Refs, pathRefs);
          const description = `${operationUnsupportedPhrase(l1.id, queryCode, 'poly')}, and ${positiveCompilationRef(l1.id, l2.id, 'poly')}. If ${languageRefForId(l2.id)} supported ${opLabel(queryCode)} in polynomial time, then ${languageRefForId(l1.id)} could too by compiling first. Therefore ${operationUnsupportedPhrase(l2.id, queryCode, 'poly')}.`;

          if (DEBUG_PROPAGATION) {
            console.log(`[Query Propagation] DOWNGRADE ${l2Name}.${queryCode}: ${l2Complexity} -> no-poly-unknown-quasi`);
          }

          setQuerySupport(l2, queryCode, {
            complexity: 'no-poly-unknown-quasi',
            refs,
            derived: true,
            description,
            derivationOrder: nextDerivationOrder(),
            proofTrace: { rule: 'query-downgrade-via-succinctness', sourceLanguageId: l1.id, targetLanguageId: l2.id, operation: queryCode, level: 'poly' },
            ...(assumption && { assumption })
          });
          changed = true;
        }
      }

      // No-quasi propagation: L1 has no-quasi, propagate via quasi edges
      if (queryAssertsNoQuasi(l1Complexity)) {
        const l1Support = getOperationSupport(l1, queryCode);
        for (const l2 of languages) {
          if (l2.id === l1.id) continue;
          const l2MatrixIdx = adjacencyMatrix.indexByLanguage[l2.id];
          if (l2MatrixIdx === undefined) continue;

          // Check if L1 -> L2 in quasi
          if (!reachQ.reach[l1MatrixIdx][l2MatrixIdx]) continue;

          const l2Complexity = getQueryComplexity(l2, queryCode);
          const l2SupportNoQuasi = getOperationSupport(l2, queryCode);

          // Compute assumptions early for prefer-unconditional check
          const pathAssumption = collectPathAssumptions(l1MatrixIdx, l2MatrixIdx, reachQ.parent, adjacencyMatrix);
          const pathRefs = collectPathRefs(l1MatrixIdx, l2MatrixIdx, reachQ.parent, adjacencyMatrix);
          const queryAssumption = l1Support?.assumption;
          const assumption = mergeAssumptions(pathAssumption, queryAssumption);

          // Skip if L2 already asserts no-quasi, unless we can improve an assumption-bearing derived result
          const canImproveAssumptionNoQuasi = queryAssertsNoQuasi(l2Complexity) && l2SupportNoQuasi?.assumption && l2SupportNoQuasi?.derived && !assumption;
          if (queryAssertsNoQuasi(l2Complexity) && !canImproveAssumptionNoQuasi) continue;

          const l2Name = idToName(l2.id);
          const l1Refs = l1.properties?.queries?.[queryCode]?.refs ?? [];
          const refs = uniqueRefs(l1Refs, pathRefs);
          const description = `${operationUnsupportedPhrase(l1.id, queryCode, 'quasi')}, and ${positiveCompilationRef(l1.id, l2.id, 'quasi')}. If ${languageRefForId(l2.id)} supported ${opLabel(queryCode)} in quasipolynomial time, then ${languageRefForId(l1.id)} could too by compiling first. Therefore ${operationUnsupportedPhrase(l2.id, queryCode, 'quasi')}.`;

          if (DEBUG_PROPAGATION) {
            console.log(`[Query Propagation] DOWNGRADE ${l2Name}.${queryCode}: ${l2Complexity} -> no-quasi`);
          }

          setQuerySupport(l2, queryCode, {
            complexity: 'no-quasi',
            refs,
            derived: true,
            description,
            derivationOrder: nextDerivationOrder(),
            proofTrace: { rule: 'query-downgrade-via-succinctness', sourceLanguageId: l1.id, targetLanguageId: l2.id, operation: queryCode, level: 'quasi' },
            ...(assumption && { assumption })
          });
          changed = true;
        }
      }
    }
  }

  return changed;
}

/**
 * Phase 5b: Propagate query downgrades via lemma contrapositives.
 * 
 * For a lemma A1 and A2 and ... and An -> C (all antecedents together imply consequent):
 * Contrapositive: not C -> not A1 or not A2 or ... or not An
 * 
 * We can only infer a specific antecedent is false when:
 * - C is false (no-poly or no-quasi)
 * - All OTHER antecedents are TRUE (supported in poly or quasi)
 * - Then the remaining antecedent must be false
 * 
 * Example: [CO, CD] -> ME (consistency + conditioning implies model enumeration)
 * - If ME is no-poly AND CD is poly → CO must be no-poly
 * - If ME is no-poly AND CO is poly → CD must be no-poly
 * 
 * Example: [EQ] -> CO (equivalence implies consistency)
 * - If CO is no-poly → EQ must be no-poly (single antecedent, trivially all others true)
 */
export function propagateDowngradesViaLemmaContrapositives(
  data: GraphData,
  lemmas: OperationLemma[]
): boolean {
  let changed = false;

  for (const language of data.languages) {
    const langName = idToName(language.id);

    for (const lemma of lemmas) {
      // Get the consequent's complexity
      const consequentSupport = getOperationSupport(language, lemma.consequent);
      const consequentComplexity = consequentSupport?.complexity ?? 'unknown-to-us';

      // Check no-poly contrapositive
      if (queryAssertsNoPoly(consequentComplexity)) {
        // For each antecedent Aj, check if all OTHER antecedents are supported in poly
        for (let j = 0; j < lemma.antecedent.length; j++) {
          const targetOp = lemma.antecedent[j];
          const targetSupport = getOperationSupport(language, targetOp);
          const targetComplexity = targetSupport?.complexity ?? 'unknown-to-us';

          // Skip if target already asserts no-poly without assumption (no improvement possible)
          if (queryAssertsNoPoly(targetComplexity) && (!targetSupport?.assumption || !targetSupport?.derived)) continue;

          // Check if ALL OTHER antecedents support poly
          let allOthersPolySupported = true;
          const otherAntecedents: string[] = [];
          const otherAssumptions: (string | undefined)[] = [];
          const otherRefs: string[][] = [];
          for (let k = 0; k < lemma.antecedent.length; k++) {
            if (k === j) continue;
            const otherOp = lemma.antecedent[k];
            otherAntecedents.push(otherOp);
            const otherSupport = getOperationSupport(language, otherOp);
            const otherComplexity = otherSupport?.complexity ?? 'unknown-to-us';
            if (!queryGuaranteesPoly(otherComplexity)) {
              allOthersPolySupported = false;
              break;
            }
            otherAssumptions.push(otherSupport?.assumption);
            otherRefs.push(otherSupport?.refs ?? []);
          }

          if (!allOthersPolySupported) continue;

          // All other antecedents support poly, consequent is no-poly → target must be no-poly
          const consequentRefs = consequentSupport?.refs ?? [];
          // Merge assumptions from the consequent and all other antecedents
          const assumption = mergeAssumptions(consequentSupport?.assumption, ...otherAssumptions);

          // If already asserting no-poly, only continue if we can improve the assumption
          if (queryAssertsNoPoly(targetComplexity) && assumption) continue;

          const refs = uniqueRefs(lemma.refs, consequentRefs, ...otherRefs);
          const othersDesc = otherAntecedents.length > 0
            ? ` Also, ${joinWithAnd(otherAntecedents.map((op) => operationSupportPhrase(language.id, op, 'poly')))}.`
            : '';
          const description = `${supportImplicationText(lemma)}${formatCitations(lemma.refs)}. However, ${operationUnsupportedPhrase(language.id, lemma.consequent, 'poly')}.${othersDesc} Therefore ${operationUnsupportedPhrase(language.id, targetOp, 'poly')}.`;

          if (DEBUG_PROPAGATION) {
            const reason = queryAssertsNoPoly(targetComplexity) ? 'ASSUMPTION-IMPROVE' : 'CONTRAPOSITIVE';
            console.log(`[Query Propagation] ${reason} ${langName}.${targetOp}: ${targetComplexity} -> no-poly-unknown-quasi (via ¬${lemma.consequent}${otherAntecedents.length > 0 ? ', with ' + otherAntecedents.join('+') + ' supported' : ''})`);
          }

          // Determine if this is a query or transformation
          const noPolyContraTrace: ProofTrace = { rule: 'lemma-contrapositive', lemmaId: lemma.id, languageId: language.id, pivotOp: targetOp, level: 'poly' };
          const noPolyContraOrder = nextDerivationOrder();
          const isQuery = targetOp in (QUERIES ?? {});
          if (isQuery) {
            setQuerySupport(language, targetOp, {
              complexity: 'no-poly-unknown-quasi',
              refs,
              derived: true,
              description,
              derivationOrder: noPolyContraOrder,
              proofTrace: noPolyContraTrace,
              ...(assumption && { assumption })
            });
          } else {
            if (!language.properties) language.properties = {};
            if (!language.properties.transformations) language.properties.transformations = {};
            language.properties.transformations[targetOp] = {
              complexity: 'no-poly-unknown-quasi',
              refs,
              derived: true,
              description,
              derivationOrder: noPolyContraOrder,
              proofTrace: noPolyContraTrace,
              ...(assumption && { assumption })
            };
          }
          changed = true;
        }
      }

      // Check no-quasi contrapositive
      if (queryAssertsNoQuasi(consequentComplexity)) {
        // For each antecedent Aj, check if all OTHER antecedents are supported in quasi
        for (let j = 0; j < lemma.antecedent.length; j++) {
          const targetOp = lemma.antecedent[j];
          const targetSupport = getOperationSupport(language, targetOp);
          const targetComplexity = targetSupport?.complexity ?? 'unknown-to-us';

          // Skip if target already asserts no-quasi without assumption (no improvement possible)
          if (queryAssertsNoQuasi(targetComplexity) && (!targetSupport?.assumption || !targetSupport?.derived)) continue;

          // Check if ALL OTHER antecedents support quasi
          let allOthersQuasiSupported = true;
          const otherAntecedents: string[] = [];
          const otherAssumptions: (string | undefined)[] = [];
          const otherRefs: string[][] = [];
          for (let k = 0; k < lemma.antecedent.length; k++) {
            if (k === j) continue;
            const otherOp = lemma.antecedent[k];
            otherAntecedents.push(otherOp);
            const otherSupport = getOperationSupport(language, otherOp);
            const otherComplexity = otherSupport?.complexity ?? 'unknown-to-us';
            if (!queryGuaranteesQuasi(otherComplexity)) {
              allOthersQuasiSupported = false;
              break;
            }
            otherAssumptions.push(otherSupport?.assumption);
            otherRefs.push(otherSupport?.refs ?? []);
          }

          if (!allOthersQuasiSupported) continue;

          // All other antecedents support quasi, consequent is no-quasi → target must be no-quasi
          const consequentRefs = consequentSupport?.refs ?? [];
          // Merge assumptions from the consequent and all other antecedents
          const assumption = mergeAssumptions(consequentSupport?.assumption, ...otherAssumptions);

          // If already asserting no-quasi, only continue if we can improve the assumption
          if (queryAssertsNoQuasi(targetComplexity) && assumption) continue;

          const refs = uniqueRefs(lemma.refs, consequentRefs, ...otherRefs);
          const othersDesc = otherAntecedents.length > 0
            ? ` Also, ${joinWithAnd(otherAntecedents.map((op) => operationSupportPhrase(language.id, op, 'quasi')))}.`
            : '';
          const description = `${supportImplicationText(lemma)}${formatCitations(lemma.refs)}. However, ${operationUnsupportedPhrase(language.id, lemma.consequent, 'quasi')}.${othersDesc} Therefore ${operationUnsupportedPhrase(language.id, targetOp, 'quasi')}.`;

          if (DEBUG_PROPAGATION) {
            const reason = queryAssertsNoQuasi(targetComplexity) ? 'ASSUMPTION-IMPROVE' : 'CONTRAPOSITIVE';
            console.log(`[Query Propagation] ${reason} ${langName}.${targetOp}: ${targetComplexity} -> no-quasi (via ¬${lemma.consequent}${otherAntecedents.length > 0 ? ', with ' + otherAntecedents.join('+') + ' supported' : ''})`);
          }

          // Determine if this is a query or transformation
          const noQuasiContraTrace: ProofTrace = { rule: 'lemma-contrapositive', lemmaId: lemma.id, languageId: language.id, pivotOp: targetOp, level: 'quasi' };
          const noQuasiContraOrder = nextDerivationOrder();
          const isQuery = targetOp in (QUERIES ?? {});
          if (isQuery) {
            setQuerySupport(language, targetOp, {
              complexity: 'no-quasi',
              refs,
              derived: true,
              description,
              derivationOrder: noQuasiContraOrder,
              proofTrace: noQuasiContraTrace,
              ...(assumption && { assumption })
            });
          } else {
            if (!language.properties) language.properties = {};
            if (!language.properties.transformations) language.properties.transformations = {};
            language.properties.transformations[targetOp] = {
              complexity: 'no-quasi',
              refs,
              derived: true,
              description,
              derivationOrder: noQuasiContraOrder,
              proofTrace: noQuasiContraTrace,
              ...(assumption && { assumption })
            };
          }
          changed = true;
        }
      }
    }
  }

  return changed;
}

// =============================================================================
// Phase 6: Succinctness by Query
// =============================================================================

/** Edge statuses that already assert "no polynomial compilation" */
const EDGE_NO_POLY = new Set<string>(['no-poly-unknown-quasi', 'no-poly-quasi', 'no-quasi']);

/**
 * Phase 6: Derive succinctness (edge) results from query differences.
 *
 * Lemma "Succinctness by Query":
 * If language A supports query Q in polynomial time, and language B does NOT
 * support Q in polynomial time, then B cannot compile to A with
 * polynomial blowup.
 *
 * Proof: If B → A were poly, then B supports Q by first compiling to A (poly)
 * then running A's poly-time query algorithm. But B doesn't support Q in poly.
 * Contradiction.
 *
 * Similarly for quasipolynomial time.
 *
 * NOTE: This lemma applies only to QUERIES, not transformations. Transformations
 * are language-specific operations that don't transfer via compilation.
 */
export function propagateSuccinctnessViaQueries(data: GraphData): boolean {
  let changed = false;
  const { adjacencyMatrix, languages } = data;
  const queryCodes = getAllQueryCodes();

  for (const queryCode of queryCodes) {
    for (const langA of languages) {
      const aIdx = adjacencyMatrix.indexByLanguage[langA.id];
      if (aIdx === undefined) continue;
      const aComplexity = getQueryComplexity(langA, queryCode);
      const aSupport = getOperationSupport(langA, queryCode);

      for (const langB of languages) {
        if (langB.id === langA.id) continue;
        const bIdx = adjacencyMatrix.indexByLanguage[langB.id];
        if (bIdx === undefined) continue;
        const bComplexity = getQueryComplexity(langB, queryCode);
        const bSupport = getOperationSupport(langB, queryCode);

        // === Poly case ===
        // A supports Q in poly, B asserts no-poly for Q → B → A is not poly
        if (queryGuaranteesPoly(aComplexity) && queryAssertsNoPoly(bComplexity)) {
          if (deriveNoPolyEdge(adjacencyMatrix, bIdx, aIdx, langB, langA, queryCode, aSupport, bSupport)) {
            changed = true;
          }
        }

        // === Quasi case ===
        // A supports Q in quasi, B has no-quasi for Q → B → A is not quasi
        // NOTE: Only 'no-quasi' means "no quasi algorithm exists".
        // 'no-poly-quasi' means quasi EXISTS (just not poly), so it does not qualify.
        if (queryGuaranteesQuasi(aComplexity) && bComplexity === 'no-quasi') {
          if (deriveNoQuasiEdge(adjacencyMatrix, bIdx, aIdx, langB, langA, queryCode, aSupport, bSupport)) {
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

/**
 * Derive a no-poly edge B → A from query difference evidence.
 * Returns true if the edge was changed.
 */
function deriveNoPolyEdge(
  adjacencyMatrix: KCAdjacencyMatrix,
  bIdx: number,
  aIdx: number,
  langB: KCLanguage,
  langA: KCLanguage,
  queryCode: string,
  aSupport: KCOpSupport | undefined,
  bSupport: KCOpSupport | undefined
): boolean {
  const currentRelation = adjacencyMatrix.matrix[bIdx][aIdx];
  const currentStatus = currentRelation?.status ?? null;

  // Skip if already asserts no-poly
  if (currentStatus !== null && EDGE_NO_POLY.has(currentStatus)) return false;

  const aName = idToName(langA.id);
  const bName = idToName(langB.id);

  // Contradiction: edge claims poly but we derived no-poly
  if (currentStatus === 'poly') {
    contradictionError(
      `Contradiction (succinctness by query): ${bName} → ${aName} is marked as poly, ` +
      `but ${aName} supports ${opLabel(queryCode)} in polynomial time while ${opLabel(queryCode)} is unsupported by ${bName}. ` +
      `If the polynomial compilation existed, ${bName} could support ${opLabel(queryCode)} by compiling to ${aName}.`
    );
  }

  const aRefs = aSupport?.refs ?? [];
  const bRefs = bSupport?.refs ?? [];
  const assumption = mergeAssumptions(aSupport?.assumption, bSupport?.assumption);
  const description =
    `${operationSupportPhrase(langA.id, queryCode, 'poly')}, but ` +
    `${operationUnsupportedPhrase(langB.id, queryCode, 'poly')}. If ${languageRefForId(langB.id)} could compile to ${languageRefForId(langA.id)} with ` +
    `polynomial blowup, ${languageRefForId(langB.id)} could support ${opLabel(queryCode)} by first compiling to ${languageRefForId(langA.id)}. ` +
    `Therefore ${languageRefForId(langB.id)} cannot compile to ${languageRefForId(langA.id)} with polynomial blowup${formatInlineAssumption(assumption)}.`;
  const refs = uniqueRefs(aRefs, bRefs);

  if (currentStatus === 'unknown-poly-quasi' && currentRelation) {
    // Transition: unknown-poly-quasi → no-poly-quasi (structured proof)
    const quasiDescription = currentRelation.quasiDescription ?? {
      description: currentRelation.description ?? '',
      refs: currentRelation.refs ?? [],
      derived: currentRelation.derived ?? false,
      ...(currentRelation.derivationOrder !== undefined && { derivationOrder: currentRelation.derivationOrder }),
      ...(currentRelation.proofTrace && { proofTrace: currentRelation.proofTrace })
    };
    const noPolyDescription: DescriptionComponent = {
      description,
      refs,
      derived: true,
      derivationOrder: nextDerivationOrder(),
      proofTrace: { rule: 'query-difference', operation: queryCode, posLanguageId: langA.id, negLanguageId: langB.id, level: 'poly' }
    };
    const allRefs = [...new Set([...noPolyDescription.refs, ...quasiDescription.refs])];

    // Merge assumptions: query-derived assumption + original relation assumption
    const allAssumptions = new Set<string>();
    if (assumption) {
      for (const c of assumption.split(' AND ')) allAssumptions.add(c.trim());
    }
    if (currentRelation.assumption) {
      for (const c of currentRelation.assumption.split(' AND ')) allAssumptions.add(c.trim());
    }
    const mergedAssumption = allAssumptions.size > 0 ? Array.from(allAssumptions).join(' AND ') : undefined;

    const fullyDerived = noPolyDescription.derived && quasiDescription.derived;

    adjacencyMatrix.matrix[bIdx][aIdx] = {
      status: 'no-poly-quasi',
      refs: allRefs,
      assumption: mergedAssumption,
      hidden: false,
      derived: fullyDerived,
      noPolyDescription,
      quasiDescription,
      description: buildNoPolyQuasiDescription(noPolyDescription, quasiDescription)
    };
  } else {
    // Transition: null / unknown-both → no-poly-unknown-quasi
    adjacencyMatrix.matrix[bIdx][aIdx] = {
      status: 'no-poly-unknown-quasi',
      refs,
      assumption,
      hidden: false,
      derived: true,
      description,
      derivationOrder: nextDerivationOrder(),
      proofTrace: { rule: 'query-difference', operation: queryCode, posLanguageId: langA.id, negLanguageId: langB.id, level: 'poly' }
    };
  }

  if (DEBUG_PROPAGATION) {
    console.log(
      `[Succinctness by Query] EDGE ${bName} → ${aName}: ` +
      `${currentStatus ?? 'null'} → ${adjacencyMatrix.matrix[bIdx][aIdx]!.status} (via ${queryCode} poly)`
    );
  }
  return true;
}

/**
 * Derive a no-quasi edge B → A from query difference evidence.
 * Returns true if the edge was changed.
 */
function deriveNoQuasiEdge(
  adjacencyMatrix: KCAdjacencyMatrix,
  bIdx: number,
  aIdx: number,
  langB: KCLanguage,
  langA: KCLanguage,
  queryCode: string,
  aSupport: KCOpSupport | undefined,
  bSupport: KCOpSupport | undefined
): boolean {
  const currentRelation = adjacencyMatrix.matrix[bIdx][aIdx];
  const currentStatus = currentRelation?.status ?? null;

  // Skip if already asserts no-quasi
  if (currentStatus === 'no-quasi') return false;

  const aName = idToName(langA.id);
  const bName = idToName(langB.id);

  // Contradiction: edge guarantees quasi exists, but we derived no-quasi
  if (currentStatus === 'poly' || currentStatus === 'unknown-poly-quasi' || currentStatus === 'no-poly-quasi') {
    contradictionError(
      `Contradiction (succinctness by query): ${bName} → ${aName} is marked as ${currentStatus} ` +
      `(guaranteeing quasi-poly), but ${aName} supports ${opLabel(queryCode)} in quasipolynomial time ` +
      `while ${opLabel(queryCode)} is unsupported by ${bName} in quasipolynomial time. If the quasipolynomial ` +
      `compilation existed, ${bName} could support ${opLabel(queryCode)} by compiling to ${aName}.`
    );
  }

  const aRefs = aSupport?.refs ?? [];
  const bRefs = bSupport?.refs ?? [];
  const assumption = mergeAssumptions(aSupport?.assumption, bSupport?.assumption);
  const description =
    `${operationSupportPhrase(langA.id, queryCode, 'quasi')}, but ` +
    `${operationUnsupportedPhrase(langB.id, queryCode, 'quasi')}. If ${languageRefForId(langB.id)} could compile to ${languageRefForId(langA.id)} with ` +
    `quasipolynomial blowup, ${languageRefForId(langB.id)} could support ${opLabel(queryCode)} by first compiling to ${languageRefForId(langA.id)}. ` +
    `Therefore ${languageRefForId(langB.id)} cannot compile to ${languageRefForId(langA.id)} with quasipolynomial blowup${formatInlineAssumption(assumption)}.`;
  const refs = uniqueRefs(aRefs, bRefs);

  // Transition: null / unknown-both / no-poly-unknown-quasi → no-quasi
  adjacencyMatrix.matrix[bIdx][aIdx] = {
    status: 'no-quasi',
    refs,
    assumption,
    hidden: false,
    derived: true,
    description,
    derivationOrder: nextDerivationOrder(),
    proofTrace: { rule: 'query-difference', operation: queryCode, posLanguageId: langA.id, negLanguageId: langB.id, level: 'quasi' }
  };

  if (DEBUG_PROPAGATION) {
    console.log(
      `[Succinctness by Query] EDGE ${bName} → ${aName}: ` +
      `${currentStatus ?? 'null'} → no-quasi (via ${queryCode} quasi)`
    );
  }
  return true;
}

/**
 * Validate query consistency.
 * Checks for contradictions:
 * 1. If L1 -> L2 and L2 supports q, but L1 claims no support (upgrade direction)
 * 2. If L1 doesn't support q and L1 -> L2, but L2 claims to support q (downgrade direction)
 * (If you can compile L1 to L2 and L2 supports a query, L1 must also support it.)
 */
export function validateQueryConsistency(data: GraphData): { ok: boolean; error?: string } {
  const { adjacencyMatrix, languages } = data;
  const reachP = computeReachability(adjacencyMatrix, POLY_STATUS);
  const reachQ = computeReachability(adjacencyMatrix, QUASI_STATUS);
  const queryCodes = getAllQueryCodes();

  for (const queryCode of queryCodes) {
    for (let l1Idx = 0; l1Idx < languages.length; l1Idx++) {
      const l1 = languages[l1Idx];
      const l1Id = l1.id;
      const l1MatrixIdx = adjacencyMatrix.indexByLanguage[l1Id];
      if (l1MatrixIdx === undefined) continue;

      const l1Complexity = getQueryComplexity(l1, queryCode);

      for (let l2Idx = 0; l2Idx < languages.length; l2Idx++) {
        const l2 = languages[l2Idx];
        const l2Id = l2.id;
        const l2MatrixIdx = adjacencyMatrix.indexByLanguage[l2Id];
        if (l2MatrixIdx === undefined) continue;
        if (l1MatrixIdx === l2MatrixIdx) continue;

        const l2Complexity = getQueryComplexity(l2, queryCode);
        const l1Name = idToName(l1Id);
        const l2Name = idToName(l2Id);

        // Check poly contradiction: L1 -> L2, L2 supports q in poly, but L1 claims no-poly
        if (reachP.reach[l1MatrixIdx][l2MatrixIdx]) {
          if (queryGuaranteesPoly(l2Complexity) && queryAssertsNoPoly(l1Complexity)) {
            return {
              ok: false,
              error: `Contradiction: ${l1Name} compiles to ${l2Name} with polynomial blowup, and ${l2Name} supports ${opLabel(queryCode)} in polynomial time, but ${opLabel(queryCode)} is marked as unsupported by ${l1Name}.`
            };
          }
        }

        // Check quasi contradiction: L1 -> L2, L2 supports q in quasi, but L1 claims no-quasi
        if (reachQ.reach[l1MatrixIdx][l2MatrixIdx]) {
          if (queryGuaranteesQuasi(l2Complexity) && queryAssertsNoQuasi(l1Complexity)) {
            return {
              ok: false,
              error: `Contradiction: ${l1Name} compiles to ${l2Name} with quasipolynomial blowup, and ${l2Name} supports ${opLabel(queryCode)} in quasipolynomial time, but ${opLabel(queryCode)} is marked as unsupported by ${l1Name} in quasipolynomial time.`
            };
          }
        }
      }
    }
  }

  return { ok: true };
}
