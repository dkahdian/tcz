import type { EdgeFilter, GraphData, LanguageFilter } from '../types.js';
import { canonicalDataset } from './canonical.js';
import { allPredefinedFilters, edgeFilters } from './filters/index.js';

// Export main GraphData object
export const initialGraphData: GraphData = canonicalDataset;

// Export all language filters
export function getAllLanguageFilters(): LanguageFilter[] {
  return [...allPredefinedFilters];
}

// Export all edge filters
export function getAllEdgeFilters(): EdgeFilter[] {
  return [...edgeFilters];
}

// Re-export specific parts for convenience
export { relationTypes } from './complexities.js';
export { allLanguages } from './languages.js';
export { allPredefinedFilters } from './filters/index.js';
export { edgeFilters } from './filters/index.js';
export { canonicalDataset } from './canonical.js';
export { 
  COMPLEXITIES,
  getComplexity,
  isValidComplexityCode
} from './complexities.js';
