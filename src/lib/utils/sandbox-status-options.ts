export type SandboxOperationOption = {
  id: string;
  complexity: string | null;
  assumption?: string;
};

const DEFAULT_SANDBOX_EDGE_OPTIONS = [
  'no-poly-unknown-quasi',
  'poly',
  'unknown-both'
];

const ALL_SANDBOX_EDGE_OPTIONS = [
  'poly',
  'no-poly-unknown-quasi',
  'no-poly-quasi',
  'unknown-poly-quasi',
  'unknown-both',
  'no-quasi'
];

export const UNKNOWN_OPERATION_COMPLEXITIES = new Set([
  '',
  'unknown',
  'unknown-both',
  'unknown-to-us',
  'unknown-poly-quasi'
]);

function edgeStatusForCompactDisplay(status: string): string {
  switch (status) {
    case 'no-poly-unknown-quasi':
    case 'no-poly-quasi':
    case 'no-quasi':
    case 'not-poly':
      return 'not-poly';
    case 'unknown-poly-quasi':
    case 'unknown-both':
    case 'unknown':
      return 'unknown';
    default:
      return status;
  }
}

export function validSandboxEdgeStatuses(
  baselineStatus: string | null | undefined,
  showQuasipolynomialOptions: boolean
): string[] {
  const status = baselineStatus ?? '';

  if (!showQuasipolynomialOptions) {
    const displayValue = edgeStatusForCompactDisplay(status || 'unknown-both');
    return displayValue === 'unknown' ? DEFAULT_SANDBOX_EDGE_OPTIONS : [];
  }

  switch (status) {
    case 'poly':
    case 'no-quasi':
    case 'no-poly-quasi':
      return [];
    case 'no-poly-unknown-quasi':
      return ['no-poly-unknown-quasi', 'no-poly-quasi', 'no-quasi'];
    case 'unknown-poly-quasi':
      return ['unknown-poly-quasi', 'no-poly-quasi', 'poly'];
    case 'unknown-both':
    case '':
    default:
      return ALL_SANDBOX_EDGE_OPTIONS;
  }
}

export function validSandboxOperationOptions({
  baselineComplexity,
  baselineAssumption,
  currentAssumption
}: {
  baselineComplexity: string | null | undefined;
  baselineAssumption?: string;
  currentAssumption?: string;
}): SandboxOperationOption[] {
  const complexity = baselineComplexity ?? '';
  const assumption = currentAssumption?.trim() || undefined;

  if (UNKNOWN_OPERATION_COMPLEXITIES.has(complexity)) {
    return [
      { id: 'blank', complexity: null },
      { id: 'poly', complexity: 'poly', assumption },
      { id: 'no-poly', complexity: 'no-poly-unknown-quasi', assumption }
    ];
  }

  if (baselineAssumption) {
    return [
      { id: 'blank', complexity: null },
      {
        id: complexity,
        complexity,
        assumption: assumption ?? baselineAssumption
      }
    ];
  }

  return [];
}
