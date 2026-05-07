<script lang="ts">
  import MathText from './MathText.svelte';
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

  type OperationType = 'queries' | 'transformations';

  let {
    graphData,
    operationType,
    selectedNode = $bindable(),
    selectedOperation = $bindable(),
    selectedOperationCell = $bindable()
  }: {
    graphData: GraphData | FilteredGraphData;
    operationType: OperationType;
    selectedNode: KCLanguage | null;
    selectedOperation: SelectedOperation | null;
    selectedOperationCell: SelectedOperationCell | null;
  } = $props();

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

  // Get operation support for a language
  function getOperationSupport(language: KCLanguage, opCode: string): KCOpEntry | null {
    const supportMap = operationType === 'queries' 
      ? language.properties.queries 
      : language.properties.transformations;
    
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
    if (!support) return;

    const opDef = operations[opCode];
    if (!opDef) return;

    selectedNode = null;
    selectedOperation = null;
    selectedOperationCell = {
      language,
      operationCode: opDef.code,
      operationLabel: opDef.label,
      operationType: operationType === 'queries' ? 'query' : 'transformation',
      support
    };
  }

  function isLanguageSelected(language: KCLanguage): boolean {
    return selectedNode?.id === language.id;
  }

  function isOperationSelected(opCode: string): boolean {
    if (!selectedOperation) return false;
    const opDef = operations[opCode];
    return selectedOperation.code === opDef?.code;
  }

  function isCellSelected(language: KCLanguage, opCode: string): boolean {
    if (!selectedOperationCell) return false;
    const opDef = operations[opCode];
    return selectedOperationCell.language.id === language.id && 
           selectedOperationCell.operationCode === opDef?.code;
  }

  function getCellTitle(language: KCLanguage, opCode: string, support: KCOpEntry | null): string {
    const opDef = operations[opCode];
    if (!support) return `${language.name} - ${opDef?.label ?? opCode}: no data`;
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

  function updateCellSize() {
    const numCols = operationCodes.length + 1; // +1 for header
    const numRows = visibleLanguages.length + 1; // +1 for header
    const result = measureCellSize(matrixScrollEl, tableEl, numCols, numRows);
    if (result) {
      cellSize = result;
      measured = true;
    }
  }

  $effect(() => {
    visibleLanguages;
    operationCodes;
    measured = false;
    queueMicrotask(() => updateCellSize());
  });

  import { onMount } from 'svelte';
  onMount(() => {
    updateCellSize();
    const resizeObserver = new ResizeObserver(() => updateCellSize());
    if (matrixScrollEl) resizeObserver.observe(matrixScrollEl);
    return () => resizeObserver.disconnect();
  });
</script>

<div class="matrix-view" aria-live="polite">
  <div class="matrix-scroll" bind:this={matrixScrollEl} role="region" aria-label="{operationType === 'queries' ? 'Queries' : 'Transformations'} matrix view">
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
            <th class={`col-header ${isOperationSelected(opCode) ? 'is-active' : ''}`}>
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
            <th class={`row-header ${isLanguageSelected(language) ? 'is-active' : ''}`}>
              <button type="button" onclick={() => handleLanguageClick(language)} title={`Select ${language.name}`}>
                <MathText text={language.name} className="inline" />
              </button>
            </th>
            {#each operationCodes as opCode}
              {@const support = getOperationSupport(language, opCode)}
              {@const display = getOperationTractabilityDisplay(
                support,
                operationType === 'queries' ? 'query' : 'transformation'
              )}
              <td>
                {#if support}
                <button
                  type="button"
                  class={`matrix-cell matrix-cell--button ${display.cssClass} ${isCellSelected(language, opCode) ? 'is-selected' : ''} ${support?.dimmed ? 'is-dimmed' : ''} ${support?.explicit ? 'is-explicit' : ''}`}
                  onclick={() => handleCellClick(language, opCode)}
                  title={getCellTitle(language, opCode, support)}
                >
                  <span class="cell-symbol">{display.symbol}</span>
                </button>
                {:else}
                <span class="matrix-cell matrix-cell--empty" title={`${language.name}: ${opCode} — no data`}>&nbsp;</span>
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
    z-index: 5;
    border-bottom: 1px solid #e5e7eb;
  }

  .corner-cell {
    background: #e5e7eb;
    z-index: 6;
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
    z-index: 4;
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
    transition: background 0.15s ease, box-shadow 0.15s ease;
    padding: 0.2rem 0.25rem;
  }

  .matrix-cell--button:is(:hover, :focus-visible) {
    box-shadow: inset 0 0 0 2px rgba(15, 23, 42, 0.2);
  }

  .matrix-cell--empty {
    background: #f9fafb;
  }

  .cell-symbol {
    font-family: KaTeX_Main, "Times New Roman", serif;
    font-size: 1.08rem;
    font-weight: 700;
    line-height: 1;
  }

  /* Explicit (non-derived) edges - golden border to highlight manually authored data */
  .matrix-cell.is-explicit {
    box-shadow: inset 0 0 0 2px #eab308; /* yellow-500 golden border */
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
