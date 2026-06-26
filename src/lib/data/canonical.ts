import type {
  GraphData,
  KCDefinition,
  KCBatchClaim,
  NodePositionsByLanguageName
} from '../types.js';
import database from './database.json';
import { allLanguages } from './languages.js';
import { adjacencyMatrixData } from './edges.js';
import { relationTypes } from './complexities.js';
import { allReferences } from './references.js';
import { COMPLEXITIES } from './complexities.js';
import { initNameMap } from '../utils/language-id.js';
import { collectAssumptions } from './assumptions.js';

// Initialize the language ID → name map so idToName() works at runtime
initNameMap(allLanguages);

const definitions = (database.definitions ?? []) as KCDefinition[];
const batchClaims = (database.batchClaims ?? []) as KCBatchClaim[];
const assumptions = Array.isArray((database as { assumptions?: unknown }).assumptions)
  ? ((database as { assumptions: string[] }).assumptions ?? [])
  : undefined;
const rawDefaultNodePositions = (database as { defaultNodePositionsByLanguageName?: unknown })
  .defaultNodePositionsByLanguageName;
const defaultNodePositionsByLanguageName: NodePositionsByLanguageName | undefined = (() => {
  if (!rawDefaultNodePositions || typeof rawDefaultNodePositions !== 'object') {
    return undefined;
  }

  const normalized: NodePositionsByLanguageName = {};
  for (const [languageName, rawPosition] of Object.entries(rawDefaultNodePositions as Record<string, unknown>)) {
    if (!rawPosition || typeof rawPosition !== 'object') continue;

    const x = (rawPosition as { x?: unknown }).x;
    const y = (rawPosition as { y?: unknown }).y;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    normalized[languageName] = { x, y };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
})();
const metadata = ('metadata' in database
  ? (database as { metadata?: Record<string, unknown> }).metadata
  : undefined);

export const canonicalDataset: GraphData = {
  languages: allLanguages,
  definitions,
  adjacencyMatrix: adjacencyMatrixData,
  relationTypes,
  complexities: COMPLEXITIES,
  references: allReferences,
  assumptions: assumptions ?? collectAssumptions({
    languages: allLanguages,
    adjacencyMatrix: adjacencyMatrixData,
    batchClaims
  }),
  defaultNodePositionsByLanguageName,
  metadata,
  batchClaims
};
