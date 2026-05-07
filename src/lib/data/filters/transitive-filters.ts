import type { GraphData, KCAdjacencyMatrix } from '../../types.js';
import { cloneDataset } from '../transforms.js';

/**
 * Helper function to check if a status is poly or quasi
 */
function isPolyOrQuasi(status: string): 'poly' | 'quasi' | null {
  if (status === 'poly') return 'poly';
  if (status === 'no-poly-quasi' || status === 'unknown-poly-quasi') return 'quasi';
  return null;
}

function isNoQuasi(status: string): boolean {
  return status === 'no-quasi';
}

/**
 * A "strict" edge is one where the forward direction is poly/quasi
 * AND the reverse direction is no-quasi.
 */
function getStrictEdgeType(
  matrix: KCAdjacencyMatrix,
  sourceIndex: number,
  targetIndex: number
): 'poly' | 'quasi' | null {
  const forward = matrix.matrix[sourceIndex]?.[targetIndex];
  const backward = matrix.matrix[targetIndex]?.[sourceIndex];
  if (!forward || !backward) return null;
  if (forward.hidden || backward.hidden) return null;

  const edgeType = isPolyOrQuasi(forward.status);
  if (!edgeType) return null;
  if (!isNoQuasi(backward.status)) return null;
  return edgeType;
}

/**
 * Internal transitive reduction pass.
 * 
 * For each node N, marks edges as hidden if they are redundant due to transitivity.
 * Uses MST approach: builds two minimum spanning trees (poly-only, poly+quasi).
 * 
 * Algorithm:
 * - When enabled (param=true): marks transitive edges as hidden
 * - When disabled (param=false): unhides all edges
 * - For each direct edge from N→B:
 *   - Temporarily hide it
 *   - Check if B is still reachable via BFS
 *   - If yes: edge is transitive, keep hidden
 *   - If no: edge is needed, unhide it
 */
export function applyTransitiveReduction(data: GraphData): GraphData {
    const working = cloneDataset(data);
    const { adjacencyMatrix } = working;

    // Pass 1: strict transitive reduction on (poly/quasi forward + no-quasi backward).
    // Must run BEFORE the standard poly/quasi reduction so we don't lose forward edges
    // needed to infer implied no-quasi relationships.
    omitStrictTransitiveEdges(adjacencyMatrix);

    // Pass 2: existing poly/quasi transitive reduction.
    for (let nodeIndex = 0; nodeIndex < adjacencyMatrix.languageIds.length; nodeIndex += 1) {
      const row = adjacencyMatrix.matrix[nodeIndex];
      if (!row) continue;

      const directEdges: Array<{ targetIndex: number; edgeType: 'poly' | 'quasi' }> = [];
      row.forEach((relation, targetIndex) => {
        if (!relation || targetIndex === nodeIndex) return;
        if (relation.hidden) return;
        const edgeType = isPolyOrQuasi(relation.status);
        if (edgeType) {
          directEdges.push({ targetIndex, edgeType });
        }
      });

      for (const { targetIndex, edgeType } of directEdges) {
        const edge = adjacencyMatrix.matrix[nodeIndex][targetIndex];
        if (!edge) continue;
        if (edge.hidden) continue;

        const previousHidden = edge.hidden ?? false;
        edge.hidden = true;
        const reachable = canReach(adjacencyMatrix, nodeIndex, targetIndex, edgeType);
        if (!reachable) {
          edge.hidden = previousHidden;
        }
      }
    }

    return working;
}

/**
 * Strict transitive reduction.
 *
 * For each strict edge A→C (poly/quasi forward and C→A no-quasi),
 * hide it if C is reachable from A through other strict edges.
 * If hidden, also hide the implied reverse no-quasi edge C→A.
 */
function omitStrictTransitiveEdges(adjacencyMatrix: KCAdjacencyMatrix): void {
  for (let sourceIndex = 0; sourceIndex < adjacencyMatrix.languageIds.length; sourceIndex += 1) {
    const row = adjacencyMatrix.matrix[sourceIndex];
    if (!row) continue;

    const directStrictEdges: Array<{ targetIndex: number; edgeType: 'poly' | 'quasi' }> = [];
    for (let targetIndex = 0; targetIndex < row.length; targetIndex += 1) {
      if (targetIndex === sourceIndex) continue;
      const edgeType = getStrictEdgeType(adjacencyMatrix, sourceIndex, targetIndex);
      if (edgeType) {
        directStrictEdges.push({ targetIndex, edgeType });
      }
    }

    for (const { targetIndex, edgeType } of directStrictEdges) {
      const forward = adjacencyMatrix.matrix[sourceIndex][targetIndex];
      if (!forward) continue;
      if (forward.hidden) continue;

      const previousHidden = forward.hidden ?? false;
      forward.hidden = true;
      const reachable = canReachStrict(adjacencyMatrix, sourceIndex, targetIndex, edgeType);
      if (!reachable) {
        forward.hidden = previousHidden;
        continue;
      }

      const backward = adjacencyMatrix.matrix[targetIndex]?.[sourceIndex];
      if (backward && isNoQuasi(backward.status)) {
        backward.hidden = true;
      }
    }
  }
}

/**
 * Check if targetIndex is reachable from sourceIndex via BFS
 * @param sourceIndex - Starting node
 * @param targetIndex - Target node to reach
 * @param edgeType - Type of edge we're checking ('poly' or 'quasi')
 */
function canReach(
  matrix: KCAdjacencyMatrix,
  sourceIndex: number,
  targetIndex: number,
  edgeType: 'poly' | 'quasi'
): boolean {
  const visited = new Set<number>();
  const queue: number[] = [sourceIndex];
  visited.add(sourceIndex);

  while (queue.length > 0) {
    const current = queue.shift()!;
    
    const currentRow = matrix.matrix[current];
    if (!currentRow) continue;

    for (let i = 0; i < currentRow.length; i++) {
      const relation = currentRow[i];
      if (!relation || i === sourceIndex || visited.has(i)) continue;

      // Skip hidden edges
      if (relation.hidden) continue;

      const currentEdgeType = isPolyOrQuasi(relation.status);
      if (!currentEdgeType) continue;

      // For poly edges, we can only use poly edges
      // For quasi edges, we can use both poly and quasi
      const canUse = edgeType === 'poly' 
        ? currentEdgeType === 'poly'
        : (currentEdgeType === 'poly' || currentEdgeType === 'quasi');

      if (canUse) {
        if (i === targetIndex) {
          return true; // Found a path!
        }
        visited.add(i);
        queue.push(i);
      }
    }
  }

  return false; // No path found
}

/**
 * Reachability test restricted to strict edges.
 */
function canReachStrict(
  matrix: KCAdjacencyMatrix,
  sourceIndex: number,
  targetIndex: number,
  edgeType: 'poly' | 'quasi'
): boolean {
  const visited = new Set<number>();
  const queue: number[] = [sourceIndex];
  visited.add(sourceIndex);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentRow = matrix.matrix[current];
    if (!currentRow) continue;

    for (let i = 0; i < currentRow.length; i += 1) {
      if (i === sourceIndex || visited.has(i)) continue;

      const currentEdgeType = getStrictEdgeType(matrix, current, i);
      if (!currentEdgeType) continue;

      const canUse = edgeType === 'poly'
        ? currentEdgeType === 'poly'
        : (currentEdgeType === 'poly' || currentEdgeType === 'quasi');

      if (!canUse) continue;

      if (i === targetIndex) {
        return true;
      }
      visited.add(i);
      queue.push(i);
    }
  }

  return false;
}

