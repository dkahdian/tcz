/**
 * Shared BibTeX helpers used by both frontend parsing and CLI scripts.
 */

/**
 * Extract a BibTeX field value, handling nested braces properly.
 * Supports both {value}, "value", and simple unquoted values.
 */
export function extractBibtexField(bibtex: string, fieldName: string): string | null {
  const fieldPattern = new RegExp(`${fieldName}\\s*=\\s*`, 'i');
  const match = fieldPattern.exec(bibtex);
  if (!match) return null;

  let pos = match.index + match[0].length;
  while (pos < bibtex.length && /\s/.test(bibtex[pos])) pos++;
  if (pos >= bibtex.length) return null;

  const delimiter = bibtex[pos];

  if (delimiter === '{') {
    const start = pos + 1;
    let depth = 1;
    pos = start;

    while (pos < bibtex.length && depth > 0) {
      const char = bibtex[pos];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      pos++;
    }

    if (depth !== 0) return null;
    return bibtex.slice(start, pos - 1).replace(/\s+/g, ' ').trim();
  }

  if (delimiter === '"') {
    const start = pos + 1;
    pos = start;

    while (pos < bibtex.length) {
      if (bibtex[pos] === '"' && bibtex[pos - 1] !== '\\') {
        return bibtex.slice(start, pos).replace(/\s+/g, ' ').trim();
      }
      pos++;
    }

    return null;
  }

  const start = pos;
  while (pos < bibtex.length && bibtex[pos] !== ',' && bibtex[pos] !== '\n' && bibtex[pos] !== '\r') {
    pos++;
  }

  return bibtex.slice(start, pos).trim() || null;
}

/**
 * Convert common BibTeX/LaTeX escapes in display strings to plain text.
 */
export function cleanBibtexText(value: string): string {
  const umlautMap: Record<string, string> = {
    a: '\u00E4', A: '\u00C4',
    e: '\u00EB', E: '\u00CB',
    i: '\u00EF', I: '\u00CF',
    o: '\u00F6', O: '\u00D6',
    u: '\u00FC', U: '\u00DC'
  };
  const acuteMap: Record<string, string> = {
    a: '\u00E1', A: '\u00C1',
    e: '\u00E9', E: '\u00C9',
    i: '\u00ED', I: '\u00CD',
    o: '\u00F3', O: '\u00D3',
    u: '\u00FA', U: '\u00DA'
  };
  const graveMap: Record<string, string> = {
    a: '\u00E0', A: '\u00C0',
    e: '\u00E8', E: '\u00C8',
    i: '\u00EC', I: '\u00CC',
    o: '\u00F2', O: '\u00D2',
    u: '\u00F9', U: '\u00D9'
  };
  const tildeMap: Record<string, string> = {
    n: '\u00F1', N: '\u00D1',
    a: '\u00E3', A: '\u00C3',
    o: '\u00F5', O: '\u00D5'
  };
  const caronMap: Record<string, string> = {
    s: '\u0161', S: '\u0160',
    c: '\u010D', C: '\u010C',
    z: '\u017E', Z: '\u017D'
  };

  return value
    .replace(/\\\\/g, '\\')
    .replace(/\{?\\"\{([aeiouAEIOU])\}\}?/g, (_, c) => umlautMap[c] ?? c)
    .replace(/\\"([aeiouAEIOU])/g, (_, c) => umlautMap[c] ?? c)
    .replace(/\{?\\'([aeiouAEIOU])\}?/g, (_, c) => acuteMap[c] ?? c)
    .replace(/\{?\\`([aeiouAEIOU])\}?/g, (_, c) => graveMap[c] ?? c)
    .replace(/\{?\\~\{([nNaAoO])\}\}?/g, (_, c) => tildeMap[c] ?? c)
    .replace(/\{?\\~([nNaAoO])\}?/g, (_, c) => tildeMap[c] ?? c)
    .replace(/\{?\\c\{([cC])\}\}?/g, (_, c) => (c === 'c' ? '\u00E7' : '\u00C7'))
    .replace(/\{?\\v\{([sczSCZ])\}\}?/g, (_, c) => caronMap[c] ?? c)
    .replace(/\\\{/g, '')
    .replace(/\\\}/g, '')
    .replace(/\{([^{}]*)\}/g, '$1')
    .replace(/--/g, '\u2013')
    .replace(/\s+/g, ' ')
    .trim();
}
