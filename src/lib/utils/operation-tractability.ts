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

export const OPERATION_TRACTABILITY_DISPLAYS: Record<
  OperationTractabilityId,
  OperationTractabilityDisplay
> = {
  tractable: {
    id: 'tractable',
    symbol: '\u2713',
    label: 'Unconditionally polynomial time',
    description: 'Operation has an unconditional polynomial-time algorithm.',
    cssClass: 'operation-tractability-tractable'
  },
  'conditional-tractable': {
    id: 'conditional-tractable',
    symbol: '\u2713*',
    label: 'Conditionally polynomial time',
    description: 'Operation has a polynomial-time algorithm assuming the listed condition.',
    cssClass: 'operation-tractability-conditional-tractable'
  },
  'conditional-intractable': {
    id: 'conditional-intractable',
    symbol: '\u25CB',
    label: 'Conditionally not polynomial time',
    description: 'Operation is not polynomial time assuming the listed condition.',
    cssClass: 'operation-tractability-conditional-intractable'
  },
  intractable: {
    id: 'intractable',
    symbol: '\u25CF',
    label: 'Unconditionally not polynomial time',
    description: 'Operation is unconditionally not polynomial time.',
    cssClass: 'operation-tractability-intractable'
  },
  unknown: {
    id: 'unknown',
    symbol: '?',
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
