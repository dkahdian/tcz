import type { DirectedSuccinctnessRelation, GraphData, KCOpSupport } from '$lib/types.js';
import { applySandboxEdits, type SandboxEdit, type SandboxOperationType } from '$lib/data/sandbox-transforms.js';
import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';

type ProofTarget =
  | { kind: 'edge'; sourceId: string; targetId: string }
  | { kind: 'operation'; operationType: SandboxOperationType; languageId: string; operationCode: string };

type WorkerRequest =
  | {
      id: number;
      kind: 'hydrate-sandbox';
      base: GraphData;
      edits: SandboxEdit[];
    }
  | {
      id: number;
      kind: 'prove-target';
      base: GraphData;
      edits: SandboxEdit[];
      target: ProofTarget;
    };

type WorkerResponse =
  | {
      id: number;
      kind: 'hydrate-sandbox';
      result: ReturnType<typeof applySandboxEdits>;
    }
  | {
      id: number;
      kind: 'prove-target';
      result:
        | {
            ok: true;
            relation?: DirectedSuccinctnessRelation | null;
            support?: KCOpSupport | null;
          }
        | { ok: false; error: string };
    };

function relationFor(
  graphData: GraphData,
  sourceId: string,
  targetId: string
): DirectedSuccinctnessRelation | null {
  const sourceIdx = graphData.adjacencyMatrix.indexByLanguage[sourceId];
  const targetIdx = graphData.adjacencyMatrix.indexByLanguage[targetId];
  if (sourceIdx === undefined || targetIdx === undefined) return null;
  return graphData.adjacencyMatrix.matrix[sourceIdx]?.[targetIdx] ?? null;
}

function supportFor(
  graphData: GraphData,
  operationType: SandboxOperationType,
  languageId: string,
  operationCode: string
): KCOpSupport | null {
  const language = graphData.languages.find((item) => item.id === languageId);
  if (!language) return null;
  const map = operationType === 'query'
    ? language.properties?.queries
    : language.properties?.transformations;
  if (!map) return null;
  const catalog = operationType === 'query' ? QUERIES : TRANSFORMATIONS;
  const catalogEntry = catalog[operationCode] ?? Object.values(catalog).find((candidate) => candidate.code === operationCode);
  const safeKey = Object.entries(catalog).find(([, candidate]) => candidate.code === operationCode)?.[0] ?? operationCode;
  return map[operationCode] ?? map[catalogEntry?.code ?? ''] ?? map[safeKey] ?? null;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    const result = applySandboxEdits(message.base, message.edits, { proofMode: 'eager' });
    if (message.kind === 'hydrate-sandbox') {
      self.postMessage({ id: message.id, kind: message.kind, result } satisfies WorkerResponse);
      return;
    }

    if (!result.ok) {
      self.postMessage({
        id: message.id,
        kind: message.kind,
        result: { ok: false, error: result.error }
      } satisfies WorkerResponse);
      return;
    }

    const targetResult = message.target.kind === 'edge'
      ? {
          ok: true as const,
          relation: relationFor(result.graphData, message.target.sourceId, message.target.targetId)
        }
      : {
          ok: true as const,
          support: supportFor(
            result.graphData,
            message.target.operationType,
            message.target.languageId,
            message.target.operationCode
          )
        };

    self.postMessage({
      id: message.id,
      kind: message.kind,
      result: targetResult
    } satisfies WorkerResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (message.kind === 'hydrate-sandbox') {
      self.postMessage({
        id: message.id,
        kind: message.kind,
        result: {
          ok: false,
          error: errorMessage,
          changedEdgeIds: new Set<string>(),
          changedOperationCellIds: new Set<string>(),
          directEdgeIds: new Set<string>(),
          directOperationCellIds: new Set<string>()
        }
      } satisfies WorkerResponse);
    } else {
      self.postMessage({
        id: message.id,
        kind: message.kind,
        result: { ok: false, error: errorMessage }
      } satisfies WorkerResponse);
    }
  }
};
