import type { ArrowShape, Complexity, KCRelationType } from '../types.js';

/**
 * Canonical complexity definitions for transformations and operations.
 * These define how complexity classifications are displayed throughout the app.
 * 
 * IMPORTANT: Always use getComplexity() to get the full Complexity object
 * for display in the frontend. Never display raw code strings to users.
 * 
 * Operation codes are merged into succinctness codes:
 * - poly -> poly (🟢)
 * - quasi -> no-poly-quasi (⚡)
 * - exp -> no-quasi (❌)
 * - unknown/open -> unknown-both (❔/❓)
 * 
 * - code: Internal identifier
 * - label: Human-readable name
 * - notation: Short LaTeX notation for succinctness relations (f:languageA→languageB)
 * - emoji: For query/transformation operations (f:any→any)
 * - description: Full LaTeX-enabled description for tooltips/info panels
 * - color: Saturated hex color for icons/text
 * - pastel: Pastel version of color for backgrounds
 * - cssClass: CSS class name for styling
 * - arrow: Arrow shape for graph edge endpoints
 * - dashed: Whether the arrow/edge should be dashed
 */
export const COMPLEXITIES: Record<string, Complexity> = {
  poly: {
    code: 'poly',
    label: 'Polynomial',
    description: 'Polynomial compilation exists',
    opDescription: 'Polynomial transformation exists',
    notation: '$\\leq_p$',
    emoji: '🟢',
    color: '#22c55e', // green-500
    pastel: '#dcfce7', // green-100
    cssClass: 'complexity-poly',
    arrow: 'triangle',
    dashed: false
  },
  'no-poly-unknown-quasi': {
    code: 'no-poly-unknown-quasi',
    label: 'No Poly, Quasi Unknown',
    description: 'No polynomial compilation; quasipolynomial unknown',
    opDescription: 'No polynomial transformation; quasipolynomial unknown',
    notation: '$\\not\\leq_p \\ \\leq_q^?$',
    emoji: '⚠️',
    color: '#ef4444', // red-500
    pastel: '#fee2e2', // red-100
    cssClass: 'complexity-no-poly-unknown-quasi',
    arrow: 'tee',
    dashed: true
  },
  'no-poly-quasi': {
    code: 'no-poly-quasi',
    label: 'No Poly, Quasi Exists',
    description: 'No polynomial compilation; quasipolynomial exists',
    opDescription: 'No polynomial transformation; quasipolynomial exists',
    notation: '$\\not\\leq_p \\ \\leq_q$',
    emoji: '⚡',
    color: '#f97316', // orange-500
    pastel: '#ffedd5', // orange-100
    cssClass: 'complexity-no-poly-quasi',
    arrow: 'tee',
    dashed: false
  },
  'unknown-poly-quasi': {
    code: 'unknown-poly-quasi',
    label: 'Poly Unknown, Quasi Exists',
    description: 'Polynomial unknown; quasipolynomial exists',
    opDescription: 'Polynomial unknown; quasipolynomial exists',
    notation: '$\\leq_p^? \\ \\leq_q$',
    emoji: '⚡',
    color: '#eab308', // yellow-500
    pastel: '#fef9c3', // yellow-100
    cssClass: 'complexity-unknown-poly-quasi',
    arrow: 'triangle-cross',
    dashed: true
  },
  'unknown-both': {
    code: 'unknown-both',
    label: 'Unknown',
    description: 'Both polynomial and quasipolynomial unknown',
    opDescription: 'Both polynomial and quasipolynomial unknown',
    notation: '$?$',
    emoji: '❔',
    color: '#6b7280', // gray-500
    pastel: '#f3f4f6', // gray-100
    cssClass: 'complexity-unknown-both',
    arrow: 'square',
    dashed: true
  },
  unknown: {
    code: 'unknown',
    internal: true,
    label: 'Unknown',
    description: 'Unknown whether polynomial compilation exists',
    opDescription: 'Unknown whether polynomial transformation exists',
    notation: '$?$',
    emoji: '❔',
    color: '#6b7280', // gray-500
    pastel: '#f3f4f6', // gray-100
    cssClass: 'complexity-unknown',
    arrow: 'square',
    dashed: true
  },
  'no-quasi': {
    code: 'no-quasi',
    label: 'No Quasi',
    description: 'No quasipolynomial compilation (implies no polynomial)',
    opDescription: 'No quasipolynomial transformation (implies no polynomial)',
    notation: '$\\not\\leq_q$',
    emoji: '❌',
    color: '#dc2626', // red-600
    pastel: '#fecaca', // red-200
    cssClass: 'complexity-no-quasi',
    arrow: 'square',
    dashed: false
  },
  'not-poly': {
    code: 'not-poly',
    internal: true,
    label: 'Not Polynomial',
    description: 'No polynomial compilation',
    opDescription: 'No polynomial transformation',
    notation: '$\\not\\leq$',
    emoji: '❌',
    color: '#dc2626', // red-600
    pastel: '#fecaca', // red-200
    cssClass: 'complexity-not-poly',
    arrow: 'square',
    dashed: false
  },
  'unknown-to-us': {
    code: 'unknown-to-us',
    label: 'Unknown to Us',
    description: 'Not yet researched or documented',
    opDescription: 'Not yet researched or documented',
    notation: '?',
    emoji: '❓',
    color: '#9ca3af', // gray-400
    pastel: '#ffffff', // white
    cssClass: 'complexity-unknown-to-us',
    arrow: 'circle',
    dashed: true
  }
};

export function getComplexityFromCatalog(
  catalog: Record<string, Complexity>,
  code: string
): Complexity {
  const fallback = catalog['unknown-both'] ?? COMPLEXITIES['unknown-both'];
  return catalog[code] ?? fallback;
}

/**
 * Get complexity info by code.
 * Falls back to 'unknown-both' if code is not recognized.
 * 
 * IMPORTANT: Use this function to get the full Complexity object for display.
 */
export function getComplexity(code: string): Complexity {
  return COMPLEXITIES[code] || COMPLEXITIES['unknown-both'];
}

/**
 * Check if a code is a valid complexity code.
 */
export function isValidComplexityCode(code: string): boolean {
  return code in COMPLEXITIES;
}

// ============================================================================
// Relation Types (formerly in relation-types.ts)
// ============================================================================

const DEFAULT_ENDPOINT: { arrow: ArrowShape; dashed: boolean } = { arrow: 'none', dashed: false };

/**
 * Generate KCRelationType array from COMPLEXITIES.
 * This consolidates complexity definitions into relation types for graph edges.
 */
function buildRelationTypes(): KCRelationType[] {
  return Object.values(COMPLEXITIES)
    .filter(c => !c.internal) // Skip internal-only types
    .map(complexity => ({
      id: complexity.code,
      name: complexity.label,
      label: complexity.notation,
      description: complexity.description,
      style: {
        lineStyle: 'solid' as const,
        width: 2,
        targetStyle: {
          arrow: complexity.arrow,
          dashed: complexity.dashed
        },
        sourceStyle: {
          arrow: 'none',
          dashed: false
        }
      },
      defaultVisible: true
    }));
}

export const relationTypes: KCRelationType[] = buildRelationTypes();

/**
 * Get the edge endpoint style for a given status code.
 * Used for graph visualization arrow/dashed styling.
 */
export function getEdgeEndpointStyle(status: string | null): { arrow: ArrowShape; dashed: boolean } {
  if (status === null) {
    return DEFAULT_ENDPOINT;
  }
  const complexity = COMPLEXITIES[status];
  if (!complexity) {
    return DEFAULT_ENDPOINT;
  }
  return { arrow: complexity.arrow, dashed: complexity.dashed };
}
