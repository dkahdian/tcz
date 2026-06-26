import type { KCAdjacencyMatrix, DescriptionComponent } from '../../types.js';
import { idToName } from '../../utils/language-id.js';

// Debug flag - set to true to see propagation decisions in console
export const DEBUG_PROPAGATION = false;

// ===========================================================================
// Global derivation counter for Lean proof generation ordering
// ===========================================================================

/** Global counter that monotonically increases each time a derived fact is created.
 *  This ensures that Lean proofs can be emitted in dependency order. */
let _derivationCounter = 0;

/** Get the next derivation order number and increment the counter. */
export function nextDerivationOrder(): number {
  return _derivationCounter++;
}

/** Reset the derivation counter (call before starting propagation). */
export function resetDerivationCounter(): void {
  _derivationCounter = 0;
}

/** Get the current derivation counter value (for reporting). */
export function getDerivationCount(): number {
  return _derivationCounter;
}

export const POLY_STATUS = new Set<string>(['poly']);
export const QUASI_STATUS = new Set<string>(['poly', 'unknown-poly-quasi', 'no-poly-quasi']);

export function rebuildIndexMap(languageIds: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  languageIds.forEach((id, idx) => {
    index[id] = idx;
  });
  return index;
}

export function initMatrix(size: number, fill: boolean): boolean[][] {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(fill));
}

export function initParent(size: number): number[][] {
  return Array.from({ length: size }, () => Array<number>(size).fill(-1));
}

/**
 * Compute reachability with a two-pass preference for assumption-free paths.
 * Pass 1 uses only assumption-free edges; Pass 2 fills in remaining reachable nodes
 * via assumption-bearing edges.  This ensures that when an assumption-free path exists, the
 * parent chain always follows it.
 */
export function computeReachability(matrix: KCAdjacencyMatrix, allowed: Set<string>): { reach: boolean[][]; parent: number[][] } {
  const size = matrix.languageIds.length;
  const reach = initMatrix(size, false);
  const parent = initParent(size);

  for (let source = 0; source < size; source += 1) {
    // Pass 1: only assumption-free edges
    const visited1 = new Set<number>();
    const stack1: number[] = [source];
    while (stack1.length > 0) {
      const current = stack1.pop() as number;
      if (visited1.has(current)) continue;
      visited1.add(current);
      const row = matrix.matrix[current];
      if (!row) continue;
      for (let target = 0; target < size; target += 1) {
        if (target === source) continue;
        const relation = row[target];
        if (!relation) continue;
        if (!allowed.has(relation.status)) continue;
        if (relation.assumption) continue; // Skip assumption-bearing edges in pass 1
        if (!reach[source][target]) {
          reach[source][target] = true;
          parent[source][target] = current;
        }
        if (!visited1.has(target)) {
          stack1.push(target);
        }
      }
    }

    // Pass 2: all edges (fills in nodes only reachable via assumption-bearing paths)
    const visited2 = new Set<number>();
    const stack2: number[] = [source];
    while (stack2.length > 0) {
      const current = stack2.pop() as number;
      if (visited2.has(current)) continue;
      visited2.add(current);
      const row = matrix.matrix[current];
      if (!row) continue;
      for (let target = 0; target < size; target += 1) {
        if (target === source) continue;
        const relation = row[target];
        if (!relation) continue;
        if (!allowed.has(relation.status)) continue;
        if (!reach[source][target]) {
          reach[source][target] = true;
          parent[source][target] = current;
        }
        if (!visited2.has(target)) {
          stack2.push(target);
        }
      }
    }
  }

  return { reach, parent };
}

export function reconstructPathIndices(source: number, target: number, parentRow: number[]): number[] {
  const path: number[] = [];
  let cursor = target;
  while (cursor !== -1 && cursor !== source) {
    path.push(cursor);
    cursor = parentRow[cursor];
  }
  if (cursor === source) {
    path.push(source);
    path.reverse();
    return path;
  }
  return [];
}

export function ensurePath(path: number[], source: number, target: number): number[] {
  if (path.length >= 2) return path;
  return [source, target];
}

export function phraseForStatus(status: string): string {
  switch (status) {
    case 'poly':
      return 'in polynomial time';
    case 'unknown-poly-quasi':
      return 'in quasipolynomial time';
    case 'no-poly-quasi':
      return 'in quasipolynomial time';
    default:
      return 'in unknown time';
  }
}

/**
 * Format reference IDs as inline citations.
 * Returns a string like " \\citep{ref1,ref2}" or empty string if no refs.
 */
export function formatCitations(refs: string[]): string {
  if (!refs || refs.length === 0) return '';
  return ` \\citep{${refs.join(',')}}`;
}

/**
 * Format an assumption as an inline phrase.
 * Used inside descriptions to show assumption provenance on individual premises.
 */
export function formatInlineAssumption(assumption: string | undefined): string {
  if (!assumption) return '';
  const parts = assumption.split(/\s+AND\s+/);
  const formatted = parts.map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return trimmed;
    if (/^\$[\s\S]*\$$|^\\\([\s\S]*\\\)$|^\\\[[\s\S]*\\\]$/.test(trimmed)) {
      return trimmed;
    }
    return /\\[a-zA-Z]+|[\u2260\u2264\u2265\u2227\u2228]/.test(trimmed)
      ? `$${trimmed.replace(/\u2260/g, '\\neq')}$`
      : trimmed;
  }).filter(Boolean);
  return ` assuming ${formatted.join(' and ')}`;
}

export function languageRefForId(languageId: string): string {
  const name = idToName(languageId);
  const familyMatch = name.match(/^(.+)\$_(.+)\$$/);
  if (familyMatch) {
    return `\\langfam{${familyMatch[1]}}{${familyMatch[2]}}`;
  }
  return `\\langref{${name.replace(/\$/g, '').replace(/_/g, '\\_')}}`;
}

export function positiveCompilationRef(sourceId: string, targetId: string, statusOrLevel: string): string {
  const command = statusOrLevel === 'poly' || statusOrLevel === 'polynomial' ? 'compilespoly' : 'compilesquasi';
  return `\\${command}{${languageRefForId(sourceId)}}{${languageRefForId(targetId)}}`;
}

export function negativeCompilationRef(sourceId: string, targetId: string, statusOrLevel: string): string {
  const command = statusOrLevel === 'no-quasi' || statusOrLevel === 'quasi' || statusOrLevel === 'quasipolynomial'
    ? 'nocompilesquasi'
    : 'nocompilespoly';
  return `\\${command}{${languageRefForId(sourceId)}}{${languageRefForId(targetId)}}`;
}

/**
 * Collect and merge assumptions from all edges along a path.
 * Returns undefined if no assumptions, a single assumption if only one,
 * or assumptions joined with " AND " if multiple unique assumptions.
 */
export function collectAssumptionsUnion(path: number[], matrix: KCAdjacencyMatrix): string | undefined {
  const assumptions = new Set<string>();
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const relation = matrix.matrix[from]?.[to];
    if (relation?.assumption) {
      assumptions.add(relation.assumption);
    }
  }
  if (assumptions.size === 0) return undefined;
  return Array.from(assumptions).join(' AND ');
}

export function describePath(pathIds: string[], matrix: KCAdjacencyMatrix): string {
  const { languageIds } = matrix;
  const parts: string[] = [];
  for (let i = 0; i < pathIds.length - 1; i += 1) {
    const fromId = pathIds[i];
    const toId = pathIds[i + 1];
    const fromIdx = languageIds.indexOf(fromId);
    const toIdx = languageIds.indexOf(toId);
    const relation = matrix.matrix[fromIdx]?.[toIdx];
    const status = relation?.status ?? 'unknown';
    parts.push(`${positiveCompilationRef(fromId, toId, status)}.`);
  }
  return parts.join(' ');
}

/**
 * Format a contradicting relationship as a premise statement with its own
 * inline assumption.  E.g. "A cannot compile to B in polynomial time assuming $P \neq NP$ [refs]".
 */
export function formatContradictingPremise(
  srcId: string,
  tgtId: string,
  status: string,
  _assumption: string | undefined
): string {
  switch (status) {
    case 'no-poly-quasi':
    case 'no-poly-unknown-quasi':
      return negativeCompilationRef(srcId, tgtId, 'poly');
    case 'no-quasi':
      return negativeCompilationRef(srcId, tgtId, 'quasi');
    default:
      return `${idToName(srcId)} and ${idToName(tgtId)} have an incompatible relationship${formatInlineAssumption(_assumption)}`;
  }
}

/**
 * Build the combined description for a no-poly-quasi edge from its proof components.
 */
export function buildNoPolyQuasiDescription(noPolyDescription: DescriptionComponent, quasiDescription: DescriptionComponent): string {
  const parts: string[] = [];
  parts.push('First, we show no polynomial compilation exists.');
  parts.push(noPolyDescription.description);
  parts.push('');
  parts.push('Now, we show a quasipolynomial compilation exists.');
  parts.push(quasiDescription.description);
  return parts.join('\n');
}

export function contradictionError(message: string): never {
  throw new Error(message);
}
