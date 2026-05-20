<script lang="ts">
  import { onMount } from 'svelte';
  import MathText from './MathText.svelte';
  import { getComplexityFromCatalog } from '$lib/data/complexities.js';
  import { initialGraphData } from '$lib/data/index.js';

  type ClaimTag =
    | {
        id: string;
        kind: 'edge';
        sourceName: string;
        targetName: string;
        href: string;
        status: string;
        title: string;
      }
    | {
        id: string;
        kind: 'query' | 'transformation';
        languageName: string;
        operationCode: string;
        href: string;
        status: string;
        title: string;
      };

  let {
    claimTags = []
  }: {
    claimTags: ClaimTag[];
  } = $props();

  let expanded = $state(false);
  let shouldCollapse = $state(false);
  let collapsedLimit = $state<number | null>(null);

  let containerEl: HTMLDivElement | null = $state(null);
  let measureRequest = 0;

  const hiddenCount = $derived.by(() => {
    if (!shouldCollapse || expanded || collapsedLimit === null) return 0;
    return Math.max(0, claimTags.length - collapsedLimit);
  });

  const visibleClaimTags = $derived.by(() => {
    if (!shouldCollapse || expanded || collapsedLimit === null) {
      return claimTags;
    }
    return claimTags.slice(0, collapsedLimit);
  });

  function getClaimTagStyle(statusCode: string): string {
    const complexity = getComplexityFromCatalog(initialGraphData.complexities, statusCode);
    const borderStyle = complexity.dashed ? 'dashed' : 'solid';
    return `--claim-tag-bg:${complexity.pastel};--claim-tag-fg:${complexity.color};--claim-tag-border:${complexity.color};--claim-tag-border-style:${borderStyle};`;
  }

  function computeLineCount(widths: number[], maxWidth: number, gapPx: number): number {
    if (widths.length === 0) return 0;

    let lineCount = 1;
    let lineWidth = 0;

    for (const width of widths) {
      const nextWidth = lineWidth === 0 ? width : lineWidth + gapPx + width;
      if (nextWidth <= maxWidth) {
        lineWidth = nextWidth;
      } else {
        lineCount += 1;
        lineWidth = width;
      }
    }

    return lineCount;
  }

  function computeCollapsedLimit(
    widths: number[],
    maxWidth: number,
    buttonWidth: number,
    gapPx: number
  ): number {
    const usableWidth = Math.max(0, maxWidth - buttonWidth - gapPx);
    let runningWidth = 0;
    let count = 0;

    for (const width of widths) {
      const nextWidth = runningWidth === 0 ? width : runningWidth + gapPx + width;
      if (nextWidth <= usableWidth) {
        runningWidth = nextWidth;
        count += 1;
      } else {
        break;
      }
    }

    return Math.max(1, count);
  }

  function measureCollapseState() {
    if (!containerEl || claimTags.length === 0) {
      shouldCollapse = false;
      collapsedLimit = null;
      expanded = false;
      return;
    }

    const availableWidth = containerEl.clientWidth;
    if (availableWidth <= 0) return;

    const gapPx = 4;
    const measureTags = Array.from(
      containerEl.querySelectorAll<HTMLSpanElement>('.claim-measure .claim-tag--measure')
    );
    const tagWidths = measureTags.map((el) => el.offsetWidth);

    if (tagWidths.length !== claimTags.length || tagWidths.some((width) => width <= 0)) {
      return;
    }

    const lineCount = computeLineCount(tagWidths, availableWidth, gapPx);
    if (lineCount <= 1) {
      shouldCollapse = false;
      collapsedLimit = null;
      expanded = false;
      return;
    }

    const measureButton = containerEl.querySelector<HTMLButtonElement>('.claim-toggle-measure');
    const buttonWidth = measureButton?.offsetWidth ?? 22;
    const limit = computeCollapsedLimit(tagWidths, availableWidth, buttonWidth, gapPx);

    shouldCollapse = true;
    collapsedLimit = Math.min(limit, claimTags.length);
  }

  function scheduleMeasureCollapseState() {
    if (typeof window === 'undefined') {
      measureCollapseState();
      return;
    }

    if (measureRequest) {
      cancelAnimationFrame(measureRequest);
    }

    measureRequest = requestAnimationFrame(() => {
      measureRequest = requestAnimationFrame(() => {
        measureRequest = 0;
        measureCollapseState();
      });
    });
  }

  $effect(() => {
    claimTags;
    queueMicrotask(() => scheduleMeasureCollapseState());
  });

  onMount(() => {
    if (!containerEl) return;

    const observer = new ResizeObserver(() => {
      scheduleMeasureCollapseState();
    });

    observer.observe(containerEl);
    queueMicrotask(() => scheduleMeasureCollapseState());

    document.fonts?.ready.then(() => scheduleMeasureCollapseState()).catch(() => {});

    return () => {
      observer.disconnect();
      if (measureRequest) cancelAnimationFrame(measureRequest);
    };
  });
</script>

<div class="claim-tags-shell" bind:this={containerEl}>
  <div class="claim-tags" aria-label="Claims referencing this paper">
    {#each visibleClaimTags as claim (claim.id)}
      <a
        class="claim-tag"
        href={claim.href}
        target="_blank"
        rel="noreferrer noopener"
        title={claim.title}
        style={getClaimTagStyle(claim.status)}
      >
        {#if claim.kind === 'edge'}
          <MathText text={claim.sourceName} className="inline" />
          <span class="claim-divider">-&gt;</span>
          <MathText text={claim.targetName} className="inline" />
        {:else}
          <MathText text={claim.languageName} className="inline" />
          <span class="claim-divider">:</span>
          <span class="claim-op">{claim.operationCode}</span>
        {/if}
      </a>
    {/each}

    {#if shouldCollapse}
      <button
        type="button"
        class="claim-toggle"
        onclick={() => (expanded = !expanded)}
        aria-expanded={expanded}
        title={expanded ? 'Collapse claim tags' : 'Expand claim tags'}
      >
        {expanded ? '-' : `+${hiddenCount}`}
      </button>
    {/if}
  </div>

  <div class="claim-measure" aria-hidden="true">
    {#each claimTags as claim (claim.id)}
      <span class="claim-tag claim-tag--measure">
        {#if claim.kind === 'edge'}
          <MathText text={claim.sourceName} className="inline" />
          <span class="claim-divider">-&gt;</span>
          <MathText text={claim.targetName} className="inline" />
        {:else}
          <MathText text={claim.languageName} className="inline" />
          <span class="claim-divider">:</span>
          <span class="claim-op">{claim.operationCode}</span>
        {/if}
      </span>
    {/each}
    <button type="button" class="claim-toggle claim-toggle-measure">+</button>
  </div>
</div>

<style>
  .claim-tags-shell {
    position: relative;
    margin-top: 0.375rem;
  }

  .claim-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }

  .claim-tag {
    --claim-tag-bg: #f3f4f6;
    --claim-tag-fg: #334155;
    --claim-tag-border: #cbd5e1;
    --claim-tag-border-style: solid;
    display: inline-flex;
    align-items: center;
    gap: 0.14rem;
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0;
    min-height: 1.25rem;
    padding: 0.12rem 0.34rem;
    border-radius: 999px;
    border: 1px var(--claim-tag-border-style) var(--claim-tag-border);
    background: var(--claim-tag-bg);
    color: var(--claim-tag-fg);
    text-decoration: none;
    white-space: nowrap;
    transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
  }

  .claim-tag:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
    filter: saturate(1.08);
  }

  .claim-tag:focus-visible {
    outline: 2px solid #1d4ed8;
    outline-offset: 1px;
  }

  .claim-tag :global(.katex) {
    font-size: 0.9em;
    line-height: 1;
  }

  .claim-tag :global(.math-text) {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    line-height: 1;
    margin: 0;
    color: inherit;
  }

  .claim-divider {
    opacity: 0.85;
    line-height: 1;
  }

  .claim-op {
    font-family: 'SFMono-Regular', 'Consolas', monospace;
    font-size: 0.9em;
    line-height: 1;
  }

  .claim-toggle {
    flex-shrink: 0;
    width: auto;
    min-width: 2.2rem;
    padding: 0 0.34rem;
    height: 1.25rem;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    background: #e2e8f0;
    color: #475569;
    font-size: 0.68rem;
    line-height: 1;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }

  .claim-toggle:hover {
    background: #cbd5e1;
    border-color: #94a3b8;
    color: #1f2937;
  }

  .claim-toggle:focus-visible {
    outline: 2px solid #1d4ed8;
    outline-offset: 1px;
  }

  .claim-measure {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    visibility: hidden;
    pointer-events: none;
    height: 0;
    overflow: hidden;
    z-index: -1;
  }

  .claim-tag--measure,
  .claim-toggle-measure {
    transition: none;
  }
</style>
