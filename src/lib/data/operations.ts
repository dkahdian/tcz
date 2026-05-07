import type { KCOpEntry, KCOpSupportMap, KCLanguagePropertiesResolved } from '../types.js';
import database from './database.json';

export interface KCOperation {
  code: string;
  label: string;
  description?: string;
}

export type OperationKind = 'query' | 'transformation';

const operationsData = database.operations as {
  queries: Record<string, KCOperation>;
  transformations: Record<string, KCOperation>;
};

export const QUERIES: Record<string, KCOperation> = operationsData.queries;
export const TRANSFORMATIONS: Record<string, KCOperation> = operationsData.transformations;

const definitions = (database.definitions ?? []) as Array<{ id: string; title: string; statement: string }>;
const definitionById = new Map(definitions.map((d) => [d.id, d]));

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findTransformationSafeKeyByCode(code: string): string | undefined {
  for (const [safeKey, opDef] of Object.entries(TRANSFORMATIONS)) {
    if (opDef.code === code) return safeKey;
  }
  return undefined;
}

export function operationDefinitionId(kind: OperationKind, code: string): string {
  if (kind === 'query') {
    return `query-${normalizeToken(code)}`;
  }

  const safeKey = findTransformationSafeKeyByCode(code) ?? code;
  return `transformation-${normalizeToken(safeKey)}`;
}

export function getOperationDefinition(kind: OperationKind, code: string) {
  return definitionById.get(operationDefinitionId(kind, code));
}

export function getOperationDescription(kind: OperationKind, code: string, fallback?: string): string | undefined {
  return getOperationDefinition(kind, code)?.statement ?? fallback;
}

export function getAllQueryCodes(): string[] {
  return Object.keys(QUERIES);
}

export function getAllTransformationCodes(): string[] {
  return Object.keys(TRANSFORMATIONS);
}

export function displayCodeToSafeKey(code: string): string {
  for (const [safeKey, opDef] of Object.entries(TRANSFORMATIONS)) {
    if (opDef.code === code) {
      return safeKey;
    }
  }
  return code;
}

export function resolveOperations(
  supportMap: KCOpSupportMap | undefined,
  operationDefs: Record<string, KCOperation>
): KCOpEntry[] {
  const result: KCOpEntry[] = [];
  
  for (const [safeKey, opDef] of Object.entries(operationDefs)) {
    const support = supportMap?.[safeKey] || supportMap?.[opDef.code];
    
    if (support) {
      result.push({
        code: opDef.code,
        label: opDef.label,
        complexity: support.complexity,
        assumption: support.assumption,
        refs: support.refs,
        description: support.description,
        derived: support.derived,
        dimmed: support.dimmed,
        explicit: support.explicit
      });
    } else {
      result.push({
        code: opDef.code,
        label: opDef.label,
        complexity: 'unknown-to-us',
        refs: []
      });
    }
  }
  
  return result;
}

export function resolveLanguageProperties(
  queries?: KCOpSupportMap,
  transformations?: KCOpSupportMap
): KCLanguagePropertiesResolved {
  return {
    queries: resolveOperations(queries, QUERIES),
    transformations: resolveOperations(transformations, TRANSFORMATIONS)
  };
}
