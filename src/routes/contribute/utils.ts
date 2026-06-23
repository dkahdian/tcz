/**
 * Utility functions for the contribute page.
 * Contains sanitizers, cloners, ID generators, and formatting helpers.
 */

import type {
  LanguageToAdd,
  RelationshipEntry,
  SubmissionHistoryEntry
} from './types.js';
import type { ContributionQueueEntry } from '$lib/data/contribution-transforms.js';
import { cloneOperationSupport } from './logic.js';

// ============================================================================
// Type Guards
// ============================================================================

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// ============================================================================
// Sanitizers
// ============================================================================

export function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isString);
}

export function sanitizeOperationSupportRecord(
  value: unknown
): Record<string, { complexity: string; note?: string; refs: string[] }> {
  if (typeof value !== 'object' || value === null) return {};
  const result: Record<string, { complexity: string; note?: string; refs: string[] }> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'object' && val !== null && 'complexity' in val) {
      const entry = val as Record<string, unknown>;
      result[key] = {
        complexity: isString(entry.complexity) ? entry.complexity : '',
        note: isString(entry.note) ? entry.note : undefined,
        refs: sanitizeStringArray(entry.refs)
      };
    }
  }
  return result;
}

export function sanitizeSubmissionId(value: unknown): string | null {
  if (!isString(value) || value.length === 0) return null;
  // Basic validation: should look like a submission ID
  if (!/^[a-z0-9-]+$/i.test(value)) return null;
  return value;
}

// ============================================================================
// Cloners
// ============================================================================

export function cloneLanguageEntry(entry: LanguageToAdd): LanguageToAdd {
  return {
    id: entry.id,
    name: entry.name,
    fullName: entry.fullName,
    definition: entry.definition,
    definitionRefs: [...entry.definitionRefs],
    queries: cloneOperationSupport(entry.queries),
    transformations: cloneOperationSupport(entry.transformations),
    existingReferences: [...entry.existingReferences]
  };
}

export function cloneRelationshipEntry(entry: RelationshipEntry): RelationshipEntry {
  return {
    sourceId: entry.sourceId,
    targetId: entry.targetId,
    status: entry.status,
    description: entry.description,
    assumption: entry.assumption,
    refs: [...entry.refs]
  };
}

export function cloneQueueEntry(entry: ContributionQueueEntry): ContributionQueueEntry {
  switch (entry.kind) {
    case 'language:new':
    case 'language:edit':
      return { id: entry.id, kind: entry.kind, payload: cloneLanguageEntry(entry.payload) };
    case 'relationship':
      return { id: entry.id, kind: entry.kind, payload: cloneRelationshipEntry(entry.payload) };
    case 'reference':
      return { id: entry.id, kind: entry.kind, payload: entry.payload };
  }
}

// ============================================================================
// ID Generators
// ============================================================================

export function createSubmissionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

export function createQueueEntryId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

// ============================================================================
// History Formatting
// ============================================================================

export function formatHistoryTimestamp(iso: string): string {
  const date = new Date(iso);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  const time = date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day}, ${year} at ${time}`;
}

export function formatHistorySummary(entry: SubmissionHistoryEntry): string {
  const segments: string[] = [];

  if (entry.summary.languagesToAdd) {
    segments.push(`${entry.summary.languagesToAdd} new language${entry.summary.languagesToAdd === 1 ? '' : 's'}`);
  }
  if (entry.summary.languagesToEdit) {
    segments.push(`${entry.summary.languagesToEdit} edit${entry.summary.languagesToEdit === 1 ? '' : 's'}`);
  }
  if (entry.summary.relationships) {
    segments.push(`${entry.summary.relationships} relation${entry.summary.relationships === 1 ? '' : 's'}`);
  }
  if (entry.summary.newReferences) {
    segments.push(`${entry.summary.newReferences} reference${entry.summary.newReferences === 1 ? '' : 's'}`);
  }

  return segments.length > 0 ? segments.join(' · ') : 'No changes';
}
