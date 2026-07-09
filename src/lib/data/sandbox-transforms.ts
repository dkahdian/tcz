import type {
  DirectedSuccinctnessRelation,
  GraphData,
  KCLanguage,
  KCOpSupport,
  NodePosition
} from '../types.js';
import { cloneDataset } from './transforms.js';
import { validateDatasetStructure } from './validation/index.js';
import { propagateImplicitRelations, type PropagationOptions } from './propagation/index.js';
import { QUERIES, TRANSFORMATIONS } from './operations.js';
import { generateLanguageId } from '../utils/language-id.js';
import { generateReferenceId } from '../utils/reference-id.js';
import { parseBibtex } from './references.js';
import { collectAssumptions } from './assumptions.js';

export type SandboxOperationType = 'query' | 'transformation';

export type SandboxEdit =
  | {
      kind: 'reference';
      bibtex: string;
    }
  | {
      kind: 'language:new';
      id?: string;
      name: string;
      fullName: string;
      definition: string;
    }
  | {
      kind: 'language:edit';
      languageId: string;
      fullName?: string;
      definition?: string;
    }
  | {
      kind: 'edge';
      sourceId: string;
      targetId: string;
      status: string | null;
      assumption?: string;
      description?: string;
      noPolyDescription?: string;
      quasiDescription?: string;
      refs?: string[];
    }
  | {
      kind: 'operation';
      operationType: SandboxOperationType;
      languageId: string;
      operationCode: string;
      complexity: string | null;
      assumption?: string;
      description?: string;
      refs?: string[];
    }
  | {
      kind: 'graph-position';
      languageId: string;
      position: NodePosition;
    };

export interface SandboxState {
  edits: SandboxEdit[];
  updatedAt: string;
}

export interface SandboxContributionSubmissionPayload {
  submissionId: string;
  contributor: {
    name: string;
    email: string;
    github?: string;
    note?: string;
  };
  sandbox: {
    edits: SandboxEdit[];
  };
}

export type SandboxEvaluationResult =
  | {
      ok: true;
      graphData: GraphData;
      changedEdgeIds: Set<string>;
      changedOperationCellIds: Set<string>;
      directEdgeIds: Set<string>;
      directOperationCellIds: Set<string>;
    }
  | {
      ok: false;
      error: string;
      changedEdgeIds: Set<string>;
      changedOperationCellIds: Set<string>;
      directEdgeIds: Set<string>;
      directOperationCellIds: Set<string>;
    };

export interface SandboxEvaluationOptions {
  proofMode?: PropagationOptions['proofMode'];
  oldProofSource?: GraphData;
}

export function edgeEditId(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

export function operationEditId(
  operationType: SandboxOperationType,
  languageId: string,
  operationCode: string
): string {
  return `${operationType}:${languageId}:${operationCode}`;
}

export function languageEditId(edit: Extract<SandboxEdit, { kind: 'language:new' | 'language:edit' }>): string {
  return edit.kind === 'language:new'
    ? edit.id ?? generateLanguageId(edit.name)
    : edit.languageId;
}

function languageNameMap(data: GraphData): Map<string, string> {
  return new Map(data.languages.map((language) => [language.id, language.name]));
}

function formatSandboxError(message: string, data: GraphData): string {
  const names = languageNameMap(data);
  return message
    .replace(/^Contradiction:\s*/i, '')
    .replace(/\blang_[a-f0-9]+\b/g, (id) => names.get(id) ?? id);
}

function relationSignature(source: GraphData, sourceId: string, targetId: string): string {
  const { adjacencyMatrix } = source;
  const sourceIdx = adjacencyMatrix.indexByLanguage[sourceId];
  const targetIdx = adjacencyMatrix.indexByLanguage[targetId];
  if (sourceIdx === undefined || targetIdx === undefined) return 'missing-language';
  const relation = adjacencyMatrix.matrix[sourceIdx]?.[targetIdx] ?? null;
  if (!relation) return 'null';
  return JSON.stringify({
    status: relation.status ?? null,
    assumption: relation.assumption ?? null
  });
}

function getOperationSupport(
  data: GraphData,
  operationType: SandboxOperationType,
  languageId: string,
  operationCode: string
): KCOpSupport | null {
  const language = data.languages.find((item) => item.id === languageId);
  if (!language) return null;
  const operation = operationType === 'query' ? QUERIES[operationCode] : TRANSFORMATIONS[operationCode];
  const map = operationType === 'query'
    ? language.properties?.queries
    : language.properties?.transformations;
  return map?.[operationCode] ?? map?.[operation?.code ?? ''] ?? null;
}

function operationSignature(
  data: GraphData,
  operationType: SandboxOperationType,
  languageId: string,
  operationCode: string
): string {
  const support = getOperationSupport(data, operationType, languageId, operationCode);
  if (!support) return 'null';
  return JSON.stringify({
    complexity: support.complexity ?? null,
    assumption: support.assumption ?? null
  });
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

export function getChangedSuccinctnessCellIds(base: GraphData, next: GraphData): Set<string> {
  const ids = new Set([...base.adjacencyMatrix.languageIds, ...next.adjacencyMatrix.languageIds]);
  const changed = new Set<string>();
  for (const sourceId of ids) {
    for (const targetId of ids) {
      if (sourceId === targetId) continue;
      if (relationSignature(base, sourceId, targetId) !== relationSignature(next, sourceId, targetId)) {
        changed.add(edgeEditId(sourceId, targetId));
      }
    }
  }
  return changed;
}

export function getChangedOperationCellIds(base: GraphData, next: GraphData): Set<string> {
  const languageIds = new Set([
    ...base.languages.map((language) => language.id),
    ...next.languages.map((language) => language.id)
  ]);
  const queryCodes = new Set([
    ...Object.keys(QUERIES),
    ...base.languages.flatMap((language) => Object.keys(language.properties?.queries ?? {})),
    ...next.languages.flatMap((language) => Object.keys(language.properties?.queries ?? {}))
  ]);
  const transformationCodes = new Set([
    ...Object.keys(TRANSFORMATIONS),
    ...base.languages.flatMap((language) => Object.keys(language.properties?.transformations ?? {})),
    ...next.languages.flatMap((language) => Object.keys(language.properties?.transformations ?? {}))
  ]);

  const changed = new Set<string>();
  for (const languageId of languageIds) {
    for (const code of queryCodes) {
      if (operationSignature(base, 'query', languageId, code) !== operationSignature(next, 'query', languageId, code)) {
        changed.add(operationEditId('query', languageId, code));
      }
    }
    for (const code of transformationCodes) {
      if (
        operationSignature(base, 'transformation', languageId, code) !==
        operationSignature(next, 'transformation', languageId, code)
      ) {
        changed.add(operationEditId('transformation', languageId, code));
      }
    }
  }
  return changed;
}

export function getDirectSandboxEdgeIds(edits: SandboxEdit[]): Set<string> {
  return new Set(
    edits
      .filter((edit): edit is Extract<SandboxEdit, { kind: 'edge' }> => edit.kind === 'edge')
      .map((edit) => edgeEditId(edit.sourceId, edit.targetId))
  );
}

export function getDirectSandboxOperationCellIds(edits: SandboxEdit[]): Set<string> {
  return new Set(
    edits
      .filter((edit): edit is Extract<SandboxEdit, { kind: 'operation' }> => edit.kind === 'operation')
      .map((edit) => operationEditId(edit.operationType, edit.languageId, edit.operationCode))
  );
}

export function isGraphPositionEdit(edit: SandboxEdit): edit is Extract<SandboxEdit, { kind: 'graph-position' }> {
  return edit.kind === 'graph-position';
}

export function isSemanticSandboxEdit(edit: SandboxEdit): boolean {
  return !isGraphPositionEdit(edit);
}

function ensureLanguageInMatrix(data: GraphData, languageId: string): void {
  const { adjacencyMatrix } = data;
  if (languageId in adjacencyMatrix.indexByLanguage) {
    return;
  }

  const newIndex = adjacencyMatrix.languageIds.length;
  adjacencyMatrix.languageIds.push(languageId);
  adjacencyMatrix.indexByLanguage[languageId] = newIndex;
  for (const row of adjacencyMatrix.matrix) {
    row.push(null);
  }
  adjacencyMatrix.matrix.push(new Array(newIndex + 1).fill(null));
}

function applyReferenceEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'reference' }>): void {
  const bibtex = edit.bibtex.trim();
  if (!bibtex) return;

  const existingIds = new Set((data.references ?? []).map((reference) => reference.id));
  const parsed = parseBibtex(bibtex);
  const id = parsed.id && parsed.id !== 'unknown'
    ? parsed.id
    : generateReferenceId(bibtex, existingIds);

  if (existingIds.has(id)) return;

  data.references = [
    ...(data.references ?? []),
    {
      id,
      title: parsed.title,
      href: parsed.href,
      bibtex
    }
  ];
}

function applyNewLanguageEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'language:new' }>): void {
  const name = edit.name.trim();
  const fullName = edit.fullName.trim();
  const definition = edit.definition.trim();
  if (!name || !fullName || !definition) {
    throw new Error('New language requires name, full name, and definition.');
  }

  const id = edit.id ?? generateLanguageId(name);
  if (data.languages.some((language) => language.id === id || language.name === name)) {
    throw new Error(`Language "${name}" already exists.`);
  }

  const language: KCLanguage = {
    id,
    name,
    fullName,
    definition,
    properties: {
      queries: {},
      transformations: {}
    }
  };

  data.languages.push(language);
  ensureLanguageInMatrix(data, id);
}

function applyLanguageMetadataEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'language:edit' }>): void {
  const language = data.languages.find((item) => item.id === edit.languageId);
  if (!language) {
    throw new Error(`Cannot edit unknown language "${edit.languageId}".`);
  }

  if (edit.fullName !== undefined) language.fullName = edit.fullName;
  if (edit.definition !== undefined) language.definition = edit.definition;
}

function applyEdgeEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'edge' }>): void {
  const sourceIdx = data.adjacencyMatrix.indexByLanguage[edit.sourceId];
  const targetIdx = data.adjacencyMatrix.indexByLanguage[edit.targetId];
  if (sourceIdx === undefined || targetIdx === undefined || sourceIdx === targetIdx) return;

  const existing = data.adjacencyMatrix.matrix[sourceIdx][targetIdx] ?? null;
  const status = normalizeSandboxEdgeStatus(edit.status, existing);
  if (!status) {
    data.adjacencyMatrix.matrix[sourceIdx][targetIdx] = null;
    return;
  }

  const noPolyText = edgeNoPolyDescriptionForEdit(edit, existing, status);
  const quasiText = edgeQuasiDescriptionForEdit(edit, existing, status);
  const descriptionText = edgeDescriptionForEdit(edit, existing, status);
  const assumptionText = hasOwn(edit, 'assumption')
    ? cleanOptionalText(edit.assumption)
    : existing?.assumption;
  const relation: DirectedSuccinctnessRelation = {
    status,
    refs: [...(edit.refs ?? existing?.refs ?? [])],
    ...(descriptionText ? { description: descriptionText } : {}),
    derived: false
  };
  if (status === 'no-poly-quasi' && noPolyText) {
    relation.noPolyDescription = {
      description: noPolyText,
      refs: [...(edit.refs ?? existing?.noPolyDescription?.refs ?? existing?.refs ?? [])],
      derived: false
    };
  }
  if (status === 'no-poly-quasi' && quasiText) {
    relation.quasiDescription = {
      description: quasiText,
      refs: [...(edit.refs ?? existing?.quasiDescription?.refs ?? existing?.refs ?? [])],
      derived: false
    };
  }
  if (assumptionText) {
    relation.assumption = assumptionText;
  }

  data.adjacencyMatrix.matrix[sourceIdx][targetIdx] = relation;
}

function normalizeSandboxEdgeStatus(
  status: string | null | undefined,
  existing: DirectedSuccinctnessRelation | null
): string | null {
  if (!status || status === 'unknown-to-us' || status === 'unknown-both' || status === 'unknown') return null;
  if (status === 'not-poly' || status === 'no-poly-unknown-quasi') {
    if (existing?.status === 'unknown-poly-quasi' || existing?.status === 'no-poly-quasi') return 'no-poly-quasi';
    if (existing?.status === 'no-quasi') return 'no-quasi';
    return 'no-poly-unknown-quasi';
  }
  return status;
}

function edgeDescriptionForEdit(
  edit: Extract<SandboxEdit, { kind: 'edge' }>,
  existing: DirectedSuccinctnessRelation | null,
  status: string
): string | undefined {
  if (hasOwn(edit, 'description')) return cleanOptionalText(edit.description);
  if (existing?.status !== status) return undefined;
  return existing.description;
}

function edgeNoPolyDescriptionForEdit(
  edit: Extract<SandboxEdit, { kind: 'edge' }>,
  existing: DirectedSuccinctnessRelation | null,
  status: string
): string | undefined {
  if (status !== 'no-poly-quasi') return undefined;
  if (hasOwn(edit, 'noPolyDescription')) return cleanOptionalText(edit.noPolyDescription);
  if (existing?.status === 'no-poly-quasi') return existing.noPolyDescription?.description;
  if (existing?.status === 'no-poly-unknown-quasi') return existing.description;
  return undefined;
}

function edgeQuasiDescriptionForEdit(
  edit: Extract<SandboxEdit, { kind: 'edge' }>,
  existing: DirectedSuccinctnessRelation | null,
  status: string
): string | undefined {
  if (status !== 'no-poly-quasi') return undefined;
  if (hasOwn(edit, 'quasiDescription')) return cleanOptionalText(edit.quasiDescription);
  if (existing?.status === 'no-poly-quasi') return existing.quasiDescription?.description;
  if (existing?.status === 'unknown-poly-quasi') return existing.description;
  return undefined;
}

function applyOperationEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'operation' }>): void {
  const language = data.languages.find((item) => item.id === edit.languageId);
  if (!language) return;

  language.properties ??= {};
  const supportMap = edit.operationType === 'query'
    ? (language.properties.queries ??= {})
    : (language.properties.transformations ??= {});
  const operation = edit.operationType === 'query'
    ? QUERIES[edit.operationCode]
    : TRANSFORMATIONS[edit.operationCode];
  const displayCode = operation?.code;

  const complexity = normalizeSandboxOperationComplexity(edit.complexity);
  if (!complexity) {
    delete supportMap[edit.operationCode];
    if (displayCode) delete supportMap[displayCode];
    return;
  }

  if (displayCode && displayCode !== edit.operationCode) {
    delete supportMap[displayCode];
  }

  const existing = supportMap[edit.operationCode] ?? (displayCode ? supportMap[displayCode] : undefined);
  const refs = edit.refs !== undefined ? [...edit.refs] : [...(existing?.refs ?? [])];
  const description = hasOwn(edit, 'description')
    ? cleanOptionalText(edit.description)
    : existing?.complexity === complexity
      ? existing?.description
      : undefined;
  const assumption = hasOwn(edit, 'assumption')
    ? cleanOptionalText(edit.assumption)
    : existing?.assumption;

  supportMap[edit.operationCode] = {
    ...(description ? { description } : {}),
    complexity,
    refs,
    derived: false,
    ...(assumption ? { assumption } : {})
  };
}

function normalizeSandboxOperationComplexity(complexity: string | null | undefined): string | null {
  if (!complexity || complexity === 'unknown-to-us' || complexity === 'unknown-both' || complexity === 'unknown') return null;
  if (complexity === 'not-poly') return 'no-poly-unknown-quasi';
  return complexity;
}

function applyGraphPositionEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'graph-position' }>): void {
  const language = data.languages.find((item) => item.id === edit.languageId);
  if (!language) {
    throw new Error(`Cannot position unknown language "${edit.languageId}".`);
  }
  const { x, y } = edit.position;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Invalid graph position for "${language.name}".`);
  }

  data.defaultNodePositionsByLanguageName ??= {};
  data.defaultNodePositionsByLanguageName[language.name] = { x, y };
}

export function applySandboxGraphPositionEdits(
  base: GraphData,
  edits: Array<Extract<SandboxEdit, { kind: 'graph-position' }>>
): GraphData {
  if (edits.length === 0) return base;
  const merged = cloneDataset(base);
  for (const edit of edits) {
    applyGraphPositionEdit(merged, edit);
  }
  return merged;
}

export function applySandboxEdits(
  base: GraphData,
  edits: SandboxEdit[],
  options: SandboxEvaluationOptions = {}
): SandboxEvaluationResult {
  const directEdgeIds = getDirectSandboxEdgeIds(edits);
  const directOperationCellIds = getDirectSandboxOperationCellIds(edits);

  try {
    const merged = cloneDataset(base);

    for (const edit of edits) {
      if (edit.kind === 'reference') applyReferenceEdit(merged, edit);
    }
    for (const edit of edits) {
      if (edit.kind === 'language:new') applyNewLanguageEdit(merged, edit);
    }
    for (const edit of edits) {
      if (edit.kind === 'language:edit') applyLanguageMetadataEdit(merged, edit);
    }
    for (const edit of edits) {
      if (edit.kind === 'edge') applyEdgeEdit(merged, edit);
      if (edit.kind === 'operation') applyOperationEdit(merged, edit);
    }
    for (const edit of edits) {
      if (edit.kind === 'graph-position') applyGraphPositionEdit(merged, edit);
    }
    merged.assumptions = collectAssumptions(merged, { includeCanonical: false });

    const validation = validateDatasetStructure(merged);
    if (!validation.ok) {
      const detail = validation.errors?.join('; ') ?? 'unknown structural error';
      throw new Error(`Sandbox edits produced an invalid dataset: ${detail}`);
    }

    const graphData = propagateImplicitRelations(merged, {
      proofMode: options.proofMode ?? 'lazy',
      oldProofSource: options.oldProofSource
    });
    graphData.assumptions = collectAssumptions(graphData, { includeCanonical: false });
    if ((options.proofMode ?? 'lazy') !== 'lazy') {
      const propagatedValidation = validateDatasetStructure(graphData);
      if (!propagatedValidation.ok) {
        const detail = propagatedValidation.errors?.join('; ') ?? 'unknown propagated structural error';
        throw new Error(`Sandbox edits produced an invalid propagated dataset: ${detail}`);
      }
    }

    return {
      ok: true,
      graphData,
      changedEdgeIds: getChangedSuccinctnessCellIds(base, graphData),
      changedOperationCellIds: getChangedOperationCellIds(base, graphData),
      directEdgeIds,
      directOperationCellIds
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: formatSandboxError(message, base),
      changedEdgeIds: new Set(),
      changedOperationCellIds: new Set(),
      directEdgeIds,
      directOperationCellIds
    };
  }
}
