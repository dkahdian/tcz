// Shared database I/O utilities for CLI scripts
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  KCAdjacencyMatrix,
  KCBatchClaim,
  KCDefinition,
  KCLanguage,
  KCReference,
  KCSeparatingFunction,
  NodePositionsByLanguageName
} from '../../src/lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATABASE_PATH = path.join(__dirname, '..', '..', 'src', 'lib', 'data', 'database.json');

export interface DatabaseSchema {
  languages: KCLanguage[];
  definitions?: KCDefinition[];
  adjacencyMatrix: KCAdjacencyMatrix;
  references: KCReference[];
  separatingFunctions: KCSeparatingFunction[];
  defaultNodePositionsByLanguageName?: NodePositionsByLanguageName;
  tags?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  operations: Record<string, unknown>;
  operationLemmas?: unknown[];
  batchClaims?: KCBatchClaim[];
}

export function loadDatabase(): DatabaseSchema {
  const content = fs.readFileSync(DATABASE_PATH, 'utf-8');
  return JSON.parse(content) as DatabaseSchema;
}

export function saveDatabase(database: DatabaseSchema): void {
  // Strip empty string assumptions (should be undefined, not "")
  for (const lang of database.languages) {
    if (lang.properties?.queries) {
      for (const op of Object.values(lang.properties.queries)) {
        if (op && 'assumption' in op && !op.assumption) delete op.assumption;
      }
    }
    if (lang.properties?.transformations) {
      for (const op of Object.values(lang.properties.transformations)) {
        if (op && 'assumption' in op && !op.assumption) delete op.assumption;
      }
    }
  }
  if (database.adjacencyMatrix?.matrix) {
    for (const row of database.adjacencyMatrix.matrix) {
      if (!row) continue;
      for (const cell of row) {
        if (cell && 'assumption' in cell && !cell.assumption) delete cell.assumption;
      }
    }
  }
  const content = JSON.stringify(database, null, 2);
  fs.writeFileSync(DATABASE_PATH, content, 'utf-8');
}
