import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GraphData, KCLanguage, KCReference } from '../../src/lib/types.js';
import {
  applySandboxEdits,
  type SandboxContributionSubmissionPayload,
  type SandboxEdit
} from '../../src/lib/data/sandbox-transforms.js';
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
  defaultNodePositionsByLanguageName?: GraphData['defaultNodePositionsByLanguageName'];
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

function normalizeSandboxEdits(rawSandbox: any): SandboxEdit[] {
  if (!rawSandbox || typeof rawSandbox !== 'object' || !Array.isArray(rawSandbox.edits)) {
    throw new Error('Contribution payload is missing sandbox edits.');
  }
  if (rawSandbox.edits.length === 0) {
    throw new Error('Sandbox contribution must include at least one edit.');
  }
  return rawSandbox.edits as SandboxEdit[];
}

function readContribution(): SandboxContributionSubmissionPayload {
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

  const contributor = payload.contributor;
  if (
    !contributor ||
    typeof contributor !== 'object' ||
    typeof contributor.name !== 'string' ||
    typeof contributor.email !== 'string' ||
    !contributor.name.trim() ||
    !contributor.email.trim()
  ) {
    throw new Error('Contributor name and email are required.');
  }

  const edits = normalizeSandboxEdits(payload.sandbox);

  return {
    submissionId,
    contributor: {
      name: contributor.name.trim(),
      email: contributor.email.trim(),
      github:
        typeof contributor.github === 'string' && contributor.github.trim()
          ? contributor.github.trim()
          : undefined,
      note:
        typeof contributor.note === 'string' && contributor.note.trim()
          ? contributor.note.trim()
          : undefined
    },
    sandbox: {
      edits
    }
  } satisfies SandboxContributionSubmissionPayload;
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
    defaultNodePositionsByLanguageName: dataset.defaultNodePositionsByLanguageName,
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

  console.log(`🔁 Replaying ${submission.sandbox.edits.length} sandbox edits...`);
  const evaluation = applySandboxEdits(canonicalDataset, submission.sandbox.edits);
  if (!evaluation.ok) {
    throw new Error(evaluation.error);
  }
  const updatedDataset = evaluation.graphData;

  console.log('🗂️ Loading current canonical database...');
  const currentDatabase = readJSON(databasePath) as RawDatabase;

  console.log('📝 Writing updated database.json...');
  const nextDatabase = buildDatabasePayload(currentDatabase, updatedDataset);
  writeDatabase(nextDatabase);

  console.log(
    `Contribution applied. Languages: ${updatedDataset.languages.length}, references: ${
      nextDatabase.references?.length ?? 0
    }.`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n❌ Unable to apply sandbox contribution:', message);
  process.exit(1);
}
