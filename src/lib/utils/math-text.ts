import katex from 'katex';

const LATEX_TRIGGER = /(\$\$?[\s\S]*?\$|\\\[|\\\(|\\begin\{|\\cite[tp]?\{|\\defref\{|\\langref\{|\\langfam\{|\\n?edgeref\{|\\n?opref\{)/;
const LATEX_FRAGMENT = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
const CITATION_PATTERN = /\\cite[tp]?\{([^}]+)\}/g;

// Entity link patterns (processed after HTML rendering)
const DEFREF_PATTERN = /\\defref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{((?:[^{}]|\{[^{}]*\})+)\})?/g;
const LANGREF_PATTERN = /\\langref\{((?:[^{}]|\{[^{}]*\})+)\}/g;
const LANGFAM_PATTERN = /\\langfam\{([^}]+)\}\{([^}]+)\}/g;
const EDGEREF_PATTERN = /\\edgeref\{([^}]+)\}\{([^}]+)\}/g;
const NEDGEREF_PATTERN = /\\nedgeref\{([^}]+)\}\{([^}]+)\}/g;
const OPREF_PATTERN = /\\opref\{([^}]+)\}\{([^}]+)\}/g;
const NOPREF_PATTERN = /\\nopref\{([^}]+)\}\{([^}]+)\}/g;
const EMPH_PATTERN = /\\emph\{([^}]+)\}/g;
const TEXTIT_PATTERN = /\\textit\{([^}]+)\}/g;
const TEXTBF_PATTERN = /\\textbf\{([^}]+)\}/g;
const TEXTTT_PATTERN = /\\texttt\{([^}]+)\}/g;

export interface EntityRefResolver {
  edgeRefs?: (sourceId: string, targetId: string) => string[];
  opRefs?: (languageId: string, opCode: string) => string[];
}

/**
 * LRU-style render cache for renderMathText results.
 * Avoids re-running KaTeX for identical input strings (e.g., the same
 * status notation rendered in hundreds of matrix cells).
 */
const renderCache = new Map<string, MathRenderResult>();
const RENDER_CACHE_MAX = 512;

export interface MathRenderResult {
  hasLatex: boolean;
  html: string | null;
  plainText: string;
  /** Citation keys found in the text (from \cite{key}, \citet{key}, \citep{key}) */
  citationKeys: string[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeLatexLiteralEscapes(value: string): string {
  // Decode escaped literal characters used in LaTeX prose (e.g. "\#P").
  // Keep command backslashes intact so macros like \langref still parse later.
  return value.replace(/\\([#%&_{}])/g, '$1');
}

/**
 * Extract all citation keys from text.
 * Supports \cite{key}, \citet{key}, \citep{key} and comma-separated keys like \cite{key1,key2}
 */
export function extractCitationKeys(text: string): string[] {
  const keys: string[] = [];
  CITATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  
  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    const keyList = match[1];
    // Handle comma-separated keys like \cite{darwiche2002,bova2016}
    const individualKeys = keyList.split(',').map(k => k.trim()).filter(Boolean);
    keys.push(...individualKeys);
  }
  
  return keys;
}

/**
 * Check if text contains citation commands
 */
export function containsCitations(text: string): boolean {
  return /\\cite[tp]?\{/.test(text);
}

function stripDelimiters(fragment: string): { content: string; displayMode: boolean } {
  if (fragment.startsWith('$$') && fragment.endsWith('$$')) {
    return { content: fragment.slice(2, -2), displayMode: true };
  }
  if (fragment.startsWith('$') && fragment.endsWith('$')) {
    return { content: fragment.slice(1, -1), displayMode: false };
  }
  if (fragment.startsWith('\\[') && fragment.endsWith('\\]')) {
    return { content: fragment.slice(2, -2), displayMode: true };
  }
  if (fragment.startsWith('\\(') && fragment.endsWith('\\)')) {
    return { content: fragment.slice(2, -2), displayMode: false };
  }
  return { content: fragment, displayMode: false };
}

function renderFragment(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      throwOnError: false,
      displayMode
    });
  } catch {
    return escapeHtml(content);
  }
}

export function renderMathText(input?: string | null): MathRenderResult {
  const text = input ?? '';
  if (!text.trim()) {
    return { hasLatex: false, html: null, plainText: text, citationKeys: [] };
  }

  // Check render cache first
  const cached = renderCache.get(text);
  if (cached) return cached;

  // Extract citation keys first
  const citationKeys = extractCitationKeys(text);

  /** Store result in cache and return it */
  function cacheAndReturn(result: MathRenderResult): MathRenderResult {
    if (renderCache.size >= RENDER_CACHE_MAX) {
      // Evict oldest entry
      const firstKey = renderCache.keys().next().value;
      if (firstKey !== undefined) renderCache.delete(firstKey);
    }
    renderCache.set(text, result);
    return result;
  }

  if (!containsLatex(text)) {
    // No LaTeX, but still convert newlines to <br> for proper display
    const htmlWithBreaks = escapeHtml(decodeLatexLiteralEscapes(text)).replace(/\n/g, '<br>');
    return cacheAndReturn({ hasLatex: false, html: htmlWithBreaks, plainText: text, citationKeys });
  }

  LATEX_FRAGMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let html = '';
  let foundLatex = false;

  while ((match = LATEX_FRAGMENT.exec(text)) !== null) {
    foundLatex = true;
    html += escapeHtml(decodeLatexLiteralEscapes(text.slice(cursor, match.index))).replace(/\n/g, '<br>');
    const fragment = match[0];
    const { content, displayMode } = stripDelimiters(fragment);
    html += renderFragment(content.trim(), displayMode);
    cursor = match.index + fragment.length;
  }

  if (!foundLatex) {
    const htmlWithBreaks = escapeHtml(decodeLatexLiteralEscapes(text)).replace(/\n/g, '<br>');
    return cacheAndReturn({ hasLatex: false, html: htmlWithBreaks, plainText: text, citationKeys });
  }

  html += escapeHtml(decodeLatexLiteralEscapes(text.slice(cursor))).replace(/\n/g, '<br>');
  return cacheAndReturn({ hasLatex: true, html, plainText: text, citationKeys });
}

export function containsLatex(input?: string | null): boolean {
  if (!input) return false;
  return LATEX_TRIGGER.test(input);
}

export function formatAssumptionForMathText(input?: string | null): string {
  const text = input ?? '';
  if (!text.trim()) return text;
  if (containsLatex(text)) return text;
  if (/\\[a-zA-Z]+/.test(text)) return `$${text}$`;
  return text;
}

/**
 * Render text with citations resolved to reference numbers.
 * The keyToNumber function should return the display number for a citation key,
 * or null if the reference is not found.
 */
export function renderTextWithCitations(
  html: string,
  keyToNumber: (key: string) => number | null,
  onCitationClick?: (key: string) => void
): string {
  // Replace citation commands with numbered links
  // Handle \cite{key}, \citet{key}, \citep{key}
  return html.replace(/\\cite[tp]?\{([^}]+)\}/g, (match, keyList: string) => {
    const keys = keyList.split(',').map(k => k.trim()).filter(Boolean);
    const numbers = keys.map(key => {
      const num = keyToNumber(key);
      if (num === null) {
        return `<span class="citation-unknown" title="Unknown reference: ${escapeHtml(key)}">[?]</span>`;
      }
      const dataKey = escapeHtml(key);
      return `<button class="citation-link" data-citation-key="${dataKey}" title="View reference">[${num}]</button>`;
    });
    return numbers.join('');
  });
}

/**
 * Check if text contains lightweight LaTeX text-formatting commands.
 */
export function containsLatexTextFormatting(text: string): boolean {
  return /\\(emph|textit|textbf|texttt|begin\{itemize\}|begin\{enumerate\})/.test(text);
}

function renderLatexListEnvironment(html: string, env: 'itemize' | 'enumerate'): string {
  const pattern = new RegExp(`\\\\begin\\{${env}\\}(?:\\[[^\\]]*\\])?([\\s\\S]*?)\\\\end\\{${env}\\}`, 'g');
  const listTag = env === 'enumerate' ? 'ol' : 'ul';

  return html.replace(pattern, (_match, body: string) => {
    const normalizedBody = body
      .replace(/<br\s*\/?>/gi, '\n')
      .trim();

    if (!normalizedBody) {
      return '';
    }

    const items = normalizedBody
      .split(/\\item\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (items.length === 0) {
      return '';
    }

    const itemHtml = items.map((item) => `<li>${item}</li>`).join('');
    return `<${listTag} class="latex-list latex-list-${env}">${itemHtml}</${listTag}>`;
  });
}

/**
 * Render lightweight LaTeX text-formatting commands into HTML.
 */
export function renderLatexTextFormatting(html: string): string {
  return renderLatexListEnvironment(renderLatexListEnvironment(html, 'itemize'), 'enumerate')
    .replace(EMPH_PATTERN, (_match, content: string) => `<em>${content}</em>`)
    .replace(TEXTIT_PATTERN, (_match, content: string) => `<em>${content}</em>`)
    .replace(TEXTBF_PATTERN, (_match, content: string) => `<strong>${content}</strong>`)
    .replace(TEXTTT_PATTERN, (_match, content: string) => `<code>${content}</code>`);
}

/**
 * Check if text contains entity link commands (\langref, \edgeref, \opref)
 */
export function containsEntityLinks(text: string): boolean {
  return /\\(defref|langref|langfam|n?edgeref|n?opref)\{/.test(text);
}

/**
 * Render a language name, applying KaTeX if it contains LaTeX fragments.
 */
function renderNameHtml(name: string): string {
  const indexedName = name.match(/^(.+)\$_(.+)\$$/);
  if (indexedName) {
    const base = indexedName[1];
    const subscript = indexedName[2];
    return `${escapeHtml(base)}<sub>${escapeHtml(subscript)}</sub>`;
  }

  if (containsLatex(name)) {
    const result = renderMathText(name);
    return result.html ?? escapeHtml(name);
  }
  return escapeHtml(name);
}

function renderEntityLabelHtml(label: string): string {
  // Inline math inside entity arguments may already have been rendered by
  // renderMathText before entity-link replacement runs.
  if (label.includes('class="katex')) return label;
  return renderNameHtml(label);
}

function decodeMinimalEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function normalizeLangRefArg(ref: string): string {
  return decodeMinimalEntities(ref)
    .trim()
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}$/i, '$1_$2')
    .replace(/\\textless\{\}/gi, '<')
    .replace(/\\textless(?![A-Za-z])/gi, '<')
    .replace(/\$<\$/g, '<')
    .replace(/\\_/g, '_')
    .replace(/_\{\s*([^{}]+)\s*\}/g, '_$1')
    .replace(/\s+/g, ' ');
}

function uniqueRefs(refs: string[] | undefined): string[] {
  return [...new Set((refs ?? []).filter(Boolean))];
}

function immediatelyCitedRefs(fullText: string, offset: number, matchLength: number): Set<string> {
  const match = /^\s*\\cite[tp]?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/.exec(
    fullText.slice(offset + matchLength)
  );
  if (!match) return new Set();
  return new Set(match[1].split(',').map((ref) => ref.trim()).filter(Boolean));
}

function entityCitationSuffix(
  refs: string[] | undefined,
  fullText: string,
  offset: number,
  matchLength: number
): string {
  const unique = uniqueRefs(refs);
  const alreadyCited = immediatelyCitedRefs(fullText, offset, matchLength);
  const missing = unique.filter((ref) => !alreadyCited.has(ref));
  if (missing.length === 0) return '';
  return ` \\citet{${missing.join(',')}}`;
}

/**
 * Replace entity link commands with clickable <a> elements.
 * 
 * Supported commands:
 * - \langref{langId} → link to language info panel
 * - \edgeref{srcId}{tgtId} → link to edge info panel
 * - \opref{langId}{opCode} → link to operation cell info panel
 *
 * Uses <a> tags with href so Ctrl+click opens in a new tab.
 */
export function renderEntityLinks(
  html: string,
  idToName: (id: string) => string,
  opCodeToLabel?: (code: string) => string,
  nameToId?: (name: string) => string | undefined,
  definitionRefResolver?: (ref: string) => { id: string; title: string; resolved: boolean },
  entityRefResolver?: EntityRefResolver
): string {
  let result = html;

  /**
   * Resolve a langref argument that may be either an ID (lang_xxx) or a display name.
   * Returns { id, name } for building the link.
   */
  const resolveLang = (ref: string): { id: string; name: string; resolved: boolean } => {
    const normalizedRef = normalizeLangRefArg(ref);
    if (normalizedRef.startsWith('lang_')) {
      return { id: normalizedRef, name: idToName(normalizedRef), resolved: true };
    }
    const resolvedId = nameToId?.(normalizedRef);
    if (resolvedId) {
      return { id: resolvedId, name: idToName(resolvedId), resolved: true };
    }
    return { id: normalizedRef, name: normalizedRef, resolved: false };
  };

  // Replace \defref{definitionId or definitionTitle} or \defref{id}{label}
  result = result.replace(DEFREF_PATTERN, (_match, defRef: string, label: string | undefined) => {
    const normalized = decodeMinimalEntities(defRef).trim();
    const displayLabel = label ? decodeMinimalEntities(label).trim() : undefined;
    const resolved = definitionRefResolver?.(normalized) ?? {
      id: normalized,
      title: normalized,
      resolved: false
    };

    if (!resolved.resolved) {
      return `<span class="entity-link entity-link--unknown def-link--unknown" title="Unknown definition: ${escapeHtml(normalized)}">[?]</span>`;
    }

    const safeId = escapeHtml(resolved.id);
    const labelHtml = renderEntityLabelHtml(displayLabel || resolved.title);
    return `<a class="entity-link def-link" href="/about#${safeId}" data-entity-type="def" data-def-id="${safeId}"><strong>${labelHtml}</strong></a>`;
  });

  // Replace \langref{langId or langName}
  result = result.replace(LANGREF_PATTERN, (_match, langRef: string) => {
    const { id, name } = resolveLang(langRef);
    const nameHtml = renderNameHtml(name);
    if (!id.startsWith('lang_')) {
      return nameHtml;
    }
    const safeId = escapeHtml(id);
    return `<a class="entity-link lang-link" href="/#lang/${safeId}" data-entity-type="lang" data-lang-id="${safeId}">${nameHtml}</a>`;
  });

  // Replace \langfam{Base}{Index} with linked family language names.
  result = result.replace(LANGFAM_PATTERN, (_match, base: string, index: string) => {
    const familyRef = `${base}_${index}`;
    const { id, name } = resolveLang(familyRef);
    const nameHtml = renderNameHtml(name);
    if (!id.startsWith('lang_')) {
      return nameHtml;
    }
    const safeId = escapeHtml(id);
    return `<a class="entity-link lang-link" href="/#lang/${safeId}" data-entity-type="lang" data-lang-id="${safeId}">${nameHtml}</a>`;
  });

  // Replace \edgeref{srcRef}{tgtRef}
  result = result.replace(EDGEREF_PATTERN, (match: string, srcRef: string, tgtRef: string, offset: number, fullText: string) => {
    const src = resolveLang(srcRef);
    const tgt = resolveLang(tgtRef);
    const labelHtml = `${renderNameHtml(src.name)} compiles to ${renderNameHtml(tgt.name)}`;
    if (!src.resolved || !tgt.resolved || !src.id.startsWith('lang_') || !tgt.id.startsWith('lang_')) {
      return labelHtml;
    }
    const safeSrc = escapeHtml(src.id);
    const safeTgt = escapeHtml(tgt.id);
    const citation = entityCitationSuffix(entityRefResolver?.edgeRefs?.(src.id, tgt.id), fullText, offset, match.length);
    return `<a class="entity-link edge-link" href="/#edge/${safeSrc}/${safeTgt}" data-entity-type="edge" data-source-id="${safeSrc}" data-target-id="${safeTgt}">${labelHtml}</a>${citation}`;
  });

  // Replace \nedgeref{srcRef}{tgtRef} (negative edge: "cannot compile to")
  result = result.replace(NEDGEREF_PATTERN, (match: string, srcRef: string, tgtRef: string, offset: number, fullText: string) => {
    const src = resolveLang(srcRef);
    const tgt = resolveLang(tgtRef);
    const labelHtml = `${renderNameHtml(src.name)} cannot compile to ${renderNameHtml(tgt.name)}`;
    if (!src.resolved || !tgt.resolved || !src.id.startsWith('lang_') || !tgt.id.startsWith('lang_')) {
      return labelHtml;
    }
    const safeSrc = escapeHtml(src.id);
    const safeTgt = escapeHtml(tgt.id);
    const citation = entityCitationSuffix(entityRefResolver?.edgeRefs?.(src.id, tgt.id), fullText, offset, match.length);
    return `<a class="entity-link edge-link" href="/#edge/${safeSrc}/${safeTgt}" data-entity-type="edge" data-source-id="${safeSrc}" data-target-id="${safeTgt}">${labelHtml}</a>${citation}`;
  });

  // Replace \opref{langRef}{opCode}
  result = result.replace(OPREF_PATTERN, (match: string, langRef: string, opCode: string, offset: number, fullText: string) => {
    const lang = resolveLang(langRef);
    const opLabel = opCodeToLabel ? opCodeToLabel(opCode) : opCode;
    const labelHtml = `${renderNameHtml(lang.name)} supports ${escapeHtml(opLabel)}`;
    if (!lang.resolved || !lang.id.startsWith('lang_')) {
      return labelHtml;
    }
    const safeId = escapeHtml(lang.id);
    const safeCode = escapeHtml(opCode);
    const citation = entityCitationSuffix(entityRefResolver?.opRefs?.(lang.id, opCode), fullText, offset, match.length);
    return `<a class="entity-link op-link" href="/#op/${safeId}/${safeCode}" data-entity-type="op" data-lang-id="${safeId}" data-op-code="${safeCode}">${labelHtml}</a>${citation}`;
  });

  // Replace \nopref{langRef}{opCode} (negative op: "is unsupported by")
  result = result.replace(NOPREF_PATTERN, (match: string, langRef: string, opCode: string, offset: number, fullText: string) => {
    const lang = resolveLang(langRef);
    const opLabel = opCodeToLabel ? opCodeToLabel(opCode) : opCode;
    const labelHtml = `${escapeHtml(opLabel)} is unsupported by ${renderNameHtml(lang.name)}`;
    if (!lang.resolved || !lang.id.startsWith('lang_')) {
      return labelHtml;
    }
    const safeId = escapeHtml(lang.id);
    const safeCode = escapeHtml(opCode);
    const citation = entityCitationSuffix(entityRefResolver?.opRefs?.(lang.id, opCode), fullText, offset, match.length);
    return `<a class="entity-link op-link" href="/#op/${safeId}/${safeCode}" data-entity-type="op" data-lang-id="${safeId}" data-op-code="${safeCode}">${labelHtml}</a>${citation}`;
  });

  return result;
}
