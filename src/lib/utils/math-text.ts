import katex from 'katex';

const LATEX_TRIGGER = /(\$\$?[\s\S]*?\$|\\\[|\\\(|\\begin\{|\\cite[tp]?(?:\[[^\]]*\]){0,2}\{|\\langref\{|\\langfam\{|\\(?:compilespoly|compilesquasi|nocompilespoly|nocompilesquasi|supportspoly|supportsquasi|nosupportspoly|nosupportsquasi)\{)/;
const LATEX_FRAGMENT = /(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
const CITATION_PATTERN = /\\cite[tp]?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g;
const CITATION_RENDER_PATTERN = /\\(cite|citet|citep)((?:\[[^\]]*\]){0,2})\{([^}]+)\}/g;

// Entity link patterns (processed after HTML rendering)
const LANGREF_PATTERN = /\\langref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{([^{}]*)\})?/g;
const LANGFAM_PATTERN = /\\langfam\{([^}]+)\}\{([^}]+)\}(?:\{([^{}]*)\})?/g;
const RELATIONREF_PATTERN = /\\(compilespoly|compilesquasi|nocompilespoly|nocompilesquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{((?:[^{}]|\{[^{}]*\})+)\}/g;
const OPRESULT_PATTERN = /\\(supportspoly|supportsquasi|nosupportspoly|nosupportsquasi)\{((?:[^{}]|\{[^{}]*\})+)\}\{(\\[A-Za-z]+)\}/g;
const EMPH_PATTERN = /\\emph\{([^}]+)\}/g;
const TEXTIT_PATTERN = /\\textit\{([^}]+)\}/g;
const TEXTBF_PATTERN = /\\textbf\{([^}]+)\}/g;
const TEXTTT_PATTERN = /\\texttt\{([^}]+)\}/g;
const ENTITY_COMMAND_PATTERN = /\\langref\{(?:[^{}]|\{[^{}]*\})+\}(?:\{[^{}]*\})?|\\langfam\{[^{}]+\}\{[^{}]+\}(?:\{[^{}]*\})?|\\(?:compilespoly|compilesquasi|nocompilespoly|nocompilesquasi)\{(?:[^{}]|\{[^{}]*\})+\}\{(?:[^{}]|\{[^{}]*\})+\}|\\(?:supportspoly|supportsquasi|nosupportspoly|nosupportsquasi)\{(?:[^{}]|\{[^{}]*\})+\}\{\\[A-Za-z]+\}/g;

export interface EntityRefResolver {
  edgeRefs?: (sourceId: string, targetId: string) => string[];
  edgeAssumption?: (sourceId: string, targetId: string) => string | undefined;
  operationLabel?: (operationMacro: string) => string;
  operationCode?: (operationMacro: string) => string | undefined;
  operationRefs?: (languageId: string, operationMacro: string) => string[];
  operationAssumption?: (languageId: string, operationMacro: string) => string | undefined;
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

function protectEntityCommands(value: string): {
  text: string;
  restore: (html: string) => string;
} {
  const commands: string[] = [];
  const text = value.replace(ENTITY_COMMAND_PATTERN, (match) => {
    const index = commands.length;
    commands.push(match);
    return `@@KCM_ENTITY_${index}@@`;
  });

  return {
    text,
    restore(html: string): string {
      return html.replace(/@@KCM_ENTITY_(\d+)@@/g, (placeholder, rawIndex: string) => {
        const command = commands[Number(rawIndex)];
        if (command === undefined) return placeholder;
        return escapeHtml(decodeLatexLiteralEscapes(command));
      });
    }
  };
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
  return /\\cite[tp]?(?:\[[^\]]*\]){0,2}\{/.test(text);
}

function parseCitationOptions(rawOptions: string): { prenote?: string; postnote?: string } {
  const options = [...rawOptions.matchAll(/\[([^\]]*)\]/g)].map((match) => match[1].trim()).filter(Boolean);
  if (options.length === 0) return {};
  if (options.length === 1) return { postnote: options[0] };
  return { prenote: options[0], postnote: options[1] };
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

function normalizeBareInlineMath(value: string): string {
  LATEX_FRAGMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let normalized = '';

  while ((match = LATEX_FRAGMENT.exec(value)) !== null) {
    normalized += normalizeBareInlineMathSegment(value.slice(cursor, match.index));
    normalized += match[0];
    cursor = match.index + match[0].length;
  }

  normalized += normalizeBareInlineMathSegment(value.slice(cursor));
  return normalized;
}

function normalizeBareInlineMathSegment(value: string): string {
  return value.replace(/\bP\s*(?:\\neq|\\ne|\u2260)\s*NP\b/g, '$P \\neq NP$');
}

export function renderMathText(input?: string | null): MathRenderResult {
  const text = normalizeBareInlineMath(input ?? '');
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
  const protectedText = protectEntityCommands(text);
  let match: RegExpExecArray | null;
  let cursor = 0;
  let html = '';
  let foundLatex = false;

  while ((match = LATEX_FRAGMENT.exec(protectedText.text)) !== null) {
    foundLatex = true;
    html += escapeHtml(decodeLatexLiteralEscapes(protectedText.text.slice(cursor, match.index))).replace(/\n/g, '<br>');
    const fragment = match[0];
    const { content, displayMode } = stripDelimiters(fragment);
    html += renderFragment(content.trim(), displayMode);
    cursor = match.index + fragment.length;
  }

  if (!foundLatex) {
    const htmlWithBreaks = protectedText.restore(
      escapeHtml(decodeLatexLiteralEscapes(protectedText.text)).replace(/\n/g, '<br>')
    );
    return cacheAndReturn({ hasLatex: false, html: htmlWithBreaks, plainText: text, citationKeys });
  }

  html += escapeHtml(decodeLatexLiteralEscapes(protectedText.text.slice(cursor))).replace(/\n/g, '<br>');
  html = protectedText.restore(html);
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
  keyToNumber: (key: string) => number | null
): string {
  // \cite and \citep render as compact superscript citations.
  // \citet renders inline so it can be used as a noun, including locators
  // such as \citet[Theorem 4.2]{key}.
  return html.replace(CITATION_RENDER_PATTERN, (_match, command: string, rawOptions: string, keyList: string) => {
    const { prenote, postnote } = parseCitationOptions(rawOptions);
    const keys = keyList.split(',').map(k => k.trim()).filter(Boolean);
    const numbers = keys.map((key) => {
      const num = keyToNumber(key);
      if (num === null) {
        return { key, html: `<span class="citation-unknown" title="Unknown reference: ${escapeHtml(key)}">?</span>` };
      }
      const dataKey = escapeHtml(key);
      return {
        key,
        html: `<button class="citation-link" data-citation-key="${dataKey}" title="View reference">${num}</button>`
      };
    });

    if (command === 'citet') {
      const parts = numbers.map((number) => number.html);
      if (postnote) parts.push(`<span class="citation-note">${postnote}</span>`);
      const prefix = prenote ? `<span class="citation-note">${prenote}</span> ` : '';
      return `<span class="citation-inline">[${prefix}${parts.join(', ')}]</span>`;
    }

    return numbers.map((number) => {
      const key = escapeHtml(number.key);
      return `<span class="citation-sup" data-citation-source="${key}">[${number.html}]</span>`;
    }).join('');
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
 * Check if text contains entity link commands.
 */
export function containsEntityLinks(text: string): boolean {
  return /\\(langref|langfam|compilespoly|compilesquasi|nocompilespoly|nocompilesquasi|supportspoly|supportsquasi|nosupportspoly|nosupportsquasi)\{/.test(text);
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

function renderEntitySuffixHtml(suffix: string | undefined): string {
  if (!suffix) return '';
  return escapeHtml(decodeMinimalEntities(suffix));
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
    .replace(/^\\langfam\{([^{}]+)\}\{([^{}]+)\}(?:\{[^{}]*\})?$/i, '$1_$2')
    .replace(/^\\langref\{((?:[^{}]|\{[^{}]*\})+)\}(?:\{[^{}]*\})?$/i, '$1')
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
  return ` \\citep{${missing.join(',')}}`;
}

/**
 * Replace entity link commands with clickable <a> elements.
 * 
 * Supported commands:
 * - \langref{langId} → link to language info panel
 * - relation macros such as \compilespoly{...}{...}: link to edge info panel
 * - operation-result macros such as \supportspoly{...}{...}: link to operation cell info panel
 *
 * Uses <a> tags with href so Ctrl+click opens in a new tab.
 */
export function renderEntityLinks(
  html: string,
  idToName: (id: string) => string,
  _opCodeToLabel?: (code: string) => string,
  nameToId?: (name: string) => string | undefined,
  _definitionRefResolver?: (ref: string) => { id: string; title: string; resolved: boolean },
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

  function relationBlowupPhrase(command: string): string {
    if (command === 'compilespoly' || command === 'nocompilespoly') return 'with polynomial blowup';
    return 'with quasipolynomial blowup';
  }

  function relationVerbPhrase(command: string): string {
    if (command === 'compilespoly' || command === 'compilesquasi') return 'compiles to';
    return 'does not compile to';
  }

  function renderAssumptionHtml(assumption: string | undefined): string {
    if (!assumption) return '';
    const rendered = renderMathText(formatAssumptionForMathText(assumption));
    return ` assuming ${rendered.html ?? escapeHtml(assumption)}`;
  }

  function relationLabelHtml(command: string, srcName: string, tgtName: string, assumption?: string): string {
    const source = renderNameHtml(srcName);
    const target = renderNameHtml(tgtName);
    return `${source} ${relationVerbPhrase(command)} ${target} ${relationBlowupPhrase(command)}${renderAssumptionHtml(assumption)}`;
  }

  function operationTimePhrase(command: string): string {
    if (command === 'supportspoly' || command === 'nosupportspoly') return 'in polynomial time';
    return 'in quasipolynomial time';
  }

  function operationLabelHtml(command: string, langName: string, operationMacro: string, assumption?: string): string {
    const language = renderNameHtml(langName);
    const operation = escapeHtml(entityRefResolver?.operationLabel?.(operationMacro) ?? operationMacro.replace(/^\\/, ''));
    if (command === 'supportspoly' || command === 'supportsquasi') {
      return `${language} supports ${operation} ${operationTimePhrase(command)}${renderAssumptionHtml(assumption)}`;
    }
    return `${operation} is unsupported by ${language} ${operationTimePhrase(command)}${renderAssumptionHtml(assumption)}`;
  }

  result = result.replace(RELATIONREF_PATTERN, (match: string, command: string, srcRef: string, tgtRef: string, offset: number, fullText: string) => {
    const src = resolveLang(srcRef);
    const tgt = resolveLang(tgtRef);
    const assumption = src.resolved && tgt.resolved
      ? entityRefResolver?.edgeAssumption?.(src.id, tgt.id)
      : undefined;
    const labelHtml = relationLabelHtml(command, src.name, tgt.name, assumption);
    if (!src.resolved || !tgt.resolved || !src.id.startsWith('lang_') || !tgt.id.startsWith('lang_')) {
      return labelHtml;
    }
    const safeSrc = escapeHtml(src.id);
    const safeTgt = escapeHtml(tgt.id);
    const citation = entityCitationSuffix(entityRefResolver?.edgeRefs?.(src.id, tgt.id), fullText, offset, match.length);
    return `<a class="entity-link edge-link" href="/#edge/${safeSrc}/${safeTgt}" data-entity-type="edge" data-source-id="${safeSrc}" data-target-id="${safeTgt}">${labelHtml}</a>${citation}`;
  });

  result = result.replace(OPRESULT_PATTERN, (match: string, command: string, languageRef: string, operationMacro: string, offset: number, fullText: string) => {
    const language = resolveLang(languageRef);
    const assumption = language.resolved
      ? entityRefResolver?.operationAssumption?.(language.id, operationMacro)
      : undefined;
    const labelHtml = operationLabelHtml(command, language.name, operationMacro, assumption);
    if (!language.resolved || !language.id.startsWith('lang_')) {
      return labelHtml;
    }
    const safeId = escapeHtml(language.id);
    const operationCode = entityRefResolver?.operationCode?.(operationMacro) ?? operationMacro.replace(/^\\/, '');
    const safeOp = escapeHtml(operationCode);
    const citation = entityCitationSuffix(entityRefResolver?.operationRefs?.(language.id, operationMacro), fullText, offset, match.length);
    return `<a class="entity-link operation-link" href="/#op/${safeId}/${safeOp}" data-entity-type="operation" data-lang-id="${safeId}" data-operation-code="${safeOp}">${labelHtml}</a>${citation}`;
  });

  // Replace \langref{langId or langName}
  result = result.replace(LANGREF_PATTERN, (_match, langRef: string, suffix: string | undefined) => {
    const { id, name } = resolveLang(langRef);
    const nameHtml = `${renderNameHtml(name)}${renderEntitySuffixHtml(suffix)}`;
    if (!id.startsWith('lang_')) {
      return nameHtml;
    }
    const safeId = escapeHtml(id);
    return `<a class="entity-link lang-link" href="/#lang/${safeId}" data-entity-type="lang" data-lang-id="${safeId}">${nameHtml}</a>`;
  });

  // Replace \langfam{Base}{Index} with linked class-member language names.
  result = result.replace(LANGFAM_PATTERN, (_match, base: string, index: string, suffix: string | undefined) => {
    const familyRef = `${base}_${index}`;
    const { id, name } = resolveLang(familyRef);
    const nameHtml = `${renderNameHtml(name)}${renderEntitySuffixHtml(suffix)}`;
    if (!id.startsWith('lang_')) {
      return nameHtml;
    }
    const safeId = escapeHtml(id);
    return `<a class="entity-link lang-link" href="/#lang/${safeId}" data-entity-type="lang" data-lang-id="${safeId}">${nameHtml}</a>`;
  });

  return result;
}
