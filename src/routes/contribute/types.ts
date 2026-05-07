import type { ContributionQueueEntry } from '$lib/data/contribution-transforms.js';
import type { KCOpSupport } from '$lib/types.js';

export type SeparatingFunctionToAdd = {
  shortName: string;
  name: string;
  description: string;
  refs: string[];
};

export type RelationshipEntry = {
  sourceId: string;
  targetId: string;
  /** Complexity code (use getComplexity() for display) */
  status: string;
  description?: string;
  assumption?: string;
  refs: string[];
  separatingFunctionIds?: string[]; // Array of shortNames referencing top-level separatingFunctions
};

/**
 * Reference entry with pre-parsed display fields.
 * The title and href are parsed from bibtex but can be edited by the user.
 */
export type ReferenceToAdd = {
  bibtex: string;
  /** Pre-parsed/verified display title in IEEE format */
  title: string;
  /** Pre-parsed/verified URL for the reference */
  href: string;
};

export type LanguageToAdd = {
  id?: string;
  name: string;
  fullName: string;
  definition: string;
  definitionRefs: string[];
  queries: Record<string, KCOpSupport>;
  transformations: Record<string, KCOpSupport>;
  tags: Array<{ label: string; color: string; description?: string; refs: string[] }>;
  existingReferences: string[];
};

export type CustomTag = {
  label: string;
  color: string;
  description?: string;
  refs: string[];
};

export type ContributorInfo = {
  email: string;
  github: string;
  note: string;
};

export type SubmissionHistoryPayload = {
  submissionId: string;
  supersedesSubmissionId?: string | null;
  languagesToAdd: LanguageToAdd[];
  languagesToEdit: LanguageToAdd[];
  relationships: RelationshipEntry[];
  newReferences: ReferenceToAdd[];
  newSeparatingFunctions: SeparatingFunctionToAdd[];
  customTags: CustomTag[];
  modifiedRelations: string[];
  contributor: ContributorInfo;
  queueEntries?: ContributionQueueEntry[];
};

export type SubmissionHistoryEntry = {
  id: string;
  createdAt: string;
  summary: {
    languagesToAdd: number;
    languagesToEdit: number;
    relationships: number;
    newReferences: number;
  };
  payload: SubmissionHistoryPayload;
  supersedesSubmissionId?: string | null;
  supersededBySubmissionId?: string;
};
