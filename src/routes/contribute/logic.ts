import type { LanguageToAdd, RelationshipEntry, ReferenceToAdd } from './types.js';
import { displayCodeToSafeKey } from '$lib/data/operations.js';
import { generateReferenceId } from '$lib/utils/reference-id.js';
import { generateLanguageId } from '$lib/utils/language-id.js';

/**
 * Generate a unique key for a relationship
 */
export function relationKey(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

/**
 * Helper function to clone operation support maps and convert display codes to safe keys
 */
export function cloneOperationSupport(
  operations: Record<string, any> | undefined,
  convertToSafeKeys = false
): Record<string, any> {
  const cloned: Record<string, any> = {};
  if (operations) {
    for (const [code, support] of Object.entries(operations)) {
      const key = convertToSafeKeys ? displayCodeToSafeKey(code) : code;
      cloned[key] = {
        complexity: support.complexity,
        assumption: support.assumption,
        refs: Array.isArray(support.refs) ? [...support.refs] : []
      };
    }
  }
  return cloned;
}

export interface BaselineRelation {
  status: string;
  description?: string;
  assumption?: string;
  refs: string[];
  derived?: boolean;
}

/**
 * Build baseline relations from adjacency matrix
 */
export function buildBaselineRelations(adjacencyMatrix: {
  languageIds: string[];
  matrix: any[][];
}): Map<string, BaselineRelation> {
  const baselineRelations = new Map<string, BaselineRelation>();

  const { languageIds, matrix } = adjacencyMatrix;
  for (let i = 0; i < languageIds.length; i++) {
    for (let j = 0; j < languageIds.length; j++) {
      const relation = matrix[i][j];
      if (relation) {
        const sourceId = languageIds[i];
        const targetId = languageIds[j];
        
        baselineRelations.set(relationKey(sourceId, targetId), {
          status: relation.status,
          description: relation.description,
          assumption: relation.assumption,
          refs: relation.refs ? [...relation.refs] : [],
          derived: relation.derived
        });
      }
    }
  }

  return baselineRelations;
}

/**
 * Reference data with tooltip information
 */
export type ReferenceForTooltip = {
  id: string;
  title: string;
  bibtex: string;
};

/**
 * Get available references with full tooltip data (existing + new)
 */
export function getAvailableReferences(
  existingReferences: Array<{ id: string; title: string; bibtex: string }>,
  newReferences: ReferenceToAdd[]
): ReferenceForTooltip[] {
  const existingSet = new Set(existingReferences.map((r) => r.id));
  
  const existing: ReferenceForTooltip[] = existingReferences.map((r) => ({
    id: r.id,
    title: r.title,
    bibtex: r.bibtex
  }));
  
  const newRefs: ReferenceForTooltip[] = newReferences.map((ref) => {
    const newId = generateReferenceId(ref.bibtex, existingSet);
    existingSet.add(newId);
    return { id: newId, title: ref.title, bibtex: ref.bibtex };
  });
  
  return [...existing, ...newRefs];
}

/**
 * Get available languages (existing + new + edited)
 */
export function getAvailableLanguages(
  existingLanguages: Array<{ id: string; name: string }>,
  languagesToAdd: LanguageToAdd[],
  languagesToEdit: LanguageToAdd[]
): Array<{ id: string; name: string }> {
  const existing = existingLanguages.map((l) => ({ id: l.id, name: l.name }));
  const newLangs = languagesToAdd.map((l) => ({ id: l.id ?? generateLanguageId(l.name), name: l.name }));
  const editedLangs = languagesToEdit.map((l) => ({ id: l.id ?? generateLanguageId(l.name), name: l.name }));
  return [...existing, ...newLangs, ...editedLangs];
}

/**
 * Convert KCLanguage to the format expected by AddLanguageModal
 */
export function convertLanguageForEdit(lang: any): LanguageToAdd {
  return {
    id: lang.id,
    name: lang.name,
    fullName: lang.fullName || '',
    definition: lang.definition || '',
    definitionRefs: lang.definitionRefs || [],
    queries: lang.properties?.queries || {},
    transformations: lang.properties?.transformations || {},
    tags: (lang.tags || []).map((t: any) => ({ ...t, color: t.color || '#6366f1' })),
    existingReferences: lang.references?.map((r: any) => r.id) || []
  };
}
