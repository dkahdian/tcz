<script lang="ts">
  import type {
    GraphData,
    FilteredGraphData,
    KCLanguage,
    KCOpEntry,
    SelectedOperation,
    SelectedOperationCell
  } from '$lib/types.js';
  import { QUERIES, TRANSFORMATIONS, getOperationDescription } from '$lib/data/operations.js';
  import { measureCellSize } from '$lib/utils/matrix-cell-size.js';
  import { compareByCanonicalOrder } from '$lib/utils/canonical-order.js';
  import { getOperationTractabilityDisplay } from '$lib/utils/operation-tractability.js';
  import { renderMathText } from '$lib/utils/math-text.js';

  type OperationType = 'queries' | 'transformations';
  type SandboxOperationOption = {
    id: string;
    complexity: string | null;
    assumption?: string;
  };

  const SANDBOX_CONDITIONAL_ASSUMPTION = 'your condition under test';

  let {
    graphData,
    operationType,
    selectedNode = $bindable(),
    selectedOperation = $bindable(),
    selectedOperationCell = $bindable(),
    highlightedOperationCellIds = new Set<string>(),
    directEditedOperationCellIds = new Set<string>(),
    sandboxMode = false,
    sandboxSelectedOperationCellId = null,
    sandboxBaselineGraphData = null,
    onSandboxOperationEdit,
    onSandboxOperationStatusChange
  }: {
    graphData: GraphData | FilteredGraphData;
    operationType: OperationType;
    selectedNode: KCLanguage | null;
    selectedOperation: SelectedOperation | null;
    selectedOperationCell: SelectedOperationCell | null;
    highlightedOperationCellIds?: Set<string>;
    directEditedOperationCellIds?: Set<string>;
    sandboxMode?: boolean;
    sandboxSelectedOperationCellId?: string | null;
    sandboxBaselineGraphData?: GraphData | FilteredGraphData | null;
    onSandboxOperationEdit?: (
      operationType: 'query' | 'transformation',
      languageId: string,
      operationCode: string
    ) => void;
    onSandboxOperationStatusChange?: (
      operationType: 'query' | 'transformation',
      languageId: string,
      operationCode: string,
      complexity: string | null,
      assumption?: string
    ) => boolean;
  } = $props();

  const UNKNOWN_OPERATION_COMPLEXITIES = new Set([
    '',
    'unknown',
    'unknown-both',
    'unknown-to-us',
    'unknown-poly-quasi'
  ]);

  // Get the operations based on type
  const operations = $derived(operationType === 'queries' ? QUERIES : TRANSFORMATIONS);

  // Get operation codes in display order
  const operationCodes = $derived.by(() => {
    const codes = Object.keys(operations);
    if (operationType === 'queries' && 'visibleQueryIds' in graphData) {
      return codes.filter((code) => graphData.visibleQueryIds.has(code));
    }
    if (operationType === 'transformations' && 'visibleTransformationIds' in graphData) {
      return codes.filter((code) => graphData.visibleTransformationIds.has(code));
    }
    return codes;
  });

  // Get visible languages
  const languageLookup = $derived.by<Map<string, KCLanguage>>(() => {
    const map = new Map<string, KCLanguage>();
    for (const language of graphData.languages) {
      map.set(language.id, language);
    }
    return map;
  });

  const visibleLanguageIds = $derived.by<string[]>(() => {
    let ids = graphData.adjacencyMatrix.languageIds.filter((id) => languageLookup.has(id));
    if ('visibleLanguageIds' in graphData && graphData.visibleLanguageIds.size > 0) {
      ids = ids.filter((id) => graphData.visibleLanguageIds.has(id));
    }
    const getName = (id: string) => languageLookup.get(id)?.name?.toLowerCase() ?? id;
    return [...ids].sort((a, b) => compareByCanonicalOrder(a, b, getName));
  });

  const visibleLanguages = $derived.by<KCLanguage[]>(() => {
    return visibleLanguageIds
      .map((id) => languageLookup.get(id))
      .filter((lang): lang is KCLanguage => lang !== undefined);
  });

  const languageNameHtml = $derived.by<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const language of visibleLanguages) {
      const result = renderMathText(language.name);
      map.set(language.id, result.html ?? language.name);
    }
    return map;
  });

  // Get operation support for a language
  function getOperationSupport(
    language: KCLanguage,
    opCode: string,
    sourceData: GraphData | FilteredGraphData = graphData
  ): KCOpEntry | null {
    const sourceLanguage = sourceData === graphData
      ? language
      : sourceData.languages.find((candidate) => candidate.id === language.id) ?? language;
    const supportMap = operationType === 'queries'
      ? sourceLanguage.properties.queries
      : sourceLanguage.properties.transformations;
    
    const operationDefs = operationType === 'queries' ? QUERIES : TRANSFORMATIONS;
    const opDef = operationDefs[opCode];
    if (!opDef) return null;
    
    // Look up by opCode (safe key) or by the operation code itself
    const support = supportMap?.[opCode] ?? supportMap?.[opDef.code];
    if (!support) return null;
    
    return {
      code: opDef.code,
      label: opDef.label,
      complexity: support.complexity,
      assumption: support.assumption,
      refs: support.refs ?? [],
      description: support.description,
      derived: support.derived,
      dimmed: support.dimmed,
      explicit: support.explicit
    };
  }

  function getUnknownOperationSupport(opCode: string): KCOpEntry | null {
    const opDef = operations[opCode];
    if (!opDef) return null;
    return {
      code: opDef.code,
      label: opDef.label,
      complexity: 'unknown-to-us',
      refs: []
    };
  }

  function handleLanguageClick(language: KCLanguage) {
    selectedOperation = null;
    selectedOperationCell = null;
    selectedNode = language;
  }

  function handleOperationClick(opCode: string) {
    const opDef = operations[opCode];
    if (!opDef) return;
    
    selectedNode = null;
    selectedOperationCell = null;
    selectedOperation = {
      code: opDef.code,
      label: opDef.label,
      description: getOperationDescription(operationType === 'queries' ? 'query' : 'transformation', opDef.code, opDef.description),
      type: operationType === 'queries' ? 'query' : 'transformation'
    };
  }

  function handleCellClick(language: KCLanguage, opCode: string) {
    const support = getOperationSupport(language, opCode);
    const opDef = operations[opCode];
    if (!opDef) return;

    if (sandboxMode) {
      onSandboxOperationEdit?.(
        operationType === 'queries' ? 'query' : 'transformation',
        language.id,
        opCode
      );
    }

    const displayedSupport = support ?? getUnknownOperationSupport(opCode);
    if (!displayedSupport) return;

    selectedNode = null;
    selectedOperation = null;
    selectedOperationCell = {
      language,
      operationCode: opDef.code,
      operationLabel: opDef.label,
      operationType: operationType === 'queries' ? 'query' : 'transformation',
      support: displayedSupport
    };
  }

  function isCellSelected(language: KCLanguage, opCode: string): boolean {
    if (!selectedOperationCell) return false;
    const opDef = operations[opCode];
    return selectedOperationCell.language.id === language.id && 
           selectedOperationCell.operationCode === opDef?.code;
  }

  function isLanguageHighlighted(language: KCLanguage): boolean {
    return selectedNode?.id === language.id || selectedOperationCell?.language.id === language.id;
  }

  function isOperationHighlighted(opCode: string): boolean {
    const opDef = operations[opCode];
    return selectedOperation?.code === opDef?.code || selectedOperationCell?.operationCode === opDef?.code;
  }

  function operationCellId(language: KCLanguage, opCode: string): string {
    const type = operationType === 'queries' ? 'query' : 'transformation';
    return `${type}:${language.id}:${opCode}`;
  }

  function isPreviewHighlighted(language: KCLanguage, opCode: string): boolean {
    return highlightedOperationCellIds.has(operationCellId(language, opCode));
  }

  function isDirectSandboxEdit(language: KCLanguage, opCode: string): boolean {
    return directEditedOperationCellIds.has(operationCellId(language, opCode));
  }

  function isSandboxEditing(language: KCLanguage, opCode: string): boolean {
    return sandboxMode && sandboxSelectedOperationCellId === operationCellId(language, opCode);
  }

  function getSandboxCellValue(support: KCOpEntry | null): string {
    return support?.complexity ?? '';
  }

  function validSandboxOptions(baselineSupport: KCOpEntry | null): SandboxOperationOption[] {
    const baselineComplexity = baselineSupport?.complexity ?? '';
    if (UNKNOWN_OPERATION_COMPLEXITIES.has(baselineComplexity)) {
      return [
        { id: 'blank', complexity: null },
        { id: 'poly', complexity: 'poly' },
        { id: 'poly-conditional', complexity: 'poly', assumption: SANDBOX_CONDITIONAL_ASSUMPTION },
        {
          id: 'no-poly-conditional',
          complexity: 'no-poly-unknown-quasi',
          assumption: SANDBOX_CONDITIONAL_ASSUMPTION
        },
        { id: 'no-poly', complexity: 'no-poly-unknown-quasi' }
      ];
    }

    if (baselineSupport?.assumption) {
      return [
        { id: 'blank', complexity: null },
        {
          id: `${baselineComplexity}-conditional`,
          complexity: baselineComplexity,
          assumption: baselineSupport.assumption
        },
        { id: `${baselineComplexity}-unconditional`, complexity: baselineComplexity }
      ];
    }

    return [];
  }

  function optionDisplay(option: SandboxOperationOption) {
    return option.complexity
      ? getOperationTractabilityDisplay({
          complexity: option.complexity,
          assumption: option.assumption
        })
      : null;
  }

  function isCurrentSandboxOption(option: SandboxOperationOption, support: KCOpEntry | null): boolean {
    const currentComplexity = support?.complexity ?? null;
    const currentAssumption = support?.assumption ?? undefined;
    return option.complexity === currentComplexity && option.assumption === currentAssumption;
  }

  function handleSandboxStatusClick(
    event: MouseEvent,
    language: KCLanguage,
    opCode: string,
    option: SandboxOperationOption
  ) {
    event.stopPropagation();
    const type = operationType === 'queries' ? 'query' : 'transformation';
    if (isCurrentSandboxOption(option, getOperationSupport(language, opCode))) {
      onSandboxOperationEdit?.(type, language.id, opCode);
      return;
    }
    onSandboxOperationStatusChange?.(
      type,
      language.id,
      opCode,
      option.complexity,
      option.assumption
    );
  }

  function getCellTitle(language: KCLanguage, opCode: string, support: KCOpEntry | null): string {
    const opDef = operations[opCode];
    if (!support) return `${language.name} - ${opDef?.label ?? opCode}: Unknown`;
    const display = getOperationTractabilityDisplay(
      support,
      operationType === 'queries' ? 'query' : 'transformation'
    );
    const assumptionStr = support.assumption ? ` (assuming ${support.assumption})` : '';
    return `${language.name} - ${opDef?.label ?? opCode}: ${display.label}${assumptionStr}`;
  }

  // Dynamic cell sizing
  let matrixScrollEl: HTMLDivElement;
  let tableEl: HTMLTableElement;
  let cellSize = $state({ width: 0, height: 0, headerWidth: 0 });
  let measured = $state(false);
  let measureRequest = 0;
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
    if (!matrixScrollEl || !tableEl) return;
    const numCols = operationCodes.length + 1; // +1 for header
    const numRows = visibleLanguages.length + 1; // +1 for header
    const result = measureCellSize(matrixScrollEl, tableEl, numCols, numRows, {
      heightMode: 'uniform'
    });
    if (result) {
      cellSize = result;
      measured = true;
      queueMicrotask(() => restoreScrollPosition());
    }
  }

  function scheduleCellSizeUpdate() {
    if (typeof window === 'undefined') {
      updateCellSize();
      return;
    }

    if (measureRequest) {
      cancelAnimationFrame(measureRequest);
    }

    measureRequest = requestAnimationFrame(() => {
      measureRequest = requestAnimationFrame(() => {
        measureRequest = 0;
        updateCellSize();
      });
    });
  }

  $effect(() => {
    visibleLanguages;
    operationCodes;
    rememberScrollPosition();
    measured = false;
    queueMicrotask(() => scheduleCellSizeUpdate());
  });

  import { onMount } from 'svelte';
  onMount(() => {
    scheduleCellSizeUpdate();
    const resizeObserver = new ResizeObserver(() => scheduleCellSizeUpdate());
    if (matrixScrollEl) resizeObserver.observe(matrixScrollEl);
    document.fonts?.ready.then(() => scheduleCellSizeUpdate()).catch(() => {});

    return () => {
      resizeObserver.disconnect();
      if (measureRequest) cancelAnimationFrame(measureRequest);
    };
  });
</script>

<div class="matrix-view" aria-live="polite">
  <div class="matrix-scroll" bind:this={matrixScrollEl} onscroll={rememberScrollPosition} role="region" aria-label="{operationType === 'queries' ? 'Queries' : 'Transformations'} matrix view">
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
          {#each operationCodes as opCode}
            {@const opDef = operations[opCode]}
            <th class={`col-header ${isOperationHighlighted(opCode) ? 'is-active' : ''}`}>
              <button 
                type="button" 
                onclick={() => handleOperationClick(opCode)} 
                title={opDef?.description ?? opDef?.label ?? opCode}
              >
                <span class="op-code">{opDef?.code ?? opCode}</span>
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each visibleLanguages as language}
          <tr>
            <th class={`row-header ${isLanguageHighlighted(language) ? 'is-active' : ''}`}>
              <button type="button" onclick={() => handleLanguageClick(language)} title={`Select ${language.name}`}>
                <span class="math-text inline" aria-label={language.name}>{@html languageNameHtml.get(language.id) ?? language.name}</span>
              </button>
            </th>
            {#each operationCodes as opCode}
              {@const support = getOperationSupport(language, opCode)}
              {@const displayedSupport = support ?? getUnknownOperationSupport(opCode)}
              {@const display = getOperationTractabilityDisplay(
                displayedSupport,
                operationType === 'queries' ? 'query' : 'transformation'
              )}
              <td class:is-sandbox-editor-cell={isSandboxEditing(language, opCode)}>
                {#if displayedSupport}
                <button
                  type="button"
                  class={`matrix-cell matrix-cell--button ${display.cssClass} ${!support ? 'matrix-cell--unknown' : ''} ${isCellSelected(language, opCode) ? 'is-selected' : ''} ${isLanguageHighlighted(language) ? 'is-row-highlighted' : ''} ${isOperationHighlighted(opCode) ? 'is-col-highlighted' : ''} ${support?.dimmed ? 'is-dimmed' : ''} ${support?.explicit ? 'is-explicit' : ''} ${isPreviewHighlighted(language, opCode) ? 'is-preview-highlighted' : ''} ${isDirectSandboxEdit(language, opCode) ? 'is-sandbox-direct' : ''}`}
                  onclick={() => handleCellClick(language, opCode)}
                  title={getCellTitle(language, opCode, support)}
                >
                  <span class="cell-symbol">{@html display.symbolHtml}</span>
                </button>
                {#if isSandboxEditing(language, opCode)}
                  {@const baselineSupport = getOperationSupport(language, opCode, sandboxBaselineGraphData ?? graphData)}
                  {@const options = validSandboxOptions(baselineSupport)}
                  {#if options.length > 0}
                    <div class="sandbox-cell-popover" role="menu" aria-label={`Sandbox status for ${language.name} ${opCode}`}>
                      {#each options as option}
                        {@const displayOption = optionDisplay(option)}
                        <button
                          type="button"
                          class={`sandbox-option ${displayOption?.cssClass ?? 'sandbox-option--blank'}`}
                          title={displayOption?.label ?? 'Blank'}
                          aria-label={displayOption?.label ?? 'Blank'}
                          onclick={(event) => handleSandboxStatusClick(event, language, opCode, option)}
                        >
                          {#if displayOption}
                            <span class="cell-symbol">{@html displayOption.symbolHtml}</span>
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
                      class={`matrix-cell matrix-cell--button matrix-cell--empty ${isLanguageHighlighted(language) ? 'is-row-highlighted' : ''} ${isOperationHighlighted(opCode) ? 'is-col-highlighted' : ''} ${isPreviewHighlighted(language, opCode) ? 'is-preview-highlighted' : ''} ${isDirectSandboxEdit(language, opCode) ? 'is-sandbox-direct' : ''}`}
                      onclick={() => handleCellClick(language, opCode)}
                      aria-label={`Edit ${language.name} ${opCode}`}
                      title={`${language.name}: ${opCode} - no data`}
                    >&nbsp;</button>
                    {#if isSandboxEditing(language, opCode)}
                      {@const baselineSupport = getOperationSupport(language, opCode, sandboxBaselineGraphData ?? graphData)}
                      {@const options = validSandboxOptions(baselineSupport)}
                      {#if options.length > 0}
                        <div class="sandbox-cell-popover" role="menu" aria-label={`Sandbox status for ${language.name} ${opCode}`}>
                          {#each options as option}
                            {@const displayOption = optionDisplay(option)}
                            <button
                              type="button"
                              class={`sandbox-option ${displayOption?.cssClass ?? 'sandbox-option--blank'}`}
                              title={displayOption?.label ?? 'Blank'}
                              aria-label={displayOption?.label ?? 'Blank'}
                              onclick={(event) => handleSandboxStatusClick(event, language, opCode, option)}
                            >
                              {#if displayOption}
                                <span class="cell-symbol">{@html displayOption.symbolHtml}</span>
                              {/if}
                            </button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  {:else}
                    <span
                      class={`matrix-cell matrix-cell--empty ${isLanguageHighlighted(language) ? 'is-row-highlighted' : ''} ${isOperationHighlighted(opCode) ? 'is-col-highlighted' : ''}`}
                      title={`${language.name}: ${opCode} — no data`}
                    >&nbsp;</span>
                  {/if}
                {/if}
              </td>
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

  .matrix-table:not(.measured) {
    table-layout: auto;
  }

  .matrix-table:not(.measured) th,
  .matrix-table:not(.measured) td {
    width: auto;
    min-width: auto;
    max-width: none;
  }

  .matrix-table.measured td,
  .matrix-table.measured thead th:not(.corner-cell) {
    width: var(--cell-width, auto);
    min-width: var(--cell-width, auto);
    max-width: var(--cell-width, none);
    height: var(--cell-height, auto);
  }

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
  }

  .corner-cell {
    background: #e5e7eb;
    z-index: 60;
    border-left: 1px solid #e5e7eb;
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
    padding: 0.25rem 0.35rem;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    font-weight: 600;
    color: #1f2937;
    font-size: 0.8rem;
  }

  .row-header button {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-header button :global(.math-text) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-header button {
    text-align: center;
  }

  .op-code {
    font-family: monospace;
    font-size: 0.75rem;
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
    gap: 0.1rem;
    border: none;
    cursor: default;
    font-size: 0.75rem;
  }

  .matrix-cell--button {
    cursor: pointer;
    padding: 0.2rem 0.25rem;
  }

  .matrix-cell--button:is(:hover, :focus-visible) {
    outline: 2px solid rgba(15, 23, 42, 0.2);
    outline-offset: -2px;
  }

  .matrix-cell--empty {
    background: #f9fafb;
  }

  .matrix-cell--unknown {
    color: #6b7280;
  }

  .matrix-cell.is-row-highlighted,
  .matrix-cell--empty.is-row-highlighted {
    box-shadow: inset 0 2px 0 #2563eb, inset 0 -2px 0 #2563eb;
  }

  .matrix-cell.is-col-highlighted,
  .matrix-cell--empty.is-col-highlighted {
    box-shadow: inset 2px 0 0 #2563eb, inset -2px 0 0 #2563eb;
  }

  .matrix-cell.is-row-highlighted.is-col-highlighted,
  .matrix-cell--empty.is-row-highlighted.is-col-highlighted {
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

  .cell-symbol {
    font-family: KaTeX_Main, "Times New Roman", serif;
    font-size: 1.08rem;
    font-weight: 700;
    line-height: 1;
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

  .sandbox-option--blank {
    background: #fff;
  }

  /* Explicit (non-derived) edges - golden border to highlight manually authored data */
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
    box-shadow: inset 0 0 0 3px #1d4ed8;
  }

  /* Dimmed/derived edges - diagonal gray stripes overlay */
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

  .matrix-cell.is-dimmed .cell-symbol {
    position: relative;
    z-index: 2;
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
