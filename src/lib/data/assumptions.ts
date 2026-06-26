import type { GraphData } from '../types.js';

function addAssumption(target: Set<string>, assumption?: string): void {
  const trimmed = assumption?.trim();
  if (trimmed) target.add(trimmed);
}

export function collectAssumptions(
  data: Pick<GraphData, 'adjacencyMatrix' | 'languages' | 'batchClaims' | 'assumptions'>,
  options: { includeCanonical?: boolean } = {}
): string[] {
  const assumptions = new Set<string>();

  if (options.includeCanonical !== false) {
    for (const assumption of data.assumptions ?? []) {
      addAssumption(assumptions, assumption);
    }
  }

  for (const row of data.adjacencyMatrix.matrix) {
    for (const relation of row) {
      addAssumption(assumptions, relation?.assumption);
    }
  }

  for (const language of data.languages) {
    for (const support of Object.values(language.properties?.queries ?? {})) {
      addAssumption(assumptions, support.assumption);
    }
    for (const support of Object.values(language.properties?.transformations ?? {})) {
      addAssumption(assumptions, support.assumption);
    }
  }

  for (const batch of data.batchClaims ?? []) {
    addAssumption(assumptions, batch.assumption);
  }

  return [...assumptions].sort((a, b) => a.localeCompare(b));
}
