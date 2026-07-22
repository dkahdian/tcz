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
import { hydrateEntityReferenceRefs } from '../src/lib/data/propagation/entity-reference-refs.js';

// Import the propagation logic and types
import { propagateImplicitRelations } from '../src/lib/data/propagation/index.js';
import { relationTypes, COMPLEXITIES } from '../src/lib/data/complexities.js';
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
      
      // Handle no-poly-quasi edges with structured descriptions
      if (edge.status === 'no-poly-quasi' && (edge.noPolyDescription || edge.quasiDescription)) {
        const noPolyDerived = edge.noPolyDescription?.derived === true || edge.noPolyDescription?.origin === 'derived';
        const quasiDerived = edge.quasiDescription?.derived === true || edge.quasiDescription?.origin === 'derived';
        
        if (noPolyDerived && quasiDerived) {
          // Both parts are derived - remove entirely
          matrix.matrix[i][j] = null;
          removed++;
        } else if (noPolyDerived && !quasiDerived) {
          // Only noPolyDescription is derived - revert to unknown-poly-quasi
          matrix.matrix[i][j] = {
            status: 'unknown-poly-quasi',
            description: edge.quasiDescription!.description,
            refs: edge.quasiDescription!.refs,
            hidden: false,
            derived: false
          };
          reverted++;
        } else if (!noPolyDerived && quasiDerived) {
          // Only quasiDescription is derived - revert to no-poly-unknown-quasi
          matrix.matrix[i][j] = {
            status: 'no-poly-unknown-quasi',
            description: edge.noPolyDescription!.description,
            refs: edge.noPolyDescription!.refs,
            hidden: false,
            derived: false
          };
          reverted++;
        }
        // If neither is derived, keep as-is
      } else if (edge.derived === true || edge.origin === 'derived' || edge.origin === 'batch') {
        // Standard derived edge - remove entirely
        matrix.matrix[i][j] = null;
        removed++;
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

function main(): void {
  console.log('=== Refresh Derived Edges ===\n');
  
  // Load database
  console.log('Loading database.json...');
  const database = loadDatabase();
  
  // Count existing derived edges
  const existingDerived = countDerivedEdges(database.adjacencyMatrix);
  console.log(`Found ${existingDerived} existing derived edges.\n`);
  
  // Remove derived edges (or revert partially-derived ones)
  console.log('Removing/reverting derived edges...');
  const { removed, reverted } = removeDerivedEdges(database.adjacencyMatrix);
  console.log(`Removed ${removed} fully-derived edges.`);
  console.log(`Reverted ${reverted} partially-derived edges.\n`);

  // Remove derived queries and transformations
  console.log('Removing derived queries and transformations...');
  const { queriesRemoved, transformationsRemoved } = removeDerivedOperations(database.languages);
  console.log(`Removed ${queriesRemoved} derived queries.`);
  console.log(`Removed ${transformationsRemoved} derived transformations.\n`);

  // Build graph data structure for propagation
  // Note: complexities and relationTypes come from complexities.ts, not database.json
  const graphData: GraphData = {
    languages: database.languages,
    references: database.references,
    complexities: COMPLEXITIES,
    relationTypes: relationTypes,
    adjacencyMatrix: database.adjacencyMatrix,
    metadata: database.metadata,
    batchClaims: database.batchClaims
  };
  
  // Run propagation
  console.log('Running propagation to regenerate derived edges...');
  console.log('---');
  const propagated = propagateImplicitRelations(graphData);
  console.log('---');
  
  // Count new derived edges
  const newDerived = countDerivedEdges(propagated.adjacencyMatrix);
  console.log(`\nGenerated ${newDerived} derived edges.`);
  
  // Update database with propagated matrix
  database.adjacencyMatrix = propagated.adjacencyMatrix;

  console.log('\nHydrating entity-reference citations...');
  const entityRefHydrated = hydrateEntityReferenceRefs(database);
  console.log(`Hydrated refs for ${entityRefHydrated} facts with entity-reference premises.`);
  
  // Save
  console.log('\nSaving database.json...');
  saveDatabase(database);
  
  console.log('\n=== Done ===');
  console.log(`Summary: Removed ${removed} edges, Reverted ${reverted} edges`);
  console.log(`         Removed ${queriesRemoved} queries, ${transformationsRemoved} transformations`);
  console.log(`         Generated ${newDerived} derived edges`);
  console.log(`         Hydrated ${entityRefHydrated} entity-reference fact ref lists`);
}

main();
