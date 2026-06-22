/**
 * Script to prioritize which open problems in the adjacency matrix would have the most impact
 * 
 * This script:
 * 1. Reads database.json
 * 2. For each null/unknown cell, tries each possible upgrade/downgrade
 * 3. Runs the propagator and counts how many changes propagate
 * 4. Sorts by impact and outputs the top N most influential changes
 * 
 * Usage: npx tsx scripts/prioritize-open-problems.ts [topN]
 */

import { loadDatabase, type DatabaseSchema } from './shared/database.js';

import { propagateImplicitRelations } from '../src/lib/data/propagation/index.js';
import { relationTypes, COMPLEXITIES } from '../src/lib/data/complexities.js';
import type { GraphData, DirectedSuccinctnessRelation, KCAdjacencyMatrix, KCLanguage } from '../src/lib/types.js';

type TargetStatus = 'poly' | 'no-poly-quasi' | 'no-quasi';

interface ChangeCandidate {
  sourceIdx: number;
  targetIdx: number;
  sourceName: string;
  targetName: string;
  currentStatus: string | null;
  triedStatus: TargetStatus;
  propagatedChanges: number;
  propagatedEdges: string[];  // List of "i->j" edge keys that changed
  contradictionFound: boolean;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function buildGraphData(database: DatabaseSchema): GraphData {
  return {
    languages: database.languages,
    references: database.references,
    complexities: COMPLEXITIES,
    relationTypes: relationTypes,
    adjacencyMatrix: database.adjacencyMatrix,
    metadata: database.metadata,
    batchClaims: database.batchClaims
  };
}

function getPossibleChanges(currentStatus: string | null): TargetStatus[] {
  switch (currentStatus) {
    case null:
    case 'unknown-both':
      return ['poly', 'no-poly-quasi', 'no-quasi'];
    case 'unknown-poly-quasi':
      return ['poly', 'no-poly-quasi'];
    case 'no-poly-unknown-quasi':
      return ['no-poly-quasi', 'no-quasi'];
    default:
      return [];
  }
}

function countDifferences(original: KCAdjacencyMatrix, propagated: KCAdjacencyMatrix): { count: number; edges: string[] } {
  const edges: string[] = [];
  const size = original.languageIds.length;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue;
      const origStatus = original.matrix[i]?.[j]?.status ?? null;
      const propStatus = propagated.matrix[i]?.[j]?.status ?? null;
      if (origStatus !== propStatus) {
        edges.push(`${i}->${j}`);
      }
    }
  }
  return { count: edges.length, edges };
}

function getLanguageName(languages: KCLanguage[], langId: string): string {
  return languages.find(l => l.id === langId)?.name ?? langId;
}

function main(): void {
  const topN = parseInt(process.argv[2] ?? '10', 10);
  
  console.log('=== Prioritize Open Problems ===\n');
  console.log(`Will output top ${topN} most influential changes.\n`);
  
  console.log('Loading database.json...');
  const database = loadDatabase();
  const languages = database.languages;
  const languageIds = database.adjacencyMatrix.languageIds;
  const size = languageIds.length;
  
  console.log(`Found ${size} languages in the matrix.`);
  
  // Identify fully missing languages (entire row + column is null)
  const fullyMissing = new Set<number>();
  for (let i = 0; i < size; i++) {
    let hasAnyEdge = false;
    for (let j = 0; j < size; j++) {
      if (i === j) continue;
      // Check both outgoing (row) and incoming (column) edges
      if (database.adjacencyMatrix.matrix[i]?.[j] !== null ||
          database.adjacencyMatrix.matrix[j]?.[i] !== null) {
        hasAnyEdge = true;
        break;
      }
    }
    if (!hasAnyEdge) {
      fullyMissing.add(i);
    }
  }
  
  if (fullyMissing.size > 0) {
    const missingNames = Array.from(fullyMissing).map(i => getLanguageName(languages, languageIds[i]));
    console.log(`Skipping ${fullyMissing.size} missing languages: ${missingNames.join(', ')}`);
  }
  
  // Collect all work items (excluding fully missing languages)
  const workItems: Array<{
    sourceIdx: number;
    targetIdx: number;
    sourceName: string;
    targetName: string;
    currentStatus: string | null;
    triedStatus: TargetStatus;
  }> = [];
  
  for (let i = 0; i < size; i++) {
    if (fullyMissing.has(i)) continue;
    for (let j = 0; j < size; j++) {
      if (i === j || fullyMissing.has(j)) continue;
      const edge = database.adjacencyMatrix.matrix[i]?.[j] as DirectedSuccinctnessRelation | null;
      const currentStatus = edge?.status ?? null;
      const possibleChanges = getPossibleChanges(currentStatus);
      
      if (possibleChanges.length > 0) {
        const sourceName = getLanguageName(languages, languageIds[i]);
        const targetName = getLanguageName(languages, languageIds[j]);
        for (const triedStatus of possibleChanges) {
          workItems.push({ sourceIdx: i, targetIdx: j, sourceName, targetName, currentStatus, triedStatus });
        }
      }
    }
  }
  
  console.log(`Found ${workItems.length} total changes to evaluate.\n`);
  
  const candidates: ChangeCandidate[] = [];
  const origLog = console.log;
  const startTime = Date.now();
  
  for (let idx = 0; idx < workItems.length; idx++) {
    const item = workItems[idx];
    
    if ((idx + 1) % 50 === 0) {
      origLog(`Processing ${idx + 1}/${workItems.length}...`);
    }
    
    const testDatabase = deepClone(database);
    testDatabase.adjacencyMatrix.matrix[item.sourceIdx][item.targetIdx] = {
      status: item.triedStatus,
      refs: [],
      derived: false,
      description: `Hypothetical: ${item.sourceName} -> ${item.targetName} is ${item.triedStatus}`
    };
    
    const beforeMatrix = deepClone(testDatabase.adjacencyMatrix);
    const graphData = buildGraphData(testDatabase);
    
    let propagatedChanges = 0;
    let propagatedEdges: string[] = [];
    let contradictionFound = false;
    
    console.log = () => {};
    try {
      const propagated = propagateImplicitRelations(graphData);
      const diff = countDifferences(beforeMatrix, propagated.adjacencyMatrix);
      propagatedChanges = diff.count;
      propagatedEdges = diff.edges;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Contradiction')) {
        contradictionFound = true;
        console.log = origLog;
        origLog(`⚠️ Contradiction: ${item.sourceName} -> ${item.targetName} = ${item.triedStatus}`);
      } else {
        throw error;
      }
    } finally {
      console.log = origLog;
    }
    
    candidates.push({ ...item, propagatedChanges, propagatedEdges, contradictionFound });
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nFinished in ${elapsed}s.\n`);
  
  const valid = candidates.filter(c => !c.contradictionFound);
  const contradictions = candidates.filter(c => c.contradictionFound);
  
  if (contradictions.length > 0) {
    console.log(`⚠️ ${contradictions.length} changes would cause contradictions.\n`);
  }
  
  // === Heuristic 1: Raw propagated changes ===
  const byRawCount = [...valid].sort((a, b) => b.propagatedChanges - a.propagatedChanges);
  const impactfulRaw = byRawCount.filter(c => c.propagatedChanges >= 1);
  const finalCountRaw = Math.min(topN, impactfulRaw.length);
  
  console.log('=== Top by Raw Propagated Changes ===\n');
  console.log(`Showing top ${finalCountRaw} (out of ${impactfulRaw.length} with impact >= 1):\n`);
  
  for (let i = 0; i < finalCountRaw; i++) {
    const c = impactfulRaw[i];
    console.log(`${i + 1}. ${c.sourceName} -> ${c.targetName}`);
    console.log(`   Change: ${c.currentStatus ?? 'null'} -> ${c.triedStatus}`);
    console.log(`   Propagated: ${c.propagatedChanges}\n`);
  }
  
  // === Heuristic 2: Greedy set cover to maximize total unique edges ===
  // Pick changes greedily to cover the most new edges at each step
  console.log('=== Top by Greedy Set Cover (maximize unique edges) ===\n');
  
  const coveredEdges = new Set<string>();
  const selectedChanges: Array<typeof valid[0] & { newEdgesCovered: number; cumulativeTotal: number }> = [];
  const remainingCandidates = valid.filter(c => c.propagatedChanges >= 1).map(c => ({ ...c }));
  
  for (let round = 0; round < topN && remainingCandidates.length > 0; round++) {
    // Find candidate that covers the most NEW edges
    let bestIdx = -1;
    let bestNewCount = 0;
    
    for (let i = 0; i < remainingCandidates.length; i++) {
      const c = remainingCandidates[i];
      let newCount = 0;
      for (const edge of c.propagatedEdges) {
        if (!coveredEdges.has(edge)) newCount++;
      }
      if (newCount > bestNewCount) {
        bestNewCount = newCount;
        bestIdx = i;
      }
    }
    
    if (bestIdx === -1 || bestNewCount === 0) break;
    
    const best = remainingCandidates[bestIdx];
    // Add all its edges to covered set
    for (const edge of best.propagatedEdges) {
      coveredEdges.add(edge);
    }
    selectedChanges.push({
      ...best,
      newEdgesCovered: bestNewCount,
      cumulativeTotal: coveredEdges.size
    });
    
    // Remove this candidate
    remainingCandidates.splice(bestIdx, 1);
  }
  
  console.log(`Selected ${selectedChanges.length} changes covering ${coveredEdges.size} unique edges:\n`);
  
  for (let i = 0; i < selectedChanges.length; i++) {
    const c = selectedChanges[i];
    console.log(`${i + 1}. ${c.sourceName} -> ${c.targetName}`);
    console.log(`   Change: ${c.currentStatus ?? 'null'} -> ${c.triedStatus}`);
    console.log(`   New edges: +${c.newEdgesCovered}, Cumulative total: ${c.cumulativeTotal}\n`);
  }
  
  // Collect all unique edges that could possibly be propagated
  const allPossibleEdges = new Set<string>();
  for (const c of valid) {
    for (const edge of c.propagatedEdges) {
      allPossibleEdges.add(edge);
    }
  }
  
  console.log('=== Summary ===');
  console.log(`Open problems evaluated: ${candidates.length}`);
  console.log(`Contradictions: ${contradictions.length}`);
  console.log(`Impactful changes (raw >= 1): ${impactfulRaw.length}`);
  console.log(`Total unique edges that could propagate: ${allPossibleEdges.size}`);
  console.log(`Edges covered by top ${selectedChanges.length} greedy picks: ${coveredEdges.size}`);
  if (impactfulRaw.length > 0) {
    console.log(`Max propagated by single change: ${impactfulRaw[0].propagatedChanges}`);
  }
  console.log('\n=== Done ===');
}

main();
