import type { LanguageFilter, GraphData } from '../../types.js';
import { QUERIES, TRANSFORMATIONS } from '../operations.js';
import { mapLanguagesInDataset } from '../transforms.js';
import { getOperationTractabilityDisplay } from '../../utils/operation-tractability.js';

/**
 * Helper function to create visualization filters for queries and transformations.
 * Adds tractability symbols and operation codes to node labels (vertically stacked).
 */
export function createOperationVisualizer(
  code: string,
  type: 'query' | 'transformation'
): (data: GraphData, param: boolean) => GraphData {
  return (data: GraphData, param: boolean) => {
    if (!param) return data;
    return mapLanguagesInDataset(data, (language) => {
      const operationDefs = type === 'query' ? QUERIES : TRANSFORMATIONS;
      const supportMap = type === 'query'
        ? language.properties.queries
        : language.properties.transformations;
      const entry = Object.entries(operationDefs).find(
        ([safeKey, opDef]) => safeKey === code || opDef.code === code
      );
      if (!entry) return language;

      const [safeKey, opDef] = entry;
      const support = supportMap?.[safeKey] ?? supportMap?.[opDef.code];
      if (!support) return language;

      const display = getOperationTractabilityDisplay(support);
      const suffix = `\n${display.graphSymbol} ${code}`;

      return {
        ...language,
        visual: {
          ...language.visual,
          labelSuffix: (language.visual?.labelSuffix || '') + suffix
        }
      };
    });
  };
}

/**
 * Creates a hidden filter that normalizes operation data by resolving safe keys to operation codes.
 * Only includes operations that have explicit data in the source; missing operations stay absent
 * (rendered as blank cells in the matrix).
 */
export function createFillUnknownOperationsFilter(): LanguageFilter {
  return {
    id: 'fill-unknown-operations',
    name: 'Fill Unknown Operations',
    description: 'Normalizes operation keys without adding unknown entries',
    applicableViews: ['graph', 'succinctness', 'queries', 'transforms'],
    uiGroup: 'Advanced',
    kind: 'internal',
    hidden: true, // This is an internal filter - not shown in UI
    defaultParam: true,
    lambda: (data: GraphData, param: boolean) => {
      if (!param) return data;
      return mapLanguagesInDataset(data, (language) => {
        const normalizeOps = (
          supportMap: Record<string, any> | undefined,
          operationDefs: Record<string, any>
        ): Record<string, any> => {
          const result: Record<string, any> = {};
          if (!supportMap) return result;

          for (const [safeKey, opDef] of Object.entries(operationDefs)) {
            const support = supportMap[safeKey] || supportMap[opDef.code];
            if (support) {
              result[opDef.code] = {
                complexity: support.complexity,
                ...(support.assumption && { assumption: support.assumption }),
                refs: support.refs ?? [],
                ...(support.description && { description: support.description }),
                ...(support.derived != null && { derived: support.derived }),
                ...(support.dimmed != null && { dimmed: support.dimmed }),
                ...(support.explicit != null && { explicit: support.explicit })
              };
            }
          }
          return result;
        };

        return {
          ...language,
          properties: {
            queries: normalizeOps(language.properties.queries, QUERIES),
            transformations: normalizeOps(language.properties.transformations, TRANSFORMATIONS)
          }
        };
      });
    }
  };
}
