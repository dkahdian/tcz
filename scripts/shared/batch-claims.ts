import type { KCBatchClaim, KCLanguage, KCOpSupport } from '../../src/lib/types.js';
import type { DatabaseSchema } from './database.js';

const LANG_PLACEHOLDER_MATH = '$\\mathcal{L}$';
const LANG_PLACEHOLDER = '\\mathcal{L}';
const EDGE_REF_PATTERN = /\\(n?edgeref)\{([^}]+)\}\{([^}]+)\}/g;
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
  database: DatabaseSchema,
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
  return text.replace(/\\(n?edgeref)\{([^}]+)\}\{\\mathcal\{L\}\}/g, (_match, command: string, sourceName: string) => {
    return `\\${command}{${sourceName.trim()}}{${edgeRefLanguageName(language)}}`;
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
  database: DatabaseSchema,
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

export function expandBatchClaims(database: DatabaseSchema): number {
  const batchClaims = database.batchClaims ?? [];
  if (batchClaims.length === 0) return 0;

  const languageById = new Map<string, KCLanguage>();
  for (const language of database.languages) {
    languageById.set(language.id, language);
  }
  const resolveLanguageId = buildLanguageResolver(database.languages);

  let expanded = 0;
  for (const batch of batchClaims) {
    for (const languageId of batch.languageIds) {
      const language = languageById.get(languageId);
      if (!language) {
        console.warn(`Batch claim ${batch.id} references unknown language ID: ${languageId}`);
        continue;
      }

      if (!language.properties) language.properties = {};
      if (!language.properties[batch.opType]) language.properties[batch.opType] = {};

      const expandedDescription = expandBatchTemplate(batch.descriptionTemplate, language);
      const citedDescription = citeEdgeReferences(expandedDescription, database, resolveLanguageId);
      const refs = [...batch.refs];
      addUnique(refs, citedDescription.refs);

      const support: KCOpSupport = {
        complexity: batch.status,
        refs,
        description: citedDescription.text,
        derived: true,
        batchId: batch.id
      };
      if (batch.assumption) support.assumption = batch.assumption;

      language.properties[batch.opType]![batch.op] = support;
      expanded++;
    }
  }

  return expanded;
}

export function batchClaimKey(batch: Pick<KCBatchClaim, 'id'>): string {
  return batch.id;
}
