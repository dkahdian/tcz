import type { GraphData } from './types.js';
import type { ContributionQueueEntry, ContributionQueueState } from './data/contribution-transforms.js';
import type { ContributorInfo } from '../routes/contribute/types.js';

export const QUEUE_STORAGE_KEY = 'kcm_contribute_queue_v1';
export const CONTRIBUTOR_STORAGE_KEY = 'kcm_contributor_info_v1';
export const PREVIEW_DATASET_STORAGE_KEY = 'kcm_contribute_preview_dataset_v1';

function getStoredValue(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}

function setStoredValue(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

function removeStoredValue(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}

export function hasQueuedChanges(): boolean {
  return getStoredValue(QUEUE_STORAGE_KEY) !== null;
}

export type ContributionQueueSnapshot = ContributionQueueState;

function normalizeEntries(parsed: any): ContributionQueueEntry[] {
  if (!Array.isArray(parsed?.entries) || parsed.entries.length === 0) {
    throw new Error('Stored queue is missing ordered entries.');
  }
  return parsed.entries as ContributionQueueEntry[];
}

export function loadQueuedChanges(): ContributionQueueSnapshot | null {
  const stored = getStoredValue(QUEUE_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    const snapshot: ContributionQueueSnapshot = {
      entries: normalizeEntries(parsed),
      modifiedRelations: parsed.modifiedRelations || [],
      submissionId: typeof parsed.submissionId === 'string' ? parsed.submissionId : undefined,
      supersedesSubmissionId:
        typeof parsed.supersedesSubmissionId === 'string' ? parsed.supersedesSubmissionId : null
    };
    return snapshot;
  } catch (error) {
    console.error('Failed to load queued changes:', error);
    return null;
  }
}

export function clearQueuedChanges(): void {
  removeStoredValue(QUEUE_STORAGE_KEY);
  removeStoredValue(PREVIEW_DATASET_STORAGE_KEY);
  removeStoredValue(CONTRIBUTOR_STORAGE_KEY);
}

export function loadContributorInfo(): ContributorInfo | null {
  const stored = getStoredValue(CONTRIBUTOR_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as ContributorInfo;
  } catch (error) {
    console.error('Failed to load contributor info:', error);
    return null;
  }
}

export function savePreviewDataset(dataset: GraphData | null): void {
  if (dataset === null) {
    removeStoredValue(PREVIEW_DATASET_STORAGE_KEY);
    return;
  }
  try {
    setStoredValue(PREVIEW_DATASET_STORAGE_KEY, JSON.stringify(dataset));
  } catch (error) {
    console.error('Failed to persist preview dataset:', error);
  }
}

export function loadPreviewDataset(): GraphData | null {
  const stored = getStoredValue(PREVIEW_DATASET_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as GraphData;
  } catch (error) {
    console.error('Failed to load preview dataset:', error);
    return null;
  }
}
