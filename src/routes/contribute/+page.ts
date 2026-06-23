import type { PageLoad } from './$types.js';
import { redirect } from '@sveltejs/kit';
import { allLanguages } from '$lib/data/languages.js';
import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';
import { COMPLEXITIES } from '$lib/data/complexities.js';
import { adjacencyMatrixData } from '$lib/data/edges.js';
import { relationTypes } from '$lib/data/complexities.js';
import { allReferences } from '$lib/data/references.js';

const CONTRIBUTIONS_ENABLED = false;

export const load: PageLoad = () => {
  if (!CONTRIBUTIONS_ENABLED) {
    throw redirect(307, '/');
  }

  const existingLanguageIds = allLanguages.map((lang) => lang.name);

  const existingReferences = allReferences.map((ref) => ({ id: ref.id, title: ref.title, bibtex: ref.bibtex }));

  return {
    existingLanguageIds,
    existingReferences,
    languages: allLanguages,
    queries: QUERIES,
    transformations: TRANSFORMATIONS,
    complexityOptions: COMPLEXITIES,
    adjacencyMatrix: adjacencyMatrixData,
    relationTypes
  };
};

export const prerender = false;
