import type { KCLanguage } from '../types.js';
import database from './database.json';
import { getReferences } from './references.js';
import { LANGUAGE_CLASSIFICATIONS } from './language-classifications.js';
import { extractCitationKeys } from '../utils/math-text.js';

const rawLanguages = database.languages as any[];

// Helper to add references to language JSON data
function enrichLanguage(langJson: any): KCLanguage {
  const refIds = new Set<string>();
  
  // Collect all reference IDs
  if (langJson.definitionRefs) {
    langJson.definitionRefs.forEach((id: string) => refIds.add(id));
  }

  if (langJson.definition) {
    extractCitationKeys(langJson.definition).forEach((id) => refIds.add(id));
  }
  
  if (langJson.properties?.queries) {
    Object.values(langJson.properties.queries).forEach((q: any) => {
      if (q.refs) q.refs.forEach((id: string) => refIds.add(id));
    });
  }
  
  if (langJson.properties?.transformations) {
    Object.values(langJson.properties.transformations).forEach((t: any) => {
      if (t.refs) t.refs.forEach((id: string) => refIds.add(id));
    });
  }
  
  if (langJson.tags) {
    langJson.tags.forEach((tag: any) => {
      if (tag.refs) tag.refs.forEach((id: string) => refIds.add(id));
    });
  }
  
  return {
    ...langJson,
    classification: LANGUAGE_CLASSIFICATIONS[langJson.id] ?? 'plain',
    references: getReferences(...Array.from(refIds))
  } as KCLanguage;
}

export const allLanguages: KCLanguage[] = rawLanguages.map(enrichLanguage);
