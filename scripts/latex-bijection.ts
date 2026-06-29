/// <reference types="node" />

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { DATABASE_PATH, loadDatabase, saveDatabase, type DatabaseSchema } from './shared/database.js';
import { cleanBibtexText, extractBibtexField } from '../src/lib/utils/bibtex.js';
import { generateLanguageId } from '../src/lib/utils/language-id.js';
import { guaranteesPoly, guaranteesQuasi } from '../src/lib/data/validation/semantic.js';
import { collectAssumptions } from '../src/lib/data/assumptions.js';
import type {
  DirectedSuccinctnessRelation,
  KCBatchClaim,
  KCBatchLanguageRef,
  KCBatchSelector,
  KCDefinition,
  KCLanguage,
  KCOpSupport,
  KCReference
} from '../src/lib/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SUCCINCTNESS_OUTPUT = path.join(__dirname, '..', 'docs', 'succinctness.tex');
const DEFAULT_LANGUAGES_OUTPUT = path.join(__dirname, '..', 'docs', 'languages.tex');
const DEFAULT_DEFINITIONS_OUTPUT = path.join(__dirname, '..', 'docs', 'definitions.tex');
const DEFAULT_BIBTEX_OUTPUT = path.join(__dirname, '..', 'docs', 'refs.bib');
const DEFAULT_QUERIES_OUTPUT = path.join(__dirname, '..', 'docs', 'queries.tex');
const DEFAULT_TRANSFORMS_OUTPUT = path.join(__dirname, '..', 'docs', 'transformations.tex');

const STATUS_TO_MACRO: Record<string, string> = {
  poly: '\\poly',
  'no-poly-unknown-quasi': '\\nopolyunknownquasi',
  'no-poly-quasi': '\\nopolyquasi',
  'unknown-poly-quasi': '\\unknownpolyquasi',
  'unknown-both': '\\unknownboth',
  'no-quasi': '\\noquasi'
};

const MACRO_TO_STATUS = Object.fromEntries(Object.entries(STATUS_TO_MACRO).map(([k, v]) => [v, k]));

const QUERY_OPERATION_MACROS: Record<string, string> = {
  CO: '\\CO',
  VA: '\\VA',
  CE: '\\CE',
  IM: '\\IM',
  EQ: '\\EQ',
  SE: '\\SE',
  CT: '\\CT',
  ME: '\\ME'
};

const TRANSFORMATION_OPERATION_MACROS: Record<string, string> = {
  CD: '\\CD',
  FO: '\\FO',
  SFO: '\\SFO',
  NOT_C: '\\NOTC',
  AND_C: '\\ANDC',
  AND_BC: '\\ANDBC',
  OR_C: '\\ORC',
  OR_BC: '\\ORBC'
};

const MACRO_TO_QUERY_OPERATION = Object.fromEntries(
  Object.entries(QUERY_OPERATION_MACROS).map(([k, v]) => [v, k])
);
const MACRO_TO_TRANSFORMATION_OPERATION = Object.fromEntries(
  Object.entries(TRANSFORMATION_OPERATION_MACROS).map(([k, v]) => [v, k])
);

const RELATION_COMMANDS = new Set([
  'compilespoly',
  'compilesquasi',
  'nocompilespoly',
  'nocompilesquasi'
]);

const OPERATION_RESULT_COMMANDS = new Set([
  'supportspoly',
  'supportsquasi',
  'nosupportspoly',
  'nosupportsquasi'
]);

const OPERATION_MACRO_TO_CODE: Record<string, string> = {
  ...MACRO_TO_QUERY_OPERATION,
  ...MACRO_TO_TRANSFORMATION_OPERATION
};

const CITATION_PATTERN = /\\cite[tp]?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g;

interface Block {
  body: string;
  start: number;
}

interface ParsedLanguage {
  name: string;
  fullName: string;
  definition: string;
}

interface ParsedConcept {
  title: string;
  statement: string;
}

interface ParsedRelation {
  sourceId: string;
  targetId: string;
  status: string;
  assumption?: string;
  description: string;
  refs: string[];
}

interface ParsedOperationClaim {
  languageId: string;
  operation: string;
  status: string;
  assumption?: string;
  description: string;
  refs: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

function hashShort(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function definitionIdForTitle(title: string): string {
  const opMatch = title.match(/\(([A-Z]+)\)$/);
  if (opMatch) return `query-${opMatch[1].toLowerCase()}`;

  const normalized = title.toLowerCase();
  if (normalized.startsWith('conditioning')) return 'transformation-cd';
  if (normalized.startsWith('singleton forgetting')) return 'transformation-sfo';
  if (normalized.startsWith('forgetting')) return 'transformation-fo';
  if (normalized.startsWith('bounded conjunction')) return 'transformation-and-bc';
  if (normalized.startsWith('conjunction')) return 'transformation-and-c';
  if (normalized.startsWith('bounded disjunction')) return 'transformation-or-bc';
  if (normalized.startsWith('disjunction')) return 'transformation-or-c';
  if (normalized.startsWith('negation')) return 'transformation-not-c';
  return slug(title);
}

function extractCitationKeys(text?: string): string[] {
  const refs: string[] = [];
  if (!text) return refs;
  CITATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    for (const key of match[1].split(',').map((item) => item.trim()).filter(Boolean)) {
      if (!refs.includes(key)) refs.push(key);
    }
  }
  return refs;
}

function ensureInlineCitations(text: string, refs?: string[]): string {
  const cleanRefs = [...new Set((refs ?? []).filter(Boolean))];
  if (cleanRefs.length === 0) return text;
  const existing = new Set(extractCitationKeys(text));
  const missing = cleanRefs.filter((ref) => !existing.has(ref));
  if (missing.length === 0) return text;
  const trimmed = text.trimEnd();
  const suffix = ` \\citep{${missing.join(',')}}`;
  return `${trimmed}${trimmed.endsWith('.') ? '' : '.'}${suffix}`;
}

function stripDefRefs(text: string): string {
  return text
    .replace(/\\defref\{[^{}]+\}\{([^{}]+)\}/g, '$1')
    .replace(/\\defref\{([^{}]+)\}/g, (_match, id: string) =>
      id
        .split('-')
        .map((part: string) => part ? part[0].toUpperCase() + part.slice(1) : part)
        .join(' ')
    );
}

function languageToLatex(name: string): string {
  const familyMatch = name.match(/^(.+)\$_(.+)\$$/);
  if (familyMatch) {
    return `\\langfam{${familyMatch[1].replace(/\$/g, '')}}{${familyMatch[2].replace(/\$/g, '')}}`;
  }
  return `\\langref{${name.replace(/\$/g, '').replace(/_/g, '\\_')}}`;
}

function normalizeLanguageName(value: string): string {
  let normalized = value
    .trim()
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}(?:\{[^{}]*\})?$/i, '$1_$2')
    .replace(/^\\langref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{[^{}]*\})?$/i, '$1')
    .replace(/\\textless\{\}/gi, '<')
    .replace(/\\textless(?![A-Za-z])/gi, '<')
    .replace(/\$<\$/g, '<')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\\_/g, '_')
    .replace(/_\{\s*([^{}]+)\s*\}/g, '_$1')
    .replace(/\s+/g, ' ');

  if (normalized.startsWith('$') && normalized.endsWith('$')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.includes('_') && !normalized.includes('$')) {
    normalized = normalized
      .replace(/([A-Za-z0-9-])_<(?![A-Za-z0-9])/g, '$1$_<$')
      .replace(/([A-Za-z0-9-])_([A-Za-z0-9]+)(?![A-Za-z0-9])/g, '$1$_$2$');
  }
  return normalized;
}

function isCurrentLanguagePlaceholder(value: string): boolean {
  return value.trim() === '\\thislang' || /^\$?\\mathcal\{L\}\$?$/.test(value.trim());
}

function languageLatexFromRef(ref: string, database: DatabaseSchema): string {
  if (isCurrentLanguagePlaceholder(ref)) return '\\thislang';
  const raw = ref.trim();
  const byId = database.languages.find((candidate) => candidate.id === raw);
  if (byId) return languageToLatex(byId.name);
  const normalized = normalizeLanguageName(ref);
  const language = database.languages.find((candidate) =>
    candidate.id === normalized ||
    candidate.name === normalized ||
    normalizeLanguageName(candidate.name) === normalized ||
    normalizeLanguageName(languageToLatex(candidate.name)) === normalized
  );
  return language ? languageToLatex(language.name) : ref.trim();
}

function languageIdFromRef(ref: string, database: DatabaseSchema): string | undefined {
  if (isCurrentLanguagePlaceholder(ref)) return undefined;
  const raw = ref.trim();
  const byId = database.languages.find((candidate) => candidate.id === raw);
  if (byId) return byId.id;
  const normalized = normalizeLanguageName(ref);
  return database.languages.find((candidate) =>
    candidate.id === normalized ||
    candidate.name === normalized ||
    normalizeLanguageName(candidate.name) === normalized ||
    normalizeLanguageName(languageToLatex(candidate.name)) === normalized
  )?.id;
}

function relationStatus(database: DatabaseSchema, sourceRef: string, targetRef: string): string | undefined {
  const sourceId = languageIdFromRef(sourceRef, database);
  const targetId = languageIdFromRef(targetRef, database);
  if (!sourceId || !targetId) return undefined;
  if (sourceId === targetId) return 'poly';
  const sourceIndex = database.adjacencyMatrix.indexByLanguage[sourceId];
  const targetIndex = database.adjacencyMatrix.indexByLanguage[targetId];
  return database.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex]?.status;
}

function operationMacroForAny(opCode: string): string {
  if (QUERY_OPERATION_MACROS[opCode]) return QUERY_OPERATION_MACROS[opCode];
  if (TRANSFORMATION_OPERATION_MACROS[opCode]) return TRANSFORMATION_OPERATION_MACROS[opCode];
  return `\\${opCode.replace(/[^A-Za-z]/g, '')}`;
}

function operationStatus(database: DatabaseSchema, languageRef: string, opCode: string): string | undefined {
  const languageId = languageIdFromRef(languageRef, database);
  if (!languageId) return undefined;
  const language = database.languages.find((item) => item.id === languageId);
  return language?.properties?.queries?.[opCode]?.complexity ?? language?.properties?.transformations?.[opCode]?.complexity;
}

function operationResultMacroFor(command: 'opref' | 'nopref', status: string | undefined): string {
  if (command === 'opref') return status === 'poly' ? 'supportspoly' : 'supportsquasi';
  return status === 'no-quasi' ? 'nosupportsquasi' : 'nosupportspoly';
}

function migrateLegacyDescription(text: string | undefined, database: DatabaseSchema): string {
  if (!text) return '';
  return stripRedundantRelationTiming(stripDefRefs(text)
    .replace(/\$?\\mathcal\{L\}\$?/g, '\\thislang')
    .replace(/\\(compilespoly|compilesquasi|nocompilespoly|nocompilesquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{((?:[^{}]|\{[^{}]*\})+)\}/g, (_match, command: string, sourceRef: string, targetRef: string) =>
      `\\${command}{${languageLatexFromRef(sourceRef, database)}}{${languageLatexFromRef(targetRef, database)}}`
    )
    .replace(/\\(edgeref|nedgeref)\{((?:[^{}]|\{[^{}]*\})+)\}\{((?:[^{}]|\{[^{}]*\})+)\}/g, (_match, command: string, sourceRef: string, targetRef: string) => {
      const status = relationStatus(database, sourceRef, targetRef);
      const source = languageLatexFromRef(sourceRef, database);
      const target = languageLatexFromRef(targetRef, database);
      const macro = command === 'edgeref'
        ? status === 'poly' ? 'compilespoly' : 'compilesquasi'
        : status === 'no-quasi' ? 'nocompilesquasi' : 'nocompilespoly';
      return `\\${macro}{${source}}{${target}}`;
    })
    .replace(/\\opref\{((?:[^{}]|\{[^{}]*\})+)\}\{([^{}]+)\}/g, (_match, languageRef: string, opCode: string) =>
      `\\${operationResultMacroFor('opref', operationStatus(database, languageRef, opCode))}{${languageLatexFromRef(languageRef, database)}}{${operationMacroForAny(opCode)}}`
    )
    .replace(/\\nopref\{((?:[^{}]|\{[^{}]*\})+)\}\{([^{}]+)\}/g, (_match, languageRef: string, opCode: string) =>
      `\\${operationResultMacroFor('nopref', operationStatus(database, languageRef, opCode))}{${languageLatexFromRef(languageRef, database)}}{${operationMacroForAny(opCode)}}`
    ));
}

function stripRedundantRelationTiming(text: string): string {
  const languageArg = String.raw`(?:\\thislang|\\langref\{[^{}]+\}|\\langfam\{[^{}]+\}\{[^{}]+\})`;
  return text
    .replace(new RegExp(`(\\\\(?:compilespoly|nocompilespoly)\\{${languageArg}\\}\\{${languageArg}\\})\\s+(?:in polynomial time|with polynomial blowup)`, 'g'), '$1')
    .replace(new RegExp(`(\\\\(?:compilesquasi|nocompilesquasi)\\{${languageArg}\\}\\{${languageArg}\\})\\s+(?:in (?:at worst |at most )?quasipolynomial time|with quasipolynomial blowup)`, 'g'), '$1')
    .replace(new RegExp(`(\\\\(?:supportspoly|nosupportspoly)\\{${languageArg}\\}\\{\\\\[A-Za-z]+\\})\\s+in polynomial time`, 'g'), '$1')
    .replace(new RegExp(`(\\\\(?:supportsquasi|nosupportsquasi)\\{${languageArg}\\}\\{\\\\[A-Za-z]+\\})\\s+in (?:at worst |at most )?quasipolynomial time`, 'g'), '$1');
}

function extractBraceAt(text: string, openBrace: number): { content: string; end: number } {
  if (text[openBrace] !== '{') fail(`Expected "{" at offset ${openBrace}`);
  let depth = 1;
  for (let i = openBrace + 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth === 0) return { content: text.slice(openBrace + 1, i), end: i + 1 };
  }
  fail(`Unbalanced braces at offset ${openBrace}`);
}

function commandValue(block: string, command: string, required = true): string | undefined {
  const needle = `\\${command}`;
  const idx = block.indexOf(needle);
  if (idx < 0) {
    if (required) fail(`Missing \\${command}{...}`);
    return undefined;
  }
  let i = idx + needle.length;
  while (/\s/.test(block[i] ?? '')) i++;
  if (block[i] !== '{') fail(`Malformed \\${command}{...}`);
  return extractBraceAt(block, i).content.trim();
}

function environmentBlocks(content: string, name: string): Block[] {
  const blocks: Block[] = [];
  const begin = `\\begin{${name}}`;
  const end = `\\end{${name}}`;
  let cursor = 0;
  while (true) {
    const start = content.indexOf(begin, cursor);
    if (start < 0) return blocks;
    const bodyStart = start + begin.length;
    const stop = content.indexOf(end, bodyStart);
    if (stop < 0) fail(`Missing ${end}`);
    blocks.push({ body: content.slice(bodyStart, stop).trim(), start });
    cursor = stop + end.length;
  }
}

function environmentValue(block: string, name: string, required = true): string | undefined {
  const blocks = environmentBlocks(block, name);
  if (blocks.length === 0) {
    if (required) fail(`Missing ${name} environment`);
    return undefined;
  }
  if (blocks.length > 1) fail(`Expected only one ${name} environment`);
  return blocks[0].body.trim();
}

function stripPreambleWarning(content: string): void {
  const forbidden = [
    /%\s*lang=/,
    /%\s*Reference ID:/,
    /\\label\{def:lang_/,
    /\\label\{kdef:/,
    /\\begin\{batchclaim\}\[/,
    /\\classification\{/,
    /\\references\{/,
    /\\defref\{/,
    /\\(?:edgeref|nedgeref|opref|nopref)\{/
  ];
  for (const pattern of forbidden) {
    if (pattern.test(content)) fail(`Legacy LaTeX metadata is not allowed: ${pattern}`);
  }
}

function titlePreamble(title: string, theoremStyle = ''): string {
  return `% =============================
% Tractable Circuit Zoo - ${title}
% Auto-generated from database.json
% =============================
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{mathtools}
\\usepackage{xparse}
\\usepackage{hyperref}
\\usepackage{natbib}
\\hypersetup{colorlinks=true, linkcolor=blue, citecolor=blue, urlcolor=blue}

${theoremStyle}

\\NewDocumentCommand{\\langref}{m g}{\\textbf{#1\\IfNoValueF{#2}{#2}}}
\\NewDocumentCommand{\\langfam}{m m g}{\\textbf{#1$_{#2}$\\IfNoValueF{#3}{#3}}}
\\newcommand{\\thislang}{\\ensuremath{\\mathcal{L}}}
\\newcommand{\\poly}{polynomial}
\\newcommand{\\nopolyunknownquasi}{not polynomial, quasipolynomial unknown}
\\newcommand{\\nopolyquasi}{not polynomial, quasipolynomial}
\\newcommand{\\unknownpolyquasi}{polynomial unknown, quasipolynomial}
\\newcommand{\\unknownboth}{unknown}
\\newcommand{\\noquasi}{not quasipolynomial}
\\newcommand{\\CO}{CO}
\\newcommand{\\VA}{VA}
\\newcommand{\\CE}{CE}
\\newcommand{\\IM}{IM}
\\newcommand{\\EQ}{EQ}
\\newcommand{\\SE}{SE}
\\newcommand{\\CT}{CT}
\\newcommand{\\ME}{ME}
\\newcommand{\\CD}{CD}
\\newcommand{\\FO}{FO}
\\newcommand{\\SFO}{SFO}
\\newcommand{\\NOTC}{$\\neg$C}
\\newcommand{\\ANDC}{$\\wedge$C}
\\newcommand{\\ANDBC}{$\\wedge$BC}
\\newcommand{\\ORC}{$\\vee$C}
\\newcommand{\\ORBC}{$\\vee$BC}
\\newcommand{\\compilespoly}[2]{#1 compiles to #2 with polynomial blowup}
\\newcommand{\\compilesquasi}[2]{#1 compiles to #2 with quasipolynomial blowup}
\\newcommand{\\nocompilespoly}[2]{#1 does not compile to #2 with polynomial blowup}
\\newcommand{\\nocompilesquasi}[2]{#1 does not compile to #2 with quasipolynomial blowup}
\\newcommand{\\supportspoly}[2]{#1 supports #2 in polynomial time}
\\newcommand{\\supportsquasi}[2]{#1 supports #2 in quasipolynomial time}
\\newcommand{\\nosupportspoly}[2]{#2 is not supported by #1 in polynomial time}
\\newcommand{\\nosupportsquasi}[2]{#2 is not supported by #1 in quasipolynomial time}
\\newcommand{\\isin}[1]{#1}
\\newcommand{\\shortname}[1]{\\textbf{Short name:} #1\\par}
\\newcommand{\\fullname}[1]{\\textbf{Full name:} #1\\par}
\\newcommand{\\source}[1]{\\textbf{Source:} #1\\par}
\\newcommand{\\target}[1]{\\textbf{Target:} #1\\par}
\\newcommand{\\claimlanguage}[1]{\\textbf{Language:} #1\\par}
\\newcommand{\\operation}[1]{\\textbf{Operation:} #1\\par}
\\newcommand{\\status}[1]{\\textbf{Status:} #1\\par}
\\newcommand{\\selector}[1]{\\textbf{Selector:} #1\\par}
\\newcommand{\\assuming}[1]{\\textbf{Assuming:} #1\\par}
\\newcommand{\\titlefield}[1]{\\textbf{Title:} #1\\par}
\\let\\titlemacro\\title
\\renewcommand{\\title}[1]{\\titlefield{#1}}
\\renewenvironment{description}{\\par\\noindent\\ignorespaces}{\\par}
\\makeatletter
\\let\\texlanguage\\language
\\def\\languageenvname{language}
\\def\\language{\\ifx\\@currenvir\\languageenvname\\expandafter\\@firstoftwo\\else\\expandafter\\@secondoftwo\\fi{\\relax}{\\texlanguage}}
\\let\\endlanguage\\relax
\\makeatother
\\newenvironment{concept}{}{}
\\newenvironment{succinctnessclaim}{}{}
\\newenvironment{queryclaim}{}{}
\\newenvironment{transformationclaim}{}{}
\\newenvironment{batchclaim}{}{}
\\titlemacro{Tractable Circuit Zoo: ${title}}
\\date{\\today}
\\begin{document}
\\maketitle

`;
}

function postamble(): string {
  return `
\\bibliographystyle{plainnat}
\\bibliography{refs}
\\end{document}
`;
}

function generateLanguagesLatex(database: DatabaseSchema): string {
  const blocks = database.languages.map((language) => `\\begin{language}
\\shortname{${languageToLatex(language.name)}}
\\fullname{${language.fullName}}
\\begin{description}
${migrateLegacyDescription(language.definition, database)}
\\end{description}
\\end{language}`).join('\n\n');
  return titlePreamble('Language Definitions') + blocks + postamble();
}

function generateDefinitionsLatex(database: DatabaseSchema): string {
  const blocks = (database.definitions ?? []).map((definition) => `\\begin{concept}
\\title{${definition.title}}
\\begin{description}
${ensureInlineCitations(migrateLegacyDescription(definition.statement, database), definition.refs)}
\\end{description}
\\end{concept}`).join('\n\n');
  return titlePreamble('Conceptual Definitions') + blocks + postamble();
}

function relationDescription(relation: DirectedSuccinctnessRelation): string {
  if (relation.status === 'no-poly-quasi') {
    const parts = [
      relation.noPolyDescription?.description,
      relation.quasiDescription?.description
    ].filter(Boolean);
    if (parts.length > 0) return parts.join('\n\n');
  }
  return relation.description ?? '';
}

function generateSuccinctnessLatex(database: DatabaseSchema): string {
  const idToLanguage = new Map(database.languages.map((language) => [language.id, language]));
  const blocks: string[] = [];
  const { languageIds, matrix } = database.adjacencyMatrix;
  for (let i = 0; i < languageIds.length; i++) {
    for (let j = 0; j < languageIds.length; j++) {
      if (i === j) continue;
      const relation = matrix[i]?.[j];
      if (!relation || relation.derived || !STATUS_TO_MACRO[relation.status]) continue;
      const source = idToLanguage.get(languageIds[i]);
      const target = idToLanguage.get(languageIds[j]);
      if (!source || !target) continue;
      const refs = [
        ...(relation.refs ?? []),
        ...(relation.noPolyDescription?.refs ?? []),
        ...(relation.quasiDescription?.refs ?? [])
      ];
      blocks.push(`\\begin{succinctnessclaim}
\\source{${languageToLatex(source.name)}}
\\target{${languageToLatex(target.name)}}
\\status{${STATUS_TO_MACRO[relation.status]}}
${relation.assumption ? `\\assuming{${relation.assumption}}\n` : ''}\\begin{description}
${ensureInlineCitations(migrateLegacyDescription(relationDescription(relation), database), refs)}
\\end{description}
\\end{succinctnessclaim}`);
    }
  }
  return titlePreamble('Succinctness Claims') + blocks.join('\n\n') + postamble();
}

function opMacro(opType: 'queries' | 'transformations', op: string): string {
  const table = opType === 'queries' ? QUERY_OPERATION_MACROS : TRANSFORMATION_OPERATION_MACROS;
  return table[op] ?? fail(`No LaTeX macro for ${opType} operation ${op}`);
}

function generateOperationClaim(
  database: DatabaseSchema,
  language: KCLanguage,
  opType: 'queries' | 'transformations',
  op: string,
  support: KCOpSupport
): string | null {
  if (!support || support.derived || support.batchId || support.complexity === 'unknown-to-us') return null;
  const environment = opType === 'queries' ? 'queryclaim' : 'transformationclaim';
  return `\\begin{${environment}}
\\claimlanguage{${languageToLatex(language.name)}}
\\operation{${opMacro(opType, op)}}
\\status{${STATUS_TO_MACRO[support.complexity] ?? fail(`Unknown operation status ${support.complexity}`)}}
${support.assumption ? `\\assuming{${support.assumption}}\n` : ''}\\begin{description}
${ensureInlineCitations(migrateLegacyDescription(support.description, database), support.refs)}
\\end{description}
\\end{${environment}}`;
}

function selectorLanguageRef(ref: KCBatchLanguageRef, idToLanguage: Map<string, KCLanguage>): string {
  if (ref.kind === 'current') return '\\thislang';
  const language = idToLanguage.get(ref.id) ?? fail(`Unknown batch selector language ${ref.id}`);
  return languageToLatex(language.name);
}

function selectorToLatex(selector: KCBatchSelector, idToLanguage: Map<string, KCLanguage>): string {
  if (selector.kind === 'list') {
    return `\\isin{${selector.languageIds.map((id) => {
      const language = idToLanguage.get(id) ?? fail(`Unknown batch language ${id}`);
      return languageToLatex(language.name);
    }).join(', ')}}`;
  }
  if (selector.kind === 'allOf') {
    return selector.selectors.map((child) => selectorToLatex(child, idToLanguage)).join(', ');
  }
  if (selector.kind === 'anyOf') {
    fail('anyOf batch selectors are not supported by canonical LaTeX');
  }
  const command = (selector.polarity ?? 'positive') === 'negative'
    ? selector.level === 'poly' ? 'nocompilespoly' : 'nocompilesquasi'
    : selector.level === 'poly' ? 'compilespoly' : 'compilesquasi';
  return `\\${command}{${selectorLanguageRef(selector.source, idToLanguage)}}{${selectorLanguageRef(selector.target, idToLanguage)}}`;
}

function batchSelector(batch: KCBatchClaim): KCBatchSelector {
  return batch.selector ?? { kind: 'list', languageIds: batch.languageIds ?? [] };
}

function generateBatchClaim(database: DatabaseSchema, batch: KCBatchClaim, idToLanguage: Map<string, KCLanguage>): string {
  return `\\begin{batchclaim}
\\selector{${selectorToLatex(batchSelector(batch), idToLanguage)}}
\\operation{${opMacro(batch.opType, batch.op)}}
\\status{${STATUS_TO_MACRO[batch.status] ?? fail(`Unknown batch status ${batch.status}`)}}
${batch.assumption ? `\\assuming{${batch.assumption}}\n` : ''}\\begin{description}
${ensureInlineCitations(migrateLegacyDescription(batch.descriptionTemplate, database), batch.refs)}
\\end{description}
\\end{batchclaim}`;
}

function generateOpsLatex(database: DatabaseSchema, opType: 'queries' | 'transformations'): string {
  const idToLanguage = new Map(database.languages.map((language) => [language.id, language]));
  const blocks: string[] = [];
  for (const batch of database.batchClaims ?? []) {
    if (batch.opType === opType) blocks.push(generateBatchClaim(database, batch, idToLanguage));
  }
  for (const language of database.languages) {
    const supports = language.properties?.[opType] ?? {};
    for (const [op, support] of Object.entries(supports)) {
      const block = generateOperationClaim(database, language, opType, op, support);
      if (block) blocks.push(block);
    }
  }
  const title = opType === 'queries' ? 'Query Support' : 'Transformation Support';
  return titlePreamble(title) + blocks.join('\n\n') + postamble();
}

function generateBibtex(database: DatabaseSchema): string {
  return database.references
    .map((ref) => ref.bibtex || `@misc{${ref.id},\n  title={${ref.title}},\n  url={${ref.href}}\n}`)
    .join('\n\n');
}

function parseLanguagesLatex(content: string): ParsedLanguage[] {
  stripPreambleWarning(content);
  return environmentBlocks(content, 'language').map((block) => {
    const shortname = commandValue(block.body, 'shortname')!;
    return {
      name: normalizeLanguageName(shortname),
      fullName: commandValue(block.body, 'fullname')!,
      definition: environmentValue(block.body, 'description')!
    };
  });
}

function parseDefinitionsLatex(content: string): ParsedConcept[] {
  stripPreambleWarning(content);
  return environmentBlocks(content, 'concept').map((block) => ({
    title: commandValue(block.body, 'title')!,
    statement: environmentValue(block.body, 'description')!
  }));
}

function languageResolver(database: DatabaseSchema): (value: string) => string {
  const aliases = new Map<string, string>();
  for (const language of database.languages) {
    const names = [
      language.id,
      language.name,
      normalizeLanguageName(language.name),
      normalizeLanguageName(languageToLatex(language.name))
    ];
    for (const name of names) {
      aliases.set(name, language.id);
      aliases.set(name.toLowerCase(), language.id);
    }
  }
  return (value: string) => {
    const normalized = normalizeLanguageName(value);
    return aliases.get(normalized) ?? aliases.get(normalized.toLowerCase()) ?? fail(`Unknown language ${value}`);
  };
}

function parseStatus(value: string): string {
  return MACRO_TO_STATUS[value.trim()] ?? fail(`Unknown status macro ${value}`);
}

function relationMacroStatusOk(command: string, status: string | undefined): boolean {
  switch (command) {
    case 'compilespoly':
      return guaranteesPoly(status);
    case 'compilesquasi':
      return guaranteesQuasi(status);
    case 'nocompilespoly':
      return status === 'no-poly-unknown-quasi' || status === 'no-poly-quasi' || status === 'no-quasi';
    case 'nocompilesquasi':
      return status === 'no-quasi';
    default:
      return false;
  }
}

function operationMacroStatusOk(command: string, status: string | undefined): boolean {
  switch (command) {
    case 'supportspoly':
      return status === 'poly';
    case 'supportsquasi':
      return guaranteesQuasi(status);
    case 'nosupportspoly':
      return status === 'no-poly-unknown-quasi' || status === 'no-poly-quasi' || status === 'no-quasi';
    case 'nosupportsquasi':
      return status === 'no-quasi';
    default:
      return false;
  }
}

function operationStatusFromMacro(database: DatabaseSchema, languageId: string, operationMacro: string): string | undefined {
  const opCode = OPERATION_MACRO_TO_CODE[operationMacro] ?? fail(`Unknown operation macro ${operationMacro}`);
  const language = database.languages.find((item) => item.id === languageId);
  return language?.properties?.queries?.[opCode]?.complexity ?? language?.properties?.transformations?.[opCode]?.complexity;
}

function validateRelationMacroAssertions(database: DatabaseSchema): void {
  const resolveLanguage = languageResolver(database);
  const pattern = /\\(compilespoly|compilesquasi|nocompilespoly|nocompilesquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{((?:[^{}]|\{[^{}]*\})+)\}/g;
  const operationPattern = /\\(supportspoly|supportsquasi|nosupportspoly|nosupportsquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{(\\[A-Za-z]+)\}/g;
  const texts: Array<{ context: string; text: string | undefined }> = [];

  for (const language of database.languages) {
    texts.push({ context: `language ${language.name}`, text: language.definition });
    for (const [opType, map] of Object.entries(language.properties ?? {})) {
      for (const [op, support] of Object.entries(map ?? {})) {
        texts.push({ context: `${opType} ${language.name} ${op}`, text: support?.description });
      }
    }
  }
  for (const definition of database.definitions ?? []) {
    texts.push({ context: `definition ${definition.title}`, text: definition.statement });
  }
  const { languageIds, matrix, indexByLanguage } = database.adjacencyMatrix;
  for (let i = 0; i < languageIds.length; i++) {
    for (let j = 0; j < languageIds.length; j++) {
      const relation = matrix[i]?.[j];
      if (!relation) continue;
      texts.push({ context: `relation ${languageIds[i]} -> ${languageIds[j]}`, text: relation.description });
      texts.push({ context: `relation ${languageIds[i]} -> ${languageIds[j]} no-poly`, text: relation.noPolyDescription?.description });
      texts.push({ context: `relation ${languageIds[i]} -> ${languageIds[j]} quasi`, text: relation.quasiDescription?.description });
    }
  }
  for (const batch of database.batchClaims ?? []) {
    if (batch.descriptionTemplate?.includes('\\thislang')) continue;
    texts.push({ context: `batch ${batch.id}`, text: batch.descriptionTemplate });
  }

  for (const { context, text } of texts) {
    if (!text) continue;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const [, command, sourceRef, targetRef] = match;
      if (sourceRef.trim() === '\\thislang' || targetRef.trim() === '\\thislang') continue;
      const sourceId = resolveLanguage(sourceRef);
      const targetId = resolveLanguage(targetRef);
      const sourceIndex = indexByLanguage[sourceId];
      const targetIndex = indexByLanguage[targetId];
      const relation = matrix[sourceIndex]?.[targetIndex];
      const status = sourceId === targetId ? 'poly' : relation?.status;
      if (!relationMacroStatusOk(command, status)) {
        fail(`False relation assertion in ${context}: \\${command}{${sourceRef}}{${targetRef}} does not match stored status ${status ?? 'missing'}`);
      }
    }
    operationPattern.lastIndex = 0;
    while ((match = operationPattern.exec(text)) !== null) {
      const [, command, languageRef, operationMacro] = match;
      if (languageRef.trim() === '\\thislang') continue;
      const languageId = resolveLanguage(languageRef);
      const status = operationStatusFromMacro(database, languageId, operationMacro);
      if (!operationMacroStatusOk(command, status)) {
        fail(`False operation assertion in ${context}: \\${command}{${languageRef}}{${operationMacro}} does not match stored status ${status ?? 'missing'}`);
      }
    }
  }
}

function parseAssumption(block: string): string | undefined {
  return commandValue(block, 'assuming', false);
}

function parseSuccinctnessLatex(content: string, database: DatabaseSchema): ParsedRelation[] {
  stripPreambleWarning(content);
  const resolveLanguage = languageResolver(database);
  return environmentBlocks(content, 'succinctnessclaim').map((block) => {
    const description = environmentValue(block.body, 'description')!;
    return {
      sourceId: resolveLanguage(commandValue(block.body, 'source')!),
      targetId: resolveLanguage(commandValue(block.body, 'target')!),
      status: parseStatus(commandValue(block.body, 'status')!),
      assumption: parseAssumption(block.body),
      description,
      refs: extractCitationKeys(description)
    };
  });
}

function parseOperationMacro(opType: 'queries' | 'transformations', value: string): string {
  const table = opType === 'queries' ? MACRO_TO_QUERY_OPERATION : MACRO_TO_TRANSFORMATION_OPERATION;
  return table[value.trim()] ?? fail(`Unknown ${opType} operation macro ${value}`);
}

function parseOperationClaims(
  content: string,
  database: DatabaseSchema,
  opType: 'queries' | 'transformations'
): ParsedOperationClaim[] {
  stripPreambleWarning(content);
  const resolveLanguage = languageResolver(database);
  const env = opType === 'queries' ? 'queryclaim' : 'transformationclaim';
  return environmentBlocks(content, env).map((block) => {
    const description = environmentValue(block.body, 'description')!;
    const languageRef = commandValue(block.body, 'claimlanguage') ?? commandValue(block.body, 'language');
    return {
      languageId: resolveLanguage(languageRef ?? fail(`Missing language field in ${env}`)),
      operation: parseOperationMacro(opType, commandValue(block.body, 'operation')!),
      status: parseStatus(commandValue(block.body, 'status')!),
      assumption: parseAssumption(block.body),
      description,
      refs: extractCitationKeys(description)
    };
  });
}

function splitTopLevelCommaList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '{') depth++;
    if (value[i] === '}') depth--;
    if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function parseLanguageRef(value: string, resolveLanguage: (value: string) => string): KCBatchLanguageRef {
  return value.trim() === '\\thislang'
    ? { kind: 'current' }
    : { kind: 'language', id: resolveLanguage(value) };
}

function parseSelectorClause(value: string, resolveLanguage: (value: string) => string): KCBatchSelector {
  const trimmed = value.trim();
  if (trimmed.startsWith('\\isin')) {
    const content = commandValue(trimmed, 'isin')!;
    return { kind: 'list', languageIds: splitTopLevelCommaList(content).map(resolveLanguage) };
  }
  for (const command of RELATION_COMMANDS) {
    if (!trimmed.startsWith(`\\${command}`)) continue;
    const firstStart = trimmed.indexOf('{');
    const first = extractBraceAt(trimmed, firstStart);
    const secondStart = trimmed.indexOf('{', first.end);
    const second = extractBraceAt(trimmed, secondStart);
    return {
      kind: 'edge',
      source: parseLanguageRef(first.content, resolveLanguage),
      target: parseLanguageRef(second.content, resolveLanguage),
      level: command.endsWith('poly') && !command.endsWith('quasi') ? 'poly' : 'quasi',
      polarity: command.startsWith('no') ? 'negative' : 'positive'
    };
  }
  fail(`Unknown selector clause: ${trimmed}`);
}

function selectorKey(selector: KCBatchSelector): string {
  return JSON.stringify(selector);
}

function parseBatchClaims(
  content: string,
  database: DatabaseSchema,
  opType: 'queries' | 'transformations'
): KCBatchClaim[] {
  stripPreambleWarning(content);
  const resolveLanguage = languageResolver(database);
  const usedSelectors = new Set<string>();
  return environmentBlocks(content, 'batchclaim').map((block) => {
    const description = environmentValue(block.body, 'description')!;
    const selectorText = commandValue(block.body, 'selector')!;
    const clauses = splitTopLevelCommaList(selectorText).map((part) => parseSelectorClause(part, resolveLanguage));
    const selector = clauses.length === 1 ? clauses[0] : { kind: 'allOf' as const, selectors: clauses };
    const key = `${opType}:${parseOperationMacro(opType, commandValue(block.body, 'operation')!)}:${selectorKey(selector)}`;
    if (usedSelectors.has(key)) fail(`Duplicate batch selector in ${opType}: ${selectorText}`);
    usedSelectors.add(key);
    const operation = parseOperationMacro(opType, commandValue(block.body, 'operation')!);
    const status = parseStatus(commandValue(block.body, 'status')!);
    return {
      id: `batch-${hashShort(`${opType}:${operation}:${status}:${selectorKey(selector)}`)}`,
      opType,
      op: operation,
      status,
      assumption: parseAssumption(block.body),
      selector,
      languageIds: selector.kind === 'list' ? selector.languageIds : [],
      claimTemplate: '',
      descriptionTemplate: description,
      refs: extractCitationKeys(description)
    };
  });
}

function alignLanguages(database: DatabaseSchema, parsed: ParsedLanguage[]): void {
  const existingByName = new Map(database.languages.map((language) => [language.name, language]));
  const oldIds = database.adjacencyMatrix.languageIds;
  const oldMatrix = database.adjacencyMatrix.matrix;
  const nextLanguages: KCLanguage[] = parsed.map((item) => {
    const existing = existingByName.get(item.name);
    const language = existing ?? {
      id: generateLanguageId(item.name),
      name: item.name,
      fullName: item.fullName,
      definition: item.definition,
      properties: { queries: {}, transformations: {} }
    };
    language.name = item.name;
    language.fullName = item.fullName;
    language.definition = item.definition;
    delete (language as any).classification;
    delete (language as any).definitionRefs;
    delete (language as any).references;
    return language;
  });

  const nextIds = nextLanguages.map((language) => language.id);
  const oldIndex = new Map(oldIds.map((id, index) => [id, index]));
  const matrix = nextIds.map((sourceId) => nextIds.map((targetId) => {
    if (sourceId === targetId) return null;
    const i = oldIndex.get(sourceId);
    const j = oldIndex.get(targetId);
    return i === undefined || j === undefined ? null : oldMatrix[i]?.[j] ?? null;
  }));
  database.languages = nextLanguages;
  database.adjacencyMatrix = {
    languageIds: nextIds,
    indexByLanguage: Object.fromEntries(nextIds.map((id, index) => [id, index])),
    matrix
  };
}

function updateDefinitions(database: DatabaseSchema, concepts: ParsedConcept[]): void {
  database.definitions = concepts.map((concept) => ({
    id: definitionIdForTitle(concept.title),
    title: concept.title,
    statement: concept.statement,
    refs: extractCitationKeys(concept.statement)
  }));
}

function updateSuccinctness(database: DatabaseSchema, relations: ParsedRelation[]): void {
  for (let i = 0; i < database.adjacencyMatrix.matrix.length; i++) {
    for (let j = 0; j < database.adjacencyMatrix.matrix[i].length; j++) {
      const relation = database.adjacencyMatrix.matrix[i][j];
      if (relation && !relation.derived) database.adjacencyMatrix.matrix[i][j] = null;
    }
  }
  for (const item of relations) {
    if (item.sourceId === item.targetId) fail(`Self relation is invalid: ${item.sourceId}`);
    const i = database.adjacencyMatrix.indexByLanguage[item.sourceId];
    const j = database.adjacencyMatrix.indexByLanguage[item.targetId];
    if (i === undefined || j === undefined) fail(`Unknown relation endpoint ${item.sourceId}->${item.targetId}`);
    database.adjacencyMatrix.matrix[i][j] = {
      status: item.status,
      description: item.description,
      refs: item.refs,
      ...(item.assumption ? { assumption: item.assumption } : {}),
      derived: false
    };
  }
}

function updateOperations(
  database: DatabaseSchema,
  claims: ParsedOperationClaim[],
  batches: KCBatchClaim[],
  opType: 'queries' | 'transformations'
): void {
  for (const language of database.languages) {
    const map = language.properties?.[opType];
    if (!map) continue;
    for (const [op, support] of Object.entries(map)) {
      if (support && !support.derived && !support.batchId) delete map[op];
    }
  }
  for (const claim of claims) {
    const language = database.languages.find((item) => item.id === claim.languageId) ?? fail(`Unknown language ${claim.languageId}`);
    language.properties ??= {};
    const map = opType === 'queries'
      ? (language.properties.queries ??= {})
      : (language.properties.transformations ??= {});
    map[claim.operation] = {
      complexity: claim.status,
      description: claim.description,
      refs: claim.refs,
      ...(claim.assumption ? { assumption: claim.assumption } : {}),
      derived: false
    };
  }
  database.batchClaims = [
    ...(database.batchClaims ?? []).filter((batch) => batch.opType !== opType),
    ...batches
  ];
}

function parseBibtex(content: string): Map<string, KCReference> {
  const references = new Map<string, KCReference>();
  const entries = content.split(/\n(?=@)/g).map((entry) => entry.trim()).filter(Boolean);
  for (const bibtex of entries) {
    const match = bibtex.match(/^@\w+\s*\{\s*([^,\s]+)\s*,/);
    if (!match) continue;
    const id = match[1].trim();
    const title = cleanBibtexText(extractBibtexField(bibtex, 'title') ?? id);
    const href =
      cleanBibtexText(extractBibtexField(bibtex, 'url') ?? extractBibtexField(bibtex, 'doi') ?? '');
    references.set(id, { id, title, href, bibtex });
  }
  return references;
}

function updateReferencesFromBibtex(database: DatabaseSchema, references: Map<string, KCReference>): void {
  database.references = [...references.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function stripCanonicalOnlyFields(database: DatabaseSchema): void {
  for (const language of database.languages) {
    delete (language as any).classification;
    delete (language as any).definitionRefs;
    delete (language as any).references;
  }
}

function writeLatex(): void {
  const database = loadDatabase();
  stripCanonicalOnlyFields(database);
  fs.writeFileSync(DEFAULT_LANGUAGES_OUTPUT, generateLanguagesLatex(database));
  fs.writeFileSync(DEFAULT_DEFINITIONS_OUTPUT, generateDefinitionsLatex(database));
  fs.writeFileSync(DEFAULT_SUCCINCTNESS_OUTPUT, generateSuccinctnessLatex(database));
  fs.writeFileSync(DEFAULT_QUERIES_OUTPUT, generateOpsLatex(database, 'queries'));
  fs.writeFileSync(DEFAULT_TRANSFORMS_OUTPUT, generateOpsLatex(database, 'transformations'));
  fs.writeFileSync(DEFAULT_BIBTEX_OUTPUT, generateBibtex(database));
  console.log('Wrote semantic LaTeX files.');
}

async function writeJson(): Promise<void> {
  const database = loadDatabase();
  const bibtex = fs.existsSync(DEFAULT_BIBTEX_OUTPUT) ? fs.readFileSync(DEFAULT_BIBTEX_OUTPUT, 'utf-8') : '';
  if (bibtex) updateReferencesFromBibtex(database, parseBibtex(bibtex));

  alignLanguages(database, parseLanguagesLatex(fs.readFileSync(DEFAULT_LANGUAGES_OUTPUT, 'utf-8')));
  updateDefinitions(database, parseDefinitionsLatex(fs.readFileSync(DEFAULT_DEFINITIONS_OUTPUT, 'utf-8')));
  updateSuccinctness(database, parseSuccinctnessLatex(fs.readFileSync(DEFAULT_SUCCINCTNESS_OUTPUT, 'utf-8'), database));

  const queriesContent = fs.readFileSync(DEFAULT_QUERIES_OUTPUT, 'utf-8');
  updateOperations(
    database,
    parseOperationClaims(queriesContent, database, 'queries'),
    parseBatchClaims(queriesContent, database, 'queries'),
    'queries'
  );

  const transformsContent = fs.readFileSync(DEFAULT_TRANSFORMS_OUTPUT, 'utf-8');
  updateOperations(
    database,
    parseOperationClaims(transformsContent, database, 'transformations'),
    parseBatchClaims(transformsContent, database, 'transformations'),
    'transformations'
  );

  stripCanonicalOnlyFields(database);
  database.assumptions = collectAssumptions(database, { includeCanonical: false });
  validateRelationMacroAssertions(database);
  saveDatabase(database);

  const { execFileSync } = await import('child_process');
  execFileSync(process.execPath, [
    '--import',
    pathToFileURL(path.join(__dirname, 'tsx-register.mjs')).href,
    path.join(__dirname, 'refresh-derived.ts')
  ], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
}

function normalizeRefs(): void {
  const database = loadDatabase();
  for (const ref of database.references) {
    if (!ref.bibtex) continue;
    ref.bibtex = ref.bibtex.replace(/^(@\w+\s*\{\s*)[^,\s]+/m, `$1${ref.id}`);
  }
  saveDatabase(database);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--to-latex')) {
    writeLatex();
    return;
  }
  if (args.includes('--to-json')) {
    await writeJson();
    return;
  }
  if (args.includes('--normalize-refs')) {
    normalizeRefs();
    return;
  }
  console.log(`Usage:
  npx tsx scripts/latex-bijection.ts --to-latex
  npx tsx scripts/latex-bijection.ts --to-json
  npx tsx scripts/latex-bijection.ts --normalize-refs`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
