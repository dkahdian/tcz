/// <reference types="node" />

/**
 * Report database coverage, authored/derived claim counts, batch footprints,
 * citation usage, and optionally recomputation-based influence statistics.
 *
 * Usage:
 *   npx tsx scripts/database-stats.ts
 *   npx tsx scripts/database-stats.ts --influence
 *   npx tsx scripts/database-stats.ts --influence --top 25 --json
 */

import { loadDatabase, type DatabaseSchema } from './shared/database.js';
import { propagateImplicitRelations } from '../src/lib/data/propagation/index.js';
import { COMPLEXITIES, relationTypes } from '../src/lib/data/complexities.js';
import type {
  DescriptionComponent,
  DirectedSuccinctnessRelation,
  GraphData,
  KCAdjacencyMatrix,
  KCLanguage,
  KCOpSupport
} from '../src/lib/types.js';

type Category = 'edges' | 'queries' | 'transformations';
type OperationCategory = Extract<Category, 'queries' | 'transformations'>;
type CellState = 'closed' | 'partially-open' | 'open';
type ClaimState = 'closed' | 'open';
type CandidateKind = 'edge' | 'query' | 'transformation' | 'batch';

interface Args {
  influence: boolean;
  influenceLimit?: number;
  json: boolean;
  top: number;
}

interface ClaimUnit {
  category: Category;
  state: ClaimState;
  derived: boolean;
  assumption?: string;
  refs: string[];
  key: string;
  label: string;
  batchId?: string;
}

interface CoverageStats {
  cells: number;
  closedCells: number;
  partiallyOpenCells: number;
  openCells: number;
  possibleClaims: number;
  closedClaims: number;
  openClaims: number;
  automaticProofsWritten: number;
  manuallyInputtedClaims: number;
  assumedClaims: number;
  unconditionalClaims: number;
}

interface InfluenceResult {
  kind: CandidateKind;
  key: string;
  label: string;
  lostDerivedClaims: number;
  lostDerivedCells: number;
  contradiction?: string;
}

interface Report {
  coverage: Record<Category | 'combined', CoverageStats>;
  derivedPercentageByCategory: Record<Category | 'combined', number>;
  influence?: {
    candidatesEvaluated: number;
    candidatesWithContradictions: number;
    top: InfluenceResult[];
  };
}

type EdgeStatusCode = string | null;
type OperationStatusCode = string | null | undefined;

const CLOSED_EDGE_STATUSES: ReadonlySet<EdgeStatusCode> = new Set(['poly', 'no-poly-quasi', 'no-quasi']);
const PARTIAL_EDGE_STATUSES: ReadonlySet<EdgeStatusCode> = new Set(['unknown-poly-quasi', 'no-poly-unknown-quasi']);
const OPEN_EDGE_STATUSES: ReadonlySet<EdgeStatusCode> = new Set([null, 'unknown-both', 'unknown-to-us', 'unknown']);
const CLOSED_OPERATION_STATUSES: ReadonlySet<OperationStatusCode> = new Set(['poly', 'no-poly-unknown-quasi', 'no-poly-quasi', 'no-quasi', 'not-poly']);
const OPEN_OPERATION_STATUSES: ReadonlySet<OperationStatusCode> = new Set([undefined, null, 'unknown-to-us', 'unknown-both', 'unknown', 'unknown-poly-quasi']);

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = { influence: false, json: false, top: 10 };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--influence') parsed.influence = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--influence-limit') {
      parsed.influenceLimit = Number.parseInt(args[i + 1] ?? '', 10);
      i += 1;
    } else if (arg.startsWith('--influence-limit=')) {
      parsed.influenceLimit = Number.parseInt(arg.slice('--influence-limit='.length), 10);
    }
    else if (arg === '--top') {
      parsed.top = Number.parseInt(args[i + 1] ?? '', 10);
      i += 1;
    } else if (arg.startsWith('--top=')) {
      parsed.top = Number.parseInt(arg.slice('--top='.length), 10);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.top) || parsed.top < 1) {
    throw new Error('--top must be a positive integer');
  }
  if (parsed.influenceLimit !== undefined && (!Number.isFinite(parsed.influenceLimit) || parsed.influenceLimit < 1)) {
    throw new Error('--influence-limit must be a positive integer');
  }

  return parsed;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/database-stats.ts [options]

Options:
  --influence       Run expensive removal/repropagation influence simulations.
  --influence-limit N
                    Evaluate only the first N influence candidates; useful for smoke tests.
  --top N          Number of rows to show for ranked tables. Default: 10.
  --json           Print machine-readable JSON instead of text.
  -h, --help       Show this help.
`);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildGraphData(database: DatabaseSchema): GraphData {
  return {
    languages: database.languages,
    definitions: database.definitions,
    references: database.references,
    complexities: COMPLEXITIES,
    relationTypes,
    adjacencyMatrix: database.adjacencyMatrix,
    metadata: database.metadata,
    batchClaims: database.batchClaims
  };
}

function getOperationCodes(database: DatabaseSchema, category: OperationCategory): string[] {
  const operations = database.operations as { queries?: Record<string, unknown>; transformations?: Record<string, unknown> };
  return Object.keys(operations?.[category] ?? {});
}

function languageNameById(database: DatabaseSchema): Map<string, string> {
  return new Map(database.languages.map((language) => [language.id, language.name]));
}

function edgeCellState(relation: DirectedSuccinctnessRelation | null): CellState {
  const status = relation?.status ?? null;
  if (CLOSED_EDGE_STATUSES.has(status)) return 'closed';
  if (PARTIAL_EDGE_STATUSES.has(status)) return 'partially-open';
  if (OPEN_EDGE_STATUSES.has(status)) return 'open';
  return 'open';
}

function operationCellState(support: KCOpSupport | undefined): CellState {
  const status = support?.complexity;
  if (CLOSED_OPERATION_STATUSES.has(status)) return 'closed';
  if (OPEN_OPERATION_STATUSES.has(status)) return 'open';
  return 'open';
}

function componentDerived(component: DescriptionComponent | undefined, fallback: boolean): boolean {
  return component?.derived ?? fallback;
}

function componentAssumption(
  component: (DescriptionComponent & { assumption?: string }) | undefined,
  fallback?: string
): string | undefined {
  return component?.assumption ?? fallback;
}

function componentRefs(component: DescriptionComponent | undefined, fallback: string[]): string[] {
  return component?.refs ?? fallback;
}

function edgeClaimUnits(
  relation: DirectedSuccinctnessRelation | null,
  sourceId: string,
  targetId: string,
  names: Map<string, string>
): ClaimUnit[] {
  const sourceName = names.get(sourceId) ?? sourceId;
  const targetName = names.get(targetId) ?? targetId;
  const baseKey = `edge:${sourceId}->${targetId}`;
  const baseLabel = `${sourceName} -> ${targetName}`;
  const fallbackDerived = relation?.derived === true;
  const fallbackRefs = relation?.refs ?? [];

  if (!relation) {
    return [
      { category: 'edges', state: 'open', derived: false, refs: [], key: `${baseKey}:poly`, label: `${baseLabel} polynomial` },
      { category: 'edges', state: 'open', derived: false, refs: [], key: `${baseKey}:quasi`, label: `${baseLabel} quasipolynomial` }
    ];
  }

  switch (relation.status) {
    case 'poly':
      return [
        { category: 'edges', state: 'closed', derived: fallbackDerived, assumption: relation.assumption, refs: fallbackRefs, key: `${baseKey}:poly`, label: `${baseLabel} polynomial` },
        { category: 'edges', state: 'closed', derived: fallbackDerived, assumption: relation.assumption, refs: fallbackRefs, key: `${baseKey}:quasi`, label: `${baseLabel} quasipolynomial` }
      ];
    case 'no-poly-quasi':
      return [
        {
          category: 'edges',
          state: 'closed',
          derived: componentDerived(relation.noPolyDescription, fallbackDerived),
          assumption: componentAssumption(relation.noPolyDescription as DescriptionComponent & { assumption?: string } | undefined, relation.assumption),
          refs: componentRefs(relation.noPolyDescription, fallbackRefs),
          key: `${baseKey}:no-poly`,
          label: `${baseLabel} no polynomial`
        },
        {
          category: 'edges',
          state: 'closed',
          derived: componentDerived(relation.quasiDescription, fallbackDerived),
          assumption: componentAssumption(relation.quasiDescription as DescriptionComponent & { assumption?: string } | undefined, relation.assumption),
          refs: componentRefs(relation.quasiDescription, fallbackRefs),
          key: `${baseKey}:quasi`,
          label: `${baseLabel} quasipolynomial`
        }
      ];
    case 'no-quasi':
      return [
        { category: 'edges', state: 'closed', derived: fallbackDerived, assumption: relation.assumption, refs: fallbackRefs, key: `${baseKey}:no-poly`, label: `${baseLabel} no polynomial` },
        { category: 'edges', state: 'closed', derived: fallbackDerived, assumption: relation.assumption, refs: fallbackRefs, key: `${baseKey}:no-quasi`, label: `${baseLabel} no quasipolynomial` }
      ];
    case 'unknown-poly-quasi':
      return [
        { category: 'edges', state: 'open', derived: false, refs: [], key: `${baseKey}:poly`, label: `${baseLabel} polynomial` },
        {
          category: 'edges',
          state: 'closed',
          derived: componentDerived(relation.quasiDescription, fallbackDerived),
          assumption: componentAssumption(relation.quasiDescription as DescriptionComponent & { assumption?: string } | undefined, relation.assumption),
          refs: componentRefs(relation.quasiDescription, fallbackRefs),
          key: `${baseKey}:quasi`,
          label: `${baseLabel} quasipolynomial`
        }
      ];
    case 'no-poly-unknown-quasi':
      return [
        {
          category: 'edges',
          state: 'closed',
          derived: componentDerived(relation.noPolyDescription, fallbackDerived),
          assumption: componentAssumption(relation.noPolyDescription as DescriptionComponent & { assumption?: string } | undefined, relation.assumption),
          refs: componentRefs(relation.noPolyDescription, fallbackRefs),
          key: `${baseKey}:no-poly`,
          label: `${baseLabel} no polynomial`
        },
        { category: 'edges', state: 'open', derived: false, refs: [], key: `${baseKey}:quasi`, label: `${baseLabel} quasipolynomial` }
      ];
    default:
      return [
        { category: 'edges', state: 'open', derived: false, refs: [], key: `${baseKey}:poly`, label: `${baseLabel} polynomial` },
        { category: 'edges', state: 'open', derived: false, refs: [], key: `${baseKey}:quasi`, label: `${baseLabel} quasipolynomial` }
      ];
  }
}

function operationClaimUnit(
  category: 'queries' | 'transformations',
  support: KCOpSupport | undefined,
  language: KCLanguage,
  opCode: string
): ClaimUnit {
  const state: ClaimState = operationCellState(support) === 'closed' ? 'closed' : 'open';
  return {
    category,
    state,
    derived: support?.derived === true,
    assumption: support?.assumption,
    refs: support?.refs ?? [],
    key: `${category}:${language.id}:${opCode}`,
    label: `${language.name}.${opCode}`,
    batchId: support?.batchId
  };
}

function collectClaimUnits(database: DatabaseSchema): ClaimUnit[] {
  const names = languageNameById(database);
  const units: ClaimUnit[] = [];
  const languageIds = database.adjacencyMatrix.languageIds;
  const queryCodes = getOperationCodes(database, 'queries');
  const transformationCodes = getOperationCodes(database, 'transformations');

  for (let sourceIdx = 0; sourceIdx < languageIds.length; sourceIdx += 1) {
    for (let targetIdx = 0; targetIdx < languageIds.length; targetIdx += 1) {
      if (sourceIdx === targetIdx) continue;
      const relation = database.adjacencyMatrix.matrix[sourceIdx]?.[targetIdx] ?? null;
      units.push(...edgeClaimUnits(relation, languageIds[sourceIdx], languageIds[targetIdx], names));
    }
  }

  for (const language of database.languages) {
    for (const opCode of queryCodes) {
      units.push(operationClaimUnit('queries', language.properties?.queries?.[opCode], language, opCode));
    }
    for (const opCode of transformationCodes) {
      units.push(operationClaimUnit('transformations', language.properties?.transformations?.[opCode], language, opCode));
    }
  }

  return units;
}

function emptyCoverageStats(cells: number, possibleClaims: number): CoverageStats {
  return {
    cells,
    closedCells: 0,
    partiallyOpenCells: 0,
    openCells: 0,
    possibleClaims,
    closedClaims: 0,
    openClaims: 0,
    automaticProofsWritten: 0,
    manuallyInputtedClaims: 0,
    assumedClaims: 0,
    unconditionalClaims: 0
  };
}

function summarizeCoverage(database: DatabaseSchema, units: ClaimUnit[]): Record<Category | 'combined', CoverageStats> {
  const languageCount = database.languages.length;
  const edgeCellCount = languageCount * (languageCount - 1);
  const queryCellCount = languageCount * getOperationCodes(database, 'queries').length;
  const transformationCellCount = languageCount * getOperationCodes(database, 'transformations').length;
  const byCategory: Record<Category | 'combined', CoverageStats> = {
    edges: emptyCoverageStats(edgeCellCount, edgeCellCount * 2),
    queries: emptyCoverageStats(queryCellCount, queryCellCount),
    transformations: emptyCoverageStats(transformationCellCount, transformationCellCount),
    combined: emptyCoverageStats(edgeCellCount + queryCellCount + transformationCellCount, edgeCellCount * 2 + queryCellCount + transformationCellCount)
  };

  const languageIds = database.adjacencyMatrix.languageIds;
  for (let sourceIdx = 0; sourceIdx < languageIds.length; sourceIdx += 1) {
    for (let targetIdx = 0; targetIdx < languageIds.length; targetIdx += 1) {
      if (sourceIdx === targetIdx) continue;
      const state = edgeCellState(database.adjacencyMatrix.matrix[sourceIdx]?.[targetIdx] ?? null);
      incrementCellState(byCategory.edges, state);
      incrementCellState(byCategory.combined, state);
    }
  }

  for (const language of database.languages) {
    for (const opCode of getOperationCodes(database, 'queries')) {
      const state = operationCellState(language.properties?.queries?.[opCode]);
      incrementCellState(byCategory.queries, state);
      incrementCellState(byCategory.combined, state);
    }
    for (const opCode of getOperationCodes(database, 'transformations')) {
      const state = operationCellState(language.properties?.transformations?.[opCode]);
      incrementCellState(byCategory.transformations, state);
      incrementCellState(byCategory.combined, state);
    }
  }

  for (const unit of units) {
    const targets = [byCategory[unit.category], byCategory.combined];
    for (const stats of targets) {
      if (unit.state === 'closed') {
        stats.closedClaims += 1;
        if (unit.derived) stats.automaticProofsWritten += 1;
        else stats.manuallyInputtedClaims += 1;
        if (unit.assumption) stats.assumedClaims += 1;
        else stats.unconditionalClaims += 1;
      } else {
        stats.openClaims += 1;
      }
    }
  }

  return byCategory;
}

function incrementCellState(stats: CoverageStats, state: CellState): void {
  if (state === 'closed') stats.closedCells += 1;
  else if (state === 'partially-open') stats.partiallyOpenCells += 1;
  else stats.openCells += 1;
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function summarizeDerivedPercentage(coverage: Record<Category | 'combined', CoverageStats>): Record<Category | 'combined', number> {
  return {
    edges: percentage(coverage.edges.automaticProofsWritten, coverage.edges.closedClaims),
    queries: percentage(coverage.queries.automaticProofsWritten, coverage.queries.closedClaims),
    transformations: percentage(coverage.transformations.automaticProofsWritten, coverage.transformations.closedClaims),
    combined: percentage(coverage.combined.automaticProofsWritten, coverage.combined.closedClaims)
  };
}

function cellKeyFromClaimUnit(unit: ClaimUnit): string {
  if (unit.category === 'edges') return unit.key.replace(/:(poly|quasi|no-poly|no-quasi)$/u, '');
  return unit.key;
}

function removeDerivedEdges(matrix: KCAdjacencyMatrix): void {
  for (let i = 0; i < matrix.languageIds.length; i += 1) {
    for (let j = 0; j < matrix.languageIds.length; j += 1) {
      const edge = matrix.matrix[i]?.[j] ?? null;
      if (!edge) continue;

      if (edge.status === 'no-poly-quasi' && (edge.noPolyDescription || edge.quasiDescription)) {
        const noPolyDerived = edge.noPolyDescription?.derived ?? true;
        const quasiDerived = edge.quasiDescription?.derived ?? true;
        if (noPolyDerived && quasiDerived) {
          matrix.matrix[i][j] = null;
        } else if (noPolyDerived && !quasiDerived) {
          matrix.matrix[i][j] = {
            status: 'unknown-poly-quasi',
            description: edge.quasiDescription!.description,
            refs: edge.quasiDescription!.refs,
            hidden: false,
            derived: false
          };
        } else if (!noPolyDerived && quasiDerived) {
          matrix.matrix[i][j] = {
            status: 'no-poly-unknown-quasi',
            description: edge.noPolyDescription!.description,
            refs: edge.noPolyDescription!.refs,
            hidden: false,
            derived: false
          };
        }
      } else if (edge.derived === true) {
        matrix.matrix[i][j] = null;
      }
    }
  }
}

function removeDerivedOperations(languages: KCLanguage[]): void {
  for (const language of languages) {
    for (const category of ['queries', 'transformations'] as const) {
      const supports = language.properties?.[category];
      if (!supports) continue;
      for (const [opCode, support] of Object.entries(supports)) {
        if (support.derived === true) {
          supports[opCode] = { complexity: 'unknown-to-us', refs: [] };
        }
      }
    }
  }
}

function stripDerived(database: DatabaseSchema): DatabaseSchema {
  const stripped = deepClone(database);
  removeDerivedEdges(stripped.adjacencyMatrix);
  removeDerivedOperations(stripped.languages);
  return stripped;
}

function propagateStrippedDatabase(database: DatabaseSchema): DatabaseSchema {
  const graphData = buildGraphData(deepClone(database));
  const originalLog = console.log;
  console.log = () => {};
  try {
    const propagated = propagateImplicitRelations(graphData);
    const result = deepClone(database);
    result.languages = propagated.languages;
    result.adjacencyMatrix = propagated.adjacencyMatrix;
    return result;
  } finally {
    console.log = originalLog;
  }
}

function derivedClosedUnitKeys(database: DatabaseSchema): Set<string> {
  return new Set(
    collectClaimUnits(database)
      .filter((unit) => unit.state === 'closed' && unit.derived)
      .map((unit) => unit.key)
  );
}

function derivedClosedCellKeys(database: DatabaseSchema): Set<string> {
  return new Set(
    collectClaimUnits(database)
      .filter((unit) => unit.state === 'closed' && unit.derived)
      .map(cellKeyFromClaimUnit)
  );
}

function collectInfluenceCandidates(database: DatabaseSchema): InfluenceResult[] {
  const candidates: InfluenceResult[] = [];
  const names = languageNameById(database);
  const languageIds = database.adjacencyMatrix.languageIds;

  for (let i = 0; i < languageIds.length; i += 1) {
    for (let j = 0; j < languageIds.length; j += 1) {
      if (i === j) continue;
      const relation = database.adjacencyMatrix.matrix[i]?.[j] ?? null;
      if (!relation || relation.derived === true) continue;
      candidates.push({
        kind: 'edge',
        key: `edge:${languageIds[i]}->${languageIds[j]}`,
        label: `${names.get(languageIds[i]) ?? languageIds[i]} -> ${names.get(languageIds[j]) ?? languageIds[j]} (${relation.status})`,
        lostDerivedClaims: 0,
        lostDerivedCells: 0
      });
    }
  }

  for (const language of database.languages) {
    for (const category of ['queries', 'transformations'] as const) {
      const supports = language.properties?.[category] ?? {};
      for (const [opCode, support] of Object.entries(supports)) {
        if (support.derived === true || support.batchId) continue;
        if (operationCellState(support) !== 'closed') continue;
        candidates.push({
          kind: category === 'queries' ? 'query' : 'transformation',
          key: `${category}:${language.id}:${opCode}`,
          label: `${language.name}.${opCode} (${support.complexity})`,
          lostDerivedClaims: 0,
          lostDerivedCells: 0
        });
      }
    }
  }

  for (const batch of database.batchClaims ?? []) {
    candidates.push({
      kind: 'batch',
      key: `batch:${batch.id}`,
      label: `${batch.id} (${batch.opType}.${batch.op} = ${batch.status})`,
      lostDerivedClaims: 0,
      lostDerivedCells: 0
    });
  }

  return candidates;
}

function removeCandidate(database: DatabaseSchema, candidate: InfluenceResult): DatabaseSchema {
  const modified = deepClone(database);

  if (candidate.kind === 'edge') {
    const match = /^edge:(.+)->(.+)$/u.exec(candidate.key);
    if (!match) throw new Error(`Invalid edge candidate key: ${candidate.key}`);
    const sourceIdx = modified.adjacencyMatrix.languageIds.indexOf(match[1]);
    const targetIdx = modified.adjacencyMatrix.languageIds.indexOf(match[2]);
    if (sourceIdx >= 0 && targetIdx >= 0) modified.adjacencyMatrix.matrix[sourceIdx][targetIdx] = null;
    return modified;
  }

  if (candidate.kind === 'query' || candidate.kind === 'transformation') {
    const [category, languageId, opCode] = candidate.key.split(':') as [OperationCategory, string, string];
    const language = modified.languages.find((item) => item.id === languageId);
    if (language?.properties?.[category]) {
      language.properties[category]![opCode] = { complexity: 'unknown-to-us', refs: [] };
    }
    return modified;
  }

  const batchId = candidate.key.slice('batch:'.length);
  modified.batchClaims = (modified.batchClaims ?? []).filter((batch) => batch.id !== batchId);
  for (const language of modified.languages) {
    for (const category of ['queries', 'transformations'] as const) {
      const supports = language.properties?.[category] ?? {};
      for (const [opCode, support] of Object.entries(supports)) {
        if (support.batchId === batchId) {
          supports[opCode] = { complexity: 'unknown-to-us', refs: [] };
        }
      }
    }
  }
  return modified;
}

function summarizeInfluence(database: DatabaseSchema, top: number, limit: number | undefined): Report['influence'] {
  const startedAt = Date.now();
  console.error('Influence simulation: stripping derived claims and rebuilding baseline...');
  const strippedBase = stripDerived(database);
  const baseline = propagateStrippedDatabase(strippedBase);
  const baselineDerivedClaims = derivedClosedUnitKeys(baseline);
  const baselineDerivedCells = derivedClosedCellKeys(baseline);
  const candidates = collectInfluenceCandidates(strippedBase).slice(0, limit);
  const results: InfluenceResult[] = [];
  console.error(
    `Influence simulation: baseline has ${formatCount(baselineDerivedClaims.size)} derived claim units ` +
      `across ${formatCount(baselineDerivedCells.size)} cells. Evaluating ${formatCount(candidates.length)} candidates.`
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const removed = removeCandidate(strippedBase, candidate);
    try {
      const propagated = propagateStrippedDatabase(removed);
      const nextDerivedClaims = derivedClosedUnitKeys(propagated);
      const nextDerivedCells = derivedClosedCellKeys(propagated);
      let lostDerivedClaims = 0;
      let lostDerivedCells = 0;

      for (const key of baselineDerivedClaims) {
        if (!nextDerivedClaims.has(key)) lostDerivedClaims += 1;
      }
      for (const key of baselineDerivedCells) {
        if (!nextDerivedCells.has(key)) lostDerivedCells += 1;
      }

      results.push({ ...candidate, lostDerivedClaims, lostDerivedCells });
    } catch (error) {
      results.push({
        ...candidate,
        contradiction: error instanceof Error ? error.message : String(error)
      });
    }
    reportInfluenceProgress(index + 1, candidates.length, startedAt, results);
  }

  const sorted = results
    .filter((result) => !result.contradiction)
    .sort((a, b) => b.lostDerivedClaims - a.lostDerivedClaims || b.lostDerivedCells - a.lostDerivedCells || a.label.localeCompare(b.label));

  return {
    candidatesEvaluated: results.length,
    candidatesWithContradictions: results.filter((result) => result.contradiction).length,
    top: sorted.slice(0, top)
  };
}

function buildReport(database: DatabaseSchema, args: Args): Report {
  const units = collectClaimUnits(database);
  const coverage = summarizeCoverage(database, units);
  return {
    coverage,
    derivedPercentageByCategory: summarizeDerivedPercentage(coverage),
    ...(args.influence ? { influence: summarizeInfluence(database, args.top, args.influenceLimit) } : {})
  };
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function bestInfluenceResult(results: InfluenceResult[]): InfluenceResult | undefined {
  return results
    .filter((result) => !result.contradiction)
    .sort((a, b) => b.lostDerivedClaims - a.lostDerivedClaims || b.lostDerivedCells - a.lostDerivedCells || a.label.localeCompare(b.label))[0];
}

function reportInfluenceProgress(done: number, total: number, startTime: number, results: InfluenceResult[]): void {
  const elapsed = Date.now() - startTime;
  const averageMs = elapsed / Math.max(done, 1);
  const remaining = total - done;
  const best = bestInfluenceResult(results);
  const bestText = best
    ? `best: ${formatCount(best.lostDerivedClaims)} claims, ${formatCount(best.lostDerivedCells)} cells (${best.label})`
    : 'best: none yet';

  console.error(
    `Influence simulation: ${formatCount(done)}/${formatCount(total)} ` +
      `(${percentage(done, total)}%) | elapsed ${formatDuration(elapsed)} | ` +
      `avg ${(averageMs / 1000).toFixed(1)}s/test | ETA ${formatDuration(averageMs * remaining)} | ${bestText}`
  );
}

function printCoverage(label: string, stats: CoverageStats, derivedPct: number): void {
  console.log(`${label}`);
  console.log(`  Cells: ${formatCount(stats.cells)} (${formatCount(stats.closedCells)} closed, ${formatCount(stats.partiallyOpenCells)} partially open, ${formatCount(stats.openCells)} open)`);
  console.log(`  Claim units: ${formatCount(stats.possibleClaims)} total, ${formatCount(stats.closedClaims)} closed, ${formatCount(stats.openClaims)} open (${percentage(stats.closedClaims, stats.possibleClaims)}% filled)`);
  console.log(`  Automatic proofs written: ${formatCount(stats.automaticProofsWritten)} (${derivedPct}% of closed claim units)`);
  console.log(`  Manually inputted claims: ${formatCount(stats.manuallyInputtedClaims)}`);
  console.log(`  Conditional closed claims: ${formatCount(stats.assumedClaims)}; unconditional: ${formatCount(stats.unconditionalClaims)}`);
}

function printRankedTable<T>(
  title: string,
  rows: T[],
  top: number,
  render: (row: T, index: number) => string
): void {
  console.log(`\n${title}`);
  const shown = rows.slice(0, top);
  if (shown.length === 0) {
    console.log('  None');
    return;
  }
  shown.forEach((row, index) => console.log(render(row, index)));
}

function printTextReport(database: DatabaseSchema, report: Report, args: Args): void {
  console.log('=== Database Stats ===\n');
  console.log(`Languages: ${formatCount(database.languages.length)}`);
  console.log(`Succinctness relations: ${formatCount(report.coverage.edges.cells)} (n * (n - 1), excluding diagonal)`);
  console.log(`Query cells: ${formatCount(report.coverage.queries.cells)}`);
  console.log(`Transformation cells: ${formatCount(report.coverage.transformations.cells)}\n`);

  printCoverage('Edges', report.coverage.edges, report.derivedPercentageByCategory.edges);
  console.log();
  printCoverage('Queries', report.coverage.queries, report.derivedPercentageByCategory.queries);
  console.log();
  printCoverage('Transformations', report.coverage.transformations, report.derivedPercentageByCategory.transformations);
  console.log();
  printCoverage('Combined', report.coverage.combined, report.derivedPercentageByCategory.combined);

  if (report.influence) {
    console.log(`\nInfluence Simulation`);
    console.log(`  Candidates evaluated: ${formatCount(report.influence.candidatesEvaluated)}`);
    console.log(`  Candidates with contradictions: ${formatCount(report.influence.candidatesWithContradictions)}`);
    printRankedTable(
      'World Records: Full Repropagation Cascades',
      report.influence.top,
      args.top,
      (row, index) => `  ${index + 1}. ${row.label} [${row.kind}]: ${formatCount(row.lostDerivedClaims)} derived claim units disappear across ${formatCount(row.lostDerivedCells)} cells`
    );
  } else {
    console.log('\nInfluence Simulation: skipped (run with --influence)');
  }
}

function main(): void {
  const args = parseArgs();
  const database = loadDatabase();
  const report = buildReport(database, args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(database, report, args);
  }
}

main();
