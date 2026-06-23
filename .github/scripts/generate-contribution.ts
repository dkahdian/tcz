import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GraphData, KCLanguage, KCReference } from '../../src/lib/types.js';
import {
  applyContributionQueue,
  type ContributionQueueState,
  type ContributionSubmissionPayload
} from '../../src/lib/data/contribution-transforms.js';
import { canonicalDataset } from '../../src/lib/data/canonical.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const contributionPath = path.join(rootDir, 'contribution.json');
const databasePath = path.join(rootDir, 'src/lib/data/database.json');

type RawReference = { id: string; bibtex: string; title?: string; href?: string };
type RawDatabase = {
  languages: unknown[];
  references?: RawReference[];
  relationTypes?: unknown[];
  adjacencyMatrix: { languageIds: string[]; matrix: unknown[][] };
  metadata?: Record<string, unknown>;
};

function readJSON(filePath: string): any {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) {
    throw new Error(`${path.basename(filePath)} is empty.`);
  }
  return JSON.parse(raw);
}

function normalizeQueue(
  rawQueue: any,
  submissionId: string,
  supersedesSubmissionId: string | null
): ContributionQueueState {
  if (!rawQueue || typeof rawQueue !== 'object') {
    throw new Error('Contribution payload is missing the ordered queue.');
  }
  const entries = Array.isArray(rawQueue.entries) ? rawQueue.entries : [];
  if (entries.length === 0) {
    throw new Error('Ordered queue must include at least one entry.');
  }
  return {
    entries,
    modifiedRelations: Array.isArray(rawQueue.modifiedRelations)
      ? rawQueue.modifiedRelations
      : [],
    submissionId,
    supersedesSubmissionId
  };
}

function readContribution(): ContributionSubmissionPayload {
  const payload = readJSON(contributionPath);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Contribution payload is malformed.');
  }

  const submissionId = typeof payload.submissionId === 'string' && payload.submissionId.trim()
    ? payload.submissionId.trim()
    : null;
  if (!submissionId) {
    throw new Error('submissionId is required.');
  }

  const supersedesSubmissionId =
    typeof payload.supersedesSubmissionId === 'string' && payload.supersedesSubmissionId.trim()
      ? payload.supersedesSubmissionId.trim()
      : null;

  const contributor = payload.contributor;
  if (!contributor || typeof contributor !== 'object' || typeof contributor.email !== 'string') {
    throw new Error('Contributor email is required.');
  }

  const queue = normalizeQueue(payload.queue, submissionId, supersedesSubmissionId);

  return {
    submissionId,
    supersedesSubmissionId,
    contributor: {
      email: contributor.email,
      github:
        typeof contributor.github === 'string' && contributor.github.trim()
          ? contributor.github.trim()
          : undefined,
      note:
        typeof contributor.note === 'string' && contributor.note.trim()
          ? contributor.note.trim()
          : undefined
    },
    queue
  } satisfies ContributionSubmissionPayload;
}

function serializeLanguages(languages: KCLanguage[]): unknown[] {
  return languages.map((language) => {
    const { references: _references, visual: _visual, ...rest } = language;
    return rest;
  });
}

function serializeReferences(
  references: KCReference[],
  existing: RawReference[] = []
): RawReference[] {
  const ordered: RawReference[] = [];
  const seen = new Set<string>();
  const lookup = new Map(references.map((ref) => [ref.id, ref]));

  for (const ref of existing) {
    const updated = lookup.get(ref.id);
    if (!updated || seen.has(ref.id)) continue;
    const entry: RawReference = { id: updated.id, bibtex: updated.bibtex };
    if (updated.title) entry.title = updated.title;
    if (updated.href) entry.href = updated.href;
    ordered.push(entry);
    seen.add(ref.id);
    lookup.delete(ref.id);
  }

  for (const ref of references) {
    if (seen.has(ref.id)) continue;
    const entry: RawReference = { id: ref.id, bibtex: ref.bibtex };
    if (ref.title) entry.title = ref.title;
    if (ref.href) entry.href = ref.href;
    ordered.push(entry);
    seen.add(ref.id);
  }

  return ordered;
}

function buildDatabasePayload(current: RawDatabase, dataset: GraphData): RawDatabase {
  const references = serializeReferences(dataset.references, current.references ?? []);
  const languages = serializeLanguages(dataset.languages);

  return {
    ...current,
    languages,
    references,
    relationTypes: dataset.relationTypes,
    adjacencyMatrix: {
      languageIds: [...dataset.adjacencyMatrix.languageIds],
      matrix: dataset.adjacencyMatrix.matrix
    },
    metadata: dataset.metadata ?? current.metadata
  };
}

function writeDatabase(payload: RawDatabase): void {
  const serialized = JSON.stringify(payload, null, 2);
  fs.writeFileSync(databasePath, `${serialized}\n`, 'utf8');
}

try {
  console.log('📥 Loading contribution payload...');
  const submission = readContribution();

  console.log(`🔁 Replaying ${submission.queue.entries.length} queue entries...`);
  const updatedDataset = applyContributionQueue(canonicalDataset, submission.queue);

  console.log('🗂️ Loading current canonical database...');
  const currentDatabase = readJSON(databasePath) as RawDatabase;

  console.log('📝 Writing updated database.json...');
  const nextDatabase = buildDatabasePayload(currentDatabase, updatedDataset);
  writeDatabase(nextDatabase);

  console.log(
    `✅ Contribution applied. Languages: ${updatedDataset.languages.length}, references: ${
      nextDatabase.references?.length ?? 0
    }.`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n❌ Unable to apply contribution queue:', message);
  process.exit(1);
}
