import type {
  CustomTag,
  LanguageToAdd,
  ReferenceToAdd,
  RelationshipEntry,
  SubmissionHistoryEntry,
  SubmissionHistoryPayload
} from '../../routes/contribute/types.js';
import type { ContributionQueueEntry } from '../data/contribution-transforms.js';

const HISTORY_STORAGE_KEY = 'kcm_submission_history_v1';
const MAX_ENTRIES = 10;

const isArray = Array.isArray;
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object';

function isLanguageLike(value: unknown): value is LanguageToAdd {
  return isObject(value) && typeof value.name === 'string';
}

function isRelationshipLike(value: unknown): value is RelationshipEntry {
  return (
    isObject(value) &&
    typeof value.sourceId === 'string' &&
    typeof value.targetId === 'string' &&
    typeof value.status === 'string' &&
    Array.isArray(value.refs)
  );
}

function isReferenceLike(value: unknown): value is ReferenceToAdd {
  return (
    isObject(value) &&
    typeof value.bibtex === 'string' &&
    typeof value.title === 'string' &&
    typeof value.href === 'string'
  );
}

function cloneLanguages(items: LanguageToAdd[]): LanguageToAdd[] {
  return items.map((item) => ({
    ...item,
    definitionRefs: [...item.definitionRefs],
    queries: Object.fromEntries(
      Object.entries(item.queries).map(([code, support]) => [code, { ...support, refs: [...support.refs] }])
    ),
    transformations: Object.fromEntries(
      Object.entries(item.transformations).map(([code, support]) => [code, { ...support, refs: [...support.refs] }])
    ),
    tags: item.tags.map((tag) => ({ ...tag, refs: [...tag.refs] })),
    existingReferences: [...item.existingReferences]
  }));
}

function cloneRelationships(items: RelationshipEntry[]): RelationshipEntry[] {
  return items.map((item) => ({
    ...item,
    refs: [...item.refs]
  }));
}

function cloneTags(items: CustomTag[]): CustomTag[] {
  return items.map((tag) => ({ ...tag, refs: [...tag.refs] }));
}

function cloneReferences(items: ReferenceToAdd[]): ReferenceToAdd[] {
  return items.map((item) => ({ ...item }));
}

function cloneQueueEntries(entries: ContributionQueueEntry[]): ContributionQueueEntry[] {
  return entries.map((entry) => {
    switch (entry.kind) {
      case 'language:new':
      case 'language:edit':
        return { ...entry, payload: cloneLanguages([entry.payload])[0] };
      case 'relationship':
        return { ...entry, payload: cloneRelationships([entry.payload])[0] };
      case 'reference':
        return { ...entry, payload: cloneReferences([entry.payload])[0] };
    }
  });
}

function sanitizeQueueEntries(value: unknown): ContributionQueueEntry[] {
  if (!isArray(value)) return [];
  const entries: ContributionQueueEntry[] = [];
  let fallbackIndex = 0;
  for (const item of value) {
    if (!isObject(item)) continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : `history-entry-${fallbackIndex++}`;
    const kind = raw.kind;
    switch (kind) {
      case 'language:new':
      case 'language:edit':
        if (isLanguageLike(raw.payload)) {
          entries.push({ id, kind, payload: cloneLanguages([raw.payload])[0] });
        }
        break;
      case 'relationship':
        if (isRelationshipLike(raw.payload)) {
          entries.push({ id, kind, payload: cloneRelationships([raw.payload])[0] });
        }
        break;
      case 'reference':
        if (isReferenceLike(raw.payload)) {
          entries.push({ id, kind, payload: cloneReferences([raw.payload])[0] });
        }
        break;
      default:
        break;
    }
  }
  return entries;
}

function sanitizeHistoryEntry(raw: unknown): SubmissionHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = typeof entry.id === 'string' ? entry.id : null;
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : null;
  if (!id || !createdAt) return null;

  const payloadRaw = entry.payload as Record<string, unknown> | undefined;
  if (!payloadRaw || typeof payloadRaw !== 'object') return null;

  const submissionId = typeof payloadRaw.submissionId === 'string' ? payloadRaw.submissionId : id;
  const supersedesSubmissionId = typeof payloadRaw.supersedesSubmissionId === 'string' ? payloadRaw.supersedesSubmissionId : null;
  const contributorRaw = payloadRaw.contributor as Record<string, unknown> | undefined;
  const contributor = contributorRaw && typeof contributorRaw === 'object'
    ? {
        email: typeof contributorRaw.email === 'string' ? contributorRaw.email : '',
        github: typeof contributorRaw.github === 'string' ? contributorRaw.github : '',
        note: typeof contributorRaw.note === 'string' ? contributorRaw.note : ''
      }
    : { email: '', github: '', note: '' };

  const asLanguageArray = (value: unknown): LanguageToAdd[] =>
    isArray(value)
      ? cloneLanguages(
          value.filter((item): item is LanguageToAdd => !!item && typeof item === 'object') as LanguageToAdd[]
        )
      : [];

  const asRelationshipArray = (value: unknown): RelationshipEntry[] =>
    isArray(value)
      ? cloneRelationships(
          value.filter((item): item is RelationshipEntry => !!item && typeof item === 'object') as RelationshipEntry[]
        )
      : [];

  const asStringArray = (value: unknown): string[] =>
    isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const asReferenceArray = (value: unknown): ReferenceToAdd[] =>
    isArray(value)
      ? cloneReferences(
          value.filter((item): item is ReferenceToAdd => isReferenceLike(item))
        )
      : [];

  const asTagArray = (value: unknown): CustomTag[] =>
    isArray(value)
      ? cloneTags(value.filter((item): item is CustomTag => !!item && typeof item === 'object') as CustomTag[])
      : [];

  const payload: SubmissionHistoryPayload = {
    submissionId,
    supersedesSubmissionId,
    languagesToAdd: asLanguageArray(payloadRaw.languagesToAdd),
    languagesToEdit: asLanguageArray(payloadRaw.languagesToEdit),
    relationships: asRelationshipArray(payloadRaw.relationships),
    newReferences: asReferenceArray(payloadRaw.newReferences),
    customTags: asTagArray(payloadRaw.customTags),
    modifiedRelations: asStringArray(payloadRaw.modifiedRelations),
    contributor,
    queueEntries: undefined
  };

  const sanitizedQueueEntries = sanitizeQueueEntries(payloadRaw.queueEntries);
  if (sanitizedQueueEntries.length === 0) {
    console.warn('Skipping submission history entry without queue entries', id);
    return null;
  }
  payload.queueEntries = sanitizedQueueEntries;

  const summaryRaw = entry.summary as Record<string, unknown> | undefined;
  const summary = summaryRaw && typeof summaryRaw === 'object'
    ? {
        languagesToAdd: Number(summaryRaw.languagesToAdd) || payload.languagesToAdd.length,
        languagesToEdit: Number(summaryRaw.languagesToEdit) || payload.languagesToEdit.length,
        relationships: Number(summaryRaw.relationships) || payload.relationships.length,
        newReferences: Number(summaryRaw.newReferences) || payload.newReferences.length
      }
    : {
        languagesToAdd: payload.languagesToAdd.length,
        languagesToEdit: payload.languagesToEdit.length,
        relationships: payload.relationships.length,
        newReferences: payload.newReferences.length
      };

  const supersededBySubmissionId = typeof entry.supersededBySubmissionId === 'string' ? entry.supersededBySubmissionId : undefined;

  return {
    id,
    createdAt,
    summary,
    payload,
    supersedesSubmissionId,
    supersededBySubmissionId
  };
}

function sanitizeHistory(raw: unknown): SubmissionHistoryEntry[] {
  if (!isArray(raw)) return [];
  const cleaned = raw
    .map((item) => sanitizeHistoryEntry(item))
    .filter((item): item is SubmissionHistoryEntry => item !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return cleaned.slice(0, MAX_ENTRIES);
}

export function loadSubmissionHistory(): SubmissionHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeHistory(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to load submission history', error);
    return [];
  }
}

export function saveSubmissionHistory(entries: SubmissionHistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (error) {
    console.warn('Failed to save submission history', error);
  }
}

function createSubmissionHistoryEntry(payload: SubmissionHistoryPayload): SubmissionHistoryEntry {
  const createdAt = new Date().toISOString();
  return {
    id: payload.submissionId,
    createdAt,
    summary: {
      languagesToAdd: payload.languagesToAdd.length,
      languagesToEdit: payload.languagesToEdit.length,
      relationships: payload.relationships.length,
      newReferences: payload.newReferences.length
    },
    payload: {
      ...payload,
      languagesToAdd: cloneLanguages(payload.languagesToAdd),
      languagesToEdit: cloneLanguages(payload.languagesToEdit),
      relationships: cloneRelationships(payload.relationships),
      newReferences: [...payload.newReferences],
      customTags: cloneTags(payload.customTags),
      modifiedRelations: [...payload.modifiedRelations],
      contributor: { ...payload.contributor },
      queueEntries: payload.queueEntries ? cloneQueueEntries(payload.queueEntries) : undefined
    },
    supersedesSubmissionId: payload.supersedesSubmissionId ?? null,
    supersededBySubmissionId: undefined
  };
}

export function recordSubmissionHistory(payload: SubmissionHistoryPayload): SubmissionHistoryEntry[] {
  const existing = loadSubmissionHistory();
  const entry = createSubmissionHistoryEntry(payload);
  const filtered = existing.filter((item) => item.id !== entry.id);

  if (entry.supersedesSubmissionId) {
    const superseded = filtered.find((item) => item.id === entry.supersedesSubmissionId);
    if (superseded) {
      superseded.supersededBySubmissionId = entry.id;
    }
  }

  const next = [entry, ...filtered];
  const capped = next.slice(0, MAX_ENTRIES);
  saveSubmissionHistory(capped);
  return capped;
}

/**
 * Derive queue entries from a submission history payload.
 * Throws if the payload doesn't have queueEntries (legacy format).
 */
export function deriveQueueEntriesFromHistory(payload: SubmissionHistoryPayload): ContributionQueueEntry[] {
  if (!Array.isArray(payload.queueEntries) || payload.queueEntries.length === 0) {
    throw new Error('Submission history entry is missing queueEntries.');
  }
  return cloneQueueEntries(payload.queueEntries);
}
