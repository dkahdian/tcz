/**
 * Script to refresh derived edges and queries in database.json
 * 
 * This script:
 * 1. Reads database.json
 * 2. Removes all fully-derived edges (where derived=true and both description components, if present, are derived)
 * 3. For partially-derived no-poly-quasi edges, reverts the derived description component
 * 4. Removes all derived queries and transformations from languages
 * 5. Runs the propagator to re-generate derived edges and queries
 * 6. Writes the updated database.json
 * 
 * Usage: npx tsx scripts/refresh-derived.ts
 */

import { loadDatabase, saveDatabase, type DatabaseSchema } from './shared/database.js';
import { hydrateEntityReferenceRefs } from './shared/entity-reference-refs.js';

// Import the propagation logic and types
import { propagateImplicitRelations } from '../src/lib/data/propagation/index.js';
import { relationTypes, COMPLEXITIES } from '../src/lib/data/complexities.js';
import { authoredRelation } from '../src/lib/data/authored-relation.js';
import type { GraphData, DirectedSuccinctnessRelation, KCAdjacencyMatrix } from '../src/lib/types.js';

function removeDerivedEdges(matrix: KCAdjacencyMatrix): { removed: number; reverted: number } {
  let removed = 0;
  let reverted = 0;
  const size = matrix.languageIds.length;
  
  for (let i = 0; i < size; i++) {
    if (!matrix.matrix[i]) continue;
    for (let j = 0; j < size; j++) {
      const edge = matrix.matrix[i][j] as DirectedSuccinctnessRelation | null;
      if (!edge) continue;
      
      const authored = authoredRelation(edge);
      if (!authored) {
        matrix.matrix[i][j] = null;
        removed++;
      } else if (authored.status !== edge.status) {
        matrix.matrix[i][j] = authored;
        reverted++;
      }
    }
  }
  
  return { removed, reverted };
}

/**
 * Remove derived queries and transformations from all languages.
 * For each query/transformation with derived=true, reset to unknown-to-us.
 */
function removeDerivedOperations(languages: any[]): { queriesRemoved: number; transformationsRemoved: number } {
  let queriesRemoved = 0;
  let transformationsRemoved = 0;

  for (const language of languages) {
    if (!language.properties) continue;

    // Process queries
    if (language.properties.queries) {
      for (const [opCode, opData] of Object.entries(language.properties.queries)) {
        const op = opData as any;
        if (op && (op.derived === true || op.origin === 'derived' || op.origin === 'batch')) {
          // Reset to unknown-to-us
          language.properties.queries[opCode] = {
            complexity: 'unknown-to-us',
            refs: []
          };
          queriesRemoved++;
        }
      }
    }

    // Process transformations
    if (language.properties.transformations) {
      for (const [opCode, opData] of Object.entries(language.properties.transformations)) {
        const op = opData as any;
        if (op && (op.derived === true || op.origin === 'derived' || op.origin === 'batch')) {
          // Reset to unknown-to-us
          language.properties.transformations[opCode] = {
            complexity: 'unknown-to-us',
            refs: []
          };
          transformationsRemoved++;
        }
      }
    }
  }

  return { queriesRemoved, transformationsRemoved };
}

function countDerivedEdges(matrix: KCAdjacencyMatrix): number {
  let count = 0;
  const size = matrix.languageIds.length;
  
  for (let i = 0; i < size; i++) {
    if (!matrix.matrix[i]) continue;
    for (let j = 0; j < size; j++) {
      const edge = matrix.matrix[i][j] as DirectedSuccinctnessRelation | null;
      if (edge && (edge.derived === true || edge.origin === 'derived' || edge.origin === 'batch')) {
        count++;
      }
    }
  }
  
  return count;
}

export function refreshDerivedDatabase(database: DatabaseSchema): {
  removed: number;
  reverted: number;
  queriesRemoved: number;
  transformationsRemoved: number;
  existingDerived: number;
  newDerived: number;
  entityRefHydrated: number;
} {
  const existingDerived = countDerivedEdges(database.adjacencyMatrix);
  const { removed, reverted } = removeDerivedEdges(database.adjacencyMatrix);
  const { queriesRemoved, transformationsRemoved } = removeDerivedOperations(database.languages);
  const graphData: GraphData = {
    languages: database.languages,
    references: database.references,
    complexities: COMPLEXITIES,
    relationTypes: relationTypes,
    adjacencyMatrix: database.adjacencyMatrix,
    metadata: database.metadata,
    batchClaims: database.batchClaims
  };
  
  const propagated = propagateImplicitRelations(graphData);
  const newDerived = countDerivedEdges(propagated.adjacencyMatrix);
  database.adjacencyMatrix = propagated.adjacencyMatrix;
  const entityRefHydrated = hydrateEntityReferenceRefs(database);

  return {
    removed,
    reverted,
    queriesRemoved,
    transformationsRemoved,
    existingDerived,
    newDerived,
    entityRefHydrated
  };
}

function main(): void {
  console.log('=== Refresh Derived Edges ===\n');
  console.log('Loading database.json...');
  const database = loadDatabase();
  const result = refreshDerivedDatabase(database);

  console.log(`Found ${result.existingDerived} existing derived edges.`);
  console.log(`Removed ${result.removed} fully-derived edges.`);
  console.log(`Reverted ${result.reverted} partially-derived edges.`);
  console.log(`Removed ${result.queriesRemoved} derived queries.`);
  console.log(`Removed ${result.transformationsRemoved} derived transformations.`);
  console.log(`Generated ${result.newDerived} derived edges.`);
  console.log(`Hydrated refs for ${result.entityRefHydrated} facts with entity-reference premises.`);
  console.log('Saving database.json...');
  saveDatabase(database);
  console.log('\n=== Done ===');
}

if (process.argv[1]?.match(/refresh-derived\.(?:ts|js)$/)) main();
