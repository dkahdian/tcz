import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { SandboxEdit, SandboxContributionSubmissionPayload } from '../../src/lib/data/sandbox-transforms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const contributionPath = path.join(rootDir, 'contribution.json');
const databasePath = path.join(rootDir, 'src/lib/data/database.json');
const reportJsonPath = path.join(rootDir, '.github/contribution-report.json');
const reportBodyPath = path.join(rootDir, '.github/contribution-pr-body.md');

const EXPECTED_CHANGED_FILES = new Set([
  'src/lib/data/database.json',
  'docs/definitions.tex',
  'docs/languages.tex',
  'docs/succinctness.tex',
  'docs/queries.tex',
  'docs/transformations.tex',
  'docs/refs.bib'
]);

const IGNORED_WORKFLOW_FILES = new Set([
  'contribution.json',
  '.github/contribution-report.json',
  '.github/contribution-pr-body.md'
]);

type DatabaseShape = {
  languages: Array<{ id: string; name: string }>;
  operations?: {
    queries?: Record<string, { code: string; label: string }>;
    transformations?: Record<string, { code: string; label: string }>;
  };
};

type ChangedFile = {
  status: string;
  path: string;
  expected: boolean;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function normalizeGithub(value: string | undefined): string {
  return (value ?? '').trim().replace(/^@+/, '');
}

function parseBibtexId(bibtex: string): string {
  const match = bibtex.match(/^@\w+\s*\{\s*([^,\s]+)\s*,/);
  return match?.[1]?.trim() || 'new BibTeX entry';
}

function changedFiles(): ChangedFile[] {
  const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const rawPath = line.slice(3);
      const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() ?? rawPath : rawPath;
      return {
        status,
        path: filePath,
        expected: EXPECTED_CHANGED_FILES.has(filePath) || IGNORED_WORKFLOW_FILES.has(filePath)
      };
    })
    .filter((file) => !IGNORED_WORKFLOW_FILES.has(file.path));
}

function operationLabel(database: DatabaseShape, kind: 'query' | 'transformation', code: string): string {
  const table = kind === 'query' ? database.operations?.queries : database.operations?.transformations;
  const direct = table?.[code];
  if (direct) return direct.label;
  const byDisplayCode = Object.values(table ?? {}).find((operation) => operation.code === code);
  return byDisplayCode?.label ?? code;
}

function summarizeEdit(edit: SandboxEdit, database: DatabaseShape, languageNames: Map<string, string>): string {
  if (edit.kind === 'language:new') {
    return `New language: ${edit.name}`;
  }
  if (edit.kind === 'language:edit') {
    const language = languageNames.get(edit.languageId) ?? edit.languageId;
    const parts = [
      edit.fullName ? 'full name updated' : '',
      edit.definition ? 'definition updated' : ''
    ].filter(Boolean);
    return `Language: ${language}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  }
  if (edit.kind === 'edge') {
    const source = languageNames.get(edit.sourceId) ?? edit.sourceId;
    const target = languageNames.get(edit.targetId) ?? edit.targetId;
    return `Relationship: ${source} -> ${target}${edit.status ? ` = ${edit.status}` : ''}`;
  }
  if (edit.kind === 'operation') {
    const language = languageNames.get(edit.languageId) ?? edit.languageId;
    const operation = operationLabel(database, edit.operationType, edit.operationCode);
    return `Operation: ${operation} on ${language}${edit.complexity ? ` = ${edit.complexity}` : ''}`;
  }
  if (edit.kind === 'graph-position') {
    const language = languageNames.get(edit.languageId) ?? edit.languageId;
    return `Graph position: ${language} = (${Math.round(edit.position.x)}, ${Math.round(edit.position.y)})`;
  }
  return `Reference: ${parseBibtexId(edit.bibtex)}`;
}

function markdownList(items: string[], emptyText: string): string {
  if (items.length === 0) return emptyText;
  return items.map((item) => `- ${item}`).join('\n');
}

const payload = readJson<SandboxContributionSubmissionPayload>(contributionPath);
const database = readJson<DatabaseShape>(databasePath);
const github = normalizeGithub(payload.contributor.github);
const languageNames = new Map(database.languages.map((language) => [language.id, language.name]));
for (const edit of payload.sandbox.edits) {
  if (edit.kind === 'language:new') {
    languageNames.set(edit.id ?? edit.name, edit.name);
  }
}

const summaries = payload.sandbox.edits.map((edit) => summarizeEdit(edit, database, languageNames));
const files = changedFiles();
const unexpectedFiles = files.filter((file) => !file.expected);

const report = {
  submissionId: payload.submissionId,
  contributor: {
    name: payload.contributor.name,
    email: payload.contributor.email,
    github: github || undefined,
    note: payload.contributor.note
  },
  summaries,
  changedFiles: files,
  unexpectedFiles
};

fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const body = [
  '## Submission Details',
  '',
  `- Submission ID: ${payload.submissionId}`,
  `- Contributor: ${payload.contributor.name}`,
  `- Contributor Email: ${payload.contributor.email}`,
  ...(github ? [`- GitHub: @${github}`] : []),
  '',
  '## Draft Changes',
  '',
  markdownList(summaries, '_No draft changes found._'),
  '',
  '## Changed Files',
  '',
  markdownList(files.map((file) => `\`${file.path}\` (${file.status})`), '_No changed files found._'),
  '',
  '## Unexpected File Warning',
  '',
  unexpectedFiles.length > 0
    ? [
        'Review carefully: the contribution workflow changed files outside the expected generated data/LaTeX set.',
        '',
        markdownList(unexpectedFiles.map((file) => `\`${file.path}\` (${file.status})`), '')
      ].join('\n')
    : 'No unexpected files changed.',
  ...(payload.contributor.note?.trim()
    ? ['', '## Contributor Note', '', payload.contributor.note.trim()]
    : []),
  '',
  '## Automation',
  '',
  'This PR was generated from sandbox-mode contribution edits. The workflow replayed the edits, ran the LaTeX bijection round-trip, and ran validation before opening this pull request.',
  '',
  '*This PR was automatically generated from a community contribution.*'
].join('\n');

fs.writeFileSync(reportBodyPath, `${body}\n`, 'utf8');
console.log(`Wrote ${path.relative(rootDir, reportJsonPath)} and ${path.relative(rootDir, reportBodyPath)}.`);
