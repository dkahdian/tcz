import type {
  DirectedSuccinctnessRelation,
  GraphData,
  KCLanguage,
  KCReference,
  KCOpSupport
} from '../types.js';
import { cloneDataset } from './transforms.js';
import { validateDatasetStructure } from './validation/index.js';
import { propagateImplicitRelations } from './propagation/index.js';
import { QUERIES, TRANSFORMATIONS } from './operations.js';
import { generateLanguageId } from '../utils/language-id.js';
import { generateReferenceId } from '../utils/reference-id.js';
import { parseBibtex } from './references.js';

const SANDBOX_DESCRIPTION = 'Your claim under test';

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
      classification: KCLanguage['classification'];
      fullName: string;
      definition: string;
      definitionRefs?: string[];
    }
  | {
      kind: 'language:edit';
      languageId: string;
      fullName?: string;
      definition?: string;
      definitionRefs?: string[];
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
    assumption: relation.assumption ?? null,
    description: relation.description ?? null,
    refs: relation.refs ?? [],
    derived: relation.derived ?? false,
    noPolyDescription: relation.noPolyDescription ?? null,
    quasiDescription: relation.quasiDescription ?? null
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
    assumption: support.assumption ?? null,
    description: support.description ?? null,
    refs: support.refs ?? [],
    derived: support.derived ?? false
  });
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

function getReferenceLookup(data: GraphData): Map<string, KCReference> {
  return new Map((data.references ?? []).map((reference) => [reference.id, reference]));
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

  const referenceLookup = getReferenceLookup(data);
  const definitionRefs = [...(edit.definitionRefs ?? [])];
  const references = definitionRefs
    .map((refId) => referenceLookup.get(refId))
    .filter((reference): reference is KCReference => Boolean(reference));

  const language: KCLanguage = {
    id,
    name,
    classification: edit.classification ?? 'plain',
    fullName,
    definition,
    definitionRefs,
    properties: {
      queries: {},
      transformations: {}
    },
    references
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
  if (edit.definitionRefs !== undefined) {
    language.definitionRefs = [...edit.definitionRefs];
    const referenceLookup = getReferenceLookup(data);
    language.references = language.definitionRefs
      .map((refId) => referenceLookup.get(refId))
      .filter((reference): reference is KCReference => Boolean(reference));
  }
}

function applyEdgeEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'edge' }>): void {
  const sourceIdx = data.adjacencyMatrix.indexByLanguage[edit.sourceId];
  const targetIdx = data.adjacencyMatrix.indexByLanguage[edit.targetId];
  if (sourceIdx === undefined || targetIdx === undefined || sourceIdx === targetIdx) return;

  if (!edit.status || edit.status === 'unknown-to-us') {
    data.adjacencyMatrix.matrix[sourceIdx][targetIdx] = null;
    return;
  }

  const noPolyText = edit.noPolyDescription?.trim();
  const quasiText = edit.quasiDescription?.trim();
  const descriptionText = edit.description?.trim();
  const relation: DirectedSuccinctnessRelation = {
    status: edit.status,
    refs: [...(edit.refs ?? [])],
    description:
      edit.status === 'no-poly-quasi' && (noPolyText || quasiText)
        ? [noPolyText, quasiText].filter(Boolean).join(' ')
        : descriptionText || SANDBOX_DESCRIPTION,
    derived: false
  };
  if (edit.status === 'no-poly-quasi' && noPolyText) {
    relation.noPolyDescription = {
      description: noPolyText,
      refs: [...(edit.refs ?? [])],
      derived: false
    };
  }
  if (edit.status === 'no-poly-quasi' && quasiText) {
    relation.quasiDescription = {
      description: quasiText,
      refs: [...(edit.refs ?? [])],
      derived: false
    };
  }
  if (edit.assumption?.trim()) {
    relation.assumption = edit.assumption.trim();
  }

  data.adjacencyMatrix.matrix[sourceIdx][targetIdx] = relation;
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

  if (!edit.complexity || edit.complexity === 'unknown-to-us') {
    delete supportMap[edit.operationCode];
    if (displayCode) delete supportMap[displayCode];
    return;
  }

  if (displayCode && displayCode !== edit.operationCode) {
    delete supportMap[displayCode];
  }

  supportMap[edit.operationCode] = {
    complexity: edit.complexity,
    refs: [...(edit.refs ?? [])],
    description: edit.description?.trim() || SANDBOX_DESCRIPTION,
    derived: false,
    ...(edit.assumption?.trim() ? { assumption: edit.assumption.trim() } : {})
  };
}

export function applySandboxEdits(base: GraphData, edits: SandboxEdit[]): SandboxEvaluationResult {
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

    const validation = validateDatasetStructure(merged);
    if (!validation.ok) {
      const detail = validation.errors?.join('; ') ?? 'unknown structural error';
      throw new Error(`Sandbox edits produced an invalid dataset: ${detail}`);
    }

    const graphData = propagateImplicitRelations(merged);
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
