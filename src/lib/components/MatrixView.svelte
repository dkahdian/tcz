<script lang="ts">
  import type {
    GraphData,
    FilteredGraphData,
    KCLanguage,
    SelectedEdge,
    DirectedSuccinctnessRelation
  } from '$lib/types.js';
  import { measureCellSize } from '$lib/utils/matrix-cell-size.js';
  import { compareByCanonicalOrder } from '$lib/utils/canonical-order.js';

  /**
   * Sort language IDs by canonical order. Unknown languages are appended alphabetically.
   */
  function sortByCanonicalOrder(ids: string[]): string[] {
    const getName = (id: string) => languageLookup.get(id)?.name?.toLowerCase() ?? id;
    return [...ids].sort((a, b) => compareByCanonicalOrder(a, b, getName));
  }

  let {
    graphData,
    selectedNode = $bindable(),
    selectedEdge = $bindable(),
    highlightedEdgeIds = new Set<string>(),
    directEditedEdgeIds = new Set<string>(),
    sandboxMode = false,
    showQuasipolynomialSandboxOptions = true,
    sandboxSelectedEdgeId = null,
    sandboxBaselineGraphData = null,
    onSandboxEdgeEdit,
    onSandboxEdgeStatusChange
  }: {
    graphData: GraphData | FilteredGraphData;
    selectedNode: KCLanguage | null;
    selectedEdge: SelectedEdge | null;
    highlightedEdgeIds?: Set<string>;
    directEditedEdgeIds?: Set<string>;
    sandboxMode?: boolean;
    showQuasipolynomialSandboxOptions?: boolean;
    sandboxSelectedEdgeId?: string | null;
    sandboxBaselineGraphData?: GraphData | FilteredGraphData | null;
    onSandboxEdgeEdit?: (sourceId: string, targetId: string) => void;
    onSandboxEdgeStatusChange?: (sourceId: string, targetId: string, status: string | null) => boolean;
  } = $props();

  const DEFAULT_SANDBOX_EDGE_OPTIONS = [
    'no-poly-unknown-quasi',
    'poly',
    'unknown-both'
  ];

  const ALL_SANDBOX_EDGE_OPTIONS = [
    'poly',
    'no-poly-unknown-quasi',
    'no-poly-quasi',
    'unknown-poly-quasi',
    'unknown-both',
    'no-quasi'
  ];

  const STATUS_LABELS = $derived.by<Record<string, string>>(() => {
    return Object.fromEntries(Object.values(graphData.complexities).map((c) => [c.code, c.label]));
  });

  const STATUS_CLASSES = $derived.by<Record<string, string>>(() => {
    return Object.fromEntries(Object.values(graphData.complexities).map((c) => [c.code, c.cssClass]));
  });

  import { renderMathText } from '$lib/utils/math-text.js';

  /** Pre-rendered KaTeX HTML for each status notation — uses renderMathText cache 
   *  so KaTeX is called once per unique notation, then reused across all cells. */
  const STATUS_SHORT_HTML = $derived.by<Record<string, string>>(() => {
    return Object.fromEntries(
      Object.values(graphData.complexities).map((c) => {
        const result = renderMathText(c.notation);
        return [c.code, result.html ?? c.notation];
      })
    );
  });

  const CONDITIONAL_STATUS_SHORT_HTML = $derived.by<Record<string, string>>(() => {
    return Object.fromEntries(
      Object.values(graphData.complexities).map((c) => {
        const notation = getConditionalNotation(c.code, c.notation);
        const result = renderMathText(notation);
        return [c.code, result.html ?? notation];
      })
    );
  });

  const UNKNOWN_STATUS = 'unknown-both';

  function getConditionalNotation(status: string, notation: string): string {
    switch (status) {
      case 'poly':
        return '$\\leq_p^\\ast$';
      case 'no-poly-unknown-quasi':
        return '$\\not\\leq_p^\\ast \\ \\leq_q^?$';
      case 'no-poly-quasi':
        return '$\\not\\leq_p^\\ast \\ \\leq_q$';
      case 'unknown-poly-quasi':
        return '$\\leq_p^? \\ \\leq_q^\\ast$';
      case 'no-quasi':
        return '$\\not\\leq_q^\\ast$';
      default:
        return notation;
    }
  }

  function getStatusHtml(status: string, hasAssumption = false): string {
    if (hasAssumption) {
      return CONDITIONAL_STATUS_SHORT_HTML[status] ?? STATUS_SHORT_HTML[status] ?? '';
    }
    return STATUS_SHORT_HTML[status] ?? '';
  }

  function getSandboxDisplayStatus(status: string): string {
    if (showQuasipolynomialSandboxOptions) return status;
    switch (status) {
      case 'no-poly-unknown-quasi':
      case 'no-poly-quasi':
      case 'no-quasi':
      case 'not-poly':
        return 'not-poly';
      case 'unknown-poly-quasi':
      case 'unknown-both':
      case 'unknown':
        return 'unknown';
      default:
        return status;
    }
  }

  function getSandboxOptionClass(status: string): string {
    const displayStatus = getSandboxDisplayStatus(status);
    return STATUS_CLASSES[displayStatus] ?? STATUS_CLASSES[status] ?? '';
  }

  function getSandboxOptionHtml(status: string): string {
    const displayStatus = getSandboxDisplayStatus(status);
    return getStatusHtml(displayStatus) || getStatusHtml(status);
  }

  function isOriginalSandboxOption(status: string, baselineValue: string): boolean {
    const originalStatus = baselineValue || UNKNOWN_STATUS;
    return getSandboxDisplayStatus(status) === getSandboxDisplayStatus(originalStatus);
  }

  const languageLookup = $derived.by<Map<string, KCLanguage>>(() => {
    const map = new Map<string, KCLanguage>();
    for (const language of graphData.languages) {
      map.set(language.id, language);
    }
    return map;
  });

  /** Pre-rendered HTML for language names — avoids MathText component overhead per header cell */
  const languageNameHtml = $derived.by<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const language of graphData.languages) {
      const result = renderMathText(language.name);
      map.set(language.id, result.html ?? language.name);
    }
    return map;
  });

  const visibleLanguageIds = $derived.by<string[]>(() => {
    let ids = graphData.adjacencyMatrix.languageIds.filter((id) => languageLookup.has(id));
    if ('visibleLanguageIds' in graphData && graphData.visibleLanguageIds.size > 0) {
      ids = ids.filter((id) => graphData.visibleLanguageIds.has(id));
    }
    return sortByCanonicalOrder(ids);
  });

  type MatrixLanguageEntry = {
    id: string;
    language: KCLanguage;
    matrixIndex: number;
  };

  const matrixLanguages = $derived.by<MatrixLanguageEntry[]>(() => {
    const entries: MatrixLanguageEntry[] = [];
    for (const id of visibleLanguageIds) {
      const language = languageLookup.get(id);
      const matrixIndex = graphData.adjacencyMatrix.indexByLanguage[id];
      if (!language || typeof matrixIndex !== 'number') continue;
      entries.push({ id, language, matrixIndex });
    }
    return entries;
  });

  const visibleEdgeIds = $derived.by<Set<string> | null>(() => ('visibleEdgeIds' in graphData ? graphData.visibleEdgeIds : null));

  function getRelation(
    rowLanguage: MatrixLanguageEntry,
    colLanguage: MatrixLanguageEntry
  ): DirectedSuccinctnessRelation | null {
    // In transposed view: rows = targets, columns = sources
    // So cell (row, col) shows relation from col → row
    if (rowLanguage.id === colLanguage.id) return null;
    const { adjacencyMatrix } = graphData;
    const relation = adjacencyMatrix.matrix[colLanguage.matrixIndex]?.[rowLanguage.matrixIndex] ?? null;
    return relation;
  }

  function buildSelectedEdge(sourceId: string, targetId: string): SelectedEdge | null {
    if (sourceId === targetId) return null;
    const { adjacencyMatrix } = graphData;
    const sourceIndex = adjacencyMatrix.indexByLanguage[sourceId];
    const targetIndex = adjacencyMatrix.indexByLanguage[targetId];
    if (sourceIndex === undefined || targetIndex === undefined) return null;

    const sourceLang = languageLookup.get(sourceId);
    const targetLang = languageLookup.get(targetId);
    if (!sourceLang || !targetLang) return null;

    const forward = adjacencyMatrix.matrix[sourceIndex]?.[targetIndex] ?? null;
    const backward = adjacencyMatrix.matrix[targetIndex]?.[sourceIndex] ?? null;
    const refs = [
      ...(forward?.refs ?? []),
      ...(backward?.refs ?? [])
    ];

    const canonicalSource = sourceId < targetId ? sourceId : targetId;
    const canonicalTarget = sourceId < targetId ? targetId : sourceId;

    return {
      id: `${canonicalSource}-${canonicalTarget}`,
      source: sourceId,
      target: targetId,
      sourceName: sourceLang.name,
      targetName: targetLang.name,
      forward,
      backward,
      refs
    };
  }

  function handleRowHeaderClick(language: KCLanguage) {
    selectedEdge = null;
    selectedNode = language;
  }

  function handleColumnHeaderClick(language: KCLanguage) {
    selectedEdge = null;
    selectedNode = language;
  }

  function handleCellClick(sourceId: string, targetId: string, relation: DirectedSuccinctnessRelation | null) {
    if (sandboxMode) {
      onSandboxEdgeEdit?.(sourceId, targetId);
    }
    const edge = buildSelectedEdge(sourceId, targetId);
    if (edge) {
      selectedNode = null;
      selectedEdge = edge;
    }
  }

  function isEdgeSelected(sourceId: string, targetId: string): boolean {
    if (!selectedEdge) return false;
    const { source, target } = selectedEdge;
    return source === sourceId && target === targetId;
  }

  function isComplementSelected(sourceId: string, targetId: string): boolean {
    if (!selectedEdge) return false;
    const { source, target } = selectedEdge;
    // Complement is the reverse direction
    return source === targetId && target === sourceId;
  }

  function isLanguageHighlighted(languageId: string): boolean {
    return selectedNode?.id === languageId;
  }

  function isPreviewHighlighted(sourceId: string, targetId: string): boolean {
    return highlightedEdgeIds.has(`${sourceId}->${targetId}`);
  }

  function isDirectSandboxEdit(sourceId: string, targetId: string): boolean {
    return directEditedEdgeIds.has(`${sourceId}->${targetId}`);
  }

  function isSandboxEditing(sourceId: string, targetId: string): boolean {
    return sandboxMode && sandboxSelectedEdgeId === `${sourceId}->${targetId}`;
  }

  function getSandboxCellValue(relation: DirectedSuccinctnessRelation | null): string {
    return relation?.status ?? '';
  }

  function getBaselineRelation(sourceId: string, targetId: string): DirectedSuccinctnessRelation | null {
    const sourceData = sandboxBaselineGraphData ?? graphData;
    const { adjacencyMatrix } = sourceData;
    const sourceIndex = adjacencyMatrix.indexByLanguage[sourceId];
    const targetIndex = adjacencyMatrix.indexByLanguage[targetId];
    if (sourceIndex === undefined || targetIndex === undefined) return null;
    return adjacencyMatrix.matrix[sourceIndex]?.[targetIndex] ?? null;
  }

  function validSandboxOptions(currentValue: string): string[] {
    if (!showQuasipolynomialSandboxOptions) {
      return DEFAULT_SANDBOX_EDGE_OPTIONS;
    }

    switch (currentValue) {
      case 'poly':
      case 'no-quasi':
      case 'no-poly-quasi':
        return [];
      case 'no-poly-unknown-quasi':
        return ['no-poly-unknown-quasi', 'no-poly-quasi', 'no-quasi'];
      case 'unknown-poly-quasi':
        return ['unknown-poly-quasi', 'no-poly-quasi', 'poly'];
      case 'unknown-both':
      case '':
      default:
        return ALL_SANDBOX_EDGE_OPTIONS;
    }
  }

  function handleSandboxStatusClick(
    event: MouseEvent,
    sourceId: string,
    targetId: string,
    status: string,
    currentValue: string,
    baselineValue: string
  ) {
    event.stopPropagation();
    if (isOriginalSandboxOption(status, baselineValue)) {
      onSandboxEdgeStatusChange?.(sourceId, targetId, null);
      return;
    }
    if (getSandboxDisplayStatus(status) === getSandboxDisplayStatus(currentValue)) {
      onSandboxEdgeEdit?.(sourceId, targetId);
      return;
    }
    onSandboxEdgeStatusChange?.(sourceId, targetId, status || null);
  }

  function getCellTitle(
    rowLang: KCLanguage,
    colLang: KCLanguage,
    relation: DirectedSuccinctnessRelation | null
  ): string {
    // In transposed view: cell (row, col) shows relation from col → row
    if (!relation) return `${colLang.name} → ${rowLang.name}: Unknown`;
    const label = STATUS_LABELS[relation.status];
    const refs = relation.refs?.length ? ` · refs: ${relation.refs.join(', ')}` : '';
    const assumptionStr = relation.assumption ? ` (assuming ${relation.assumption})` : '';
    return `${colLang.name} → ${rowLang.name}: ${label}${assumptionStr}${refs}`;
  }

  // Dynamic cell sizing
  let matrixScrollEl: HTMLDivElement;
  let tableEl: HTMLTableElement;
  let cellSize = $state({ width: 0, height: 0, headerWidth: 0 });
  let measured = $state(false);
  let lastContainerSize = { width: 0, height: 0 };
  let lastLanguageCount = 0;

  function updateCellSize() {
    if (!matrixScrollEl || !tableEl) return;
    
    const containerWidth = matrixScrollEl.clientWidth;
    const containerHeight = matrixScrollEl.clientHeight;
    const langCount = matrixLanguages.length;
    
    // Skip re-measurement if container size and language count haven't changed
    if (measured && containerWidth === lastContainerSize.width 
        && containerHeight === lastContainerSize.height 
        && langCount === lastLanguageCount) {
      return;
    }
    
    const numCells = langCount + 1; // +1 for header
    const result = measureCellSize(matrixScrollEl, tableEl, numCells, numCells);
    if (result) {
      // Only update if dimensions actually changed
      if (result.width !== cellSize.width || result.height !== cellSize.height || result.headerWidth !== cellSize.headerWidth) {
        cellSize = result;
      }
      lastContainerSize = { width: containerWidth, height: containerHeight };
      lastLanguageCount = langCount;
      measured = true;
    }
  }

  $effect(() => {
    // Re-measure when languages change
    matrixLanguages;
    measured = false;
    // Use microtask to ensure DOM is updated
    queueMicrotask(() => updateCellSize());
  });

  // Also measure on mount and resize
  import { onMount } from 'svelte';
  onMount(() => {
    updateCellSize();
    const resizeObserver = new ResizeObserver(() => updateCellSize());
    if (matrixScrollEl) resizeObserver.observe(matrixScrollEl);
    return () => resizeObserver.disconnect();
  });
</script>

<div class="matrix-view" aria-live="polite">
  <div class="matrix-scroll" bind:this={matrixScrollEl} role="region" aria-label="Adjacency matrix view">
    <table 
      class="matrix-table" 
      bind:this={tableEl}
      style:--cell-width="{cellSize.width}px"
      style:--cell-height="{cellSize.height}px"
      style:--header-width="{cellSize.headerWidth}px"
      class:measured
    >
      <thead>
        <tr>
          <th class="corner-cell" aria-hidden="true"></th>
          {#each matrixLanguages as column}
            <th class={`col-header ${selectedNode?.id === column.id ? 'is-active' : ''}`}>
              <button type="button" onclick={() => handleColumnHeaderClick(column.language)} title={`Select ${column.language.name}`}>
                <span class="math-text inline column-label" aria-label={column.language.name}>{@html languageNameHtml.get(column.id) ?? column.language.name}</span>
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each matrixLanguages as rowLanguage}
          <tr>
            <th class={`row-header ${selectedNode?.id === rowLanguage.id ? 'is-active' : ''}`}>
              <button type="button" onclick={() => handleRowHeaderClick(rowLanguage.language)} title={`Select ${rowLanguage.language.name}`}>
                <span class="math-text inline" aria-label={rowLanguage.language.name}>{@html languageNameHtml.get(rowLanguage.id) ?? rowLanguage.language.name}</span>
              </button>
            </th>
            {#each matrixLanguages as colLanguage}
              {#if rowLanguage.id === colLanguage.id}
                <td class={`matrix-cell--diagonal ${isLanguageHighlighted(rowLanguage.id) ? 'is-row-highlighted is-col-highlighted' : ''}`}>
                  <button
                    type="button"
                    class="diagonal-button"
                    onclick={() => handleRowHeaderClick(rowLanguage.language)}
                    aria-label={`Select ${rowLanguage.language.name}`}
                    title={`Select ${rowLanguage.language.name}`}
                  >
                    =
                  </button>
                </td>
              {:else}
                {@const relation = getRelation(rowLanguage, colLanguage)}
                {#if relation}
                  <td class:is-sandbox-editor-cell={isSandboxEditing(colLanguage.id, rowLanguage.id)}>
                    <button
                      type="button"
                      class={`matrix-cell matrix-cell--button ${STATUS_CLASSES[relation.status]} ${relation.dimmed ? 'is-dimmed' : ''} ${relation.explicit ? 'is-explicit' : ''} ${isEdgeSelected(colLanguage.id, rowLanguage.id) ? 'is-selected' : ''} ${isComplementSelected(colLanguage.id, rowLanguage.id) ? 'is-complement' : ''} ${isLanguageHighlighted(rowLanguage.id) ? 'is-row-highlighted' : ''} ${isLanguageHighlighted(colLanguage.id) ? 'is-col-highlighted' : ''} ${isPreviewHighlighted(colLanguage.id, rowLanguage.id) ? 'is-preview-highlighted' : ''} ${isDirectSandboxEdit(colLanguage.id, rowLanguage.id) ? 'is-sandbox-direct' : ''}`}
                      onclick={() => handleCellClick(colLanguage.id, rowLanguage.id, relation)}
                      title={getCellTitle(rowLanguage.language, colLanguage.language, relation)}
                    >
                      <span class="cell-short">{@html getStatusHtml(relation.status, Boolean(relation.assumption))}</span>
                    </button>
                    {#if isSandboxEditing(colLanguage.id, rowLanguage.id)}
                      {@const currentValue = getSandboxCellValue(relation)}
                      {@const baselineValue = getSandboxCellValue(getBaselineRelation(colLanguage.id, rowLanguage.id))}
                      {@const options = validSandboxOptions(baselineValue)}
                      {#if options.length > 0}
                        <div class="sandbox-cell-popover" role="menu" aria-label={`Sandbox status for ${colLanguage.language.name} to ${rowLanguage.language.name}`}>
                          {#each options as option}
                            <button
                              type="button"
                              class={`sandbox-option ${option ? getSandboxOptionClass(option) : 'sandbox-option--blank'} ${isOriginalSandboxOption(option, baselineValue) ? 'is-original' : ''}`}
                              title={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                              aria-label={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                              onclick={(event) => handleSandboxStatusClick(event, colLanguage.id, rowLanguage.id, option, currentValue, baselineValue)}
                            >
                              {#if option}
                                <span class="cell-short">{@html getSandboxOptionHtml(option)}</span>
                              {/if}
                            </button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </td>
                {:else}
                  <td class:is-sandbox-editor-cell={isSandboxEditing(colLanguage.id, rowLanguage.id)}>
                    {#if sandboxMode}
                      <button
                        type="button"
                        class={`matrix-cell matrix-cell--button matrix-cell--unknown ${STATUS_CLASSES[UNKNOWN_STATUS]} ${isLanguageHighlighted(rowLanguage.id) ? 'is-row-highlighted' : ''} ${isLanguageHighlighted(colLanguage.id) ? 'is-col-highlighted' : ''} ${isPreviewHighlighted(colLanguage.id, rowLanguage.id) ? 'is-preview-highlighted' : ''} ${isDirectSandboxEdit(colLanguage.id, rowLanguage.id) ? 'is-sandbox-direct' : ''}`}
                        onclick={() => handleCellClick(colLanguage.id, rowLanguage.id, null)}
                        aria-label={`Edit ${colLanguage.language.name} to ${rowLanguage.language.name}`}
                        title={getCellTitle(rowLanguage.language, colLanguage.language, null)}
                      >
                        <span class="cell-short">{@html STATUS_SHORT_HTML[UNKNOWN_STATUS] ?? '?'}</span>
                      </button>
                      {#if isSandboxEditing(colLanguage.id, rowLanguage.id)}
                        {@const currentValue = getSandboxCellValue(null)}
                        {@const baselineValue = getSandboxCellValue(getBaselineRelation(colLanguage.id, rowLanguage.id))}
                        {@const options = validSandboxOptions(baselineValue)}
                        {#if options.length > 0}
                          <div class="sandbox-cell-popover" role="menu" aria-label={`Sandbox status for ${colLanguage.language.name} to ${rowLanguage.language.name}`}>
                            {#each options as option}
                              <button
                                type="button"
                                class={`sandbox-option ${option ? getSandboxOptionClass(option) : 'sandbox-option--blank'} ${isOriginalSandboxOption(option, baselineValue) ? 'is-original' : ''}`}
                                title={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                                aria-label={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                                onclick={(event) => handleSandboxStatusClick(event, colLanguage.id, rowLanguage.id, option, currentValue, baselineValue)}
                              >
                                {#if option}
                                  <span class="cell-short">{@html getSandboxOptionHtml(option)}</span>
                                {/if}
                              </button>
                            {/each}
                          </div>
                        {/if}
                      {/if}
                    {:else}
                      <button
                        type="button"
                        class={`matrix-cell matrix-cell--button matrix-cell--unknown ${STATUS_CLASSES[UNKNOWN_STATUS]} ${isEdgeSelected(colLanguage.id, rowLanguage.id) ? 'is-selected' : ''} ${isComplementSelected(colLanguage.id, rowLanguage.id) ? 'is-complement' : ''} ${isLanguageHighlighted(rowLanguage.id) ? 'is-row-highlighted' : ''} ${isLanguageHighlighted(colLanguage.id) ? 'is-col-highlighted' : ''} ${isPreviewHighlighted(colLanguage.id, rowLanguage.id) ? 'is-preview-highlighted' : ''}`}
                        onclick={() => handleCellClick(colLanguage.id, rowLanguage.id, null)}
                        title={getCellTitle(rowLanguage.language, colLanguage.language, null)}
                      >
                        <span class="cell-short">{@html STATUS_SHORT_HTML[UNKNOWN_STATUS] ?? '?'}</span>
                      </button>
                    {/if}
                  </td>
                {/if}
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .matrix-view {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .matrix-scroll {
    flex: 1;
    overflow: auto;
    width: 100%;
  }

  .matrix-table {
    width: auto;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-size: 0.75rem;
  }

  /* border-box so measured getBoundingClientRect() widths map directly to CSS width */
  .matrix-table th,
  .matrix-table td {
    box-sizing: border-box;
  }

  /* Before measurement, let cells size naturally */
  .matrix-table:not(.measured) th,
  .matrix-table:not(.measured) td {
    width: auto;
    min-width: auto;
    max-width: none;
  }

  /* After measurement, use computed cell size */
  .matrix-table.measured td {
    width: var(--cell-width, auto);
    min-width: var(--cell-width, auto);
    max-width: var(--cell-width, none);
    height: var(--cell-height, auto);
  }

  /* Column headers (thead th except corner) use data-column width */
  .matrix-table.measured thead th:not(.corner-cell) {
    width: var(--cell-width, auto);
    min-width: var(--cell-width, auto);
    max-width: var(--cell-width, none);
  }

  /* Row headers + corner use separate header width */
  .matrix-table.measured .corner-cell,
  .matrix-table.measured tbody th {
    width: var(--header-width, auto);
    min-width: var(--header-width, auto);
    max-width: var(--header-width, none);
    height: var(--cell-height, auto);
  }

  thead th {
    position: sticky;
    top: 0;
    background: #f8fafc;
    z-index: 50;
    border-bottom: 1px solid #e5e7eb;
    height: 5rem !important;
  }

  .corner-cell {
    background: #e5e7eb;
    z-index: 60;
    border-left: 1px solid #e5e7eb;
    height: 5rem;
  }

  .row-header,
  .col-header {
    background: #fff;
    border-right: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    padding: 0;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-header {
    position: sticky;
    left: 0;
    z-index: 50;
    background: #f8fafc;
    border-left: 1px solid #e5e7eb;
  }

  .row-header button,
  .col-header button {
    width: 100%;
    height: 100%;
    padding: 0 0.05rem;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    font-weight: 600;
    color: #1f2937;
    font-size: 0.6rem;
    line-height: 1.1;
    overflow: hidden;
    white-space: nowrap;
  }

  .col-header button {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    white-space: normal;
    padding: 0;
    overflow: visible;
  }

  .col-header .column-label {
    display: inline-block;
    transform: rotate(-90deg);
    transform-origin: center;
    white-space: nowrap;
    line-height: 1;
  }

  .row-header.is-active,
  .col-header.is-active {
    background: #e0f2fe;
    box-shadow: inset 0 0 0 2px #2563eb;
  }

  tbody th {
    border-bottom: 1px solid #e5e7eb;
  }

  td {
    border-right: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    text-align: center;
    padding: 0;
    overflow: hidden;
  }

  td.is-sandbox-editor-cell {
    position: relative;
    overflow: visible;
    z-index: 20;
  }

  .matrix-cell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    border: none;
    cursor: default;
    font-size: 0.6rem;
    padding: 0;
    line-height: 1;
  }

  .matrix-cell--button {
    cursor: pointer;
    padding: 0;
  }

  .matrix-cell--button:is(:hover, :focus-visible) {
    outline: 2px solid rgba(15, 23, 42, 0.2);
    outline-offset: -2px;
  }

  .matrix-cell.is-row-highlighted,
  .matrix-cell--empty.is-row-highlighted,
  .matrix-cell--diagonal.is-row-highlighted {
    box-shadow: inset 0 2px 0 #2563eb, inset 0 -2px 0 #2563eb;
  }

  .matrix-cell.is-col-highlighted,
  .matrix-cell--empty.is-col-highlighted,
  .matrix-cell--diagonal.is-col-highlighted {
    box-shadow: inset 2px 0 0 #2563eb, inset -2px 0 0 #2563eb;
  }

  .matrix-cell.is-row-highlighted.is-col-highlighted,
  .matrix-cell--empty.is-row-highlighted.is-col-highlighted,
  .matrix-cell--diagonal.is-row-highlighted.is-col-highlighted {
    box-shadow: inset 0 0 0 2px #2563eb;
  }

  .matrix-cell.is-preview-highlighted,
  .matrix-cell--empty.is-preview-highlighted {
    box-shadow: inset 0 0 0 3px #a855f7;
  }

  .matrix-cell.is-sandbox-direct,
  .matrix-cell--empty.is-sandbox-direct {
    box-shadow: inset 0 0 0 3px #0284c7;
  }

  .matrix-cell--diagonal {
    background: #e5e7eb;
  }

  .diagonal-button {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    cursor: pointer;
    color: #9ca3af;
    font-size: 0.65rem;
    padding: 0;
    line-height: 1;
  }

  .diagonal-button:hover {
    background: #d1d5db;
    color: #6b7280;
  }

  .matrix-cell--empty {
    background: #fff;
    color: #94a3b8;
  }

  .matrix-cell--unknown {
    color: #6b7280;
  }

  .cell-short {
    font-weight: 600;
    font-size: 0.75rem;
    line-height: 1;
  }

  .cell-label {
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .sandbox-cell-popover {
    position: absolute;
    left: 50%;
    top: calc(100% + 0.2rem);
    z-index: 40;
    display: grid;
    grid-auto-flow: row;
    gap: 0.15rem;
    min-width: max(2.4rem, var(--cell-width, 2.4rem));
    transform: translateX(-50%);
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    background: #fff;
    padding: 0.2rem;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.18);
  }

  .sandbox-option {
    width: 100%;
    min-width: 2.1rem;
    height: 1.65rem;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 0.2rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .sandbox-option:hover,
  .sandbox-option:focus-visible {
    border-color: #0284c7;
    box-shadow: inset 0 0 0 1px #0284c7;
  }

  .sandbox-option.is-original {
    border-color: #eab308;
    box-shadow: inset 0 0 0 2px #eab308;
  }

  .sandbox-option.is-original:hover,
  .sandbox-option.is-original:focus-visible {
    border-color: #ca8a04;
    box-shadow:
      inset 0 0 0 2px #eab308,
      0 0 0 1px #ca8a04;
  }

  .sandbox-option--blank {
    background: #fff;
  }

  /* Explicit edges - golden border to highlight non-derived edges */
  .matrix-cell.is-explicit {
    box-shadow: inset 0 0 0 2px #eab308; /* yellow-500 golden border */
  }

  .matrix-cell.is-explicit.is-preview-highlighted {
    box-shadow: inset 0 0 0 3px #a855f7, inset 0 0 0 5px #eab308;
  }

  .matrix-cell.is-explicit.is-sandbox-direct {
    box-shadow: inset 0 0 0 3px #0284c7, inset 0 0 0 5px #eab308;
  }

  /* Selection borders override explicit border */
  .matrix-cell.is-selected {
    box-shadow: inset 0 0 0 3px #1d4ed8; /* blue border for selected */
  }

  .matrix-cell.is-complement {
    box-shadow: inset 0 0 0 3px #dc2626; /* red border for complement */
  }

  /* Dimmed/implicit edges - diagonal gray stripes overlay */
  .matrix-cell.is-dimmed {
    position: relative;
  }

  .matrix-cell.is-dimmed::before {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 6px,
      rgba(156, 163, 175, 0.3) 6px,
      rgba(156, 163, 175, 0.3) 7px
    );
    pointer-events: none;
    z-index: 1;
  }

  .matrix-cell.is-dimmed .cell-short {
    position: relative;
    z-index: 2;
  }

  /* Tighten KaTeX rendering inside matrix cells */
  .matrix-table :global(.katex) {
    font-size: 1.2em;
    line-height: 1;
    padding: 0;
  }

  /* Reduce inter-atom spacing in data cells for compact minimum width */
  .cell-short :global(.katex .mspace) {
    margin-right: 0.15em !important;
    margin-left: 0 !important;
  }


  @media (max-width: 1024px) {
    .matrix-table {
      min-width: 400px;
    }

    .row-header,
    .col-header,
    .corner-cell {
      width: 80px;
    }
  }
</style>
