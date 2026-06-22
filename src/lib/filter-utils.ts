import type { 
  GraphData, 
  LanguageFilter, 
  EdgeFilter,
  FilteredGraphData, 
  FilterStateMap, 
  FilterParamValue,
  KCAdjacencyMatrix,
  ViewMode,
  LanguageVisibilityParam
} from './types.js';
import { transformData } from './data/transforms.js';
import { QUERIES, TRANSFORMATIONS } from './data/operations.js';

type AnyFilter = LanguageFilter | EdgeFilter;

function isLockedInternalFilter(filter: AnyFilter): boolean {
  return filter.hidden === true || filter.kind === 'internal';
}

/**
 * Check if view mode is a matrix-based view (succinctness, queries, or transforms)
 */
function isMatrixView(viewMode: ViewMode): boolean {
  return viewMode === 'succinctness' || viewMode === 'queries' || viewMode === 'transforms';
}

/**
 * Get the default param for a filter based on view mode.
 * Uses defaultParamMatrix if defined and mode is a matrix view, otherwise defaultParam.
 */
export function getFilterDefault(filter: AnyFilter, viewMode: ViewMode = 'graph'): FilterParamValue {
  if (isMatrixView(viewMode) && filter.defaultParamMatrix !== undefined) {
    return filter.defaultParamMatrix;
  }
  return filter.defaultParam;
}

function isLanguageVisibilityParam(value: FilterParamValue): value is LanguageVisibilityParam {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mode' in value &&
    'ids' in value &&
    Array.isArray((value as LanguageVisibilityParam).ids)
  );
}

function normalizeFilterValue(value: FilterParamValue): FilterParamValue {
  if (!isLanguageVisibilityParam(value)) {
    return value;
  }

  const uniqueSortedIds = Array.from(new Set(value.ids)).sort();
  return {
    mode: value.mode,
    ids: uniqueSortedIds,
    hiddenQueryIds: Array.from(new Set(value.hiddenQueryIds ?? [])).sort(),
    hiddenTransformationIds: Array.from(new Set(value.hiddenTransformationIds ?? [])).sort(),
    graphQueryIds: Array.from(new Set(value.graphQueryIds ?? [])).sort(),
    graphTransformationIds: Array.from(new Set(value.graphTransformationIds ?? [])).sort()
  };
}

export function areFilterValuesEqual(a: FilterParamValue, b: FilterParamValue): boolean {
  const normalizedA = normalizeFilterValue(a);
  const normalizedB = normalizeFilterValue(b);

  if (isLanguageVisibilityParam(normalizedA) && isLanguageVisibilityParam(normalizedB)) {
    return (
      normalizedA.mode === normalizedB.mode &&
      normalizedA.ids.length === normalizedB.ids.length &&
      normalizedA.ids.every((id, index) => id === normalizedB.ids[index]) &&
      (normalizedA.hiddenQueryIds ?? []).length === (normalizedB.hiddenQueryIds ?? []).length &&
      (normalizedA.hiddenQueryIds ?? []).every((id, index) => id === (normalizedB.hiddenQueryIds ?? [])[index]) &&
      (normalizedA.hiddenTransformationIds ?? []).length === (normalizedB.hiddenTransformationIds ?? []).length &&
      (normalizedA.hiddenTransformationIds ?? []).every(
        (id, index) => id === (normalizedB.hiddenTransformationIds ?? [])[index]
      ) &&
      (normalizedA.graphQueryIds ?? []).length === (normalizedB.graphQueryIds ?? []).length &&
      (normalizedA.graphQueryIds ?? []).every((id, index) => id === (normalizedB.graphQueryIds ?? [])[index]) &&
      (normalizedA.graphTransformationIds ?? []).length === (normalizedB.graphTransformationIds ?? []).length &&
      (normalizedA.graphTransformationIds ?? []).every(
        (id, index) => id === (normalizedB.graphTransformationIds ?? [])[index]
      )
    );
  }

  return normalizedA === normalizedB;
}

export function isFilterApplicable(filter: AnyFilter, viewMode: ViewMode): boolean {
  return filter.applicableViews.includes(viewMode);
}

export function getApplicableFiltersForView<T extends AnyFilter>(filters: T[], viewMode: ViewMode): T[] {
  return filters.filter((filter) => isFilterApplicable(filter, viewMode));
}

export function getVisibleFiltersForView<T extends AnyFilter>(filters: T[], viewMode: ViewMode): T[] {
  return filters.filter(
    (filter) =>
      isFilterApplicable(filter, viewMode) &&
      !filter.hidden &&
      filter.kind !== 'internal'
  );
}

/**
 * Filter deltas: only the user's changes from defaults.
 * These are view-mode-agnostic and persist across view switches.
 */
export type FilterDeltas = Map<string, FilterParamValue>;

/**
 * Compute effective filter state for a given view mode by merging
 * defaults for that view mode with user deltas.
 */
export function computeEffectiveFilterState(
  languageFilters: LanguageFilter[],
  edgeFilters: EdgeFilter[],
  viewMode: ViewMode,
  deltas: FilterDeltas
): FilterStateMap {
  const stateMap: FilterStateMap = new Map();
  const allFilters: AnyFilter[] = [...languageFilters, ...edgeFilters];

  for (const filter of allFilters) {
    const defaultVal = getFilterDefault(filter, viewMode);
    // Hidden/internal filters are source-of-truth defaults only.
    const value = isLockedInternalFilter(filter)
      ? defaultVal
      : (deltas.has(filter.id) ? deltas.get(filter.id)! : defaultVal);
    stateMap.set(filter.id, value);
  }

  return stateMap;
}

/**
 * Extract deltas from a full filter state map by comparing against defaults.
 * Used for migrating from old storage format to new deltas format.
 * 
 * NOTE: We compare against ALL view modes' defaults. A value is only
 * considered a delta if it differs from the graph-mode default
 * (the canonical "base" default).
 */
export function extractDeltasFromState(
  filterStates: FilterStateMap,
  languageFilters: LanguageFilter[],
  edgeFilters: EdgeFilter[]
): FilterDeltas {
  const deltas: FilterDeltas = new Map();
  const allFilters: AnyFilter[] = [...languageFilters, ...edgeFilters];

  for (const filter of allFilters) {
    if (isLockedInternalFilter(filter)) continue;
    const currentValue = filterStates.get(filter.id);
    if (currentValue === undefined) continue;
    
    // Compare against graph-mode default (canonical base default)
    const graphDefault = getFilterDefault(filter, 'graph');
    if (!areFilterValuesEqual(currentValue, graphDefault)) {
      deltas.set(filter.id, currentValue);
    }
  }

  return deltas;
}

/**
 * Update deltas when the user changes a filter value.
 * If the new value matches the graph-mode default, remove the delta.
 * Otherwise, store/update the delta.
 */
export function updateDelta(
  deltas: FilterDeltas,
  filterId: string,
  value: FilterParamValue,
  filter: AnyFilter,
  viewMode: ViewMode = 'graph'
): FilterDeltas {
  if (isLockedInternalFilter(filter)) {
    return deltas;
  }

  const newDeltas = new Map(deltas);
  const viewDefault = getFilterDefault(filter, viewMode);
  
  if (areFilterValuesEqual(value, viewDefault)) {
    newDeltas.delete(filterId);
  } else {
    newDeltas.set(filterId, value);
  }
  
  return newDeltas;
}

/**
 * Applies filters using their parameter values from the filter state map.
 * Pipeline:
 * 1. Apply all node/language filters
 * 2. Remove edges connected to hidden nodes
 * 3. Apply all edge filters
 */
export function applyFiltersWithParams(
  graphData: GraphData, 
  languageFilters: LanguageFilter[],
  edgeFilters: EdgeFilter[],
  filterStates: FilterStateMap,
  viewMode: ViewMode = 'graph'
): FilteredGraphData {
  const applicableLanguageFilters = getApplicableFiltersForView(languageFilters, viewMode);
  const applicableEdgeFilters = getApplicableFiltersForView(edgeFilters, viewMode);
  const transformStage = (current: GraphData, filter: LanguageFilter | EdgeFilter) => {
    const param = filterStates.get(filter.id) ?? filter.defaultParam;
    const result = transformData(current, (data) => filter.lambda(data, param as any)) ?? current;
    return result;
  };

  const applyStageList = (
    current: GraphData,
    filters: Array<LanguageFilter | EdgeFilter>
  ): GraphData => {
    return filters.reduce<GraphData>((working, filter) => transformStage(working, filter), current);
  };

  const afterLanguageFilters = applyStageList(graphData, applicableLanguageFilters);
  const afterEdgeFilters = applyStageList(afterLanguageFilters, applicableEdgeFilters);

  const visibleLanguageIds = new Set(afterEdgeFilters.languages.map((language) => language.id));
  const visibleEdgeIds = collectVisibleEdgeIds(afterEdgeFilters.adjacencyMatrix);
  const visibleQueryIds = new Set(afterEdgeFilters.operationVisibility?.queryIds ?? Object.keys(QUERIES));
  const visibleTransformationIds = new Set(
    afterEdgeFilters.operationVisibility?.transformationIds ?? Object.keys(TRANSFORMATIONS)
  );

  return {
    ...afterEdgeFilters,
    visibleLanguageIds,
    visibleEdgeIds,
    visibleQueryIds,
    visibleTransformationIds
  };
}

/**
 * Collect visible edge IDs from the adjacency matrix.
 */
function collectVisibleEdgeIds(matrix: KCAdjacencyMatrix): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < matrix.languageIds.length; i += 1) {
    for (let j = 0; j < matrix.languageIds.length; j += 1) {
      if (matrix.matrix[i][j]) {
        ids.add(`${matrix.languageIds[i]}->${matrix.languageIds[j]}`);
      }
    }
  }
  return ids;
}

/**
 * @deprecated Use computeEffectiveFilterState + FilterDeltas instead.
 * Creates initial filter state map with all filters set to their defaults for a given view mode
 */
export function createDefaultFilterState(
  languageFilters: LanguageFilter[],
  edgeFilters: EdgeFilter[] = [],
  viewMode: ViewMode = 'graph'
): FilterStateMap {
  return computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, new Map());
}

/**
 * @deprecated Use computeEffectiveFilterState + FilterDeltas instead.
 * Adjusts filter states when switching view modes.
 */
export function adjustFilterStateForViewMode(
  currentStates: FilterStateMap,
  languageFilters: LanguageFilter[],
  edgeFilters: EdgeFilter[],
  _fromMode: ViewMode,
  toMode: ViewMode
): FilterStateMap {
  const deltas = extractDeltasFromState(currentStates, languageFilters, edgeFilters);
  return computeEffectiveFilterState(languageFilters, edgeFilters, toMode, deltas);
}
