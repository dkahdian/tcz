import type {
  KCBatchClaim,
  KCBatchLanguageRef,
  KCBatchSelector,
  KCAdjacencyMatrix,
  KCLanguage,
  KCOpSupport
} from '../types.js';
import { guaranteesPoly, guaranteesQuasi } from './validation/semantic.js';

interface BatchExpansionData {
  languages: KCLanguage[];
  adjacencyMatrix: KCAdjacencyMatrix;
  batchClaims?: KCBatchClaim[];
}

const LANG_PLACEHOLDER_MATH = '$\\mathcal{L}$';
const LANG_PLACEHOLDER = '\\mathcal{L}';
const EDGE_REF_PATTERN = /\\(n?edgeref)\{([^}]+)\}\{([^}]+)\}/g;
const LANG_PLACEHOLDER_ARG = String.raw`\$?\\mathcal\{L\}\$?`;
const CITATION_PATTERN = /\\cite[tp]?\{([^}]+)\}/g;

function languageRef(language: KCLanguage): string {
  const familyMatch = language.name.match(/^(.+)\$_(.+)\$$/);
  if (familyMatch) {
    return `\\langfam{${familyMatch[1]}}{${familyMatch[2]}}`;
  }
  return `\\langref{${language.name}}`;
}

function edgeRefLanguageName(language: KCLanguage): string {
  return language.name
    .replace(/\$_([^$]+)\$/g, '_$1')
    .replace(/\$/g, '');
}

function addUnique(target: string[], refs?: string[]): void {
  for (const ref of refs ?? []) {
    if (ref && !target.includes(ref)) target.push(ref);
  }
}

function citationRefs(text?: string): string[] {
  if (!text) return [];
  const refs: string[] = [];
  CITATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    addUnique(refs, match[1].split(',').map((ref) => ref.trim()).filter(Boolean));
  }
  return refs;
}

function normalizeEdgeRefArg(value: string): string {
  return value
    .trim()
    .replace(/^\\langref\{([^{}]+)\}$/i, '$1')
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}$/i, '$1_$2')
    .replace(/\\textless\{\}/gi, '<')
    .replace(/\\textless(?![A-Za-z])/gi, '<')
    .replace(/\$<\$/g, '<')
    .replace(/\$/g, '')
    .replace(/\\_/g, '_')
    .replace(/_\{\s*([^{}]+)\s*\}/g, '_$1')
    .replace(/\s+/g, ' ');
}

function languageNameAliases(language: KCLanguage): string[] {
  const edgeName = edgeRefLanguageName(language);
  return [
    language.id,
    language.name,
    edgeName,
    normalizeEdgeRefArg(language.name),
    normalizeEdgeRefArg(edgeName)
  ];
}

function isLanguageRef(language: KCLanguage, ref: string): boolean {
  const normalized = normalizeEdgeRefArg(ref);
  return languageNameAliases(language).some((alias) => {
    const normalizedAlias = normalizeEdgeRefArg(alias);
    return normalizedAlias === normalized || normalizedAlias.toLowerCase() === normalized.toLowerCase();
  });
}

function buildLanguageResolver(languages: KCLanguage[]): (ref: string) => string | undefined {
  const byRef = new Map<string, string>();
  for (const language of languages) {
    for (const alias of languageNameAliases(language)) {
      byRef.set(alias, language.id);
      byRef.set(alias.toLowerCase(), language.id);
    }
  }

  return (ref: string) => {
    const normalized = normalizeEdgeRefArg(ref);
    return byRef.get(normalized) ?? byRef.get(normalized.toLowerCase());
  };
}

function edgeRefs(
  database: BatchExpansionData,
  resolveLanguageId: (ref: string) => string | undefined,
  sourceRef: string,
  targetRef: string
): string[] {
  const sourceId = resolveLanguageId(sourceRef);
  const targetId = resolveLanguageId(targetRef);
  if (!sourceId || !targetId) return [];

  const sourceIndex = database.adjacencyMatrix.indexByLanguage[sourceId];
  const targetIndex = database.adjacencyMatrix.indexByLanguage[targetId];
  if (sourceIndex === undefined || targetIndex === undefined) return [];

  const relation = database.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex];
  if (!relation) return [];

  const refs: string[] = [];
  addUnique(refs, relation.refs);
  addUnique(refs, citationRefs(relation.description));
  addUnique(refs, relation.noPolyDescription?.refs);
  addUnique(refs, citationRefs(relation.noPolyDescription?.description));
  addUnique(refs, relation.quasiDescription?.refs);
  addUnique(refs, citationRefs(relation.quasiDescription?.description));
  return refs;
}

function replaceEdgePlaceholders(text: string, language: KCLanguage): string {
  return text
    .replace(new RegExp(String.raw`\\(n?edgeref)\{((?:[^{}]|\{[^{}]*\})+)\}\{${LANG_PLACEHOLDER_ARG}\}`, 'g'), (_match, command: string, sourceName: string) => {
      if (command === 'edgeref' && isLanguageRef(language, sourceName)) {
        return `${languageRef(language)} compiles to itself`;
      }
      return `\\${command}{${sourceName.trim()}}{${edgeRefLanguageName(language)}}`;
    })
    .replace(new RegExp(String.raw`\\(n?edgeref)\{${LANG_PLACEHOLDER_ARG}\}\{((?:[^{}]|\{[^{}]*\})+)\}`, 'g'), (_match, command: string, targetName: string) => {
      if (command === 'edgeref' && isLanguageRef(language, targetName)) {
        return `${languageRef(language)} compiles to itself`;
      }
      return `\\${command}{${edgeRefLanguageName(language)}}{${targetName.trim()}}`;
    });
}

export function expandBatchTemplate(template: string, language: KCLanguage): string {
  const ref = languageRef(language);
  return replaceEdgePlaceholders(template, language)
    .split(LANG_PLACEHOLDER_MATH).join(ref)
    .split(LANG_PLACEHOLDER).join(ref);
}

function citeEdgeReferences(
  text: string,
  database: BatchExpansionData,
  resolveLanguageId: (ref: string) => string | undefined
): { text: string; refs: string[] } {
  const refs: string[] = [];

  const expandedText = text.replace(
    EDGE_REF_PATTERN,
    (match: string, _command: string, sourceRef: string, targetRef: string) => {
      const citedRefs = edgeRefs(database, resolveLanguageId, sourceRef, targetRef);
      addUnique(refs, citedRefs);
      return match;
    }
  );

  return { text: expandedText, refs };
}

function languageMatchesSelector(
  database: BatchExpansionData,
  language: KCLanguage,
  selector: KCBatchSelector
): boolean {
  switch (selector.kind) {
    case 'list':
      return selector.languageIds.includes(language.id);
    case 'allOf':
      return selector.selectors.every((child) => languageMatchesSelector(database, language, child));
    case 'anyOf':
      return selector.selectors.some((child) => languageMatchesSelector(database, language, child));
    case 'edge':
      return edgeSelectorMatches(database, language, selector);
    default:
      return false;
  }
}

function resolveBatchLanguageRef(language: KCLanguage, ref: KCBatchLanguageRef): string {
  return ref.kind === 'current' ? language.id : ref.id;
}

function edgeSelectorMatches(
  database: BatchExpansionData,
  language: KCLanguage,
  selector: Extract<KCBatchSelector, { kind: 'edge' }>
): boolean {
  const sourceId = resolveBatchLanguageRef(language, selector.source);
  const targetId = resolveBatchLanguageRef(language, selector.target);

  // Compilation to itself is always available in polynomial time, even though
  // the adjacency matrix does not store reflexive edges.
  if (sourceId === targetId) return true;

  const sourceIndex = database.adjacencyMatrix.indexByLanguage[sourceId];
  const targetIndex = database.adjacencyMatrix.indexByLanguage[targetId];
  if (sourceIndex === undefined || targetIndex === undefined) return false;

  const relation = database.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex];
  const status = relation?.status;
  return selector.level === 'poly' ? guaranteesPoly(status) : guaranteesQuasi(status);
}

function selectorForBatch(batch: KCBatchClaim): KCBatchSelector {
  if (batch.selector) return batch.selector;
  return { kind: 'list', languageIds: batch.languageIds ?? [] };
}

function hasKnownSupport(support: KCOpSupport | undefined): boolean {
  return support !== undefined && support.complexity !== 'unknown-to-us';
}

function negativeSupportRank(complexity: string | undefined): number {
  switch (complexity) {
    case 'no-poly-unknown-quasi':
      return 1;
    case 'no-poly-quasi':
      return 2;
    case 'no-quasi':
      return 3;
    default:
      return 0;
  }
}

function shouldApplyBatchSupport(existing: KCOpSupport | undefined, incomingComplexity: string): boolean {
  if (!hasKnownSupport(existing)) return true;
  const existingRank = negativeSupportRank(existing?.complexity);
  const incomingRank = negativeSupportRank(incomingComplexity);
  if (existingRank === 0) return false;
  return incomingRank > existingRank;
}

function clearExpandedBatchClaims(database: BatchExpansionData): void {
  for (const language of database.languages) {
    for (const opType of ['queries', 'transformations'] as const) {
      const supportMap = language.properties?.[opType];
      if (!supportMap) continue;
      for (const [op, support] of Object.entries(supportMap)) {
        if (support?.batchId) {
          supportMap[op] = {
            complexity: 'unknown-to-us',
            refs: []
          };
        }
      }
    }
  }
}

export function expandBatchClaims(database: BatchExpansionData): number {
  const batchClaims = database.batchClaims ?? [];
  if (batchClaims.length === 0) return 0;

  clearExpandedBatchClaims(database);

  const resolveLanguageId = buildLanguageResolver(database.languages);

  let expanded = 0;
  for (const batch of batchClaims) {
    const selector = selectorForBatch(batch);
    for (const language of database.languages) {
      if (!languageMatchesSelector(database, language, selector)) continue;

      if (!language.properties) language.properties = {};
      if (!language.properties[batch.opType]) language.properties[batch.opType] = {};

      const supportMap = language.properties[batch.opType]!;
      const previousSupport = supportMap[batch.op];
      if (!shouldApplyBatchSupport(previousSupport, batch.status)) continue;

      const expandedDescription = expandBatchTemplate(batch.descriptionTemplate, language);
      const citedDescription = citeEdgeReferences(expandedDescription, database, resolveLanguageId);
      const refs = [...batch.refs];
      addUnique(refs, previousSupport?.refs);
      addUnique(refs, citedDescription.refs);

      const support: KCOpSupport = {
        complexity: batch.status,
        refs,
        description: citedDescription.text,
        derived: false,
        batchId: batch.id
      };
      if (batch.assumption) support.assumption = batch.assumption;

      supportMap[batch.op] = support;
      expanded++;
    }
  }

  return expanded;
}

export function batchClaimKey(batch: Pick<KCBatchClaim, 'id'>): string {
  return batch.id;
}
