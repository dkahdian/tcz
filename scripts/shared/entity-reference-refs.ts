import type { DatabaseSchema } from './database.js';

const ENTITY_REF_PATTERN = /\\(n?edgeref|n?opref)\{([^}]+)\}\{([^}]+)\}/g;

type OperationCatalog = Record<string, { code: string }>;

function operationCatalogs(database: DatabaseSchema): { queries: OperationCatalog; transformations: OperationCatalog } {
  const operations = database.operations as {
    queries?: OperationCatalog;
    transformations?: OperationCatalog;
  };
  return {
    queries: operations.queries ?? {},
    transformations: operations.transformations ?? {}
  };
}

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

function buildLanguageResolver(database: DatabaseSchema): (ref: string) => string | undefined {
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

function displayCodeToSafeKey(database: DatabaseSchema, opCode: string): string {
  const operations = operationCatalogs(database);
  if (operations.queries[opCode] || operations.transformations[opCode]) {
    return opCode;
  }

  for (const [safeKey, opDef] of Object.entries(operations.transformations)) {
    if (opDef.code === opCode) return safeKey;
  }
  for (const [safeKey, opDef] of Object.entries(operations.queries)) {
    if (opDef.code === opCode) return safeKey;
  }
  return opCode;
}

function relationRefs(database: DatabaseSchema, sourceId: string, targetId: string): string[] {
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

function operationRefs(database: DatabaseSchema, languageId: string, opCode: string): string[] {
  const language = database.languages.find((candidate) => candidate.id === languageId);
  if (!language) return [];
  const safeCode = displayCodeToSafeKey(database, opCode);
  const support =
    language.properties?.queries?.[safeCode] ??
    language.properties?.queries?.[opCode] ??
    language.properties?.transformations?.[safeCode] ??
    language.properties?.transformations?.[opCode];
  return support?.refs ?? [];
}

function referencedEntityRefs(
  database: DatabaseSchema,
  resolveLanguageId: (ref: string) => string | undefined,
  text?: string
): string[] {
  if (!text) return [];

  const refs: string[] = [];
  ENTITY_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_REF_PATTERN.exec(text)) !== null) {
    const [, command, firstRef, secondRef] = match;
    const firstId = resolveLanguageId(firstRef);
    if (!firstId) continue;

    if (command.endsWith('edgeref')) {
      const secondId = resolveLanguageId(secondRef);
      if (secondId) addUnique(refs, relationRefs(database, firstId, secondId));
    } else {
      addUnique(refs, operationRefs(database, firstId, secondRef));
    }
  }
  return refs;
}

/**
 * Ensure fact-level refs include the refs of every entity premise cited in the
 * description. This runs after propagation and batch hydration so entity refs
 * resolve against the final, current database state.
 */
export function hydrateEntityReferenceRefs(database: DatabaseSchema): number {
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
