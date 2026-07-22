import type { GraphData } from '../../types.js';

const ENTITY_REF_PATTERN = /\\(compilespoly|compilesquasi|nocompilespoly|nocompilesquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{((?:[^{}]|\{[^{}]*\})+)\}/g;
const OPERATION_RESULT_REF_PATTERN = /\\(supportspoly|supportsquasi|nosupportspoly|nosupportsquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{(\\[A-Za-z]+)\}/g;

const OPERATION_MACRO_TO_CODE: Record<string, string> = {
  '\\CO': 'CO',
  '\\VA': 'VA',
  '\\CE': 'CE',
  '\\IM': 'IM',
  '\\EQ': 'EQ',
  '\\SE': 'SE',
  '\\CT': 'CT',
  '\\ME': 'ME',
  '\\CD': 'CD',
  '\\FO': 'FO',
  '\\SFO': 'SFO',
  '\\NOTC': 'NOT_C',
  '\\ANDC': 'AND_C',
  '\\ANDBC': 'AND_BC',
  '\\ORC': 'OR_C',
  '\\ORBC': 'OR_BC'
};

type EntityReferenceData = Pick<GraphData, 'languages' | 'adjacencyMatrix'>;

function addUnique(target: string[], refs?: string[]): boolean {
  let changed = false;
  for (const ref of refs ?? []) {
    if (ref && !target.includes(ref)) {
      target.push(ref);
      changed = true;
    }
  }
  return changed;
}

function normalizeLangRefArg(value: string): string {
  return value
    .trim()
    .replace(/^\\langref\{([^{}]+)\}(?:\{[^{}]*\})?$/i, '$1')
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}(?:\{[^{}]*\})?$/i, '$1_$2')
    .replace(/\\textless\{\}/gi, '<')
    .replace(/\\textless(?![A-Za-z])/gi, '<')
    .replace(/\$<\$/g, '<')
    .replace(/\$/g, '')
    .replace(/\\_/g, '_')
    .replace(/_\{\s*([^{}]+)\s*\}/g, '_$1')
    .replace(/\s+/g, ' ');
}

function edgeRefLanguageName(name: string): string {
  return name
    .replace(/\$_([^$]+)\$/g, '_$1')
    .replace(/\$/g, '');
}

function buildLanguageResolver(database: EntityReferenceData): (ref: string) => string | undefined {
  const byRef = new Map<string, string>();
  for (const language of database.languages) {
    const aliases = [
      language.id,
      language.name,
      edgeRefLanguageName(language.name),
      normalizeLangRefArg(language.name),
      normalizeLangRefArg(edgeRefLanguageName(language.name))
    ];
    for (const alias of aliases) {
      byRef.set(alias, language.id);
      byRef.set(alias.toLowerCase(), language.id);
    }
  }

  return (ref: string) => {
    const normalized = normalizeLangRefArg(ref);
    return byRef.get(normalized) ?? byRef.get(normalized.toLowerCase());
  };
}

function relationRefs(database: EntityReferenceData, sourceId: string, targetId: string): string[] {
  const sourceIdx = database.adjacencyMatrix.indexByLanguage[sourceId];
  const targetIdx = database.adjacencyMatrix.indexByLanguage[targetId];
  if (sourceIdx === undefined || targetIdx === undefined) return [];
  const relation = database.adjacencyMatrix.matrix[sourceIdx]?.[targetIdx];
  if (!relation) return [];

  const refs: string[] = [];
  addUnique(refs, relation.refs);
  addUnique(refs, relation.noPolyDescription?.refs);
  addUnique(refs, relation.quasiDescription?.refs);
  return refs;
}

function operationRefs(database: EntityReferenceData, languageId: string, operationMacro: string): string[] {
  const operationCode = OPERATION_MACRO_TO_CODE[operationMacro];
  if (!operationCode) return [];
  const language = database.languages.find((item) => item.id === languageId);
  const support = language?.properties?.queries?.[operationCode] ?? language?.properties?.transformations?.[operationCode];
  return support?.refs ?? [];
}

function referencedEntityRefs(
  database: EntityReferenceData,
  resolveLanguageId: (ref: string) => string | undefined,
  text?: string
): string[] {
  if (!text) return [];

  const refs: string[] = [];
  ENTITY_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_REF_PATTERN.exec(text)) !== null) {
    const [, _command, firstRef, secondRef] = match;
    const firstId = resolveLanguageId(firstRef);
    if (!firstId) continue;
    const secondId = resolveLanguageId(secondRef);
    if (secondId) addUnique(refs, relationRefs(database, firstId, secondId));
  }

  OPERATION_RESULT_REF_PATTERN.lastIndex = 0;
  while ((match = OPERATION_RESULT_REF_PATTERN.exec(text)) !== null) {
    const [, _command, languageRef, operationMacro] = match;
    const languageId = resolveLanguageId(languageRef);
    if (languageId) addUnique(refs, operationRefs(database, languageId, operationMacro));
  }
  return refs;
}

/**
 * Ensure fact-level refs include the refs of every entity premise cited in the
 * description. Propagation calls this before seeding facts so derived proofs
 * inherit complete premise metadata on their first pass.
 */
export function hydrateEntityReferenceRefs(database: EntityReferenceData): number {
  const resolveLanguageId = buildLanguageResolver(database);
  let changedFacts = 0;

  const hydrateRefList = (refs: string[], description?: string): boolean => {
    if (addUnique(refs, referencedEntityRefs(database, resolveLanguageId, description))) {
      changedFacts++;
      return true;
    }
    return false;
  };

  let changed = true;
  while (changed) {
    changed = false;

    for (const row of database.adjacencyMatrix.matrix) {
      for (const relation of row) {
        if (!relation) continue;
        changed = hydrateRefList(relation.refs, relation.description) || changed;
        if (relation.noPolyDescription) {
          changed = hydrateRefList(relation.noPolyDescription.refs, relation.noPolyDescription.description) || changed;
          changed = addUnique(relation.refs, relation.noPolyDescription.refs) || changed;
        }
        if (relation.quasiDescription) {
          changed = hydrateRefList(relation.quasiDescription.refs, relation.quasiDescription.description) || changed;
          changed = addUnique(relation.refs, relation.quasiDescription.refs) || changed;
        }
      }
    }

    for (const language of database.languages) {
      for (const supportMap of [language.properties?.queries, language.properties?.transformations]) {
        if (!supportMap) continue;
        for (const support of Object.values(supportMap)) {
          changed = hydrateRefList(support.refs, support.description) || changed;
        }
      }
    }
  }

  return changedFacts;
}
