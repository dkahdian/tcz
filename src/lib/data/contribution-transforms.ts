import type {
  GraphData,
  KCLanguage,
  KCReference,
  DirectedSuccinctnessRelation,
  KCSeparatingFunction
} from '../types.js';
import { generateLanguageId } from '../utils/language-id.js';
import type {
  LanguageToAdd,
  RelationshipEntry,
  SeparatingFunctionToAdd,
  ReferenceToAdd,
  CustomTag
} from '../../routes/contribute/types.js';
import { cloneDataset } from './transforms.js';
import { validateDatasetStructure } from './validation/index.js';
import { propagateImplicitRelations } from './propagation/index.js';
import { isValidComplexityCode } from './complexities.js';
import { generateReferenceId } from '../utils/reference-id.js';

export type ContributionQueueEntry =
  | { id: string; kind: 'reference'; payload: ReferenceToAdd }
  | { id: string; kind: 'separator'; payload: SeparatingFunctionToAdd }
  | { id: string; kind: 'language:new'; payload: LanguageToAdd }
  | { id: string; kind: 'language:edit'; payload: LanguageToAdd }
  | { id: string; kind: 'relationship'; payload: RelationshipEntry };

export interface ContributionQueueState {
  entries: ContributionQueueEntry[];
  customTags: CustomTag[];
  modifiedRelations: string[];
  submissionId?: string;
  supersedesSubmissionId?: string | null;
}

export interface ContributionSubmissionPayload {
  submissionId: string;
  supersedesSubmissionId?: string | null;
  contributor: {
    email: string;
    github?: string;
    note?: string;
  };
  queue: ContributionQueueState;
}

function convertToKCLanguage(
  language: LanguageToAdd,
  referenceLookup: Map<string, KCReference>,
  classification: KCLanguage['classification'] = 'plain'
): KCLanguage {
  const references: KCReference[] = [];
  for (const refId of language.definitionRefs) {
    const ref = referenceLookup.get(refId);
    if (ref) {
      references.push(ref);
    }
  }

  return {
    id: language.id ?? generateLanguageId(language.name),
    name: language.name,
    classification,
    fullName: language.fullName,
    definition: language.definition,
    definitionRefs: [...language.definitionRefs],
    properties: {
      queries: language.queries,
      transformations: language.transformations
    },
    tags: language.tags,
    references
  };
}

export function applyContributionQueue(
  base: GraphData,
  queue: ContributionQueueState
): GraphData {
  const merged = cloneDataset(base);

  const normalizeOperationComplexities = () => {
    for (const language of merged.languages) {
      const queryMap = language.properties?.queries;
      if (queryMap && typeof queryMap === 'object') {
        for (const support of Object.values(queryMap)) {
          const complexity = (support as any)?.complexity;
          if (typeof complexity !== 'string' || !isValidComplexityCode(complexity)) {
            (support as any).complexity = 'unknown-to-us';
          }
        }
      }

      const transformationMap = language.properties?.transformations;
      if (transformationMap && typeof transformationMap === 'object') {
        for (const support of Object.values(transformationMap)) {
          const complexity = (support as any)?.complexity;
          if (typeof complexity !== 'string' || !isValidComplexityCode(complexity)) {
            (support as any).complexity = 'unknown-to-us';
          }
        }
      }
    }
  };

  const ensureLanguageInMatrix = (id: string) => {
    const { adjacencyMatrix } = merged;
    if (id in adjacencyMatrix.indexByLanguage) {
      return;
    }

    const newIndex = adjacencyMatrix.languageIds.length;
    adjacencyMatrix.languageIds.push(id);
    adjacencyMatrix.indexByLanguage[id] = newIndex;
    for (const row of adjacencyMatrix.matrix) {
      row.push(null);
    }
    adjacencyMatrix.matrix.push(new Array(newIndex + 1).fill(null));
  };

  const referenceLookup = new Map<string, KCReference>();
  if (merged.references) {
    for (const reference of merged.references) {
      referenceLookup.set(reference.id, reference);
    }
  }
  const referenceIds = new Set(referenceLookup.keys());

  const separatingFunctionLookup = new Map<string, KCSeparatingFunction>();
  if (merged.separatingFunctions) {
    for (const fn of merged.separatingFunctions) {
      separatingFunctionLookup.set(fn.shortName, fn);
    }
  }

  const modifiedSet = new Set(queue.modifiedRelations ?? []);

  const addSeparatingFunction = (entry: SeparatingFunctionToAdd) => {
    const resolved: KCSeparatingFunction = {
      shortName: entry.shortName,
      name: entry.name,
      description: entry.description,
      refs: [...entry.refs]
    };
    separatingFunctionLookup.set(resolved.shortName, resolved);
    merged.separatingFunctions = [...(merged.separatingFunctions ?? []), resolved];
  };

  const applyRelationship = (rel: RelationshipEntry) => {
    ensureLanguageInMatrix(rel.sourceId);
    ensureLanguageInMatrix(rel.targetId);

    const sourceIdx = merged.adjacencyMatrix.indexByLanguage[rel.sourceId];
    const targetIdx = merged.adjacencyMatrix.indexByLanguage[rel.targetId];
    if (sourceIdx === undefined || targetIdx === undefined) return;

    const relationKey = `${rel.sourceId}->${rel.targetId}`;
    if (modifiedSet.size > 0 && !modifiedSet.has(relationKey)) {
      const existing = merged.adjacencyMatrix.matrix[sourceIdx]?.[targetIdx];
      if (existing) {
        return;
      }
    }

    // If the status is 'unknown-to-us' or empty, this means "remove the edge" (set to null)
    if (!rel.status || rel.status === 'unknown-to-us') {
      merged.adjacencyMatrix.matrix[sourceIdx][targetIdx] = null;
      return;
    }

    // Collect separating function IDs
    const separatingFunctionIds: string[] = [];
    if (rel.separatingFunctionIds && rel.separatingFunctionIds.length > 0) {
      for (const id of rel.separatingFunctionIds) {
        if (separatingFunctionLookup.has(id)) {
          separatingFunctionIds.push(id);
        }
      }
    }

    const relation: DirectedSuccinctnessRelation = {
      status: rel.status,
      description: rel.description,
      assumption: rel.assumption,
      refs: [...rel.refs],
      separatingFunctionIds: separatingFunctionIds.length > 0 ? separatingFunctionIds : undefined,
      // Explicitly mark as not derived since this is user-contributed
      derived: false
    };
    merged.adjacencyMatrix.matrix[sourceIdx][targetIdx] = relation;
  };

  for (const entry of queue.entries) {
    switch (entry.kind) {
      case 'reference': {
        const refData = entry.payload;
        const generatedId = generateReferenceId(refData.bibtex, referenceIds);
        referenceIds.add(generatedId);
        const reference: KCReference = {
          id: generatedId,
          title: refData.title,
          href: refData.href,
          bibtex: refData.bibtex
        };
        referenceLookup.set(generatedId, reference);
        merged.references = [...(merged.references ?? []), reference];
        break;
      }
      case 'separator': {
        addSeparatingFunction(entry.payload);
        break;
      }
      case 'language:new': {
        const kcLanguage = convertToKCLanguage(entry.payload, referenceLookup, 'plain');
        merged.languages.push(kcLanguage);
        ensureLanguageInMatrix(kcLanguage.id);
        break;
      }
      case 'language:edit': {
        const langId = entry.payload.id ?? generateLanguageId(entry.payload.name);
        const index = merged.languages.findIndex((existing) => existing.id === langId);
        if (index === -1) {
          // If language not present yet, treat as addition to keep queue idempotent
          const kcLanguage = convertToKCLanguage(entry.payload, referenceLookup, 'plain');
          merged.languages.push(kcLanguage);
          ensureLanguageInMatrix(kcLanguage.id);
        } else {
          merged.languages[index] = convertToKCLanguage(
            entry.payload,
            referenceLookup,
            merged.languages[index].classification ?? 'plain'
          );
        }
        break;
      }
      case 'relationship': {
        applyRelationship(entry.payload);
        break;
      }
    }
  }

  // Queued contribution payloads may include older/partial operation maps.
  // Normalize invalid/missing complexity codes so preview datasets still build.
  normalizeOperationComplexities();

  const validation = validateDatasetStructure(merged);
  if (!validation.ok) {
    const detail = validation.errors?.join('; ') ?? 'unknown structural error';
    throw new Error(`Contribution queue produced an invalid dataset: ${detail}`);
  }

  return propagateImplicitRelations(merged);
}
