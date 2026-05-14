import type { PageLoad } from './$types.js';
import { redirect } from '@sveltejs/kit';
import { allLanguages } from '$lib/data/languages.js';
import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';
import { COMPLEXITIES } from '$lib/data/complexities.js';
import { adjacencyMatrixData } from '$lib/data/edges.js';
import { relationTypes } from '$lib/data/complexities.js';
import { allSeparatingFunctions } from '$lib/data/separating-functions.js';
import { allReferences } from '$lib/data/references.js';

const CONTRIBUTIONS_ENABLED = false;

export const load: PageLoad = () => {
  if (!CONTRIBUTIONS_ENABLED) {
    throw redirect(307, '/');
  }

  const existingLanguageIds = allLanguages.map((lang) => lang.name);

  const existingReferences = allReferences.map((ref) => ({ id: ref.id, title: ref.title, bibtex: ref.bibtex }));

  const tagLookup = new Map<string, { label: string; color?: string }>();
  for (const language of allLanguages) {
    if (!language.tags) continue;
    for (const tag of language.tags) {
      if (!tagLookup.has(tag.label)) {
        tagLookup.set(tag.label, { label: tag.label, color: tag.color });
      }
    }
  }

  const existingTags = Array.from(tagLookup.values());

  const existingSeparatingFunctions = allSeparatingFunctions.map(sf => ({
    shortName: sf.shortName,
    name: sf.name,
    description: sf.description
  }));

  return {
    existingLanguageIds,
    existingReferences,
    existingSeparatingFunctions,
    existingTags,
    languages: allLanguages,
    queries: QUERIES,
    transformations: TRANSFORMATIONS,
    complexityOptions: COMPLEXITIES,
    adjacencyMatrix: adjacencyMatrixData,
    relationTypes
  };
};

export const prerender = false;
