// Export all filter modules
export { languageVisibilityFilter } from './language-scope-filters.js';
export { queryVisualizationFilters } from './query-visualizations.js';
export { transformationVisualizationFilters } from './transformation-visualizations.js';
export { edgeFilters } from './edge-filters.js';
export { 
  createOperationVisualizer, 
  createFillUnknownOperationsFilter 
} from './helpers.js';

// Convenience array of all predefined filters (excluding dynamic language selection filters)
import { languageVisibilityFilter } from './language-scope-filters.js';
import { createFillUnknownOperationsFilter } from './helpers.js';
import type { LanguageFilter } from '../../types.js';

export const allPredefinedFilters: LanguageFilter<any>[] = [
  languageVisibilityFilter,
  createFillUnknownOperationsFilter() // Hidden internal filter
];
