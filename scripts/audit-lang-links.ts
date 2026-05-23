import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initNameMap, nameToId } from '../src/lib/utils/language-id.js';

type Unresolved = {
  cmd: 'langref' | 'langfam';
  arg: string;
  path: string;
};

const database = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lib/data/database.json'), 'utf8')
) as any;

const languages = database.languages as Array<{ id: string; name: string }>;
initNameMap(languages);

const LANGREF_PATTERN = /\\langref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{([^{}]*)\})?/g;
const LANGFAM_PATTERN = /\\langfam\{([^}]+)\}\{([^}]+)\}(?:\{([^{}]*)\})?/g;

function normalize(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim()
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}(?:\{[^{}]*\})?$/i, '$1_$2')
    .replace(/^\\langref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{[^{}]*\})?$/i, '$1')
    .replace(/\\textless\{\}/gi, '<')
    .replace(/\\textless(?![A-Za-z])/gi, '<')
    .replace(/\$<\$/g, '<')
    .replace(/\\_/g, '_')
    .replace(/_\{\s*([^{}]+)\s*\}/g, '_$1')
    .replace(/\s+/g, ' ');
}

const unresolved: Unresolved[] = [];

function visit(value: unknown, path: string) {
  if (typeof value === 'string') {
    let match: RegExpExecArray | null;

    LANGREF_PATTERN.lastIndex = 0;
    while ((match = LANGREF_PATTERN.exec(value)) !== null) {
      const raw = match[1];
      const normalized = normalize(raw);
      const resolved = normalized.startsWith('lang_') || !!nameToId(normalized);
      if (!resolved) {
        unresolved.push({ cmd: 'langref', arg: raw, path });
      }
    }

    LANGFAM_PATTERN.lastIndex = 0;
    while ((match = LANGFAM_PATTERN.exec(value)) !== null) {
      const raw = `${match[1]}_${match[2]}`;
      const normalized = normalize(raw);
      const resolved = !!nameToId(normalized);
      if (!resolved) {
        unresolved.push({ cmd: 'langfam', arg: raw, path });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      visit(nested, `${path}.${key}`);
    }
  }
}

visit(database, 'database');

if (unresolved.length > 0) {
  console.error(`Found ${unresolved.length} unresolved language references:`);
  for (const item of unresolved) {
    console.error(`- \\${item.cmd}{${item.arg}} @ ${item.path}`);
  }
  process.exit(1);
}

console.log('OK: all \\langref and \\langfam references resolve to known languages.');
