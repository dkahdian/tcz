import type { DirectedSuccinctnessRelation, EdgeFilter, GraphData } from '../../types.js';
import { mapRelationsInDataset, mapLanguagesInDataset } from '../transforms.js';
import { applyTransitiveReduction } from './transitive-filters.js';

/**
 * A classifier function that determines if an edge matches a certain criterion.
 * Returns true if the edge matches (should be considered for hiding), false otherwise.
 * A null relation is treated as matching (i.e., absence of an edge counts as matching the criterion).
 */
type EdgeClassifier = (relation: DirectedSuccinctnessRelation | null) => boolean;

/**
 * Creates an edge filter that hides edge pairs where BOTH directions match the classifier.
 * For an edge A<->B, we hide the edge IFF:
 * - A->B matches the classifier (or is null)
 * - B->A matches the classifier (or is null)
 * 
 * This ensures we only hide edges where both directions satisfy the condition.
 */
function createPairwiseOmitFilter(
  classifier: EdgeClassifier,
  data: GraphData
): (relation: DirectedSuccinctnessRelation | null, sourceId: string, targetId: string) => DirectedSuccinctnessRelation | null {
  const { indexByLanguage, matrix } = data.adjacencyMatrix;
  
  return (relation, sourceId, targetId) => {
    if (!relation) return null;
    
    // Check if this direction matches the classifier
    const forwardMatches = classifier(relation);
    
    // Get the reverse direction
    const sourceIdx = indexByLanguage[sourceId];
    const targetIdx = indexByLanguage[targetId];
    if (sourceIdx === undefined || targetIdx === undefined) return relation;
    
    const reverse = matrix[targetIdx]?.[sourceIdx] ?? null;
    const reverseMatches = classifier(reverse);
    
    // Only hide if BOTH directions match (or are null)
    if (forwardMatches && reverseMatches) {
      return null;
    }
    
    return relation;
  };
}

/**
 * Control whether quasipolynomial distinctions are displayed.
 */
export const polyDisplay: EdgeFilter<boolean> = {
  id: 'poly-display',
  name: 'Show quasipolynomial succinctness relations',
  description: 'Show quasipolynomial distinctions instead of collapsing succinctness to polynomial vs not polynomial',
  applicableViews: ['graph', 'succinctness'],
  uiGroup: 'Display',
  kind: 'matrix-display',
  defaultParam: false,
  controlType: 'checkbox',
  lambda: (data, showQuasipolynomial) => {
    if (showQuasipolynomial === true) {
      return data;
    }
    let mapped = mapRelationsInDataset(data, (relation) => {
      if (!relation) return null;
      let newStatus = relation.status;
      switch (relation.status) {
        case 'poly':
          break;
        case 'no-poly-unknown-quasi':
        case 'no-poly-quasi':
        case 'no-quasi':
          newStatus = 'not-poly';
          break;
        case 'unknown-poly-quasi':
        case 'unknown-both':
          newStatus = 'unknown';
          break;
      }
      return newStatus === relation.status ? relation : { ...relation, status: newStatus };
    });

    // Keep operations views consistent with the succinctness collapse by mapping
    // quasi-level operation outcomes into a binary poly vs not-poly representation.
    mapped = mapLanguagesInDataset(mapped, (language) => {
      const collapseOpMap = (ops: Record<string, import('$lib/types.js').KCOpSupport> | undefined) => {
        const result: Record<string, import('$lib/types.js').KCOpSupport> = {};
        for (const [opCode, support] of Object.entries(ops ?? {})) {
          let newComplexity = support.complexity;
          switch (support.complexity) {
            case 'poly':
              break;
            case 'no-poly-unknown-quasi':
            case 'no-poly-quasi':
            case 'no-quasi':
              newComplexity = 'not-poly';
              break;
            case 'unknown-poly-quasi':
            case 'unknown-both':
              newComplexity = 'unknown';
              break;
          }
          result[opCode] =
            newComplexity === support.complexity
              ? support
              : { ...support, complexity: newComplexity };
        }
        return result;
      };

      return {
        ...language,
        properties: {
          ...language.properties,
          queries: collapseOpMap(language.properties.queries),
          transformations: collapseOpMap(language.properties.transformations)
        }
      };
    });

    // Also adjust complexity display definitions to match the collapsed view.
    // In this view, "poly" means "polytime" and should be rendered as \leq.
    const poly = mapped.complexities['poly'];
    if (poly) {
      mapped.complexities = {
        ...mapped.complexities,
        poly: {
          ...poly,
          notation: '$\\leq$'
        }
      };
    }

  return mapped;
  }
};

/**
 * Omit separator functions - always off, not user-facing
 */
export const omitSeparatorFunctions: EdgeFilter = {
  id: 'omit-separator-functions',
  name: 'Omit Separator Functions',
  description: 'Hide all separator functions from edges',
  applicableViews: ['graph', 'succinctness'],
  uiGroup: 'Advanced',
  kind: 'internal',
  // Locked on now that the UI toggle is gone.
  defaultParam: true,
  controlType: 'checkbox',
  hidden: true,
  lambda: (data, param) => {
    if (!param) return data;
    return mapRelationsInDataset(data, (relation) => {
      if (!relation) return null;
      if (relation.separatingFunctionIds && relation.separatingFunctionIds.length > 0) {
        return {
          ...relation,
          separatingFunctionIds: []
        };
      }
      return relation;
    });
  }
};

/**
 * Show incomparabilities - OFF BY DEFAULT
 *
 * When disabled, hides pairs where both directions are gaps, unknown, or null.
 * Uses the pairwise classifier: an edge pair A<->B is hidden IFF
 * both A->B and B->A are gap/unknown-like.
 */
export const omitIncomparable: EdgeFilter<boolean> = {
  id: 'omit-incomparable',
  name: 'Show incomparabilities',
  description: 'Show edges where both directions are gaps or unknown',
  applicableViews: ['graph'],
  uiGroup: 'Visibility',
  kind: 'edge-visibility',
  defaultParam: false,
  controlType: 'checkbox',
  lambda: (data, param) => {
    if (param) return data;
    
    const isIncomparable: EdgeClassifier = (rel) =>
      !rel ||
      rel.status === 'not-poly' ||
      rel.status === 'no-poly-unknown-quasi' ||
      rel.status === 'no-quasi' ||
      rel.status === 'unknown' ||
      rel.status === 'unknown-both';
    
    return mapRelationsInDataset(data, createPairwiseOmitFilter(isIncomparable, data));
  }
};

/**
 * Omit edges marked as hidden (used by transitive reduction)
 * This is an internal filter that should always be applied
 */
export const omitMarkedEdges: EdgeFilter = {
  id: 'omit-marked-edges',
  name: 'Omit Marked Edges',
  description: 'Omit edges that have been marked as hidden',
  applicableViews: ['graph', 'succinctness', 'queries', 'transforms'],
  uiGroup: 'Advanced',
  kind: 'internal',
  defaultParam: true,
  controlType: 'checkbox',
  hidden: true, // Internal filter, not shown in UI
  lambda: (data, param) => {
    if (!param) return data;
    const isMarkedHidden: EdgeClassifier = (rel) => !rel || rel.hidden === true;
    return mapRelationsInDataset(data, createPairwiseOmitFilter(isMarkedHidden, data));
  }
};

/**
 * Show transitive edges - OFF BY DEFAULT for graph view.
 *
 * When disabled, computes transitive reduction on the currently visible relation
 * graph and marks redundant edges hidden. This is intentionally independent of
 * proof provenance: explicit and derived edges are treated the same.
 */
export const omitImplicitEdges: EdgeFilter = {
  id: 'omit-implicit-edges',
  name: 'Show transitive edges',
  description: 'Show edges that are redundant by transitivity',
  applicableViews: ['graph'],
  uiGroup: 'Visibility',
  kind: 'edge-visibility',
  defaultParam: false,
  controlType: 'checkbox',
  lambda: (data, param) => {
    if (param) return data;
    return applyTransitiveReduction(data);
  }
};

type ImplicitEdgeTreatmentMode = 'gray';

/**
 * Implicit edge treatment.
 *
 * This is now an internal always-on gray styling pass rather than a user-facing
 * filter. It keeps derived edges visually distinct without exposing a control.
 */
export const implicitEdgeTreatment: EdgeFilter<ImplicitEdgeTreatmentMode> = {
  id: 'implicit-edge-treatment',
  name: 'Implicit Edge Treatment',
  description: 'Apply gray styling to implicit (derived) edges',
  applicableViews: ['graph', 'succinctness', 'queries', 'transforms'],
  uiGroup: 'Advanced',
  kind: 'internal',
  defaultParam: 'gray',
  defaultParamMatrix: 'gray',
  hidden: true,
  lambda: (data, mode) => {
    // Apply to succinctness edges
    let result = mapRelationsInDataset(data, (relation) => {
      if (!relation) return null;

      if (relation.derived) {
        return { ...relation, dimmed: true };
      }
      return relation;
    });

    // Apply to operations data (queries + transformations)
    result = mapLanguagesInDataset(result, (language) => {
      const mapOps = (ops: Record<string, import('$lib/types.js').KCOpSupport>) => {
        const mapped: Record<string, import('$lib/types.js').KCOpSupport> = {};
        for (const [code, support] of Object.entries(ops)) {
          if (support.derived) {
            mapped[code] = { ...support, dimmed: true };
          } else {
            mapped[code] = support;
          }
        }
        return mapped;
      };
      return {
        ...language,
        properties: {
          ...language.properties,
          queries: mapOps(language.properties.queries ?? {}),
          transformations: mapOps(language.properties.transformations ?? {})
        }
      };
    });

    return result;
  }
};

export const edgeFilters: EdgeFilter<any>[] = [
  polyDisplay,
  omitIncomparable,
  omitImplicitEdges,
  implicitEdgeTreatment,
  omitSeparatorFunctions,
  omitMarkedEdges
];
