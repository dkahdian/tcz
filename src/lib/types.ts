// Types for the Tractable Circuit Zoo.
// TODO: Clean up legacy KC-prefixed type conventions in a later refactor
// (for example, KCLanguage may eventually become TCLanguage).

/**
 * Arrow shape types for relation endpoints
 */
export type ArrowShape = 
  | 'none'           // no arrow
  | 'triangle'       // solid triangle (standard arrow)
  | 'triangle-tee'   // triangle with perpendicular line
  | 'triangle-cross' // triangle with cross
  | 'tee'            // perpendicular line only
  | 'diamond'        // hollow diamond
  | 'square'         // square
  | 'circle'         // circle
  | 'vee'            // V-shaped arrow
  | 'chevron'        // chevron arrow
  | 'triangle-backcurve'; // curved triangle

/**
 * An operation implication lemma: if a language supports all operations in the antecedent,
 * it also supports the consequent operation.
 * 
 * Operations can be queries (CO, VA, CT, etc.) or transformations (CD, FO, NOT_C, etc.).
 * 
 * Example: VA + NOT_C implies CO because you can check satisfiability by
 * negating the formula and checking if the negation is valid.
 */
export interface OperationLemma {
  /** Unique identifier for this lemma */
  id: string;
  /** Operation codes that must be supported (antecedent set) - can be queries or transformations */
  antecedent: string[];
  /** Operation code that is implied (consequent) - can be a query or transformation */
  consequent: string;
  /** Human-readable justification for the implication */
  description: string;
  /** Reference IDs supporting this lemma */
  refs: string[];
}

// ===========================================================================
// Proof trace types for Lean 4 code generation
// ===========================================================================

/**
 * A structured proof trace recording how a derived fact was inferred.
 * Used by the Lean code generator to emit machine-checked proof terms.
 */
export type ProofTrace =
  | { rule: 'transitivity'; path: string[]; level: 'poly' | 'quasi' }
  | { rule: 'contradiction'; triedStatus: string; witnessPath: string[] }
  | { rule: 'query-via-succinctness'; sourceLanguageId: string; targetLanguageId: string; operation: string; level: 'poly' | 'quasi' }
  | { rule: 'lemma-forward'; lemmaId: string; languageId: string; level: 'poly' | 'quasi' }
  | { rule: 'lemma-contrapositive'; lemmaId: string; languageId: string; pivotOp: string; level: 'poly' | 'quasi' }
  | { rule: 'query-difference'; operation: string; posLanguageId: string; negLanguageId: string; level: 'poly' | 'quasi' }
  | { rule: 'query-downgrade-via-succinctness'; sourceLanguageId: string; targetLanguageId: string; operation: string; level: 'poly' | 'quasi' };

/**
 * Full complexity info with display properties.
 * Used for both transformation statuses and operation complexities.
 * 
 * IMPORTANT: Always use the full Complexity object in the frontend,
 * never just the code string. This ensures consistent display.
 * 
 * Display contexts:
 * - notation: LaTeX notation for succinctness relations (f:languageA→languageB), e.g., "$\leq_p$"
 * - emoji: For query/transformation operations (f:any→any), e.g., "✓" or "✗"
 */
export interface Complexity {
  /** Internal code identifier */
  code: string;
  /**
   * True if this complexity code is generated only by filters/UI transforms
   * and should never be stored in canonical data or user-authored contributions.
   */
  internal?: boolean;
  /** Human-readable label (e.g., "Polynomial") */
  label: string;
  /** Short notation, supports LaTeX (e.g., "$\\leq_p$") - used for succinctness relations */
  notation: string;
  /** Emoji representation - used for query/transformation operations */
  emoji: string;
  /** Full description, supports LaTeX (used for succinctness edges) */
  description: string;
  /** Operation-context description (used for query/transformation operations) */
  opDescription: string;
  /** CSS color value (saturated, for icons/text) */
  color: string;
  /** Pastel version of color (for backgrounds) */
  pastel: string;
  /** CSS class name for styling */
  cssClass: string;
  /** Arrow shape for graph edge endpoints */
  arrow: ArrowShape;
  /** Whether the arrow/edge should be dashed */
  dashed: boolean;
}

export interface VisualOverrides {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  labelPrefix?: string;
  labelSuffix?: string;
  highlightLevel?: 'none' | 'subtle' | 'strong';
}

/**
 * Language-specific support information for an operation.
 * The operation code and label come from the canonical operations definition.
 */
export interface KCOpSupport {
  /** complexity code (use getComplexity() to get full Complexity object for display) */
  complexity: string;
  /** Optional complexity assumption under which the claim holds, e.g., "P \neq NP". */
  assumption?: string;
  /** reference IDs pointing to entries in the language's references array */
  refs: string[];
  /** optional justification/description for this complexity claim */
  description?: string;
  /** True if this operation support was inferred by the propagator rather than manually authored */
  derived?: boolean;
  /** ID of the authored batch claim that generated this operation support entry. */
  batchId?: string;
  /** Global derivation order for Lean proof generation (lower = derived earlier). Undefined for non-derived. */
  derivationOrder?: number;
  /** Structured proof trace for Lean code generation */
  proofTrace?: ProofTrace;
  /** True if this cell should be visually dimmed/grayed (set by implicitEdgeTreatment filter). */
  dimmed?: boolean;
  /** True if this cell should be highlighted as explicit (set by implicitEdgeTreatment filter). */
  explicit?: boolean;
}

/**
 * A human-authored grouped operation claim, expanded into ordinary derived
 * operation support entries before propagation.
 */
export interface KCBatchClaim {
  id: string;
  opType: 'queries' | 'transformations';
  op: string;
  status: string;
  assumption?: string;
  languageIds: string[];
  claimTemplate: string;
  descriptionTemplate: string;
  refs: string[];
}

/**
 * Full operation entry with all metadata, used for rendering.
 * Extends KCOpSupport with canonical operation info (code/label).
 */
export interface KCOpEntry extends KCOpSupport {
  /** short code, e.g., CO, VA, CE, IM, EQ, SU, CD, FO */
  code: string;
  /** human-friendly label, e.g., "Consistency" */
  label: string;
}

/**
 * Language-specific operation support, keyed by operation code.
 */
export interface KCOpSupportMap {
  [opCode: string]: KCOpSupport;
}

export interface KCLanguageProperties {
  /** map of query operation codes to their support info */
  queries?: KCOpSupportMap;
  /** map of transformation operation codes to their support info */
  transformations?: KCOpSupportMap;
}

/**
 * Resolved language properties with full operation entries for rendering.
 */
export interface KCLanguagePropertiesResolved {
  /** list of query operations for this language */
  queries: KCOpEntry[];
  /** list of transformation operations for this language */
  transformations: KCOpEntry[];
}

export interface KCTag {
  label: string;
  color?: string; // CSS color for badge
  description?: string;
  /** reference IDs pointing to entries in the language's references array */
  refs: string[];
}

export interface KCReference {
  id: string;
  title: string;
  href: string;
  bibtex: string;
}

export interface KCLanguage {
  /** Unique internal identifier (URL-safe, no special chars) */
  id: string;
  /** Display name (may contain LaTeX like OBDD$_<$) */
  name: string;
  /** Whether this node is a plain language, a fixed-parameter family, or a union language */
  classification?: LanguageClassification;
  fullName: string;
  /** Formal definition of the language (supports LaTeX) */
  definition: string;
  /** reference IDs for the definition */
  definitionRefs: string[];
  properties: KCLanguageProperties;
  /** names of languages that are strict subsets of this one */
  subsets?: string[];
  /** badges/tags for quick categorization */
  tags?: KCTag[];
  /** list of external references for this language */
  references: KCReference[];
  /** visual overrides applied by filters */
  visual?: VisualOverrides;
}

/**
 * A conceptual definition shown on the About page.
 * These entries are intentionally lightweight and mathtext-friendly.
 */
export interface KCDefinition {
  /** Unique identifier for the definition */
  id: string;
  /** Human-readable title */
  title: string;
  /** Main text shown in the UI; may include LaTeX/math and citations */
  statement: string;
  /** Optional follow-up explanation or editorial note */
  explanation?: string;
  /** Reference IDs supporting the definition */
  refs: string[];
}

/**
 * Style configuration for a single endpoint of an edge
 */
export interface EdgeEndpointStyle {
  /** Arrow shape at this endpoint */
  arrow: ArrowShape;
  /** Whether the arrow is dashed (for uncertainty) */
  dashed?: boolean;
  /** Whether to render as double parallel lines (for no-quasi relationships) */
  isDouble?: boolean;
  /** Color override for this endpoint */
  color?: string;
}

export interface KCRelationTypeStyle {
  lineColor?: string; // CSS color
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'double';
  width?: number; // pixels
  /** Style for the target (head) end of the edge */
  targetStyle?: EdgeEndpointStyle;
  /** Style for the source (tail) end of the edge */
  sourceStyle?: EdgeEndpointStyle;
}

/**
 * Defines a visual/semantic type of relation (edge) with styling
 * and information used across edges and in legend.
 */
export interface KCRelationType {
  /** unique id used to reference this type from relations */
  id: string;
  /** display name, e.g., "Polynomial Transformation" */
  name: string;
  /** optional short glyph/symbol, e.g., "≤_p", "≤_q" */
  label?: string;
  /** optional description shown in legend/tooltips */
  description?: string;
  /** default style for edges of this type */
  style?: KCRelationTypeStyle;
  /** whether this relation type is shown by default in the graph */
  defaultVisible?: boolean;
}


/**
 * Canonical edge representation - each edge stored exactly once.
 * Edges are bidirectional with independent status in each direction.
 * 
 * Node ordering: nodeA and nodeB are ordered lexicographically (nodeA < nodeB)
 * to ensure canonical representation.
 */

/**
 * Separating function stored in top-level database array.
 * shortName serves as the unique identifier for referencing from relationships.
 */
export interface KCSeparatingFunction {
  /** Short label rendered directly on the edge (also serves as unique ID) */
  shortName: string;
  /** Full human-readable name */
  name: string;
  /** Description of what is separated */
  description: string;
  /** Supporting references */
  refs: string[];
}

/**
 * Description component for a single claim in a no-poly-quasi edge.
 * Used to track whether each half (no-poly / quasi-exists) was manually authored or derived.
 */
export interface DescriptionComponent {
  /** Description/justification for this claim */
  description: string;
  /** Supporting references */
  refs: string[];
  /** True if this part was inferred by the propagator */
  derived: boolean;
  /** Global derivation order for Lean proof generation */
  derivationOrder?: number;
  /** Structured proof trace for Lean code generation */
  proofTrace?: ProofTrace;
}

export interface DirectedSuccinctnessRelation {
  /** Transformation classification from source → target (use getComplexity() for display) */
  status: string;
  /** Optional descriptive note for this direction */
  description?: string;
  /** Optional complexity assumption under which the claim holds, e.g., "P \neq NP". */
  assumption?: string;
  /** Supporting references */
  refs: string[];
  /** Separating function shortNames (references top-level separatingFunctions array by shortName) */
  separatingFunctionIds?: string[];
  /** Whether this edge is hidden by transitive reduction (always false by default) */
  hidden?: boolean;
  /** True if this edge was inferred by the propagator rather than manually authored. */
  derived?: boolean;
  /** Global derivation order for Lean proof generation (lower = derived earlier). Undefined for non-derived. */
  derivationOrder?: number;
  /** Structured proof trace for Lean code generation */
  proofTrace?: ProofTrace;
  /**
   * For no-poly-quasi edges: structured proof tracking for each claim.
   * Allows partial derivation where one claim is manual and the other derived.
   * When present, `derived` should be true only if BOTH proofs are derived.
   */
  noPolyDescription?: DescriptionComponent;
  quasiDescription?: DescriptionComponent;
  /** True if this edge should be visually dimmed/grayed (set by implicitEdgeTreatment filter). */
  dimmed?: boolean;
  /** True if this edge should be highlighted as explicit (set by implicitEdgeTreatment filter). */
  explicit?: boolean;
}

/**
 * Edge selection information for UI display
 */
export interface SelectedEdge {
  /** Edge identifier */
  id: string;
  /** Source language ID */
  source: string;
  /** Target language ID */
  target: string;
  /** Source language name */
  sourceName: string;
  /** Target language name */
  targetName: string;
  /** Forward direction relation (source → target) */
  forward: DirectedSuccinctnessRelation | null;
  /** Backward direction relation (target → source) */
  backward: DirectedSuccinctnessRelation | null;
  /** Combined references from both directions */
  refs: string[];
}

export interface KCAdjacencyMatrix {
  languageIds: string[]; // Contains language IDs (unique internal identifiers)
  indexByLanguage: Record<string, number>; // Maps language ID to matrix index
  matrix: (DirectedSuccinctnessRelation | null)[][];
}

export interface NodePosition {
  x: number;
  y: number;
}

export type NodePositionsByLanguageName = Record<string, NodePosition>;

export interface GraphData {
  languages: KCLanguage[];
  /** Conceptual definitions shown on the About page */
  definitions?: KCDefinition[];
  /** Directed succinctness relationships stored as an adjacency matrix */
  adjacencyMatrix: KCAdjacencyMatrix;
  /** catalog of relation types used by relations and legend */
  relationTypes: KCRelationType[];
  /** catalog of complexity definitions used for rendering */
  complexities: Record<string, Complexity>;
  /** global registry of references used across the dataset */
  references: KCReference[];
  /** separating function registry */
  separatingFunctions: KCSeparatingFunction[];
  /** optional default node positions, keyed by language name */
  defaultNodePositionsByLanguageName?: NodePositionsByLanguageName;
  /** optional metadata copied from database.json */
  metadata?: Record<string, unknown>;
  /** UI-filtered operation visibility, used by operation matrix views. */
  operationVisibility?: {
    queryIds: string[];
    transformationIds: string[];
  };
}

export interface TransformValidationResult {
  ok: boolean;
  errors?: string[];
}

// Filter system types
export type ViewMode = 'graph' | 'succinctness' | 'queries' | 'transforms';
export type LanguageClassification = 'plain' | 'family' | 'union';
export type LanguageScopeMode = 'families' | 'unions' | 'both';
export type FilterUIGroup = 'Language Scope' | 'Visibility' | 'Display' | 'Advanced';
export type FilterKind =
  | 'language-visibility'
  | 'edge-visibility'
  | 'matrix-display'
  | 'operation-visualization'
  | 'internal';
export type FilterControlType = 'checkbox' | 'toggle' | 'radio' | 'dropdown' | 'language-picker';

export interface LanguageVisibilityParam {
  mode: 'all' | 'only' | 'except';
  ids: string[];
  hiddenQueryIds?: string[];
  hiddenTransformationIds?: string[];
  graphQueryIds?: string[];
  graphTransformationIds?: string[];
}

export type FilterParamValue = boolean | string | number | LanguageVisibilityParam;

/**
 * Selected operation for sidebar display
 */
export interface SelectedOperation {
  /** Operation code (e.g., CO, VA, CD, FO) */
  code: string;
  /** Human-readable label */
  label: string;
  /** Description of the operation */
  description?: string;
  /** Type of operation */
  type: 'query' | 'transformation';
}

/**
 * Selected language-operation cell for sidebar display
 */
export interface SelectedOperationCell {
  /** The language */
  language: KCLanguage;
  /** The operation code */
  operationCode: string;
  /** The operation label */
  operationLabel: string;
  /** Type of operation */
  operationType: 'query' | 'transformation';
  /** The language's support info for this operation */
  support: KCOpEntry;
}

export interface FilterOption {
  value: string;
  label: string;
  description?: string;
}

export interface DataFilter<T extends FilterParamValue = boolean> {
  id: string;
  name: string;
  description: string;
  category?: string;
  applicableViews: ViewMode[];
  uiGroup?: FilterUIGroup;
  advanced?: boolean;
  kind?: FilterKind;
  /** Whether this filter is internal/hidden from UI or can be edited by the user */
  hidden?: boolean;
  /** Default value for the filter parameter (used for graph mode, or both if no matrix default) */
  defaultParam: T;
  /** Optional override default for matrix view mode */
  defaultParamMatrix?: T;
  /** UI control type for displaying this filter */
  controlType?: FilterControlType;
  /** Optional list of selectable options for dropdown-style filters */
  options?: FilterOption[];
  /** Filter function operating on the entire dataset */
  lambda: (data: GraphData, param: T) => GraphData;
}

/** A filter that operates primarily on language/node data */
export type LanguageFilter<T extends FilterParamValue = boolean> = DataFilter<T>;
/** A filter that operates primarily on edge/relation data */
export type EdgeFilter<T extends FilterParamValue = boolean> = DataFilter<T>;

export interface FilterCategory {
  name: string;
  filters: DataFilter[];
}

/**
 * State for a single filter, including its current parameter value
 */
export interface FilterState<T extends FilterParamValue = FilterParamValue> {
  filterId: string;
  param: T;
}

/**
 * Map of filter IDs to their current parameter values
 */
export type FilterStateMap = Map<string, FilterParamValue>;

export interface FilteredGraphData extends GraphData {
  visibleLanguageIds: Set<string>;
  /** Set of visible edge IDs in format "sourceId->targetId" */
  visibleEdgeIds: Set<string>;
  /** Set of visible query operation codes */
  visibleQueryIds: Set<string>;
  /** Set of visible transformation operation codes */
  visibleTransformationIds: Set<string>;
}

// TODO: Future enhancement - Filter Presets
// Allow users to save and load filter combinations for quick access
// This would be useful for commonly used filter sets
/*
export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  filterIds: string[];  // IDs of filters to activate together
}
*/

// Note: Filters are designed to be independent and commutative
// i.e., f(g(language)) = g(f(language)) for any filters f and g
// This property ensures filter order doesn't matter
