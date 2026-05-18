<script lang="ts">
  import MathText from './MathText.svelte';
  import DynamicLegend from './DynamicLegend.svelte';
  import ReferenceList from './ReferenceList.svelte';
  import type { 
    GraphData, 
    FilteredGraphData, 
    KCLanguage,
    KCOpEntry,
    SelectedOperation,
    SelectedOperationCell,
    ViewMode
  } from '$lib/types.js';
  import { extractCitationKeys, formatAssumptionForMathText } from '$lib/utils/math-text.js';
  import { getGlobalRefNumber } from '$lib/data/references.js';
  import { getOperationTractabilityDisplay } from '$lib/utils/operation-tractability.js';

  import { QUERIES, TRANSFORMATIONS, getOperationDescription } from '$lib/data/operations.js';

  let {
    selectedOperation = null,
    selectedOperationCell = null,
    graphData,
    filteredGraphData,
    onLanguageSelect,
    onOperationSelect,
    viewMode = 'queries' as ViewMode
  }: {
    selectedOperation: SelectedOperation | null;
    selectedOperationCell: SelectedOperationCell | null;
    graphData: GraphData | FilteredGraphData;
    filteredGraphData?: GraphData | FilteredGraphData;
    onLanguageSelect?: (language: KCLanguage) => void;
    onOperationSelect?: (operation: SelectedOperation) => void;
    viewMode?: ViewMode;
  } = $props();

  const legendGraphData = $derived(filteredGraphData ?? graphData);
  const panelTitle = $derived(
    viewMode === 'transforms' ? 'Transformation Tractability' : 'Query Tractability'
  );

  let referencesSection: HTMLElement | null = $state(null);

  function handleCitationClick(_key: string) {
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function handleLanguageClick(language: KCLanguage) {
    onLanguageSelect?.(language);
  }

  function handleOperationCodeClick(code: string, type: 'query' | 'transformation') {
    const opDefs = type === 'query' ? QUERIES : TRANSFORMATIONS;
    const opDef = Object.values(opDefs).find(op => op.code === code);
    if (opDef && onOperationSelect) {
      onOperationSelect({
        code: opDef.code,
        label: opDef.label,
        description: getOperationDescription(type, opDef.code, opDef.description),
        type
      });
    }
  }

  // Collect references for the cell view
  const cellReferences = $derived.by(() => {
    if (!selectedOperationCell) return [];

    const refIds = new Set<string>();
    const support = selectedOperationCell.support;
    
    // Add refs from the support
    support.refs?.forEach(id => refIds.add(id));
    
    // Extract inline citations from description/assumption
    if (support.description) {
      extractCitationKeys(support.description).forEach(key => refIds.add(key));
    }
    if (support.assumption) {
      extractCitationKeys(support.assumption).forEach(key => refIds.add(key));
    }
    
    // Build result from global references
    const globalRefMap = new Map(graphData.references.map(ref => [ref.id, ref]));
    const refs = [];
    
    for (const id of refIds) {
      const ref = globalRefMap.get(id);
      if (ref) {
        refs.push(ref);
      }
    }
    
    // Sort by global reference number
    refs.sort((a, b) => (getGlobalRefNumber(a.id) ?? Infinity) - (getGlobalRefNumber(b.id) ?? Infinity));
    
    return refs;
  });
</script>

<div class="content-wrapper">
  <div class="scrollable-content">
    {#if selectedOperationCell}
      <!-- Show language + operation cell info -->
      {@const display = getOperationTractabilityDisplay(
        selectedOperationCell.support,
        selectedOperationCell.operationType
      )}
      <div class="operation-cell-details">
        <h3 class="panel-title">{panelTitle}</h3>
        <div class="cell-header">
          <button 
            type="button"
            class="language-link"
            onclick={() => handleLanguageClick(selectedOperationCell.language)}
            title="View language details"
          >
            <MathText text={selectedOperationCell.language.name} className="inline text-lg font-bold" />
          </button>
          <span class="separator">:</span>
          <button 
            type="button"
            class="operation-code-link"
            onclick={() => handleOperationCodeClick(selectedOperationCell.operationCode, selectedOperationCell.operationType)}
            title="View operation details"
          >{selectedOperationCell.operationCode}</button>
          <span class="operation-label-inline">({selectedOperationCell.operationLabel})</span>
        </div>

        <div class={`tractability-summary ${display.cssClass}`}>
          <span class="tractability-symbol">{@html display.symbolHtml}</span>
          <div class="tractability-copy">
            <span class="tractability-label">{display.label}</span>
          {#if selectedOperationCell.support.assumption}
              <span class="assumption-line">
                <span class="assumption-prefix">assuming</span>
                <MathText
                  text={formatAssumptionForMathText(selectedOperationCell.support.assumption)}
                  className="inline assumption-math"
                  onCitationClick={handleCitationClick}
                />
              </span>
          {/if}
          </div>
        </div>

        {#if selectedOperationCell.support.description}
          <div class="description-section">
            <MathText 
              text={selectedOperationCell.support.description} 
              className="operation-description-text"
              onCitationClick={handleCitationClick}
            />
          </div>
        {/if}

        <ReferenceList references={cellReferences} bind:anchorElement={referencesSection} />
      </div>
    {:else if selectedOperation}
      <!-- Show operation info only -->
      <div class="operation-details">
        <div class="operation-header">
          <span class="operation-code-large">{selectedOperation.code}</span>
          <span class="operation-type-badge">{selectedOperation.type}</span>
        </div>
        
        <h4 class="text-lg font-semibold text-gray-900 mb-2">{selectedOperation.label}</h4>
        
        {#if selectedOperation.description}
          <p class="text-gray-700 mb-4">
            <MathText text={selectedOperation.description} className="inline" />
          </p>
        {/if}
      </div>
    {:else}
      <div class="welcome-message">
        <h3 class="panel-title">{panelTitle}</h3>
        <p class="text-gray-600 text-sm mb-4">
          Click on any cell for more information.
        </p>
      </div>
    {/if}
    
    <DynamicLegend graphData={legendGraphData} viewMode={viewMode} />
  </div>
</div>

<style>
  .operation-details, 
  .operation-cell-details,
  .welcome-message {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .cell-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem 0.45rem;
    margin-bottom: 0.85rem;
    line-height: 1.25;
  }

  .panel-title {
    margin: 0 0 1rem;
    font-size: 1.125rem;
    font-weight: 600;
    color: #374151;
  }

  .language-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: #2563eb;
    text-decoration: none;
  }

  .language-link:hover {
    text-decoration: underline;
  }

  .separator {
    color: #9ca3af;
    font-size: 1.25rem;
  }

  .operation-code-link {
    font-family: monospace;
    font-size: 1.25rem;
    font-weight: 700;
    color: #2563eb;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }

  .operation-code-link:hover {
    text-decoration: underline;
  }

  .operation-label-inline {
    color: #4b5563;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .tractability-summary {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    margin: 0 0 0.9rem;
    padding: 0.65rem 0.75rem;
    border-left: 4px solid currentColor;
    background-clip: padding-box;
  }

  .tractability-symbol {
    display: grid;
    flex: 0 0 1.75rem;
    width: 1.75rem;
    height: 1.55rem;
    place-items: center;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.72);
    font-family: KaTeX_Main, "Times New Roman", serif;
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1;
  }

  .tractability-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    line-height: 1.3;
  }

  .tractability-label {
    color: #111827;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .assumption-line {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.3rem;
    color: #475569;
    font-size: 0.88rem;
  }

  .assumption-prefix {
    color: #64748b;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-size: 0.72rem;
  }

  .assumption-line :global(.assumption-math) {
    color: #334155;
    font-size: 0.95rem;
  }

  .description-section {
    margin: 0 0 1rem;
    padding-top: 0.15rem;
  }

  .description-section :global(.operation-description-text) {
    color: #374151;
    font-size: 0.92rem;
    line-height: 1.55;
  }

  .operation-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .operation-code-large {
    font-family: monospace;
    font-size: 2rem;
    font-weight: 700;
    color: #1f2937;
    background: #f3f4f6;
    padding: 0.25rem 0.75rem;
    border-radius: 0.375rem;
  }

  .operation-type-badge {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: #6366f1;
    background: #eef2ff;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

</style>
