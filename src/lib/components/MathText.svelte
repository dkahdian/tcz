<script lang="ts">
  import {
    renderMathText,
    renderTextWithCitations,
    containsCitations,
    containsEntityLinks,
    renderEntityLinks,
    containsLatexTextFormatting,
    renderLatexTextFormatting
  } from '$lib/utils/math-text';
  import { getGlobalRefNumber } from '$lib/data/references.js';
  import { idToName, nameToId } from '$lib/utils/language-id.js';
  import { initialGraphData } from '$lib/data/index.js';
  import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';
  import type { EntityRefResolver } from '$lib/utils/math-text';

  const processedHtmlCache = new Map<string, string | null>();
  const PROCESSED_HTML_CACHE_MAX = 1024;

  function uniqueRefs(...refLists: Array<string[] | undefined>): string[] {
    const refs = new Set<string>();
    for (const refList of refLists) {
      for (const ref of refList ?? []) {
        if (ref) refs.add(ref);
      }
    }
    return Array.from(refs);
  }

  const operationMacroToCode: Record<string, string> = {
    '\\CO': 'CO',
    '\\VA': 'VA',
    '\\CE': 'CE',
    '\\IM': 'IM',
    '\\EQ': 'EQ',
    '\\SE': 'SE',
    '\\CT': 'CT',
    '\\ME': 'ME',
    '\\CD': 'CD',
    '\\FO': 'FO',
    '\\SFO': 'SFO',
    '\\NOTC': 'NOT_C',
    '\\ANDC': 'AND_C',
    '\\ANDBC': 'AND_BC',
    '\\ORC': 'OR_C',
    '\\ORBC': 'OR_BC'
  };

  function operationSupport(languageId: string, operationMacro: string) {
    const operationCode = operationMacroToCode[operationMacro] ?? operationMacro.replace(/^\\/, '');
    const language = initialGraphData.languages.find((item) => item.id === languageId);
    return language?.properties?.queries?.[operationCode] ?? language?.properties?.transformations?.[operationCode];
  }

  const entityRefResolver: EntityRefResolver = {
    edgeRefs(sourceId: string, targetId: string) {
      const { adjacencyMatrix } = initialGraphData;
      const sourceIdx = adjacencyMatrix.indexByLanguage[sourceId];
      const targetIdx = adjacencyMatrix.indexByLanguage[targetId];
      if (sourceIdx === undefined || targetIdx === undefined) return [];
      const relation = adjacencyMatrix.matrix[sourceIdx]?.[targetIdx];
      if (!relation) return [];
      return uniqueRefs(
        relation.refs,
        relation.noPolyDescription?.refs,
        relation.quasiDescription?.refs
      );
    },
    edgeAssumption(sourceId: string, targetId: string) {
      const { adjacencyMatrix } = initialGraphData;
      const sourceIdx = adjacencyMatrix.indexByLanguage[sourceId];
      const targetIdx = adjacencyMatrix.indexByLanguage[targetId];
      if (sourceIdx === undefined || targetIdx === undefined) return undefined;
      return adjacencyMatrix.matrix[sourceIdx]?.[targetIdx]?.assumption;
    },
    operationCode(operationMacro: string) {
      return operationMacroToCode[operationMacro];
    },
    operationLabel(operationMacro: string) {
      const operationCode = operationMacroToCode[operationMacro] ?? operationMacro.replace(/^\\/, '');
      return QUERIES[operationCode]?.label ?? TRANSFORMATIONS[operationCode]?.label ?? operationCode;
    },
    operationRefs(languageId: string, operationMacro: string) {
      return operationSupport(languageId, operationMacro)?.refs ?? [];
    },
    operationAssumption(languageId: string, operationMacro: string) {
      return operationSupport(languageId, operationMacro)?.assumption;
    }
  };

  let {
    text = '',
    className = '',
    as = 'span',
    wrapMode = 'normal',
    href,
    target,
    rel,
    /**
     * Callback when a citation is clicked. Receives the citation key.
     */
    onCitationClick = undefined as ((key: string) => void) | undefined,
    ...rest
  }: {
    text?: string | null;
    className?: string;
    as?: keyof HTMLElementTagNameMap | 'span';
    wrapMode?: 'normal' | 'hyphenate';
    href?: string;
    target?: string;
    rel?: string;
    onCitationClick?: (key: string) => void;
    [key: string]: unknown;
  } = $props();

  function cacheProcessedHtml(cacheKey: string, html: string | null): string | null {
    if (processedHtmlCache.size >= PROCESSED_HTML_CACHE_MAX) {
      const firstKey = processedHtmlCache.keys().next().value;
      if (firstKey !== undefined) processedHtmlCache.delete(firstKey);
    }
    processedHtmlCache.set(cacheKey, html);
    return html;
  }

  const result = $derived(renderMathText(text));

  // Process HTML once per unique input string; MathText is used heavily in tables
  // and sidebars, and citation/entity expansion is pure over the static dataset.
  const processedHtml = $derived.by(() => {
    const cacheKey = text ?? '';
    if (processedHtmlCache.has(cacheKey)) {
      return processedHtmlCache.get(cacheKey) ?? null;
    }
    if (!result.html) return cacheProcessedHtml(cacheKey, null);
    let html = result.html;

    if (containsLatexTextFormatting(text ?? '')) {
      html = renderLatexTextFormatting(html);
    }
    
    if (containsEntityLinks(text ?? '')) {
      html = renderEntityLinks(html, idToName, undefined, nameToId, undefined, entityRefResolver);
    }

    if (containsCitations(html)) {
      html = renderTextWithCitations(html, getGlobalRefNumber);
    }
    
    return cacheProcessedHtml(cacheKey, html);
  });

  const resolvedElement = $derived((href ? 'a' : as) as keyof HTMLElementTagNameMap | 'span');
  const resolvedRel = $derived(rel ?? (target === '_blank' ? 'noreferrer noopener' : undefined));
  const rootClass = $derived(
    `math-text ${wrapMode === 'hyphenate' ? 'math-text--hyphenate' : ''} ${className}`.trim()
  );
  
  // Handle clicks via event delegation for citations and entity links
  function handleClick(event: MouseEvent) {
    const el = event.target as HTMLElement;
    // Walk up to find the clickable element (in case click was on a child like KaTeX span)
    const link = el.closest('.citation-link, .entity-link') as HTMLElement | null;
    if (!link) return;

    if (link.classList.contains('citation-link')) {
      const key = link.dataset.citationKey;
      if (key && onCitationClick) {
        event.preventDefault();
        onCitationClick(key);
      }
      return;
    }

    if (link.classList.contains('entity-link')) {
      // Allow Ctrl+click / Cmd+click / middle-click to open in new tab naturally
      if (event.ctrlKey || event.metaKey || event.button === 1) return;
      // For regular clicks, route to the map hash target.
      event.preventDefault();
      const href = link.getAttribute('href');
      if (href) {
        if (href.startsWith('/')) {
          window.location.assign(href);
        } else if (href.startsWith('#')) {
          window.location.hash = href.replace(/^#/, '');
        } else {
          window.location.assign(href);
        }
      }
    }
  }
</script>

{#if processedHtml}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svelte:element
    this={resolvedElement}
    class={rootClass}
    aria-label={text ?? ''}
    href={href}
    target={target}
    rel={resolvedRel}
    onclick={handleClick}
    {...rest}
  >
    {@html processedHtml}
  </svelte:element>
{:else}
  <svelte:element
    this={resolvedElement}
    class={rootClass}
    href={href}
    target={target}
    rel={resolvedRel}
    {...rest}
  >
    {text}
  </svelte:element>
{/if}

<style>
  .math-text :global(.katex-display) {
    margin: 0;
  }

  .math-text :global(.katex) {
    font-size: 0.95em;
  }

  .math-text--hyphenate {
    overflow-wrap: break-word;
    hyphens: auto;
    hyphenate-character: "-";
  }

  .math-text--hyphenate :global(.entity-link),
  .math-text--hyphenate :global(.citation-link),
  .math-text--hyphenate :global(.citation-inline) {
    overflow-wrap: break-word;
    hyphens: auto;
    hyphenate-character: "-";
  }

  :global(.math-text.edge-link) {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgba(37, 99, 235, 0.3);
    transition: text-decoration-color 0.15s ease;
  }

  :global(.math-text.edge-link:hover) {
    text-decoration-color: rgba(37, 99, 235, 0.8);
  }

  .math-text :global(.citation-sup) {
    display: inline;
    font-size: 0.7em;
    vertical-align: super;
    line-height: 0;
    color: #2563eb;
    font-weight: 600;
    white-space: nowrap;
  }

  .math-text :global(.citation-inline) {
    display: inline;
    color: #374151;
    font-weight: 500;
    white-space: nowrap;
  }

  .math-text :global(.citation-link) {
    display: inline;
    font-size: inherit;
    vertical-align: baseline;
    line-height: inherit;
    color: #2563eb;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    font-weight: 600;
    text-decoration: none;
    transition: color 0.15s ease;
  }
  
  .math-text :global(.citation-link:hover) {
    color: #1d4ed8;
    text-decoration: underline;
  }
  
  .math-text :global(.citation-unknown) {
    display: inline;
    font-size: inherit;
    vertical-align: baseline;
    line-height: inherit;
    color: #dc2626;
    font-weight: 600;
  }

  .math-text :global(.citation-note) {
    color: #4b5563;
  }

  .math-text :global(.entity-link) {
    display: inline;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: #2563eb;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgba(37, 99, 235, 0.3);
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
    transition: text-decoration-color 0.15s ease, color 0.15s ease;
  }

  .math-text :global(.entity-link:hover) {
    text-decoration-color: rgba(37, 99, 235, 0.8);
    color: #1d4ed8;
  }

  .math-text :global(.entity-link:visited) {
    color: #2563eb;
  }

  .math-text :global(.entity-link--unknown) {
    color: #dc2626;
    text-decoration: none;
    cursor: default;
    font-weight: 600;
  }

  .math-text :global(.latex-list) {
    margin: 0.35rem 0 0.35rem 1.1rem;
    padding: 0;
  }

  .math-text :global(.latex-list li) {
    margin: 0.2rem 0;
  }

  .math-text :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.9em;
  }
</style>
