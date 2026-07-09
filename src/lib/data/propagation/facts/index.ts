import type {
  DirectedSuccinctnessRelation,
  GraphData,
  KCBatchClaim,
  KCBatchSelector,
  KCOpSupport,
  PropagationProof
} from '../../../types.js';
import { getAllQueryCodes, getAllTransformationCodes, QUERIES } from '../../operations.js';

export type EdgeKind = 'leP' | 'leQ' | 'notLeP' | 'notLeQ';
export type OpKind = 'supportsP' | 'notSupportsP';
export type AtomKind = EdgeKind | OpKind | 'batchApplies';
export type FactOrigin = 'authored' | 'batch' | 'derived';
export type ProofPhase = 'clean' | 'dirty';
export type OperationType = 'queries' | 'transformations';

export type Atom =
  | { kind: EdgeKind; source: number; target: number }
  | { kind: OpKind; language: number; op: string }
  | { kind: 'batchApplies'; batch: number; language: number };

export interface FactMetadata {
  origin: FactOrigin;
  refs: string[];
  description?: string;
  assumption?: string;
  batchId?: string;
  proof?: PropagationProof;
}

export interface CertifiedFact extends FactMetadata {
  atom: Atom;
  phase: ProofPhase;
}

export interface OperationCatalog {
  queryCodes: string[];
  transformationCodes: string[];
  allCodes: string[];
  typeByCode: Map<string, OperationType>;
}

export interface FactContext {
  data: GraphData;
  languageIds: string[];
  languageIndex: Map<string, number>;
  batches: KCBatchClaim[];
  operations: OperationCatalog;
  authored: FactMetadataStore;
  oldProofs: FactMetadataStore;
  batchSources: Map<string, number>;
}

export interface FactTables {
  leP: boolean[][];
  leQ: boolean[][];
  notLeP: boolean[][];
  notLeQ: boolean[][];
  supportsP: Map<string, boolean[]>;
  notSupportsP: Map<string, boolean[]>;
  batchApplies: boolean[][];
  origins: Map<string, FactOrigin>;
}

export type FactMetadataStore = Map<string, FactMetadata>;

export function atomKey(atom: Atom): string {
  switch (atom.kind) {
    case 'leP':
    case 'leQ':
    case 'notLeP':
    case 'notLeQ':
      return `${atom.kind}:${atom.source}:${atom.target}`;
    case 'supportsP':
    case 'notSupportsP':
      return `${atom.kind}:${atom.language}:${atom.op}`;
    case 'batchApplies':
      return `${atom.kind}:${atom.batch}:${atom.language}`;
  }
}

export function edgeAtom(kind: EdgeKind, source: number, target: number): Atom {
  return { kind, source, target };
}

export function opAtom(kind: OpKind, language: number, op: string): Atom {
  return { kind, language, op };
}

export function batchAtom(batch: number, language: number): Atom {
  return { kind: 'batchApplies', batch, language };
}

export function createMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

export function createTables(languageCount: number, batchCount: number): FactTables {
  return {
    leP: createMatrix(languageCount),
    leQ: createMatrix(languageCount),
    notLeP: createMatrix(languageCount),
    notLeQ: createMatrix(languageCount),
    supportsP: new Map(),
    notSupportsP: new Map(),
    batchApplies: Array.from({ length: batchCount }, () => Array<boolean>(languageCount).fill(false)),
    origins: new Map()
  };
}

function opRow(map: Map<string, boolean[]>, op: string, languageCount: number): boolean[] {
  let row = map.get(op);
  if (!row) {
    row = Array<boolean>(languageCount).fill(false);
    map.set(op, row);
  }
  return row;
}

export function hasFact(tables: FactTables, atom: Atom): boolean {
  switch (atom.kind) {
    case 'leP':
      return tables.leP[atom.source]?.[atom.target] === true;
    case 'leQ':
      return tables.leQ[atom.source]?.[atom.target] === true;
    case 'notLeP':
      return tables.notLeP[atom.source]?.[atom.target] === true;
    case 'notLeQ':
      return tables.notLeQ[atom.source]?.[atom.target] === true;
    case 'supportsP':
      return tables.supportsP.get(atom.op)?.[atom.language] === true;
    case 'notSupportsP':
      return tables.notSupportsP.get(atom.op)?.[atom.language] === true;
    case 'batchApplies':
      return tables.batchApplies[atom.batch]?.[atom.language] === true;
  }
}

function setOrigin(tables: FactTables, key: string, origin: FactOrigin): void {
  const current = tables.origins.get(key);
  if (!current || originRank(origin) < originRank(current)) {
    tables.origins.set(key, origin);
  }
}

export function originRank(origin: FactOrigin): number {
  return origin === 'authored' ? 0 : origin === 'batch' ? 1 : 2;
}

export function addFact(tables: FactTables, atom: Atom, origin: FactOrigin, languageCount: number): boolean {
  const key = atomKey(atom);
  let changed = false;
  switch (atom.kind) {
    case 'leP':
      if (!tables.leP[atom.source][atom.target]) {
        tables.leP[atom.source][atom.target] = true;
        changed = true;
      }
      break;
    case 'leQ':
      if (!tables.leQ[atom.source][atom.target]) {
        tables.leQ[atom.source][atom.target] = true;
        changed = true;
      }
      break;
    case 'notLeP':
      if (!tables.notLeP[atom.source][atom.target]) {
        tables.notLeP[atom.source][atom.target] = true;
        changed = true;
      }
      break;
    case 'notLeQ':
      if (!tables.notLeQ[atom.source][atom.target]) {
        tables.notLeQ[atom.source][atom.target] = true;
        changed = true;
      }
      break;
    case 'supportsP': {
      const row = opRow(tables.supportsP, atom.op, languageCount);
      if (!row[atom.language]) {
        row[atom.language] = true;
        changed = true;
      }
      break;
    }
    case 'notSupportsP': {
      const row = opRow(tables.notSupportsP, atom.op, languageCount);
      if (!row[atom.language]) {
        row[atom.language] = true;
        changed = true;
      }
      break;
    }
    case 'batchApplies':
      if (!tables.batchApplies[atom.batch][atom.language]) {
        tables.batchApplies[atom.batch][atom.language] = true;
        changed = true;
      }
      break;
  }
  setOrigin(tables, key, origin);
  return changed;
}

export function getOrigin(tables: FactTables, atom: Atom): FactOrigin {
  return tables.origins.get(atomKey(atom)) ?? 'derived';
}

export function allAtoms(tables: FactTables, context: FactContext): Atom[] {
  const atoms: Atom[] = [];
  const n = context.languageIds.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      if (tables.leP[i][j]) atoms.push(edgeAtom('leP', i, j));
      if (tables.leQ[i][j]) atoms.push(edgeAtom('leQ', i, j));
      if (tables.notLeP[i][j]) atoms.push(edgeAtom('notLeP', i, j));
      if (tables.notLeQ[i][j]) atoms.push(edgeAtom('notLeQ', i, j));
    }
  }
  for (const op of context.operations.allCodes) {
    const supportRow = tables.supportsP.get(op);
    const noSupportRow = tables.notSupportsP.get(op);
    for (let language = 0; language < n; language += 1) {
      if (supportRow?.[language]) atoms.push(opAtom('supportsP', language, op));
      if (noSupportRow?.[language]) atoms.push(opAtom('notSupportsP', language, op));
    }
  }
  for (let batch = 0; batch < context.batches.length; batch += 1) {
    for (let language = 0; language < n; language += 1) {
      if (tables.batchApplies[batch]?.[language]) atoms.push(batchAtom(batch, language));
    }
  }
  return atoms.sort((a, b) => atomKey(a).localeCompare(atomKey(b)));
}

export function buildOperationCatalog(): OperationCatalog {
  const queryCodes = getAllQueryCodes().sort();
  const transformationCodes = getAllTransformationCodes().sort();
  const typeByCode = new Map<string, OperationType>();
  for (const op of queryCodes) typeByCode.set(op, 'queries');
  for (const op of transformationCodes) typeByCode.set(op, 'transformations');
  return {
    queryCodes,
    transformationCodes,
    allCodes: [...new Set([...queryCodes, ...transformationCodes])].sort(),
    typeByCode
  };
}

export function buildFactContext(data: GraphData, oldProofSource: GraphData = data): FactContext {
  const languageIds = [...data.adjacencyMatrix.languageIds];
  const languageIndex = new Map(languageIds.map((id, index) => [id, index]));
  return {
    data,
    languageIds,
    languageIndex,
    batches: data.batchClaims ?? [],
    operations: buildOperationCatalog(),
    authored: new Map(),
    oldProofs: collectExistingProofs(oldProofSource),
    batchSources: new Map()
  };
}

export function relationGuaranteesPoly(status: string | undefined | null): boolean {
  return status === 'poly';
}

export function relationGuaranteesQuasi(status: string | undefined | null): boolean {
  return status === 'poly' || status === 'unknown-poly-quasi' || status === 'no-poly-quasi';
}

export function relationAssertsNoPoly(status: string | undefined | null): boolean {
  return status === 'no-poly-unknown-quasi' || status === 'no-poly-quasi' || status === 'no-quasi';
}

export function relationAssertsNoQuasi(status: string | undefined | null): boolean {
  return status === 'no-quasi';
}

export function opGuaranteesPoly(status: string | undefined | null): boolean {
  return status === 'poly';
}

export function opAssertsNoPoly(status: string | undefined | null): boolean {
  return status === 'no-poly-unknown-quasi' || status === 'no-poly-quasi' || status === 'no-quasi';
}

function componentMetadata(
  origin: FactOrigin,
  refs: string[],
  description?: string,
  assumption?: string
): FactMetadata {
  return { origin, refs: [...refs], ...(description && { description }), ...(assumption && { assumption }) };
}

function addAuthoredMetadata(
  context: FactContext,
  atom: Atom,
  refs: string[],
  description?: string,
  assumption?: string
): void {
  context.authored.set(atomKey(atom), componentMetadata('authored', refs, description, assumption));
}

export function seedAuthoredFacts(context: FactContext): FactTables {
  const n = context.languageIds.length;
  const tables = createTables(n, context.batches.length);

  for (let source = 0; source < n; source += 1) {
    for (let target = 0; target < n; target += 1) {
      if (source === target) continue;
      const relation = context.data.adjacencyMatrix.matrix[source]?.[target];
      if (!relation) continue;
      seedAuthoredRelation(context, tables, relation, source, target, n);
    }
  }

  for (let language = 0; language < context.data.languages.length; language += 1) {
    const entry = context.data.languages[language];
    seedAuthoredOperationMap(context, tables, language, entry.properties?.queries ?? {}, n);
    seedAuthoredOperationMap(context, tables, language, entry.properties?.transformations ?? {}, n);
  }

  return tables;
}

function seedAuthoredRelation(
  context: FactContext,
  tables: FactTables,
  relation: DirectedSuccinctnessRelation,
  source: number,
  target: number,
  languageCount: number
): void {
  if (relation.derived === true || relation.origin === 'derived' || relation.origin === 'batch') return;

  const baseRefs = relation.refs ?? [];
  const baseDescription = relation.description;
  const baseAssumption = relation.assumption;
  const status = relation.status;

  const add = (kind: EdgeKind, refs = baseRefs, description = baseDescription, assumption = baseAssumption) => {
    const atom = edgeAtom(kind, source, target);
    addFact(tables, atom, 'authored', languageCount);
    addAuthoredMetadata(context, atom, refs, description, assumption);
  };

  if (status === 'poly') {
    add('leP');
  } else if (status === 'unknown-poly-quasi') {
    add('leQ');
  } else if (status === 'no-poly-unknown-quasi') {
    add('notLeP');
  } else if (status === 'no-quasi') {
    add('notLeQ');
  } else if (status === 'no-poly-quasi') {
    const noPolyDerived = relation.noPolyDescription?.derived === true || relation.noPolyDescription?.origin === 'derived';
    const quasiDerived = relation.quasiDescription?.derived === true || relation.quasiDescription?.origin === 'derived';
    if (!noPolyDerived) {
      add('notLeP', relation.noPolyDescription?.refs ?? baseRefs, relation.noPolyDescription?.description, baseAssumption);
    }
    if (!quasiDerived) {
      add('leQ', relation.quasiDescription?.refs ?? baseRefs, relation.quasiDescription?.description, baseAssumption);
    }
  }
}

function seedAuthoredOperationMap(
  context: FactContext,
  tables: FactTables,
  language: number,
  supportMap: Record<string, KCOpSupport>,
  languageCount: number
): void {
  for (const [op, support] of Object.entries(supportMap)) {
    if (
      !support ||
      support.derived === true ||
      support.origin === 'derived' ||
      support.origin === 'batch' ||
      support.batchId ||
      support.complexity === 'unknown-to-us'
    ) continue;
    if (opGuaranteesPoly(support.complexity)) {
      const atom = opAtom('supportsP', language, op);
      addFact(tables, atom, 'authored', languageCount);
      addAuthoredMetadata(context, atom, support.refs ?? [], support.description, support.assumption);
    } else if (opAssertsNoPoly(support.complexity)) {
      const atom = opAtom('notSupportsP', language, op);
      addFact(tables, atom, 'authored', languageCount);
      addAuthoredMetadata(context, atom, support.refs ?? [], support.description, support.assumption);
    }
  }
}

export function collectExistingProofs(data: GraphData): FactMetadataStore {
  const proofs: FactMetadataStore = new Map();
  const languageIds = data.adjacencyMatrix.languageIds;

  const add = (
    atom: Atom,
    refs: string[],
    description: string | undefined,
    assumption: string | undefined,
    origin: FactOrigin | undefined,
    proof: PropagationProof | undefined,
    batchId?: string
  ) => {
    if (!proof) return;
    proofs.set(atomKey(atom), {
      origin: origin ?? 'derived',
      refs: refs ?? [],
      ...(description && { description }),
      ...(assumption && { assumption }),
      ...(batchId && { batchId }),
      proof
    });
  };

  for (let source = 0; source < languageIds.length; source += 1) {
    for (let target = 0; target < languageIds.length; target += 1) {
      if (source === target) continue;
      const relation = data.adjacencyMatrix.matrix[source]?.[target];
      if (!relation) continue;
      if (relation.status === 'poly') {
        add(edgeAtom('leP', source, target), relation.refs, relation.description, relation.assumption, relation.origin, relation.proof);
      } else if (relation.status === 'unknown-poly-quasi') {
        add(edgeAtom('leQ', source, target), relation.refs, relation.description, relation.assumption, relation.origin, relation.proof);
      } else if (relation.status === 'no-poly-unknown-quasi') {
        add(edgeAtom('notLeP', source, target), relation.refs, relation.description, relation.assumption, relation.origin, relation.proof);
      } else if (relation.status === 'no-quasi') {
        add(edgeAtom('notLeQ', source, target), relation.refs, relation.description, relation.assumption, relation.origin, relation.proof);
      } else if (relation.status === 'no-poly-quasi') {
        add(
          edgeAtom('notLeP', source, target),
          relation.noPolyDescription?.refs ?? relation.refs,
          relation.noPolyDescription?.description,
          relation.assumption,
          relation.noPolyDescription?.origin ?? relation.origin,
          relation.noPolyDescription?.proof
        );
        add(
          edgeAtom('leQ', source, target),
          relation.quasiDescription?.refs ?? relation.refs,
          relation.quasiDescription?.description,
          relation.assumption,
          relation.quasiDescription?.origin ?? relation.origin,
          relation.quasiDescription?.proof
        );
      }
    }
  }

  for (let language = 0; language < data.languages.length; language += 1) {
    for (const map of [data.languages[language].properties?.queries, data.languages[language].properties?.transformations]) {
      for (const [op, support] of Object.entries(map ?? {})) {
        if (!support) continue;
        if (opGuaranteesPoly(support.complexity)) {
          add(opAtom('supportsP', language, op), support.refs, support.description, support.assumption, support.origin, support.proof, support.batchId);
        } else if (opAssertsNoPoly(support.complexity)) {
          add(opAtom('notSupportsP', language, op), support.refs, support.description, support.assumption, support.origin, support.proof, support.batchId);
        }
      }
    }
  }

  return proofs;
}

export function resolveBatchLanguageRef(context: FactContext, currentLanguage: number, ref: { kind: 'current' } | { kind: 'language'; id: string }): number | undefined {
  if (ref.kind === 'current') return currentLanguage;
  return context.languageIndex.get(ref.id);
}

export function selectorForBatch(batch: KCBatchClaim): KCBatchSelector {
  return batch.selector ?? { kind: 'list', languageIds: batch.languageIds ?? [] };
}

export function operationTypeForCode(context: FactContext, op: string): OperationType | undefined {
  return context.operations.typeByCode.get(op);
}

export function isQueryCode(op: string): boolean {
  return op in QUERIES;
}
