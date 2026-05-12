import type { KCOpEntry, KCOpSupport } from '$lib/types.js';

export type OperationTractabilityId =
  | 'tractable'
  | 'conditional-tractable'
  | 'conditional-intractable'
  | 'intractable'
  | 'unknown';
export type OperationDisplayContext = 'query' | 'transformation';

export type OperationTractabilityDisplay = {
  id: OperationTractabilityId;
  symbol: string;
  symbolHtml: string;
  graphSymbol: string;
  label: string;
  description: string;
  cssClass: string;
};

const UNKNOWN_CODES = new Set(['unknown', 'unknown-both', 'unknown-to-us', 'unknown-poly-quasi']);

export const OPERATION_TRACTABILITY_ORDER: OperationTractabilityId[] = [
  'tractable',
  'conditional-tractable',
  'conditional-intractable',
  'intractable',
  'unknown'
];

const SOLID_CHECK_SVG =
  '<svg class="operation-check-icon operation-check-icon--solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 19.2 1.9 12.4 5 9.3l3.7 3.7L19.1 2.6l3.1 3.1L8.7 19.2Z"/></svg>';

const HOLLOW_CHECK_SVG =
  '<svg class="operation-check-icon operation-check-icon--hollow" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 19.2 1.9 12.4 5 9.3l3.7 3.7L19.1 2.6l3.1 3.1L8.7 19.2Z"/></svg>';

export const OPERATION_TRACTABILITY_DISPLAYS: Record<
  OperationTractabilityId,
  OperationTractabilityDisplay
> = {
  tractable: {
    id: 'tractable',
    symbol: '\u2713',
    symbolHtml: SOLID_CHECK_SVG,
    graphSymbol: '\u2713',
    label: 'Unconditionally polynomial time',
    description: 'Operation has an unconditional polynomial-time algorithm.',
    cssClass: 'operation-tractability-tractable'
  },
  'conditional-tractable': {
    id: 'conditional-tractable',
    symbol: '\u2713*',
    symbolHtml: HOLLOW_CHECK_SVG,
    graphSymbol: '$\\checkmark^{*}$',
    label: 'Conditionally polynomial time',
    description: 'Operation has a polynomial-time algorithm assuming the listed condition.',
    cssClass: 'operation-tractability-conditional-tractable'
  },
  'conditional-intractable': {
    id: 'conditional-intractable',
    symbol: '\u25CB',
    symbolHtml: '\u25CB',
    graphSymbol: '\u25CB',
    label: 'Conditionally not polynomial time',
    description: 'Operation is not polynomial time assuming the listed condition.',
    cssClass: 'operation-tractability-conditional-intractable'
  },
  intractable: {
    id: 'intractable',
    symbol: '\u25CF',
    symbolHtml: '\u25CF',
    graphSymbol: '\u25CF',
    label: 'Unconditionally not polynomial time',
    description: 'Operation is unconditionally not polynomial time.',
    cssClass: 'operation-tractability-intractable'
  },
  unknown: {
    id: 'unknown',
    symbol: '?',
    symbolHtml: '?',
    graphSymbol: '?',
    label: 'Unknown',
    description: 'Tractability is unknown.',
    cssClass: 'operation-tractability-unknown'
  }
};

export function getOperationTractabilityDisplay(
  support: Pick<KCOpEntry | KCOpSupport, 'complexity' | 'assumption'> | null | undefined,
  _context?: OperationDisplayContext
): OperationTractabilityDisplay {
  if (!support?.complexity || UNKNOWN_CODES.has(support.complexity)) {
    return OPERATION_TRACTABILITY_DISPLAYS.unknown;
  }

  if (support.complexity === 'poly') {
    return support.assumption
      ? OPERATION_TRACTABILITY_DISPLAYS['conditional-tractable']
      : OPERATION_TRACTABILITY_DISPLAYS.tractable;
  }

  if (support.assumption) {
    return OPERATION_TRACTABILITY_DISPLAYS['conditional-intractable'];
  }

  return OPERATION_TRACTABILITY_DISPLAYS.intractable;
}

export function getOrderedOperationTractabilityDisplays(
  ids: Iterable<OperationTractabilityId>
): OperationTractabilityDisplay[] {
  const idSet = new Set(ids);
  return OPERATION_TRACTABILITY_ORDER
    .filter((id) => idSet.has(id))
    .map((id) => OPERATION_TRACTABILITY_DISPLAYS[id]);
}
