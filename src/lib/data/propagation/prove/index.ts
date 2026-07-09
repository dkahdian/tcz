import type {
  DirectedSuccinctnessRelation,
  GraphData,
  KCBatchSelector,
  OperationLemma,
  ProofAtom,
  PropagationProof
} from '../../../types.js';
import { OPERATION_LEMMAS } from '../../query-lemmas.js';
import { expandBatchTemplate } from '../../batch-claims.js';
import {
  formatCitations,
  languageRefForId,
  negativeCompilationRef,
  positiveCompilationRef
} from '../helpers.js';
import {
  addFact,
  allAtoms,
  atomKey,
  batchAtom,
  edgeAtom,
  type Atom,
  type EdgeKind,
  type FactContext,
  type FactOrigin,
  type FactTables,
  type CertifiedFact,
  type FactMetadata,
  getOrigin,
  hasFact,
  isQueryCode,
  opAtom,
  opAssertsNoPoly,
  opGuaranteesPoly,
  resolveBatchLanguageRef,
  selectorForBatch
} from '../facts/index.js';

interface ProofPolicy {
  phase: 'clean' | 'dirty';
  allowedOrigins: Set<FactOrigin>;
}

type CertifiedMap = Map<string, CertifiedFact>;

function mergeRefs(...refs: Array<string[] | undefined>): string[] {
  return [...new Set(refs.flatMap((list) => list ?? []).filter(Boolean))];
}

function mergeAssumptions(...assumptions: Array<string | undefined>): string | undefined {
  const parts = new Set<string>();
  for (const assumption of assumptions) {
    if (!assumption) continue;
    for (const part of assumption.split(/\s+AND\s+/)) {
      const trimmed = part.trim();
      if (trimmed) parts.add(trimmed);
    }
  }
  return parts.size > 0 ? [...parts].join(' AND ') : undefined;
}

const OPERATION_MACROS: Record<string, string> = {
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

function operationMacro(op: string): string {
  return OPERATION_MACROS[op] ?? `\\${op.replace(/[^A-Za-z0-9]/g, '')}`;
}

function supportPhrase(context: FactContext, language: number, op: string): string {
  return `\\supportspoly{${languageRefForId(context.languageIds[language])}}{${operationMacro(op)}}`;
}

function noSupportPhrase(context: FactContext, language: number, op: string): string {
  return `\\nosupportspoly{${languageRefForId(context.languageIds[language])}}{${operationMacro(op)}}`;
}

function atomLabel(context: FactContext, atom: Atom): string {
  switch (atom.kind) {
    case 'leP':
      return positiveCompilationRef(context.languageIds[atom.source], context.languageIds[atom.target], 'poly');
    case 'leQ':
      return positiveCompilationRef(context.languageIds[atom.source], context.languageIds[atom.target], 'quasi');
    case 'notLeP':
      return negativeCompilationRef(context.languageIds[atom.source], context.languageIds[atom.target], 'poly');
    case 'notLeQ':
      return negativeCompilationRef(context.languageIds[atom.source], context.languageIds[atom.target], 'quasi');
    case 'supportsP':
      return supportPhrase(context, atom.language, atom.op);
    case 'notSupportsP':
      return noSupportPhrase(context, atom.language, atom.op);
    case 'batchApplies':
      return `batch ${context.batches[atom.batch]?.id ?? atom.batch} applies to ${languageRefForId(context.languageIds[atom.language])}`;
  }
}

function toProofAtom(context: FactContext, atom: Atom): ProofAtom | null {
  switch (atom.kind) {
    case 'leP':
    case 'leQ':
    case 'notLeP':
    case 'notLeQ':
      return { kind: atom.kind, sourceId: context.languageIds[atom.source], targetId: context.languageIds[atom.target] };
    case 'supportsP':
    case 'notSupportsP':
      return { kind: atom.kind, languageId: context.languageIds[atom.language], op: atom.op };
    case 'batchApplies':
      return null;
  }
}

function fromProofAtom(context: FactContext, atom: ProofAtom): Atom | null {
  switch (atom.kind) {
    case 'leP':
    case 'leQ':
    case 'notLeP':
    case 'notLeQ': {
      const source = context.languageIndex.get(atom.sourceId);
      const target = context.languageIndex.get(atom.targetId);
      return source === undefined || target === undefined ? null : edgeAtom(atom.kind, source, target);
    }
    case 'supportsP':
    case 'notSupportsP': {
      const language = context.languageIndex.get(atom.languageId);
      return language === undefined ? null : opAtom(atom.kind, language, atom.op);
    }
  }
}

function proof(rule: PropagationProof['rule'], context: FactContext, premises: Atom[]): PropagationProof {
  return {
    rule,
    premises: premises.map((atom) => toProofAtom(context, atom)).filter((atom): atom is ProofAtom => atom !== null)
  };
}

function available(certified: CertifiedMap, atom: Atom, policy: ProofPolicy): CertifiedFact | undefined {
  const fact = certified.get(atomKey(atom));
  if (!fact) return undefined;
  if (policy.phase === 'clean' && fact.phase !== 'clean') return undefined;
  if (!policy.allowedOrigins.has(fact.origin)) return undefined;
  return fact;
}

function certifiedMetadata(certified: CertifiedMap, atoms: Atom[]): Pick<FactMetadata, 'refs' | 'assumption'> {
  return {
    refs: mergeRefs(...atoms.map((atom) => certified.get(atomKey(atom))?.refs)),
    assumption: mergeAssumptions(...atoms.map((atom) => certified.get(atomKey(atom))?.assumption))
  };
}

function reusableMetadata(context: FactContext, atom: Atom): FactMetadata | undefined {
  if (context.authored.has(atomKey(atom))) return undefined;
  return context.oldProofs.get(atomKey(atom));
}

function validateOldProof(
  context: FactContext,
  atom: Atom,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'phase'> | null {
  const metadata = context.oldProofs.get(atomKey(atom));
  if (!metadata?.proof) return null;
  if (!policy.allowedOrigins.has(metadata.origin)) return null;
  if (policy.phase === 'clean' && metadata.assumption) return null;
  const premises: Atom[] = [];
  for (const premise of metadata.proof.premises) {
    const premiseAtom = fromProofAtom(context, premise);
    if (!premiseAtom || !available(certified, premiseAtom, policy)) return null;
    premises.push(premiseAtom);
  }
  if (!validProofRule(context, atom, metadata.proof, premises)) return null;
  return {
    origin: metadata.origin,
    refs: metadata.refs,
    description: metadata.description,
    assumption: metadata.assumption,
    batchId: metadata.batchId,
    proof: metadata.proof
  };
}

function validProofRule(context: FactContext, atom: Atom, oldProof: PropagationProof, premises: Atom[]): boolean {
  switch (oldProof.rule) {
    case 'authored':
      return premises.length === 0 && context.authored.has(atomKey(atom));
    case 'batch':
      return validBatchProof(context, atom, premises);
    case 'positive-path':
      return validPositivePath(atom, premises);
    case 'negative-obstruction':
      return validNegativeObstruction(atom, premises);
    case 'query-transfer':
      return validQueryTransfer(context, atom, premises);
    case 'query-separation':
      return validQuerySeparation(context, atom, premises);
    case 'lemma-forward':
      return validLemmaForward(atom, premises);
    case 'lemma-contrapositive':
      return validLemmaContrapositive(atom, premises);
    case 'no-quasi-implies-no-poly':
      return atom.kind === 'notLeP'
        && premises.length === 1
        && premises[0].kind === 'notLeQ'
        && premises[0].source === atom.source
        && premises[0].target === atom.target;
  }
}

function validBatchProof(context: FactContext, atom: Atom, premises: Atom[]): boolean {
  if (atom.kind === 'batchApplies') return premises.length === 0;
  if (atom.kind !== 'supportsP' && atom.kind !== 'notSupportsP') return false;
  const batchIndex = context.batchSources.get(atomKey(atom));
  if (batchIndex === undefined || premises.length !== 1) return false;
  const batch = context.batches[batchIndex];
  const premise = premises[0];
  const expectedKind = opGuaranteesPoly(batch?.status) ? 'supportsP' : opAssertsNoPoly(batch?.status) ? 'notSupportsP' : null;
  return expectedKind === atom.kind
    && batch?.op === atom.op
    && premise.kind === 'batchApplies'
    && premise.batch === batchIndex
    && premise.language === atom.language;
}

function positiveStep(atom: Atom, level: 'leP' | 'leQ', source: number): number | null {
  if (atom.kind !== 'leP' && atom.kind !== 'leQ') return null;
  if (atom.source !== source) return null;
  if (level === 'leP' && atom.kind !== 'leP') return null;
  return atom.target;
}

function pathConnects(premises: Atom[], source: number, target: number, level: 'leP' | 'leQ'): boolean {
  let current = source;
  for (const premise of premises) {
    const next = positiveStep(premise, level, current);
    if (next === null) return false;
    current = next;
  }
  return current === target;
}

function validPositivePath(atom: Atom, premises: Atom[]): boolean {
  if (atom.kind !== 'leP' && atom.kind !== 'leQ') return false;
  return pathConnects(premises, atom.source, atom.target, atom.kind);
}

function validNegativeObstruction(atom: Atom, premises: Atom[]): boolean {
  if (atom.kind !== 'notLeP' && atom.kind !== 'notLeQ') return false;
  const obstructionIndex = premises.findIndex((premise) => premise.kind === atom.kind);
  if (obstructionIndex < 0) return false;
  const obstruction = premises[obstructionIndex];
  if (obstruction.kind !== atom.kind) return false;
  const level = atom.kind === 'notLeP' ? 'leP' : 'leQ';
  const left = premises.slice(0, obstructionIndex);
  const right = premises.slice(obstructionIndex + 1);
  return pathConnects(left, obstruction.source, atom.source, level)
    && pathConnects(right, atom.target, obstruction.target, level);
}

function validQueryTransfer(context: FactContext, atom: Atom, premises: Atom[]): boolean {
  if (atom.kind !== 'supportsP' && atom.kind !== 'notSupportsP') return false;
  if (!context.operations.queryCodes.includes(atom.op)) return false;
  const leafIndex = premises.findIndex((premise) =>
    premise.kind === atom.kind && premise.op === atom.op
  );
  if (leafIndex < 0) return false;
  const leaf = premises[leafIndex];
  if (leaf.kind !== atom.kind) return false;
  const path = premises.filter((_, index) => index !== leafIndex);
  return atom.kind === 'supportsP'
    ? pathConnects(path, atom.language, leaf.language, 'leP')
    : pathConnects(path, leaf.language, atom.language, 'leP');
}

function validQuerySeparation(context: FactContext, atom: Atom, premises: Atom[]): boolean {
  if (atom.kind !== 'notLeP' || premises.length !== 2) return false;
  const support = premises.find((premise) => premise.kind === 'supportsP');
  const noSupport = premises.find((premise) => premise.kind === 'notSupportsP');
  if (!support || !noSupport || support.kind !== 'supportsP' || noSupport.kind !== 'notSupportsP') return false;
  return support.op === noSupport.op
    && context.operations.queryCodes.includes(support.op)
    && support.language === atom.target
    && noSupport.language === atom.source;
}

function sameOpSet(atoms: Atom[], language: number, kind: 'supportsP' | 'notSupportsP', ops: string[]): boolean {
  const actual = new Set<string>();
  for (const atom of atoms) {
    if (atom.kind !== kind || atom.language !== language) return false;
    actual.add(atom.op);
  }
  return actual.size === ops.length && ops.every((op) => actual.has(op));
}

function validLemmaForward(atom: Atom, premises: Atom[]): boolean {
  if (atom.kind !== 'supportsP') return false;
  return OPERATION_LEMMAS.some((lemma) =>
    lemma.consequent === atom.op && sameOpSet(premises, atom.language, 'supportsP', lemma.antecedent)
  );
}

function validLemmaContrapositive(atom: Atom, premises: Atom[]): boolean {
  if (atom.kind !== 'notSupportsP') return false;
  return OPERATION_LEMMAS.some((lemma) => {
    if (!lemma.antecedent.includes(atom.op)) return false;
    const consequent = premises.find((premise) =>
      premise.kind === 'notSupportsP' && premise.language === atom.language && premise.op === lemma.consequent
    );
    if (!consequent) return false;
    const others = premises.filter((premise) => premise !== consequent);
    return sameOpSet(
      others,
      atom.language,
      'supportsP',
      lemma.antecedent.filter((op) => op !== atom.op)
    );
  });
}

export function certifyFacts(context: FactContext, tables: FactTables): CertifiedMap {
  const certified: CertifiedMap = new Map();
  const candidates = allAtoms(tables, context);

  certifyAuthored(context, candidates, certified, 'clean');
  runTier(context, tables, candidates, certified, { phase: 'clean', allowedOrigins: new Set(['authored']) });
  runTier(context, tables, candidates, certified, { phase: 'clean', allowedOrigins: new Set(['authored', 'batch']) });
  runTier(context, tables, candidates, certified, { phase: 'clean', allowedOrigins: new Set(['authored', 'batch', 'derived']) });

  certifyAuthored(context, candidates, certified, 'dirty');
  runTier(context, tables, candidates, certified, { phase: 'dirty', allowedOrigins: new Set(['authored']) });
  runTier(context, tables, candidates, certified, { phase: 'dirty', allowedOrigins: new Set(['authored', 'batch']) });
  runTier(context, tables, candidates, certified, { phase: 'dirty', allowedOrigins: new Set(['authored', 'batch', 'derived']) });

  const missing = candidates.filter((atom) => !certified.has(atomKey(atom)));
  if (missing.length > 0) {
    throw new Error(`Propagation proof search failed for ${missing.length} facts; first missing fact is ${atomLabel(context, missing[0])}`);
  }

  return certified;
}

function certifyAuthored(
  context: FactContext,
  candidates: Atom[],
  certified: CertifiedMap,
  phase: 'clean' | 'dirty'
): void {
  for (const atom of candidates) {
    const key = atomKey(atom);
    if (certified.has(key)) continue;
    const metadata = context.authored.get(key);
    if (!metadata) continue;
    if (phase === 'clean' && metadata.assumption) continue;
    certified.set(key, {
      atom,
      origin: 'authored',
      refs: metadata.refs,
      description: metadata.description,
      assumption: metadata.assumption,
      proof: proof('authored', context, []),
      phase
    });
  }
}

function runTier(
  context: FactContext,
  tables: FactTables,
  candidates: Atom[],
  certified: CertifiedMap,
  policy: ProofPolicy
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const atom of candidates) {
      const key = atomKey(atom);
      if (certified.has(key)) continue;
      const origin = getOrigin(tables, atom);
      if (origin === 'batch' && !policy.allowedOrigins.has('batch')) continue;
      const oldProof = validateOldProof(context, atom, certified, policy);
      const found = oldProof ?? (origin === 'batch'
        ? proveBatchFact(context, atom, certified, policy)
        : proveDerivedFact(context, tables, atom, certified, policy));
      if (!found) continue;
      certified.set(key, { ...found, atom, origin: oldProof?.origin ?? origin, phase: policy.phase });
      changed = true;
    }
  }
}

function proveBatchFact(
  context: FactContext,
  atom: Atom,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  if (atom.kind === 'batchApplies') {
    const batch = context.batches[atom.batch];
    if (!batch) return null;
    const selectorProof = proveSelector(context, selectorForBatch(batch), atom.language, certified, policy);
    if (!selectorProof) return null;
    return {
      refs: selectorProof.refs,
      assumption: selectorProof.assumption,
      description: `The selector for batch claim ${batch.id} applies to ${languageRefForId(context.languageIds[atom.language])}. ${selectorProof.description ?? ''}`.trim(),
      proof: proof('batch', context, []),
      batchId: batch.id
    };
  }

  if (atom.kind !== 'supportsP' && atom.kind !== 'notSupportsP') return null;
  const batchIndex = context.batchSources.get(atomKey(atom));
  if (batchIndex === undefined) return null;
  const batch = context.batches[batchIndex];
  const applies = batchAtom(batchIndex, atom.language);
  const appliesProof = available(certified, applies, policy);
  if (!batch || !appliesProof) return null;

  return {
    refs: mergeRefs(batch.refs, appliesProof.refs),
    assumption: mergeAssumptions(batch.assumption, appliesProof.assumption),
    description: expandBatchTemplate(batch.descriptionTemplate, context.data.languages[atom.language]),
    proof: proof('batch', context, [applies]),
    batchId: batch.id
  };
}

function proveSelector(
  context: FactContext,
  selector: KCBatchSelector,
  language: number,
  certified: CertifiedMap,
  policy: ProofPolicy
): Pick<FactMetadata, 'refs' | 'assumption' | 'description'> | null {
  switch (selector.kind) {
    case 'list':
      return selector.languageIds.includes(context.languageIds[language])
        ? { refs: [], description: `${languageRefForId(context.languageIds[language])} is listed explicitly.` }
        : null;
    case 'allOf': {
      const proofs = selector.selectors.map((child) => proveSelector(context, child, language, certified, policy));
      if (proofs.some((proof) => !proof)) return null;
      return {
        refs: mergeRefs(...proofs.map((proof) => proof?.refs)),
        assumption: mergeAssumptions(...proofs.map((proof) => proof?.assumption)),
        description: proofs.map((proof) => proof?.description).filter(Boolean).join(' ')
      };
    }
    case 'anyOf': {
      for (const child of selector.selectors) {
        const proof = proveSelector(context, child, language, certified, policy);
        if (proof) return proof;
      }
      return null;
    }
    case 'edge': {
      const source = resolveBatchLanguageRef(context, language, selector.source);
      const target = resolveBatchLanguageRef(context, language, selector.target);
      if (source === undefined || target === undefined) return null;
      if (source === target && (selector.polarity ?? 'positive') === 'positive') {
        return { refs: [], description: 'Reflexive polynomial compilation is immediate.' };
      }
      const atom = (selector.polarity ?? 'positive') === 'negative'
        ? edgeAtom(selector.level === 'poly' ? 'notLeP' : 'notLeQ', source, target)
        : edgeAtom(selector.level === 'poly' ? 'leP' : 'leQ', source, target);
      const proof = available(certified, atom, policy);
      return proof ? { refs: proof.refs, assumption: proof.assumption, description: proof.description } : null;
    }
    case 'operation': {
      const targetLanguage = resolveBatchLanguageRef(context, language, selector.language);
      if (targetLanguage === undefined) return null;
      const atom = opAtom((selector.polarity ?? 'positive') === 'positive' ? 'supportsP' : 'notSupportsP', targetLanguage, selector.op);
      const proof = available(certified, atom, policy);
      return proof ? { refs: proof.refs, assumption: proof.assumption, description: proof.description } : null;
    }
  }
}

function proveDerivedFact(
  context: FactContext,
  tables: FactTables,
  atom: Atom,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  switch (atom.kind) {
    case 'leP':
      return provePositiveEdge(context, atom.source, atom.target, 'leP', certified, policy);
    case 'leQ':
      return provePositiveEdge(context, atom.source, atom.target, 'leQ', certified, policy);
    case 'notLeP':
      return proveNoPolyEdge(context, tables, atom.source, atom.target, certified, policy);
    case 'notLeQ':
      return proveNegativeObstruction(context, atom.source, atom.target, 'notLeQ', certified, policy);
    case 'supportsP':
      return proveSupport(context, atom.language, atom.op, certified, policy);
    case 'notSupportsP':
      return proveNoSupport(context, atom.language, atom.op, certified, policy);
    case 'batchApplies':
      return null;
  }
}

function provePositiveEdge(
  context: FactContext,
  source: number,
  target: number,
  level: 'leP' | 'leQ',
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  const path = findPath(context, source, target, level, certified, policy);
  if (!path) return null;
  const metadata = certifiedMetadata(certified, path);
  const pathText = path.map((atom) => atomLabel(context, atom)).join('. ');
  return {
    refs: metadata.refs,
    assumption: metadata.assumption,
    description: `${pathText}. Therefore ${atomLabel(context, edgeAtom(level, source, target))}.`,
    proof: proof('positive-path', context, path)
  };
}

function proveNoPolyEdge(
  context: FactContext,
  tables: FactTables,
  source: number,
  target: number,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  const noQuasi = available(certified, edgeAtom('notLeQ', source, target), policy);
  if (noQuasi) {
    return {
      refs: noQuasi.refs,
      assumption: noQuasi.assumption,
      description: `${atomLabel(context, edgeAtom('notLeQ', source, target))}. Therefore ${atomLabel(context, edgeAtom('notLeP', source, target))}.`,
      proof: proof('no-quasi-implies-no-poly', context, [edgeAtom('notLeQ', source, target)])
    };
  }
  return proveNegativeObstruction(context, source, target, 'notLeP', certified, policy)
    ?? proveQuerySeparation(context, source, target, certified, policy);
}

function proveNegativeObstruction(
  context: FactContext,
  source: number,
  target: number,
  obstructionKind: 'notLeP' | 'notLeQ',
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  const positiveLevel = obstructionKind === 'notLeP' ? 'leP' : 'leQ';
  const left = bfsDistances(context, source, positiveLevel, 'backward', certified, policy);
  const right = bfsDistances(context, target, positiveLevel, 'forward', certified, policy);
  let best: { c: number; d: number; score: number } | null = null;
  const n = context.languageIds.length;

  for (let c = 0; c < n; c += 1) {
    if (left.dist[c] === Infinity) continue;
    for (let d = 0; d < n; d += 1) {
      if (right.dist[d] === Infinity) continue;
      if (!available(certified, edgeAtom(obstructionKind, c, d), policy)) continue;
      const score = left.dist[c] + right.dist[d];
      if (!best || score < best.score) best = { c, d, score };
    }
  }

  if (!best) return null;
  const leftPath = reconstructBackwardPath(best.c, source, left.parent, positiveLevel, certified, policy);
  const rightPath = reconstructPath(target, best.d, right.parent, positiveLevel, certified, policy);
  const obstruction = edgeAtom(obstructionKind, best.c, best.d);
  const premiseAtoms = [...leftPath, obstruction, ...rightPath];
  const metadata = certifiedMetadata(certified, premiseAtoms);
  const targetAtom = edgeAtom(obstructionKind, source, target);
  const assumed = `${languageRefForId(context.languageIds[source])} compiled to ${languageRefForId(context.languageIds[target])} ${
    positiveLevel === 'leP' ? 'with polynomial blowup' : 'with quasipolynomial blowup'
  }`;
  return {
    refs: metadata.refs,
    assumption: metadata.assumption,
    description: `${premiseAtoms.map((atom) => atomLabel(context, atom)).join('. ')}. If ${assumed}, this would contradict ${atomLabel(context, obstruction)}. Therefore ${atomLabel(context, targetAtom)}.`,
    proof: proof('negative-obstruction', context, premiseAtoms)
  };
}

function proveQuerySeparation(
  context: FactContext,
  source: number,
  target: number,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  for (const query of context.operations.queryCodes) {
    const positive = opAtom('supportsP', target, query);
    const negative = opAtom('notSupportsP', source, query);
    if (!available(certified, positive, policy) || !available(certified, negative, policy)) continue;
    const metadata = certifiedMetadata(certified, [positive, negative]);
    return {
      refs: metadata.refs,
      assumption: metadata.assumption,
      description: `${atomLabel(context, positive)}, but ${atomLabel(context, negative)}. If ${languageRefForId(context.languageIds[source])} compiled to ${languageRefForId(context.languageIds[target])} with polynomial blowup, then ${languageRefForId(context.languageIds[source])} would support ${operationMacro(query)} in polynomial time, a contradiction. Therefore ${atomLabel(context, edgeAtom('notLeP', source, target))}.`,
      proof: proof('query-separation', context, [positive, negative])
    };
  }
  return null;
}

function proveSupport(
  context: FactContext,
  language: number,
  op: string,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  if (isQueryCode(op)) {
    for (let target = 0; target < context.languageIds.length; target += 1) {
      if (target === language) continue;
      const leaf = opAtom('supportsP', target, op);
      if (!available(certified, leaf, policy)) continue;
      const path = findPath(context, language, target, 'leP', certified, policy);
      if (!path) continue;
      const metadata = certifiedMetadata(certified, [...path, leaf]);
      return {
        refs: metadata.refs,
        assumption: metadata.assumption,
        description: `${path.map((atom) => atomLabel(context, atom)).join('. ')}, and ${atomLabel(context, leaf)}. Therefore ${supportPhrase(context, language, op)}.`,
        proof: proof('query-transfer', context, [...path, leaf])
      };
    }
  }
  return proveLemmaForward(context, language, op, certified, policy);
}

function proveNoSupport(
  context: FactContext,
  language: number,
  op: string,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  if (isQueryCode(op)) {
    for (let source = 0; source < context.languageIds.length; source += 1) {
      if (source === language) continue;
      const leaf = opAtom('notSupportsP', source, op);
      if (!available(certified, leaf, policy)) continue;
      const path = findPath(context, source, language, 'leP', certified, policy);
      if (!path) continue;
      const metadata = certifiedMetadata(certified, [...path, leaf]);
      return {
        refs: metadata.refs,
        assumption: metadata.assumption,
        description: `${atomLabel(context, leaf)}, and ${path.map((atom) => atomLabel(context, atom)).join('. ')}. If ${languageRefForId(context.languageIds[language])} supported ${operationMacro(op)} in polynomial time, then ${languageRefForId(context.languageIds[source])} would support it by compiling first. Therefore ${noSupportPhrase(context, language, op)}.`,
        proof: proof('query-transfer', context, [...path, leaf])
      };
    }
  }
  return proveLemmaContrapositive(context, language, op, certified, policy);
}

function proveLemmaForward(
  context: FactContext,
  language: number,
  op: string,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  for (const lemma of OPERATION_LEMMAS) {
    if (lemma.consequent !== op) continue;
    const antecedents = lemma.antecedent.map((antecedent) => opAtom('supportsP', language, antecedent));
    if (antecedents.some((atom) => !available(certified, atom, policy))) continue;
    const metadata = certifiedMetadata(certified, antecedents);
    return {
      refs: mergeRefs(metadata.refs, lemma.refs),
      assumption: metadata.assumption,
      description: `${antecedents.map((atom) => atomLabel(context, atom)).join('. ')}. Since ${lemma.description}${formatCitations(lemma.refs)}, ${supportPhrase(context, language, op)}.`,
      proof: proof('lemma-forward', context, antecedents)
    };
  }
  return null;
}

function proveLemmaContrapositive(
  context: FactContext,
  language: number,
  op: string,
  certified: CertifiedMap,
  policy: ProofPolicy
): Omit<CertifiedFact, 'atom' | 'origin' | 'phase'> | null {
  for (const lemma of OPERATION_LEMMAS as OperationLemma[]) {
    if (!lemma.antecedent.includes(op)) continue;
    const consequent = opAtom('notSupportsP', language, lemma.consequent);
    if (!available(certified, consequent, policy)) continue;
    const others = lemma.antecedent
      .filter((antecedent) => antecedent !== op)
      .map((antecedent) => opAtom('supportsP', language, antecedent));
    if (others.some((atom) => !available(certified, atom, policy))) continue;
    const metadata = certifiedMetadata(certified, [consequent, ...others]);
    return {
      refs: mergeRefs(metadata.refs, lemma.refs),
      assumption: metadata.assumption,
      description: `${lemma.description}${formatCitations(lemma.refs)}. However, ${atomLabel(context, consequent)}.${others.length > 0 ? ` Also, ${others.map((atom) => atomLabel(context, atom)).join('. ')}.` : ''} Therefore ${noSupportPhrase(context, language, op)}.`,
      proof: proof('lemma-contrapositive', context, [consequent, ...others])
    };
  }
  return null;
}

function edgeAtomsForStep(
  source: number,
  target: number,
  level: 'leP' | 'leQ',
  certified: CertifiedMap,
  policy: ProofPolicy
): Atom[] {
  const atoms = level === 'leP'
    ? [edgeAtom('leP', source, target)]
    : [edgeAtom('leP', source, target), edgeAtom('leQ', source, target)];
  return atoms.filter((atom) => available(certified, atom, policy));
}

function findPath(
  context: FactContext,
  source: number,
  target: number,
  level: 'leP' | 'leQ',
  certified: CertifiedMap,
  policy: ProofPolicy
): Atom[] | null {
  if (source === target) return [];
  const { parent } = bfsDistances(context, source, level, 'forward', certified, policy);
  if (parent[target] === -1) return null;
  return reconstructPath(source, target, parent, level, certified, policy);
}

function bfsDistances(
  context: FactContext,
  start: number,
  level: 'leP' | 'leQ',
  direction: 'forward' | 'backward',
  certified: CertifiedMap,
  policy: ProofPolicy
): { dist: number[]; parent: number[] } {
  const n = context.languageIds.length;
  const dist = Array<number>(n).fill(Infinity);
  const parent = Array<number>(n).fill(-1);
  const queue: number[] = [start];
  dist[start] = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (let next = 0; next < n; next += 1) {
      if (next === current || dist[next] !== Infinity) continue;
      const atoms = direction === 'forward'
        ? edgeAtomsForStep(current, next, level, certified, policy)
        : edgeAtomsForStep(next, current, level, certified, policy);
      if (atoms.length === 0) continue;
      dist[next] = dist[current] + 1;
      parent[next] = current;
      queue.push(next);
    }
  }
  return { dist, parent };
}

function reconstructPath(
  source: number,
  target: number,
  parent: number[],
  level: 'leP' | 'leQ',
  certified: CertifiedMap,
  policy: ProofPolicy
): Atom[] {
  const nodes: number[] = [];
  let current = target;
  while (current !== -1 && current !== source) {
    nodes.push(current);
    current = parent[current];
  }
  if (current !== source) return [];
  nodes.push(source);
  nodes.reverse();

  const atoms: Atom[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const options = edgeAtomsForStep(nodes[i], nodes[i + 1], level, certified, policy);
    atoms.push(options[0]);
  }
  return atoms;
}

function reconstructBackwardPath(
  source: number,
  target: number,
  parentTowardTarget: number[],
  level: 'leP' | 'leQ',
  certified: CertifiedMap,
  policy: ProofPolicy
): Atom[] {
  const atoms: Atom[] = [];
  let current = source;
  while (current !== target && current !== -1) {
    const next = parentTowardTarget[current];
    if (next === -1) return [];
    const options = edgeAtomsForStep(current, next, level, certified, policy);
    if (options.length === 0) return [];
    atoms.push(options[0]);
    current = next;
  }
  return atoms;
}

export function stripGeneratedFacts(data: GraphData): void {
  for (let i = 0; i < data.adjacencyMatrix.matrix.length; i += 1) {
    for (let j = 0; j < data.adjacencyMatrix.matrix[i].length; j += 1) {
      const relation = data.adjacencyMatrix.matrix[i][j];
      if (!relation) continue;
      if (relation.status === 'no-poly-quasi' && (relation.noPolyDescription || relation.quasiDescription)) {
        const noPolyDerived = relation.noPolyDescription?.derived === true || relation.noPolyDescription?.origin === 'derived';
        const quasiDerived = relation.quasiDescription?.derived === true || relation.quasiDescription?.origin === 'derived';
        if (noPolyDerived && quasiDerived) {
          data.adjacencyMatrix.matrix[i][j] = null;
        } else if (noPolyDerived && relation.quasiDescription) {
          data.adjacencyMatrix.matrix[i][j] = {
            status: 'unknown-poly-quasi',
            refs: relation.quasiDescription.refs,
            description: relation.quasiDescription.description,
            assumption: relation.assumption,
            hidden: false,
            derived: false
          };
        } else if (quasiDerived && relation.noPolyDescription) {
          data.adjacencyMatrix.matrix[i][j] = {
            status: 'no-poly-unknown-quasi',
            refs: relation.noPolyDescription.refs,
            description: relation.noPolyDescription.description,
            assumption: relation.assumption,
            hidden: false,
            derived: false
          };
        }
      } else if (relation.derived === true || relation.origin === 'derived' || relation.origin === 'batch') {
        data.adjacencyMatrix.matrix[i][j] = null;
      }
    }
  }

  for (const language of data.languages) {
    for (const map of [language.properties?.queries, language.properties?.transformations]) {
      if (!map) continue;
      for (const [op, support] of Object.entries(map)) {
        if (support?.derived === true || support?.origin === 'derived' || support?.origin === 'batch' || support?.batchId) {
          map[op] = { complexity: 'unknown-to-us', refs: [] };
        }
      }
    }
  }
}

export function serializeCertifiedFacts(
  data: GraphData,
  context: FactContext,
  tables: FactTables,
  certified: CertifiedMap
): GraphData {
  const n = context.languageIds.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const existing = data.adjacencyMatrix.matrix[i][j];
      data.adjacencyMatrix.matrix[i][j] = null;
      if (i === j) continue;
      const leP = certified.get(atomKey(edgeAtom('leP', i, j)));
      const leQ = certified.get(atomKey(edgeAtom('leQ', i, j)));
      const notLeP = certified.get(atomKey(edgeAtom('notLeP', i, j)));
      const notLeQ = certified.get(atomKey(edgeAtom('notLeQ', i, j)));
      if (leP && notLeP) throw new Error(`Contradiction while serializing ${context.languageIds[i]} -> ${context.languageIds[j]}`);
      if ((leQ || leP) && notLeQ) throw new Error(`Contradiction while serializing ${context.languageIds[i]} -> ${context.languageIds[j]}`);

      const nextStatus = leP
        ? 'poly'
        : notLeQ
          ? 'no-quasi'
          : notLeP && leQ
            ? 'no-poly-quasi'
            : notLeP
              ? 'no-poly-unknown-quasi'
              : leQ
                ? 'unknown-poly-quasi'
                : existing && existing.derived !== true && existing.status === 'unknown-both'
                  ? 'unknown-both'
                  : null;

      if (
        existing &&
        existing.derived !== true &&
        existing.origin !== 'derived' &&
        existing.origin !== 'batch' &&
        existing.status === nextStatus &&
        existing.noPolyDescription?.derived !== true &&
        existing.noPolyDescription?.origin !== 'derived' &&
        existing.quasiDescription?.derived !== true
        && existing.quasiDescription?.origin !== 'derived'
      ) {
        data.adjacencyMatrix.matrix[i][j] = existing;
      } else if (leP) {
        data.adjacencyMatrix.matrix[i][j] = relationFromFact('poly', leP);
      } else if (notLeQ) {
        data.adjacencyMatrix.matrix[i][j] = relationFromFact('no-quasi', notLeQ);
      } else if (notLeP && leQ) {
        data.adjacencyMatrix.matrix[i][j] = {
          status: 'no-poly-quasi',
          refs: mergeRefs(notLeP.refs, leQ.refs),
          assumption: mergeAssumptions(notLeP.assumption, leQ.assumption),
          hidden: false,
          derived: notLeP.origin === 'derived' && leQ.origin === 'derived',
          origin: notLeP.origin === 'derived' && leQ.origin === 'derived' ? 'derived' : 'authored',
          noPolyDescription: descriptionComponent(notLeP),
          quasiDescription: descriptionComponent(leQ),
          description: [
            'First, we show no polynomial compilation exists.',
            notLeP.description,
            '',
            'Now, we show a quasipolynomial compilation exists.',
            leQ.description
          ].filter((part) => part !== undefined).join('\n')
        };
      } else if (notLeP) {
        data.adjacencyMatrix.matrix[i][j] = relationFromFact('no-poly-unknown-quasi', notLeP);
      } else if (leQ) {
        data.adjacencyMatrix.matrix[i][j] = relationFromFact('unknown-poly-quasi', leQ);
      } else if (nextStatus === 'unknown-both' && existing) {
        data.adjacencyMatrix.matrix[i][j] = existing;
      }
    }
  }

  for (const language of data.languages) {
    if (!language.properties) language.properties = {};
    if (!language.properties.queries) language.properties.queries = {};
    if (!language.properties.transformations) language.properties.transformations = {};
  }

  for (let language = 0; language < n; language += 1) {
    for (const op of context.operations.allCodes) {
      const mapName = context.operations.typeByCode.get(op);
      if (!mapName) continue;
      const map = data.languages[language].properties[mapName]!;
      const supports = certified.get(atomKey(opAtom('supportsP', language, op)));
      const notSupports = certified.get(atomKey(opAtom('notSupportsP', language, op)));
      if (supports && notSupports) throw new Error(`Contradiction while serializing ${context.languageIds[language]}.${op}`);
      const fact = supports ?? notSupports;
      if (!fact) {
        if (map[op]?.derived || map[op]?.origin === 'derived' || map[op]?.origin === 'batch' || map[op]?.batchId) {
          map[op] = { complexity: 'unknown-to-us', refs: [] };
        }
        continue;
      }
      if (
        !map[op]?.derived &&
        map[op]?.origin !== 'derived' &&
        map[op]?.origin !== 'batch' &&
        !map[op]?.batchId &&
        map[op]?.complexity === (supports ? 'poly' : 'no-poly-unknown-quasi')
      ) {
        continue;
      }
      map[op] = {
        complexity: supports ? 'poly' : 'no-poly-unknown-quasi',
        refs: fact.refs,
        ...(fact.description && { description: fact.description }),
        ...(fact.assumption && { assumption: fact.assumption }),
        derived: fact.origin === 'derived',
        origin: fact.origin,
        ...(fact.proof && { proof: fact.proof }),
        ...(fact.batchId && { batchId: fact.batchId })
      };
    }
  }

  return data;
}

export function serializeCandidateFacts(
  data: GraphData,
  context: FactContext,
  tables: FactTables
): GraphData {
  const n = context.languageIds.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const existing = data.adjacencyMatrix.matrix[i][j];
      data.adjacencyMatrix.matrix[i][j] = null;
      if (i === j) continue;

      const leP = hasFact(tables, edgeAtom('leP', i, j));
      const leQ = hasFact(tables, edgeAtom('leQ', i, j));
      const notLeP = hasFact(tables, edgeAtom('notLeP', i, j));
      const notLeQ = hasFact(tables, edgeAtom('notLeQ', i, j));
      if (leP && notLeP) throw new Error(`Contradiction while serializing ${context.languageIds[i]} -> ${context.languageIds[j]}`);
      if ((leQ || leP) && notLeQ) throw new Error(`Contradiction while serializing ${context.languageIds[i]} -> ${context.languageIds[j]}`);

      const status = leP
        ? 'poly'
        : notLeQ
          ? 'no-quasi'
          : notLeP && leQ
            ? 'no-poly-quasi'
            : notLeP
              ? 'no-poly-unknown-quasi'
              : leQ
                ? 'unknown-poly-quasi'
                : existing && existing.derived !== true && existing.status === 'unknown-both'
                  ? 'unknown-both'
                  : null;
      if (!status) continue;

      if (
        existing &&
        existing.derived !== true &&
        existing.origin !== 'derived' &&
        existing.origin !== 'batch' &&
        existing.status === status
      ) {
        data.adjacencyMatrix.matrix[i][j] = existing;
        continue;
      }

      if (status === 'unknown-both' && existing) {
        data.adjacencyMatrix.matrix[i][j] = existing;
        continue;
      }

      const lePOrigin = leP ? getOrigin(tables, edgeAtom('leP', i, j)) : undefined;
      const leQOrigin = leQ ? getOrigin(tables, edgeAtom('leQ', i, j)) : undefined;
      const notLePOrigin = notLeP ? getOrigin(tables, edgeAtom('notLeP', i, j)) : undefined;
      const notLeQOrigin = notLeQ ? getOrigin(tables, edgeAtom('notLeQ', i, j)) : undefined;
      const lePMetadata = leP ? reusableMetadata(context, edgeAtom('leP', i, j)) : undefined;
      const leQMetadata = leQ ? reusableMetadata(context, edgeAtom('leQ', i, j)) : undefined;
      const notLePMetadata = notLeP ? reusableMetadata(context, edgeAtom('notLeP', i, j)) : undefined;
      const notLeQMetadata = notLeQ ? reusableMetadata(context, edgeAtom('notLeQ', i, j)) : undefined;
      data.adjacencyMatrix.matrix[i][j] = candidateRelation(status, {
        origins: status === 'poly'
          ? [lePOrigin]
          : status === 'no-quasi'
            ? [notLeQOrigin]
            : status === 'no-poly-quasi'
              ? [notLePOrigin, leQOrigin]
              : status === 'no-poly-unknown-quasi'
                ? [notLePOrigin]
                : status === 'unknown-poly-quasi'
                  ? [leQOrigin]
                  : [],
        noPolyOrigin: notLePOrigin,
        quasiOrigin: leQOrigin,
        metadata: status === 'poly'
          ? lePMetadata
          : status === 'no-quasi'
            ? notLeQMetadata
            : status === 'no-poly-unknown-quasi'
              ? notLePMetadata
              : status === 'unknown-poly-quasi'
                ? leQMetadata
                : undefined,
        noPolyMetadata: notLePMetadata,
        quasiMetadata: leQMetadata
      });
    }
  }

  for (const language of data.languages) {
    if (!language.properties) language.properties = {};
    if (!language.properties.queries) language.properties.queries = {};
    if (!language.properties.transformations) language.properties.transformations = {};
  }

  for (let language = 0; language < n; language += 1) {
    for (const op of context.operations.allCodes) {
      const mapName = context.operations.typeByCode.get(op);
      if (!mapName) continue;
      const map = data.languages[language].properties[mapName]!;
      const supports = opAtom('supportsP', language, op);
      const notSupports = opAtom('notSupportsP', language, op);
      const hasSupport = hasFact(tables, supports);
      const hasNoSupport = hasFact(tables, notSupports);
      if (hasSupport && hasNoSupport) throw new Error(`Contradiction while serializing ${context.languageIds[language]}.${op}`);
      const complexity = hasSupport ? 'poly' : hasNoSupport ? 'no-poly-unknown-quasi' : null;
      if (!complexity) {
        if (map[op]?.derived || map[op]?.origin === 'derived' || map[op]?.origin === 'batch' || map[op]?.batchId) {
          map[op] = { complexity: 'unknown-to-us', refs: [] };
        }
        continue;
      }
      if (
        !map[op]?.derived &&
        map[op]?.origin !== 'derived' &&
        map[op]?.origin !== 'batch' &&
        !map[op]?.batchId &&
        map[op]?.complexity === complexity
      ) {
        continue;
      }
      const atom = hasSupport ? supports : notSupports;
      const origin = getOrigin(tables, atom);
      const batchIndex = context.batchSources.get(atomKey(atom));
      const batch = batchIndex === undefined ? undefined : context.batches[batchIndex];
      const metadata = reusableMetadata(context, atom);
      map[op] = {
        complexity,
        refs: metadata?.refs ?? [],
        ...(metadata?.description && { description: metadata.description }),
        ...(metadata?.assumption && { assumption: metadata.assumption }),
        derived: origin === 'derived',
        origin,
        ...(metadata?.proof && { proof: metadata.proof }),
        ...(metadata?.batchId || batch?.id ? { batchId: metadata?.batchId ?? batch?.id } : {})
      };
    }
  }

  return data;
}

function candidateRelation(
  status: string,
  metadata: {
    origins: Array<FactOrigin | undefined>;
    noPolyOrigin?: FactOrigin;
    quasiOrigin?: FactOrigin;
    metadata?: FactMetadata;
    noPolyMetadata?: FactMetadata;
    quasiMetadata?: FactMetadata;
  }
): DirectedSuccinctnessRelation {
  const origin = combineOrigins(metadata.origins.filter((item): item is FactOrigin => item !== undefined));
  const relationMetadata = status === 'no-poly-quasi'
    ? combinedSplitRelationMetadata(metadata.noPolyMetadata, metadata.quasiMetadata)
    : metadata.metadata;
  const relationProofMetadata = status === 'no-poly-quasi' ? undefined : metadata.metadata;
  return {
    status,
    refs: relationMetadata?.refs ?? [],
    ...(relationMetadata?.description && { description: relationMetadata.description }),
    ...(relationMetadata?.assumption && { assumption: relationMetadata.assumption }),
    hidden: false,
    derived: origin === 'derived',
    origin,
    ...(relationProofMetadata?.proof && { proof: relationProofMetadata.proof }),
    ...(status === 'no-poly-quasi'
      ? {
          noPolyDescription: componentFromMetadata(metadata.noPolyMetadata, metadata.noPolyOrigin ?? origin),
          quasiDescription: componentFromMetadata(metadata.quasiMetadata, metadata.quasiOrigin ?? origin)
        }
      : {})
  };
}

function combinedSplitRelationMetadata(
  noPolyMetadata: FactMetadata | undefined,
  quasiMetadata: FactMetadata | undefined
): Pick<FactMetadata, 'refs' | 'assumption' | 'description'> | undefined {
  if (!noPolyMetadata && !quasiMetadata) return undefined;
  const description = [
    'First, we show no polynomial compilation exists.',
    noPolyMetadata?.description,
    '',
    'Now, we show a quasipolynomial compilation exists.',
    quasiMetadata?.description
  ].filter((part) => part !== undefined).join('\n');
  return {
    refs: mergeRefs(noPolyMetadata?.refs, quasiMetadata?.refs),
    assumption: mergeAssumptions(noPolyMetadata?.assumption, quasiMetadata?.assumption),
    ...(description.trim() && { description })
  };
}

function componentFromMetadata(metadata: FactMetadata | undefined, origin: FactOrigin) {
  return {
    description: metadata?.description ?? '',
    refs: metadata?.refs ?? [],
    derived: origin === 'derived',
    origin,
    ...(metadata?.proof && { proof: metadata.proof })
  };
}

function combineOrigins(origins: FactOrigin[]): FactOrigin {
  if (origins.includes('authored')) return 'authored';
  if (origins.includes('batch')) return 'batch';
  return 'derived';
}

function relationFromFact(status: string, fact: CertifiedFact) {
  return {
    status,
    refs: fact.refs,
    ...(fact.description && { description: fact.description }),
    ...(fact.assumption && { assumption: fact.assumption }),
    hidden: false,
    derived: fact.origin === 'derived',
    origin: fact.origin,
    ...(fact.proof && { proof: fact.proof })
  };
}

function descriptionComponent(fact: CertifiedFact) {
  return {
    description: fact.description ?? '',
    refs: fact.refs,
    derived: fact.origin === 'derived',
    origin: fact.origin,
    ...(fact.proof && { proof: fact.proof })
  };
}
