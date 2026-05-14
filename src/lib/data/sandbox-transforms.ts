import type {
  DirectedSuccinctnessRelation,
  GraphData,
  KCOpSupport
} from '../types.js';
import { cloneDataset } from './transforms.js';
import { validateDatasetStructure } from './validation/index.js';
import { propagateImplicitRelations } from './propagation/index.js';
import { QUERIES, TRANSFORMATIONS } from './operations.js';

const SANDBOX_DESCRIPTION = 'Your claim under test';

export type SandboxOperationType = 'query' | 'transformation';

export type SandboxEdit =
  | {
      kind: 'edge';
      sourceId: string;
      targetId: string;
      status: string | null;
      assumption?: string;
      description?: string;
    }
  | {
      kind: 'operation';
      operationType: SandboxOperationType;
      languageId: string;
      operationCode: string;
      complexity: string | null;
      assumption?: string;
      description?: string;
    };

export interface SandboxState {
  edits: SandboxEdit[];
  updatedAt: string;
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
    separatingFunctionIds: relation.separatingFunctionIds ?? [],
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

function applyEdgeEdit(data: GraphData, edit: Extract<SandboxEdit, { kind: 'edge' }>): void {
  const sourceIdx = data.adjacencyMatrix.indexByLanguage[edit.sourceId];
  const targetIdx = data.adjacencyMatrix.indexByLanguage[edit.targetId];
  if (sourceIdx === undefined || targetIdx === undefined || sourceIdx === targetIdx) return;

  if (!edit.status || edit.status === 'unknown-to-us') {
    data.adjacencyMatrix.matrix[sourceIdx][targetIdx] = null;
    return;
  }

  const relation: DirectedSuccinctnessRelation = {
    status: edit.status,
    refs: [],
    description: SANDBOX_DESCRIPTION,
    derived: false
  };

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
    refs: [],
    description: SANDBOX_DESCRIPTION,
    derived: false
  };
}

export function applySandboxEdits(base: GraphData, edits: SandboxEdit[]): SandboxEvaluationResult {
  const directEdgeIds = getDirectSandboxEdgeIds(edits);
  const directOperationCellIds = getDirectSandboxOperationCellIds(edits);

  try {
    const merged = cloneDataset(base);

    for (const edit of edits) {
      if (edit.kind === 'edge') {
        applyEdgeEdit(merged, edit);
      } else {
        applyOperationEdit(merged, edit);
      }
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
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      changedEdgeIds: new Set(),
      changedOperationCellIds: new Set(),
      directEdgeIds,
      directOperationCellIds
    };
  }
}
