<script lang="ts">
  import type {
    GraphData,
    FilteredGraphData,
    KCLanguage,
    SelectedEdge,
    DirectedSuccinctnessRelation
  } from '$lib/types.js';
  import { compareByCanonicalOrder } from '$lib/utils/canonical-order.js';

  /**
   * Sort language IDs by canonical order. Unknown languages are appended alphabetically.
   */
  function sortByCanonicalOrder(ids: string[]): string[] {
    const getName = (id: string) => languageLookup.get(id)?.name?.toLowerCase() ?? id;
    return [...ids].sort((a, b) =>
      compareByCanonicalOrder(a, b, getName, {
        isNewLanguage: isSandboxAddedLanguage,
        getCurrentIndex: (id) => graphData.adjacencyMatrix.indexByLanguage[id] ?? 0,
        hasPositiveCompilation
      })
    );
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
    onAddLanguage,
    onRemoveSandboxLanguage,
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
    onAddLanguage?: () => void;
    onRemoveSandboxLanguage?: (languageId: string) => void;
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

  const POSITIVE_COMPILATION_STATUSES = new Set(['poly', 'unknown-poly-quasi', 'no-poly-quasi']);

  function hasPositiveCompilation(sourceId: string, targetId: string): boolean {
    const sourceIndex = graphData.adjacencyMatrix.indexByLanguage[sourceId];
    const targetIndex = graphData.adjacencyMatrix.indexByLanguage[targetId];
    if (sourceIndex === undefined || targetIndex === undefined) return false;
    const status = graphData.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex]?.status;
    return Boolean(status && POSITIVE_COMPILATION_STATUSES.has(status));
  }

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
      case 'not-poly':
        return '$\\not\\leq^\\ast$';
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

  function getSandboxOptionHtml(status: string, hasAssumption = false): string {
    const displayStatus = getSandboxDisplayStatus(status);
    return getStatusHtml(displayStatus, hasAssumption) || getStatusHtml(status, hasAssumption);
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

  const matrixLayoutSignature = $derived(matrixLanguages.map((entry) => entry.id).join('|'));

  const visibleEdgeIds = $derived.by<Set<string> | null>(() => ('visibleEdgeIds' in graphData ? graphData.visibleEdgeIds : null));

  type MatrixCellModel = {
    key: string;
    relation: DirectedSuccinctnessRelation | null;
    status: string;
    statusHtml: string;
    currentValue: string;
    title: string;
    buttonClass: string;
    editing: boolean;
  };

  const matrixCellCache = new Map<string, { signature: string; model: MatrixCellModel }>();

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

  function getMatrixCellModel(rowLanguage: MatrixLanguageEntry, colLanguage: MatrixLanguageEntry): MatrixCellModel {
    const relation = getRelation(rowLanguage, colLanguage);
    const sourceId = colLanguage.id;
    const targetId = rowLanguage.id;
    const status = relation?.status ?? UNKNOWN_STATUS;
    const hasAssumption = Boolean(relation?.assumption);
    const editing = isSandboxEditing(sourceId, targetId);
    const selected = isEdgeSelected(sourceId, targetId);
    const complement = isComplementSelected(sourceId, targetId);
    const rowHighlighted = isLanguageHighlighted(rowLanguage.id);
    const colHighlighted = isLanguageHighlighted(colLanguage.id);
    const previewHighlighted = isPreviewHighlighted(sourceId, targetId);
    const directEdit = isDirectSandboxEdit(sourceId, targetId);
    const statusClass = STATUS_CLASSES[status] ?? '';
    const statusHtml = relation
      ? getStatusHtml(status, hasAssumption)
      : STATUS_SHORT_HTML[UNKNOWN_STATUS] ?? '?';
    const key = `${sourceId}->${targetId}`;
    const signature = [
      relation ? 'relation' : 'empty',
      status,
      relation?.assumption ?? '',
      relation?.dimmed ? 'dimmed' : '',
      relation?.explicit ? 'explicit' : '',
      selected ? 'selected' : '',
      complement ? 'complement' : '',
      rowHighlighted ? 'row' : '',
      colHighlighted ? 'col' : '',
      previewHighlighted ? 'preview' : '',
      directEdit ? 'direct' : '',
      editing ? 'editing' : '',
      sandboxMode ? 'sandbox' : '',
      statusClass,
      statusHtml
    ].join('|');
    const cached = matrixCellCache.get(key);
    if (cached?.signature === signature) return cached.model;

    const buttonClass = relation
      ? `matrix-cell matrix-cell--button ${statusClass} ${relation.dimmed ? 'is-dimmed' : ''} ${relation.explicit ? 'is-explicit' : ''} ${selected ? 'is-selected' : ''} ${complement ? 'is-complement' : ''} ${rowHighlighted ? 'is-row-highlighted' : ''} ${colHighlighted ? 'is-col-highlighted' : ''} ${previewHighlighted ? 'is-preview-highlighted' : ''} ${directEdit ? 'is-sandbox-direct' : ''}`
      : `matrix-cell matrix-cell--button matrix-cell--unknown ${STATUS_CLASSES[UNKNOWN_STATUS]} ${selected ? 'is-selected' : ''} ${complement ? 'is-complement' : ''} ${rowHighlighted ? 'is-row-highlighted' : ''} ${colHighlighted ? 'is-col-highlighted' : ''} ${previewHighlighted ? 'is-preview-highlighted' : ''} ${directEdit ? 'is-sandbox-direct' : ''}`;
    const model = {
      key,
      relation,
      status,
      statusHtml,
      currentValue: relation?.status ?? '',
      title: getCellTitle(rowLanguage.language, colLanguage.language, relation),
      buttonClass,
      editing
    };
    matrixCellCache.set(key, { signature, model });
    return model;
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

  function isSandboxAddedLanguage(languageId: string): boolean {
    if (!sandboxMode || !sandboxBaselineGraphData) return false;
    return sandboxBaselineGraphData.adjacencyMatrix.indexByLanguage[languageId] === undefined;
  }

  function handleRemoveSandboxLanguageClick(event: MouseEvent, languageId: string) {
    event.stopPropagation();
    onRemoveSandboxLanguage?.(languageId);
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
      const displayValue = getSandboxDisplayStatus(currentValue || UNKNOWN_STATUS);
      return displayValue === 'unknown' ? DEFAULT_SANDBOX_EDGE_OPTIONS : [];
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

  let matrixScrollEl: HTMLDivElement;
  let cellSize = $state({ width: 44, height: 34, headerWidth: 116 });
  let lastContainerSize = { width: 0, height: 0 };
  let lastLanguageCount = 0;
  let lastQuasiSizingMode = showQuasipolynomialSandboxOptions;
  let savedScrollPosition = { left: 0, top: 0 };
  let restoringScroll = false;

  function rememberScrollPosition() {
    if (!matrixScrollEl || restoringScroll) return;
    savedScrollPosition = {
      left: matrixScrollEl.scrollLeft,
      top: matrixScrollEl.scrollTop
    };
  }

  function restoreScrollPosition() {
    if (!matrixScrollEl) return;
    const maxLeft = Math.max(0, matrixScrollEl.scrollWidth - matrixScrollEl.clientWidth);
    const maxTop = Math.max(0, matrixScrollEl.scrollHeight - matrixScrollEl.clientHeight);
    restoringScroll = true;
    matrixScrollEl.scrollLeft = Math.min(savedScrollPosition.left, maxLeft);
    matrixScrollEl.scrollTop = Math.min(savedScrollPosition.top, maxTop);
    queueMicrotask(() => {
      restoringScroll = false;
    });
  }

  function updateCellSize() {
    if (!matrixScrollEl) return;

    const containerWidth = matrixScrollEl.clientWidth;
    const containerHeight = matrixScrollEl.clientHeight;
    const langCount = matrixLanguages.length;
    const quasiSizingMode = showQuasipolynomialSandboxOptions;

    if (containerWidth === lastContainerSize.width
        && containerHeight === lastContainerSize.height
        && langCount === lastLanguageCount
        && quasiSizingMode === lastQuasiSizingMode) {
      return;
    }

    const headerWidth = 116;
    const headerHeight = 80;
    const dataCols = Math.max(langCount, 1);
    const availableDataWidth = Math.max(0, containerWidth - headerWidth);
    const availableDataHeight = Math.max(0, containerHeight - headerHeight);
    const minCellWidth = quasiSizingMode ? 66 : 42;
    const width = Math.max(minCellWidth, Math.floor(availableDataWidth / dataCols));
    const height = Math.max(28, Math.floor(availableDataHeight / dataCols));
    const next = { width, height, headerWidth };
    if (
      next.width !== cellSize.width ||
      next.height !== cellSize.height ||
      next.headerWidth !== cellSize.headerWidth
    ) {
      cellSize = next;
    }
    lastContainerSize = { width: containerWidth, height: containerHeight };
    lastLanguageCount = langCount;
    lastQuasiSizingMode = quasiSizingMode;
    queueMicrotask(() => restoreScrollPosition());
  }

  $effect(() => {
    matrixLayoutSignature;
    showQuasipolynomialSandboxOptions;
    rememberScrollPosition();
    queueMicrotask(() => updateCellSize());
  });

  import { onMount } from 'svelte';
  onMount(() => {
    updateCellSize();
    const resizeObserver = new ResizeObserver(() => updateCellSize());
    if (matrixScrollEl) resizeObserver.observe(matrixScrollEl);

    const closeSandboxPopover = () => {
      if (!sandboxSelectedEdgeId) return;
      const [sourceId, targetId] = sandboxSelectedEdgeId.split('->');
      if (sourceId && targetId) onSandboxEdgeEdit?.(sourceId, targetId);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!sandboxSelectedEdgeId || !(target instanceof Element)) return;
      if (target.closest('.is-sandbox-editor-cell')) return;
      closeSandboxPopover();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSandboxPopover();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  });
</script>

<div class="matrix-view" aria-live="polite">
  <div class="matrix-scroll" bind:this={matrixScrollEl} onscroll={rememberScrollPosition} role="region" aria-label="Adjacency matrix view">
    <div
      class="matrix-grid"
      role="table"
      aria-label="Succinctness matrix"
      style:--cell-width="{cellSize.width}px"
      style:--cell-height="{cellSize.height}px"
      style:--header-width="{cellSize.headerWidth}px"
      style:--column-count={matrixLanguages.length}
    >
      <div class="corner-cell" role="columnheader" style:grid-column="1" style:grid-row="1">
        {#if sandboxMode}
          <button type="button" class="new-language-button" onclick={onAddLanguage} title="Add language">
            New Language
          </button>
        {/if}
      </div>
      {#each matrixLanguages as column, columnIndex (column.id)}
        <div
          class={`col-header ${selectedNode?.id === column.id ? 'is-active' : ''}`}
          role="columnheader"
          style:grid-column={columnIndex + 2}
          style:grid-row="1"
        >
          <div class="language-header-control language-header-control--column">
            {#if isSandboxAddedLanguage(column.id)}
              <button
                type="button"
                class="remove-language-button"
                onclick={(event) => handleRemoveSandboxLanguageClick(event, column.id)}
                title={`Remove draft language ${column.language.name}`}
                aria-label={`Remove draft language ${column.language.name}`}
              >x</button>
            {/if}
            <button class="language-select-button" type="button" onclick={() => handleColumnHeaderClick(column.language)} title={`Select ${column.language.name}`}>
              <span class="math-text inline column-label" aria-label={column.language.name}>{@html languageNameHtml.get(column.id) ?? column.language.name}</span>
            </button>
          </div>
        </div>
      {/each}
      {#each matrixLanguages as rowLanguage, rowIndex (rowLanguage.id)}
        <div
          class={`row-header ${selectedNode?.id === rowLanguage.id ? 'is-active' : ''}`}
          role="rowheader"
          style:grid-column="1"
          style:grid-row={rowIndex + 2}
        >
          <div class="language-header-control">
            {#if isSandboxAddedLanguage(rowLanguage.id)}
              <button
                type="button"
                class="remove-language-button"
                onclick={(event) => handleRemoveSandboxLanguageClick(event, rowLanguage.id)}
                title={`Remove draft language ${rowLanguage.language.name}`}
                aria-label={`Remove draft language ${rowLanguage.language.name}`}
              >x</button>
            {/if}
            <button class="language-select-button" type="button" onclick={() => handleRowHeaderClick(rowLanguage.language)} title={`Select ${rowLanguage.language.name}`}>
              <span class="math-text inline" aria-label={rowLanguage.language.name}>{@html languageNameHtml.get(rowLanguage.id) ?? rowLanguage.language.name}</span>
            </button>
          </div>
        </div>
        {#each matrixLanguages as colLanguage, colIndex (colLanguage.id)}
          {#if rowLanguage.id === colLanguage.id}
            <div
              class={`matrix-cell-shell matrix-cell--diagonal ${isLanguageHighlighted(rowLanguage.id) ? 'is-row-highlighted is-col-highlighted' : ''}`}
              role="cell"
              style:grid-column={colIndex + 2}
              style:grid-row={rowIndex + 2}
            >
              <button
                type="button"
                class="diagonal-button"
                onclick={() => handleRowHeaderClick(rowLanguage.language)}
                aria-label={`Select ${rowLanguage.language.name}`}
                title={`Select ${rowLanguage.language.name}`}
              >
                =
              </button>
            </div>
          {:else}
            {@const cell = getMatrixCellModel(rowLanguage, colLanguage)}
            <div
              class="matrix-cell-shell"
              class:is-sandbox-editor-cell={cell.editing}
              role="cell"
              style:grid-column={colIndex + 2}
              style:grid-row={rowIndex + 2}
            >
              {#if cell.relation}
                <button
                  type="button"
                  class={cell.buttonClass}
                  onclick={() => handleCellClick(colLanguage.id, rowLanguage.id, cell.relation)}
                  title={cell.title}
                >
                  <span class="cell-short">{@html cell.statusHtml}</span>
                </button>
                {#if cell.editing}
                  {@const currentValue = cell.currentValue}
                  {@const baselineRelation = getBaselineRelation(colLanguage.id, rowLanguage.id)}
                  {@const baselineValue = getSandboxCellValue(baselineRelation)}
                  {@const options = validSandboxOptions(baselineValue)}
                  {#if options.length > 0}
                    <div class="sandbox-cell-popover" role="menu" aria-label={`Sandbox status for ${colLanguage.language.name} to ${rowLanguage.language.name}`}>
                      {#each options as option}
                        {@const isOriginalOption = isOriginalSandboxOption(option, baselineValue)}
                        {@const optionAssumption = cell.relation.assumption ?? (isOriginalOption ? baselineRelation?.assumption : undefined)}
                        <button
                          type="button"
                          class={`sandbox-option ${option ? getSandboxOptionClass(option) : 'sandbox-option--blank'} ${isOriginalOption ? 'is-original' : ''}`}
                          title={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                          aria-label={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                          onclick={(event) => handleSandboxStatusClick(event, colLanguage.id, rowLanguage.id, option, currentValue, baselineValue)}
                        >
                          {#if option}
                            <span class="cell-short">{@html getSandboxOptionHtml(option, Boolean(optionAssumption))}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                {/if}
              {:else}
                {#if sandboxMode}
                  <button
                    type="button"
                    class={cell.buttonClass}
                    onclick={() => handleCellClick(colLanguage.id, rowLanguage.id, null)}
                    aria-label={`Edit ${colLanguage.language.name} to ${rowLanguage.language.name}`}
                    title={cell.title}
                  >
                    <span class="cell-short">{@html cell.statusHtml}</span>
                  </button>
                  {#if cell.editing}
                    {@const currentValue = cell.currentValue}
                    {@const baselineRelation = getBaselineRelation(colLanguage.id, rowLanguage.id)}
                    {@const baselineValue = getSandboxCellValue(baselineRelation)}
                    {@const options = validSandboxOptions(baselineValue)}
                    {#if options.length > 0}
                      <div class="sandbox-cell-popover" role="menu" aria-label={`Sandbox status for ${colLanguage.language.name} to ${rowLanguage.language.name}`}>
                        {#each options as option}
                          {@const isOriginalOption = isOriginalSandboxOption(option, baselineValue)}
                          {@const optionAssumption = isOriginalOption ? baselineRelation?.assumption : undefined}
                          <button
                            type="button"
                            class={`sandbox-option ${option ? getSandboxOptionClass(option) : 'sandbox-option--blank'} ${isOriginalOption ? 'is-original' : ''}`}
                            title={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                            aria-label={option ? STATUS_LABELS[getSandboxDisplayStatus(option)] ?? STATUS_LABELS[option] : 'Blank'}
                            onclick={(event) => handleSandboxStatusClick(event, colLanguage.id, rowLanguage.id, option, currentValue, baselineValue)}
                          >
                            {#if option}
                              <span class="cell-short">{@html getSandboxOptionHtml(option, Boolean(optionAssumption))}</span>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                {:else}
                  <button
                    type="button"
                    class={cell.buttonClass}
                    onclick={() => handleCellClick(colLanguage.id, rowLanguage.id, null)}
                    title={cell.title}
                  >
                    <span class="cell-short">{@html cell.statusHtml}</span>
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}
      {/each}
    </div>
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

  .matrix-grid {
    width: max-content;
    min-width: 100%;
    display: grid;
    grid-template-columns: var(--header-width) repeat(var(--column-count), var(--cell-width));
    grid-template-rows: 5rem repeat(var(--column-count), var(--cell-height));
    font-size: 0.75rem;
  }

  .matrix-grid > * {
    box-sizing: border-box;
  }

  .col-header {
    position: sticky;
    top: 0;
    background: #f8fafc;
    z-index: 70;
    border-bottom: 1px solid #e5e7eb;
    height: 5rem;
  }

  .corner-cell {
    position: sticky;
    top: 0;
    left: 0;
    background: #e5e7eb;
    z-index: 90;
    border-left: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    height: 5rem;
  }

  .new-language-button {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border: 0;
    background: #dbeafe;
    color: #1d4ed8;
    font-size: 0.68rem;
    font-weight: 800;
    line-height: 1.1;
    cursor: pointer;
  }

  .new-language-button:hover,
  .new-language-button:focus-visible {
    background: #bfdbfe;
    color: #1e40af;
    outline: 2px solid #2563eb;
    outline-offset: -2px;
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
    z-index: 60;
    background: #f8fafc;
    border-left: 1px solid #e5e7eb;
  }

  .language-header-control {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: stretch;
    min-width: 0;
  }

  .language-header-control--column {
    align-items: center;
    justify-content: center;
  }

  .row-header .language-select-button,
  .col-header .language-select-button {
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

  .remove-language-button {
    flex: 0 0 1rem;
    width: 1rem;
    height: 100%;
    padding: 0;
    display: grid;
    place-items: center;
    border: 0;
    border-right: 1px solid #dbeafe;
    background: #eff6ff;
    color: #1d4ed8;
    cursor: pointer;
    font-size: 0.62rem;
    font-weight: 800;
    line-height: 1;
  }

  .remove-language-button:hover,
  .remove-language-button:focus-visible {
    background: #dbeafe;
    color: #991b1b;
    outline: 2px solid #2563eb;
    outline-offset: -2px;
  }

  .language-header-control--column .remove-language-button {
    height: 1rem;
    border-right: 0;
    border-bottom: 1px solid #dbeafe;
  }

  .col-header .language-select-button {
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

  .matrix-cell-shell {
    border-right: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    text-align: center;
    padding: 0;
    overflow: hidden;
  }

  .matrix-cell-shell.is-sandbox-editor-cell {
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
    white-space: nowrap;
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
  .matrix-grid :global(.katex) {
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
    .matrix-grid {
      min-width: 400px;
    }
  }
</style>
