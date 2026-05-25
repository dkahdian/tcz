/**
 * generate-lean.ts — Auto-generate Lean 4 Proofs.lean from database.json
 *
 * Reads the (already-propagated) database and emits:
 *   1. Operation lemma axioms (poly + quasi variants)
 *   2. Non-derived edge axioms (positive and negative)
 *   3. Non-derived operation support axioms
 *   4. Derived theorems sorted by derivationOrder, each with a proof term
 *
 * Usage:  npx tsx scripts/generate-lean.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  DirectedSuccinctnessRelation,
  KCLanguage,
  KCOpSupport,
  DescriptionComponent,
  OperationLemma,
  ProofTrace
} from '../src/lib/types.js';
import { loadDatabase } from './shared/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROOFS_PATH = path.join(__dirname, '..', 'lean', 'TCZ', 'Proofs.lean');

// Language ID → Lean constructor mapping

/** Map language ID to its Lean inductive constructor name. */
const LANG_CONSTRUCTOR: Record<string, string> = {
  lang_8f666aa0: 'anf',
  lang_bb65ddb5: 'bdd',
  lang_89649e36: 'cnf',
  lang_83e3b023: 'csdd',
  lang_6c130090: 'd_dnnf',
  lang_ea9b5299: 'd_sdnnf',
  lang_91f812d0: 'd_sdnnf_t',
  lang_4c204bf3: 'dnf',
  lang_3bebcab7: 'dnnf',
  lang_684b1ca7: 'fbdd',
  lang_6ae90adc: 'ip',
  lang_e02902d0: 'mods',
  lang_1df07cc3: 'nfbdd',
  lang_5bf00851: 'nnf',
  lang_d24efe0e: 'nobdd',
  lang_e827cf31: 'nobdd_lt',
  lang_d69995dd: 'obdd_lt',
  lang_27fffab2: 'pi',
  lang_1afefbe2: 'sdd',
  lang_9c84a267: 'sdd_t',
  lang_b13b0d78: 'sdnnf',
  lang_3c803ba1: 'sdnnf_t',
  lang_4e62a038: 'ufbdd',
  lang_c2df8c2b: 'uobdd',
  lang_43a33aec: 'uobdd_lt',
  lang_b9d72a7c: 'obdd',
  lang_d7403a53: 'tdd',
  lang_8cf1da0e: 'tdd_t',
  lang_981b62f0: 'dec_dnnf',
  lang_0f27d539: 'dec_sdnnf',
  lang_4ae03bc8: 'dec_sdnnf_lt',
  lang_82fa749e: 'csdd_t'
};

function langLean(id: string): string {
  const c = LANG_CONSTRUCTOR[id];
  if (!c) throw new Error(`Unknown language ID: ${id}`);
  return `.${c}`;
}

// Operation code → Lean constructor mapping

/** Operation safe keys (as they appear in database.json) → Lean Operation constructors. */
const OP_CONSTRUCTOR: Record<string, string> = {
  CO: 'CO',
  VA: 'VA',
  CE: 'CE',
  IM: 'IM',
  EQ: 'EQ',
  SE: 'SE',
  CT: 'CT',
  ME: 'ME',
  CD: 'CD',
  FO: 'FO',
  SFO: 'SFO',
  AND_C: 'AND_C',
  AND_BC: 'AND_BC',
  OR_C: 'OR_C',
  OR_BC: 'OR_BC',
  NOT_C: 'NOT_C'
};

function opLean(code: string): string {
  const c = OP_CONSTRUCTOR[code];
  if (!c) throw new Error(`Unknown operation code: ${code}`);
  return `.${c}`;
}

// Lean-safe name helpers

/** Make a lemma ID safe for Lean identifiers. */
function safeLemmaId(id: string): string {
  return id.replace(/-/g, '_');
}

/** Canonical edge theorem name: `edge_{src}_{tgt}_{claim}` */
function edgeName(srcId: string, tgtId: string, claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi'): string {
  return `edge_${LANG_CONSTRUCTOR[srcId]}_${LANG_CONSTRUCTOR[tgtId]}_${claim}`;
}

/** Canonical operation support theorem name: `op_{lang}_{op}_{claim}` */
function opTheoremName(langId: string, opCode: string, claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi'): string {
  return `op_${LANG_CONSTRUCTOR[langId]}_${OP_CONSTRUCTOR[opCode]}_${claim}`;
}

// Derived fact collection types

interface DerivedEdgeFact {
  kind: 'edge';
  srcId: string;
  tgtId: string;
  claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi';
  derivationOrder: number;
  proofTrace: ProofTrace;
}

interface DerivedOpFact {
  kind: 'op';
  langId: string;
  opCode: string;
  claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi';
  derivationOrder: number;
  proofTrace: ProofTrace;
}

type DerivedFact = DerivedEdgeFact | DerivedOpFact;

function validateLanguageConstructors(languages: KCLanguage[]): void {
  const missing = languages
    .filter((lang) => !LANG_CONSTRUCTOR[lang.id])
    .map((lang) => `${lang.id} (${lang.name})`)
    .sort();

  if (missing.length === 0) return;

  throw new Error(
    [
      'Lean language mapping is incomplete.',
      'Add constructors for these IDs in LANG_CONSTRUCTOR (scripts/generate-lean.ts):',
      ...missing.map((m) => `  - ${m}`)
    ].join('\n')
  );
}

// Edge status → Lean claims

/** All statuses that carry a "compilesInPoly" positive claim. */
const EDGE_POLY_STATUSES = new Set(['poly']);

/** All statuses that carry a "compilesInQuasi" positive claim. */
const EDGE_QUASI_STATUSES = new Set(['poly', 'unknown-poly-quasi', 'no-poly-quasi']);

/** All statuses that carry a "¬compilesInPoly" negative claim. */
const EDGE_NO_POLY_STATUSES = new Set(['no-poly-unknown-quasi', 'no-poly-quasi', 'no-quasi']);

/** All statuses that carry a "¬compilesInQuasi" negative claim. */
const EDGE_NO_QUASI_STATUSES = new Set(['no-quasi']);

// Lookups — filled once after loading

/** Set of axiom names already emitted (used to resolve references in proofs). */
const emittedNames = new Set<string>();

/**
 * Resolve the Lean name for an edge claim, or null if it hasn't been emitted.
 * Also checks if the edge needs lifting via poly_implies_quasi.
 */
function resolveEdge(srcId: string, tgtId: string, level: 'poly' | 'quasi'): string | null {
  const directName = edgeName(srcId, tgtId, level);
  if (emittedNames.has(directName)) return directName;
  // If we want quasi and only poly exists, use poly_implies_quasi
  if (level === 'quasi') {
    const polyName = edgeName(srcId, tgtId, 'poly');
    if (emittedNames.has(polyName)) return `(poly_implies_quasi ${polyName})`;
  }
  return null;
}

/**
 * Resolve the Lean name for an operation support claim.
 * If we want quasi and only poly exists, use poly_support_implies_quasi.
 */
function resolveOp(langId: string, opCode: string, level: 'poly' | 'quasi'): string | null {
  const directName = opTheoremName(langId, opCode, level);
  if (emittedNames.has(directName)) return directName;
  if (level === 'quasi') {
    const polyName = opTheoremName(langId, opCode, 'poly');
    if (emittedNames.has(polyName)) return `(poly_support_implies_quasi ${polyName})`;
  }
  return null;
}

/** Resolve edge name for a negative claim. */
function resolveNegEdge(srcId: string, tgtId: string, level: 'poly' | 'quasi'): string | null {
  const claim = level === 'poly' ? 'no_poly' : 'no_quasi';
  const directName = edgeName(srcId, tgtId, claim);
  if (emittedNames.has(directName)) return directName;
  // If we want no-poly but only no-quasi exists, derive from no-quasi via contrapositive of poly_implies_quasi
  // ¬quasi → ¬poly is the contrapositive of poly → quasi
  if (level === 'poly') {
    const noQuasiName = edgeName(srcId, tgtId, 'no_quasi');
    if (emittedNames.has(noQuasiName)) return `(fun h => absurd (poly_implies_quasi h) ${noQuasiName})`;
  }
  return null;
}

/** Resolve op name for a negative claim. */
function resolveNegOp(langId: string, opCode: string, level: 'poly' | 'quasi'): string | null {
  const claim = level === 'poly' ? 'no_poly' : 'no_quasi';
  const directName = opTheoremName(langId, opCode, claim);
  if (emittedNames.has(directName)) return directName;
  if (level === 'poly') {
    const noQuasiName = opTheoremName(langId, opCode, 'no_quasi');
    if (emittedNames.has(noQuasiName)) return `(fun h => absurd (poly_support_implies_quasi h) ${noQuasiName})`;
  }
  return null;
}

// Proof term generation

function proofForTransitivity(trace: Extract<ProofTrace, { rule: 'transitivity' }>): string {
  const { path, level } = trace;
  if (path.length < 2) throw new Error('Transitivity path must have at least 2 nodes');
  const trans = level === 'poly' ? 'poly_trans' : 'quasi_trans';

  // Build chain right-to-left: poly_trans h_AB (poly_trans h_BC h_CD)
  // Each hop is path[i] → path[i+1]
  const hops: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const hop = resolveEdge(path[i], path[i + 1], level);
    if (!hop) {
      return `sorry /- missing edge ${path[i]} → ${path[i + 1]} at level ${level} -/`;
    }
    hops.push(hop);
  }

  if (hops.length === 1) return hops[0];

  // Right-fold: (trans h0 (trans h1 (trans h2 h3)))
  let result = hops[hops.length - 1];
  for (let i = hops.length - 2; i >= 0; i--) {
    result = `(${trans} ${hops[i]} ${result})`;
  }
  // Strip outermost parens since we're at top-level of a := expression
  if (result.startsWith('(') && result.endsWith(')')) {
    result = result.slice(1, -1);
  }
  return result;
}

function proofForContradiction(
  trace: Extract<ProofTrace, { rule: 'contradiction' }>,
  srcId: string,
  tgtId: string
): string {
  const { triedStatus, witnessPath } = trace;
  // triedStatus tells us what we tried to add (e.g. 'poly' or 'unknown-poly-quasi')
  // The contradiction is: If srcId→tgtId had status `triedStatus`, then transitivity
  // along witnessPath would create an impossible edge.
  //
  // We prove ¬compilesInPoly srcId tgtId (or ¬compilesInQuasi) by assuming the edge
  // and deriving a contradiction with an existing negative edge.

  // The witnessPath is pathStart → ... → pathEnd and includes the edge we're testing.
  // The edge at pathStart→pathEnd has a known negative status.
  if (witnessPath.length < 2) {
    return `sorry /- empty witness path -/`;
  }

  const pathStart = witnessPath[0];
  const pathEnd = witnessPath[witnessPath.length - 1];

  // Determine level from triedStatus
  const isPoly = triedStatus === 'poly';
  const level: 'poly' | 'quasi' = isPoly ? 'poly' : 'quasi';
  const trans = isPoly ? 'poly_trans' : 'quasi_trans';

  // Build the chain of known edges along the witness path, skipping the tested edge src→tgt
  // The proof is: fun h => absurd (chain_trans ... h ...) contradicting_edge
  const hopExprs: string[] = [];
  for (let i = 0; i < witnessPath.length - 1; i++) {
    const from = witnessPath[i];
    const to = witnessPath[i + 1];
    if (from === srcId && to === tgtId) {
      hopExprs.push('h');
    } else {
      const hop = resolveEdge(from, to, level);
      if (!hop) {
        return `sorry /- missing edge ${from} → ${to} at level ${level} -/`;
      }
      hopExprs.push(hop);
    }
  }

  // Build the chained transitivity expression
  let chainExpr: string;
  if (hopExprs.length === 1) {
    chainExpr = hopExprs[0];
  } else {
    chainExpr = hopExprs[hopExprs.length - 1];
    for (let i = hopExprs.length - 2; i >= 0; i--) {
      chainExpr = `${trans} ${hopExprs[i]} (${chainExpr})`;
    }
  }

  // The contradicting edge: pathStart→pathEnd has a negative status
  const negEdge = resolveNegEdge(pathStart, pathEnd, level);
  if (!negEdge) {
    return `sorry /- missing negative edge ${pathStart} → ${pathEnd} at level ${level} -/`;
  }

  return `fun h => absurd (${chainExpr}) ${negEdge}`;
}

function proofForQueryViaSuccinctness(
  trace: Extract<ProofTrace, { rule: 'query-via-succinctness' }>
): string {
  const { sourceLanguageId, targetLanguageId, operation, level } = trace;
  const via = level === 'poly' ? 'query_via_poly' : 'query_via_quasi';

  const edgeExpr = resolveEdge(sourceLanguageId, targetLanguageId, level);
  if (!edgeExpr) {
    return `sorry /- missing edge ${sourceLanguageId} → ${targetLanguageId} at level ${level} -/`;
  }

  const opExpr = resolveOp(targetLanguageId, operation, level);
  if (!opExpr) {
    return `sorry /- missing op ${targetLanguageId}.${operation} at level ${level} -/`;
  }

  return `${via} ${edgeExpr} ${opExpr}`;
}

function proofForLemmaForward(
  trace: Extract<ProofTrace, { rule: 'lemma-forward' }>,
  opCode: string
): string {
  const { lemmaId, languageId, level } = trace;
  const lemmaName = `lemma_${safeLemmaId(lemmaId)}_${level}`;

  // The lemma is ∀ (l : Language), supportsInPoly l .A1 → ... → supportsInPoly l .C
  // We instantiate with the specific language, then supply all antecedent proofs.
  // We need to find the lemma's antecedent list from the database.
  const lemma = allLemmas.find(l => l.id === lemmaId);
  if (!lemma) return `sorry /- unknown lemma ${lemmaId} -/`;

  const parts: string[] = [];
  for (const ant of lemma.antecedent) {
    const opExpr = resolveOp(languageId, ant, level);
    if (!opExpr) {
      return `sorry /- missing op ${languageId}.${ant} at level ${level} -/`;
    }
    parts.push(opExpr);
  }

  // lemma_X_poly .lang op1_proof op2_proof ...
  return `${lemmaName} ${langLean(languageId)} ${parts.join(' ')}`;
}

function proofForLemmaContrapositive(
  trace: Extract<ProofTrace, { rule: 'lemma-contrapositive' }>
): string {
  const { lemmaId, languageId, pivotOp, level } = trace;
  const lemma = allLemmas.find(l => l.id === lemmaId);
  if (!lemma) return `sorry /- unknown lemma ${lemmaId} -/`;

  // Contrapositive of: antecedents → consequent
  // We know ¬consequent and all antecedents EXCEPT pivotOp.
  // Proof: fun h => absurd (lemma lang ant1 ant2 ... h ...) neg_consequent
  // where h stands in for the pivotOp argument.

  const lemmaName = `lemma_${safeLemmaId(lemmaId)}_${level}`;

  // Build the argument list, substituting 'h' for pivotOp
  const args: string[] = [langLean(languageId)];
  for (const ant of lemma.antecedent) {
    if (ant === pivotOp) {
      args.push('h');
    } else {
      const opExpr = resolveOp(languageId, ant, level);
      if (!opExpr) {
        return `sorry /- missing op ${languageId}.${ant} at level ${level} -/`;
      }
      args.push(opExpr);
    }
  }

  // The negative consequent
  const negConseq = resolveNegOp(languageId, lemma.consequent, level);
  if (!negConseq) {
    return `sorry /- missing neg op ${languageId}.${lemma.consequent} at level ${level} -/`;
  }

  return `fun h => absurd (${lemmaName} ${args.join(' ')}) ${negConseq}`;
}

function proofForQueryDifference(
  trace: Extract<ProofTrace, { rule: 'query-difference' }>,
  srcId: string,
  tgtId: string
): string {
  const { operation, posLanguageId, negLanguageId, level } = trace;
  // Proves: ¬compilesInPoly negLanguageId posLanguageId (or quasi)
  // Logic: If negLang could compile to posLang, then negLang would support op
  //        (via query_via_poly/quasi + posLang's op support). Contradiction with negLang's ¬op.
  const via = level === 'poly' ? 'query_via_poly' : 'query_via_quasi';

  const opPos = resolveOp(posLanguageId, operation, level);
  if (!opPos) {
    return `sorry /- missing op ${posLanguageId}.${operation} at level ${level} -/`;
  }

  const opNeg = resolveNegOp(negLanguageId, operation, level);
  if (!opNeg) {
    return `sorry /- missing neg op ${negLanguageId}.${operation} at level ${level} -/`;
  }

  // fun h => absurd (query_via_poly h op_pos) op_neg
  return `fun h => absurd (${via} h ${opPos}) ${opNeg}`;
}

function proofForQueryDowngradeViaSuccinctness(
  trace: Extract<ProofTrace, { rule: 'query-downgrade-via-succinctness' }>
): string {
  const { sourceLanguageId, targetLanguageId, operation, level } = trace;
  // Source has ¬supportsIn(level) for operation.
  // Source compiles to target at that level.
  // Prove: ¬supportsIn(level) target operation.
  // Proof: fun h => absurd (query_via_poly edge_src_tgt h) op_src_neg
  const via = level === 'poly' ? 'query_via_poly' : 'query_via_quasi';

  const edgeExpr = resolveEdge(sourceLanguageId, targetLanguageId, level);
  if (!edgeExpr) {
    return `sorry /- missing edge ${sourceLanguageId} → ${targetLanguageId} at level ${level} -/`;
  }

  const opNeg = resolveNegOp(sourceLanguageId, operation, level);
  if (!opNeg) {
    return `sorry /- missing neg op ${sourceLanguageId}.${operation} at level ${level} -/`;
  }

  // fun h => absurd (query_via_poly edge h) op_neg
  return `fun h => absurd (${via} ${edgeExpr} h) ${opNeg}`;
}

function generateProofTerm(fact: DerivedFact): string {
  const { proofTrace } = fact;
  switch (proofTrace.rule) {
    case 'transitivity':
      return proofForTransitivity(proofTrace);
    case 'contradiction':
      if (fact.kind !== 'edge') return 'sorry /- contradiction on non-edge -/';
      return proofForContradiction(proofTrace, fact.srcId, fact.tgtId);
    case 'query-via-succinctness':
      return proofForQueryViaSuccinctness(proofTrace);
    case 'lemma-forward':
      if (fact.kind !== 'op') return 'sorry /- lemma-forward on non-op -/';
      return proofForLemmaForward(proofTrace, fact.opCode);
    case 'lemma-contrapositive':
      return proofForLemmaContrapositive(proofTrace);
    case 'query-difference':
      if (fact.kind !== 'edge') return 'sorry /- query-difference on non-edge -/';
      return proofForQueryDifference(proofTrace, fact.srcId, fact.tgtId);
    case 'query-downgrade-via-succinctness':
      return proofForQueryDowngradeViaSuccinctness(proofTrace);
  }
}

// Lean statement builders

function leanEdgeStatement(srcId: string, tgtId: string, claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi'): string {
  const src = langLean(srcId);
  const tgt = langLean(tgtId);
  switch (claim) {
    case 'poly': return `compilesInPoly ${src} ${tgt}`;
    case 'quasi': return `compilesInQuasi ${src} ${tgt}`;
    case 'no_poly': return `¬ compilesInPoly ${src} ${tgt}`;
    case 'no_quasi': return `¬ compilesInQuasi ${src} ${tgt}`;
  }
}

function leanOpStatement(langId: string, opCode: string, claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi'): string {
  const lang = langLean(langId);
  const op = opLean(opCode);
  switch (claim) {
    case 'poly': return `supportsInPoly ${lang} ${op}`;
    case 'quasi': return `supportsInQuasi ${lang} ${op}`;
    case 'no_poly': return `¬ supportsInPoly ${lang} ${op}`;
    case 'no_quasi': return `¬ supportsInQuasi ${lang} ${op}`;
  }
}

// State

let allLemmas: OperationLemma[] = [];

// Main

function main(): void {
  const db = loadDatabase();
  const { languages, adjacencyMatrix: am, operationLemmas } = db;
  validateLanguageConstructors(languages);
  allLemmas = (operationLemmas ?? []) as OperationLemma[];

  const lines: string[] = [];
  const emit = (s: string) => lines.push(s);
  const blank = () => lines.push('');

  emit('/-');
  emit('  TCZ/Proofs.lean — AUTO-GENERATED by scripts/generate-lean.ts');
  emit('  DO NOT EDIT. Re-generate with: npm run generate-lean');
  emit('-/');
  emit('import TCZ.Basic');
  blank();

  // ------------------------------------------------------------------
  // Section 1: Operation lemma axioms (poly + quasi)
  // ------------------------------------------------------------------
  emit('-- ═══════════════════════════════════════════════════════════════');
  emit('-- Section 1: Operation Lemma Axioms');
  emit('-- ═══════════════════════════════════════════════════════════════');
  blank();

  for (const lemma of allLemmas) {
    const safeId = safeLemmaId(lemma.id);
    for (const level of ['poly', 'quasi'] as const) {
      const fn = level === 'poly' ? 'supportsInPoly' : 'supportsInQuasi';
      const antecedentTypes = lemma.antecedent.map(a => `${fn} l ${opLean(a)}`).join(' → ');
      const consequentType = `${fn} l ${opLean(lemma.consequent)}`;
      const name = `lemma_${safeId}_${level}`;
      emit(`axiom ${name} (l : Language) : ${antecedentTypes} → ${consequentType}`);
      emittedNames.add(name);
    }
    blank();
  }

  // ------------------------------------------------------------------
  // Section 2: Non-derived edge axioms
  // ------------------------------------------------------------------
  emit('-- ═══════════════════════════════════════════════════════════════');
  emit('-- Section 2: Non-Derived Edge Axioms');
  emit('-- ═══════════════════════════════════════════════════════════════');
  blank();

  const { languageIds, matrix } = am;
  const derivedEdges: DerivedFact[] = [];

  for (let i = 0; i < languageIds.length; i++) {
    for (let j = 0; j < languageIds.length; j++) {
      if (i === j) continue;
      const rel = matrix[i]?.[j] as DirectedSuccinctnessRelation | null;
      if (!rel) continue;
      const srcId = languageIds[i];
      const tgtId = languageIds[j];

      if (!rel.derived) {
        // Non-derived edge: emit axioms based on status
        emitEdgeAxioms(emit, srcId, tgtId, rel);
      } else {
        // Derived edge: collect for later (Section 4)
        collectDerivedEdgeFacts(srcId, tgtId, rel, derivedEdges);
      }
    }
  }
  blank();

  // Also emit poly_implies_quasi corollaries for non-derived poly edges
  // These are trivially derivable but let us name them for reference
  emit('-- Quasi corollaries from poly edges (via poly_implies_quasi)');
  for (let i = 0; i < languageIds.length; i++) {
    for (let j = 0; j < languageIds.length; j++) {
      if (i === j) continue;
      const rel = matrix[i]?.[j] as DirectedSuccinctnessRelation | null;
      if (!rel || rel.derived) continue;
      const srcId = languageIds[i];
      const tgtId = languageIds[j];
      if (rel.status === 'poly') {
        const qName = edgeName(srcId, tgtId, 'quasi');
        if (!emittedNames.has(qName)) {
          const pName = edgeName(srcId, tgtId, 'poly');
          emit(`theorem ${qName} : ${leanEdgeStatement(srcId, tgtId, 'quasi')} := poly_implies_quasi ${pName}`);
          emittedNames.add(qName);
        }
      }
    }
  }
  blank();

  // Also emit no_poly corollaries from no-quasi edges
  emit('-- No-poly corollaries from no-quasi edges (contrapositive of poly_implies_quasi)');
  for (let i = 0; i < languageIds.length; i++) {
    for (let j = 0; j < languageIds.length; j++) {
      if (i === j) continue;
      const rel = matrix[i]?.[j] as DirectedSuccinctnessRelation | null;
      if (!rel || rel.derived) continue;
      const srcId = languageIds[i];
      const tgtId = languageIds[j];
      if (rel.status === 'no-quasi') {
        const npName = edgeName(srcId, tgtId, 'no_poly');
        if (!emittedNames.has(npName)) {
          const nqName = edgeName(srcId, tgtId, 'no_quasi');
          emit(`theorem ${npName} : ${leanEdgeStatement(srcId, tgtId, 'no_poly')} := fun h => absurd (poly_implies_quasi h) ${nqName}`);
          emittedNames.add(npName);
        }
      }
    }
  }
  blank();

  // ------------------------------------------------------------------
  // Section 3: Non-derived operation support axioms
  // ------------------------------------------------------------------
  emit('-- ═══════════════════════════════════════════════════════════════');
  emit('-- Section 3: Non-Derived Operation Support Axioms');
  emit('-- ═══════════════════════════════════════════════════════════════');
  blank();

  const derivedOps: DerivedFact[] = [];

  for (const lang of languages as KCLanguage[]) {
    for (const mapKey of ['queries', 'transformations'] as const) {
      const opMap = lang.properties?.[mapKey];
      if (!opMap) continue;
      for (const [opCode, support] of Object.entries(opMap) as [string, KCOpSupport][]) {
        if (!support) continue;
        if (!support.derived || support.batchId) {
          emitOpAxioms(emit, lang.id, opCode, support);
        } else {
          collectDerivedOpFacts(lang.id, opCode, support, derivedOps);
        }
      }
    }
  }
  blank();

  // Quasi corollaries from poly ops
  emit('-- Quasi corollaries from poly operation axioms (via poly_support_implies_quasi)');
  for (const lang of languages as KCLanguage[]) {
    for (const mapKey of ['queries', 'transformations'] as const) {
      const opMap = lang.properties?.[mapKey];
      if (!opMap) continue;
      for (const [opCode, support] of Object.entries(opMap) as [string, KCOpSupport][]) {
        if (!support || (support.derived && !support.batchId)) continue;
        if (support.complexity === 'poly') {
          const qName = opTheoremName(lang.id, opCode, 'quasi');
          if (!emittedNames.has(qName)) {
            const pName = opTheoremName(lang.id, opCode, 'poly');
            emit(`theorem ${qName} : ${leanOpStatement(lang.id, opCode, 'quasi')} := poly_support_implies_quasi ${pName}`);
            emittedNames.add(qName);
          }
        }
      }
    }
  }
  blank();

  // No-poly corollaries from no-quasi ops
  emit('-- No-poly corollaries from no-quasi operation axioms');
  for (const lang of languages as KCLanguage[]) {
    for (const mapKey of ['queries', 'transformations'] as const) {
      const opMap = lang.properties?.[mapKey];
      if (!opMap) continue;
      for (const [opCode, support] of Object.entries(opMap) as [string, KCOpSupport][]) {
        if (!support || (support.derived && !support.batchId)) continue;
        if (support.complexity === 'no-quasi') {
          const npName = opTheoremName(lang.id, opCode, 'no_poly');
          if (!emittedNames.has(npName)) {
            const nqName = opTheoremName(lang.id, opCode, 'no_quasi');
            emit(`theorem ${npName} : ${leanOpStatement(lang.id, opCode, 'no_poly')} := fun h => absurd (poly_support_implies_quasi h) ${nqName}`);
            emittedNames.add(npName);
          }
        }
      }
    }
  }
  blank();

  // ------------------------------------------------------------------
  // Section 4: Derived theorems (sorted by derivationOrder)
  // ------------------------------------------------------------------
  emit('-- ═══════════════════════════════════════════════════════════════');
  emit('-- Section 4: Derived Theorems');
  emit('-- ═══════════════════════════════════════════════════════════════');
  blank();

  const allDerived: DerivedFact[] = [...derivedEdges, ...derivedOps];
  allDerived.sort((a, b) => a.derivationOrder - b.derivationOrder);

  let sorryCount = 0;
  for (const fact of allDerived) {
    const name = factName(fact);
    const stmt = factStatement(fact);
    const proof = generateProofTerm(fact);
    const isSorry = proof.startsWith('sorry');
    if (isSorry) sorryCount++;

    emit(`theorem ${name} : ${stmt} :=`);
    emit(`  ${proof}`);
    emittedNames.add(name);

    // Also emit corollaries when possible
    emitDerivedCorollaries(emit, fact);
    blank();
  }

  // Write file
  const content = lines.join('\n') + '\n';
  fs.mkdirSync(path.dirname(PROOFS_PATH), { recursive: true });
  fs.writeFileSync(PROOFS_PATH, content, 'utf-8');

  // Summary
  const axiomCount = [...emittedNames].filter(n =>
    !allDerived.some(f => factName(f) === n)
  ).length;
  console.log(`Generated ${PROOFS_PATH}`);
  console.log(`  Lemma axioms:       ${allLemmas.length * 2}`);
  console.log(`  Non-derived axioms: ${axiomCount - allLemmas.length * 2}`);
  console.log(`  Derived theorems:   ${allDerived.length}`);
  console.log(`  Total names:        ${emittedNames.size}`);
  if (sorryCount > 0) {
    console.log(`  ⚠ sorry proofs:     ${sorryCount}`);
  }
}

// Helpers for axiom/fact emission

function emitEdgeAxioms(emit: (s: string) => void, srcId: string, tgtId: string, rel: DirectedSuccinctnessRelation): void {
  const { status } = rel;

  if (status === 'poly') {
    const name = edgeName(srcId, tgtId, 'poly');
    emit(`axiom ${name} : ${leanEdgeStatement(srcId, tgtId, 'poly')}`);
    emittedNames.add(name);
  }

  if (status === 'no-quasi') {
    const name = edgeName(srcId, tgtId, 'no_quasi');
    emit(`axiom ${name} : ${leanEdgeStatement(srcId, tgtId, 'no_quasi')}`);
    emittedNames.add(name);
  }

  if (status === 'no-poly-quasi') {
    // Two claims: ¬poly and quasi
    const npName = edgeName(srcId, tgtId, 'no_poly');
    emit(`axiom ${npName} : ${leanEdgeStatement(srcId, tgtId, 'no_poly')}`);
    emittedNames.add(npName);

    const qName = edgeName(srcId, tgtId, 'quasi');
    emit(`axiom ${qName} : ${leanEdgeStatement(srcId, tgtId, 'quasi')}`);
    emittedNames.add(qName);
  }

  if (status === 'no-poly-unknown-quasi') {
    // Only ¬poly is known
    const npName = edgeName(srcId, tgtId, 'no_poly');
    emit(`axiom ${npName} : ${leanEdgeStatement(srcId, tgtId, 'no_poly')}`);
    emittedNames.add(npName);
  }

  // unknown-poly-quasi: only quasi is known (poly is unknown)
  if (status === 'unknown-poly-quasi') {
    const qName = edgeName(srcId, tgtId, 'quasi');
    emit(`axiom ${qName} : ${leanEdgeStatement(srcId, tgtId, 'quasi')}`);
    emittedNames.add(qName);
  }
}

function emitOpAxioms(emit: (s: string) => void, langId: string, opCode: string, support: KCOpSupport): void {
  const { complexity } = support;

  if (complexity === 'poly') {
    const name = opTheoremName(langId, opCode, 'poly');
    emit(`axiom ${name} : ${leanOpStatement(langId, opCode, 'poly')}`);
    emittedNames.add(name);
  }

  if (complexity === 'no-quasi') {
    const name = opTheoremName(langId, opCode, 'no_quasi');
    emit(`axiom ${name} : ${leanOpStatement(langId, opCode, 'no_quasi')}`);
    emittedNames.add(name);
  }

  if (complexity === 'no-poly-unknown-quasi') {
    const name = opTheoremName(langId, opCode, 'no_poly');
    emit(`axiom ${name} : ${leanOpStatement(langId, opCode, 'no_poly')}`);
    emittedNames.add(name);
  }

  // unknown-poly-quasi and unknown-to-us: nothing provable, skip
}

function collectDerivedEdgeFacts(
  srcId: string,
  tgtId: string,
  rel: DirectedSuccinctnessRelation,
  out: DerivedFact[]
): void {
  const { status } = rel;

  // Simple derived edge with top-level proofTrace
  if (rel.proofTrace && rel.derivationOrder !== undefined) {
    const claims = edgeStatusToClaims(status);
    for (const claim of claims) {
      // For the top-level trace, we emit the claim that matches the trace's polarity
      if (claimMatchesTrace(claim, rel.proofTrace)) {
        out.push({
          kind: 'edge',
          srcId,
          tgtId,
          claim,
          derivationOrder: rel.derivationOrder,
          proofTrace: rel.proofTrace
        });
      }
    }
  }

  // Structured no-poly-quasi: check each component
  if (rel.noPolyDescription?.derived && rel.noPolyDescription.proofTrace && rel.noPolyDescription.derivationOrder !== undefined) {
    out.push({
      kind: 'edge',
      srcId,
      tgtId,
      claim: 'no_poly',
      derivationOrder: rel.noPolyDescription.derivationOrder,
      proofTrace: rel.noPolyDescription.proofTrace
    });
  }
  if (rel.quasiDescription?.derived && rel.quasiDescription.proofTrace && rel.quasiDescription.derivationOrder !== undefined) {
    out.push({
      kind: 'edge',
      srcId,
      tgtId,
      claim: 'quasi',
      derivationOrder: rel.quasiDescription.derivationOrder,
      proofTrace: rel.quasiDescription.proofTrace
    });
  }
}

function collectDerivedOpFacts(
  langId: string,
  opCode: string,
  support: KCOpSupport,
  out: DerivedFact[]
): void {
  if (!support.proofTrace || support.derivationOrder === undefined) return;

  const claims = opComplexityToClaims(support.complexity);
  for (const claim of claims) {
    if (opClaimMatchesTrace(claim, support.proofTrace)) {
      out.push({
        kind: 'op',
        langId,
        opCode,
        claim,
        derivationOrder: support.derivationOrder,
        proofTrace: support.proofTrace
      });
    }
  }
}

function edgeStatusToClaims(status: string): ('poly' | 'quasi' | 'no_poly' | 'no_quasi')[] {
  switch (status) {
    case 'poly': return ['poly'];
    case 'unknown-poly-quasi': return ['quasi'];
    case 'no-poly-unknown-quasi': return ['no_poly'];
    case 'no-poly-quasi': return ['no_poly', 'quasi'];
    case 'no-quasi': return ['no_quasi'];
    default: return [];
  }
}

function opComplexityToClaims(complexity: string): ('poly' | 'quasi' | 'no_poly' | 'no_quasi')[] {
  switch (complexity) {
    case 'poly': return ['poly'];
    case 'unknown-poly-quasi': return ['quasi'];
    case 'no-poly-unknown-quasi': return ['no_poly'];
    case 'no-poly-quasi': return ['no_poly', 'quasi'];
    case 'no-quasi': return ['no_quasi'];
    default: return [];
  }
}

function claimMatchesTrace(claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi', trace: ProofTrace): boolean {
  switch (trace.rule) {
    case 'transitivity':
      return (trace.level === 'poly' && claim === 'poly') ||
             (trace.level === 'quasi' && claim === 'quasi');
    case 'contradiction':
      // triedStatus is what was tested; the result is the negation
      if (trace.triedStatus === 'poly') return claim === 'no_poly';
      if (trace.triedStatus === 'unknown-poly-quasi' || trace.triedStatus === 'no-poly-quasi') return claim === 'no_quasi';
      return false;
    case 'query-difference':
      return (trace.level === 'poly' && claim === 'no_poly') ||
             (trace.level === 'quasi' && claim === 'no_quasi');
    default:
      return false;
  }
}

function opClaimMatchesTrace(claim: 'poly' | 'quasi' | 'no_poly' | 'no_quasi', trace: ProofTrace): boolean {
  switch (trace.rule) {
    case 'query-via-succinctness':
    case 'lemma-forward':
      return (trace.level === 'poly' && claim === 'poly') ||
             (trace.level === 'quasi' && claim === 'quasi');
    case 'query-downgrade-via-succinctness':
    case 'lemma-contrapositive':
      return (trace.level === 'poly' && claim === 'no_poly') ||
             (trace.level === 'quasi' && claim === 'no_quasi');
    default:
      return false;
  }
}

function factName(fact: DerivedFact): string {
  if (fact.kind === 'edge') return edgeName(fact.srcId, fact.tgtId, fact.claim);
  return opTheoremName(fact.langId, fact.opCode, fact.claim);
}

function factStatement(fact: DerivedFact): string {
  if (fact.kind === 'edge') return leanEdgeStatement(fact.srcId, fact.tgtId, fact.claim);
  return leanOpStatement(fact.langId, fact.opCode, fact.claim);
}

function emitDerivedCorollaries(emit: (s: string) => void, fact: DerivedFact): void {
  if (fact.kind === 'edge') {
    // poly edge → quasi corollary
    if (fact.claim === 'poly') {
      const qName = edgeName(fact.srcId, fact.tgtId, 'quasi');
      if (!emittedNames.has(qName)) {
        const pName = edgeName(fact.srcId, fact.tgtId, 'poly');
        emit(`theorem ${qName} : ${leanEdgeStatement(fact.srcId, fact.tgtId, 'quasi')} := poly_implies_quasi ${pName}`);
        emittedNames.add(qName);
      }
    }
    // no-quasi edge → no-poly corollary
    if (fact.claim === 'no_quasi') {
      const npName = edgeName(fact.srcId, fact.tgtId, 'no_poly');
      if (!emittedNames.has(npName)) {
        const nqName = edgeName(fact.srcId, fact.tgtId, 'no_quasi');
        emit(`theorem ${npName} : ${leanEdgeStatement(fact.srcId, fact.tgtId, 'no_poly')} := fun h => absurd (poly_implies_quasi h) ${nqName}`);
        emittedNames.add(npName);
      }
    }
  }
  if (fact.kind === 'op') {
    // poly op → quasi corollary
    if (fact.claim === 'poly') {
      const qName = opTheoremName(fact.langId, fact.opCode, 'quasi');
      if (!emittedNames.has(qName)) {
        const pName = opTheoremName(fact.langId, fact.opCode, 'poly');
        emit(`theorem ${qName} : ${leanOpStatement(fact.langId, fact.opCode, 'quasi')} := poly_support_implies_quasi ${pName}`);
        emittedNames.add(qName);
      }
    }
    // no-quasi op → no-poly corollary
    if (fact.claim === 'no_quasi') {
      const npName = opTheoremName(fact.langId, fact.opCode, 'no_poly');
      if (!emittedNames.has(npName)) {
        const nqName = opTheoremName(fact.langId, fact.opCode, 'no_quasi');
        emit(`theorem ${npName} : ${leanOpStatement(fact.langId, fact.opCode, 'no_poly')} := fun h => absurd (poly_support_implies_quasi h) ${nqName}`);
        emittedNames.add(npName);
      }
    }
  }
}

main();
