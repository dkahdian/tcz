import { idToName } from '../../utils/language-id.js';

export function formatCitations(refs: string[]): string {
  if (!refs || refs.length === 0) return '';
  return ` \\citep{${refs.join(',')}}`;
}

export function formatInlineAssumption(assumption: string | undefined): string {
  if (!assumption) return '';
  const parts = assumption.split(/\s+AND\s+/);
  const formatted = parts.map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return trimmed;
    if (/^\$[\s\S]*\$$|^\\\([\s\S]*\\\)$|^\\\[[\s\S]*\\\]$/.test(trimmed)) {
      return trimmed;
    }
    return /\\[a-zA-Z]+|[\u2260\u2264\u2265\u2227\u2228]/.test(trimmed)
      ? `$${trimmed.replace(/\u2260/g, '\\neq')}$`
      : trimmed;
  }).filter(Boolean);
  return ` assuming ${formatted.join(' and ')}`;
}

export function languageRefForId(languageId: string): string {
  const name = idToName(languageId);
  const familyMatch = name.match(/^(.+)\$_(.+)\$$/);
  if (familyMatch) {
    return `\\langfam{${familyMatch[1]}}{${familyMatch[2]}}`;
  }
  return `\\langref{${name.replace(/\$/g, '').replace(/_/g, '\\_')}}`;
}

export function positiveCompilationRef(sourceId: string, targetId: string, statusOrLevel: string): string {
  const command = statusOrLevel === 'poly' || statusOrLevel === 'polynomial' ? 'compilespoly' : 'compilesquasi';
  return `\\${command}{${languageRefForId(sourceId)}}{${languageRefForId(targetId)}}`;
}

export function negativeCompilationRef(sourceId: string, targetId: string, statusOrLevel: string): string {
  const command = statusOrLevel === 'no-quasi' || statusOrLevel === 'quasi' || statusOrLevel === 'quasipolynomial'
    ? 'nocompilesquasi'
    : 'nocompilespoly';
  return `\\${command}{${languageRefForId(sourceId)}}{${languageRefForId(targetId)}}`;
}
