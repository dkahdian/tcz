<script lang="ts">
  import MathText from './MathText.svelte';
  import type { 
    KCLanguage, 
    GraphData, 
    KCOpEntry, 
    FilteredGraphData,
    KCLanguagePropertiesResolved,
    KCReference,
    SelectedOperationCell
  } from '$lib/types.js';
  import { displayCodeToSafeKey, resolveLanguageProperties } from '$lib/data/operations.js';
  import { extractCitationKeys, formatAssumptionForMathText } from '$lib/utils/math-text.js';
  import { getGlobalRefNumber } from '$lib/data/references.js';
  import DynamicLegend from './DynamicLegend.svelte';
  import ReferenceList from './ReferenceList.svelte';
  import type { ViewMode } from '$lib/types.js';
  import { getOperationTractabilityDisplay } from '$lib/utils/operation-tractability.js';

  let {
    selectedLanguage,
    graphData,
    filteredGraphData,
    onOperationCellSelect,
    viewMode = 'graph' as ViewMode
  }: {
    selectedLanguage: KCLanguage | null;
    graphData: GraphData | FilteredGraphData;
    filteredGraphData?: GraphData | FilteredGraphData;
    onOperationCellSelect?: (cell: SelectedOperationCell) => void;
    viewMode?: ViewMode;
  } = $props();

  const isOperationsView = $derived(viewMode === 'queries' || viewMode === 'transforms');

  function hasOperationVisibility(data: GraphData | FilteredGraphData): data is FilteredGraphData {
    return 'visibleQueryIds' in data && 'visibleTransformationIds' in data;
  }

  function isVisibleOperation(op: KCOpEntry, opType: 'query' | 'transformation') {
    const sourceData = filteredGraphData ?? graphData;
    if (!hasOperationVisibility(sourceData)) return true;

    if (opType === 'query') {
      return sourceData.visibleQueryIds.has(op.code);
    }

    const safeKey = displayCodeToSafeKey(op.code);
    return sourceData.visibleTransformationIds.has(safeKey) || sourceData.visibleTransformationIds.has(op.code);
  }

  function shouldShowOperation(op: KCOpEntry, opType: 'query' | 'transformation') {
    return isVisibleOperation(op, opType);
  }

  // Use filteredGraphData for the legend if provided, otherwise fall back to graphData
  const legendGraphData = $derived(filteredGraphData ?? graphData);
  
  // Combine all operations for display
  // Resolve the properties to get full operation entries
  // Note: If the fill-unknown-operations filter is active, properties will already be resolved,
  // but we resolve again here for safety in case selectedLanguage comes from unfiltered data
  let resolvedProperties: KCLanguagePropertiesResolved | null = $derived(
    selectedLanguage ? resolveLanguageProperties(
      selectedLanguage.properties.queries,
      selectedLanguage.properties.transformations
    ) : null
  );

  let referencesSection: HTMLElement | null = $state(null);

  // Collect all references including inline citations from description and notes
  const allReferences = $derived.by<KCReference[]>(() => {
    if (!selectedLanguage) return [];

    const refIds = new Set<string>();
    
    // Add explicit references from the language
    selectedLanguage.references?.forEach(ref => refIds.add(ref.id));
    
    // Extract inline citations from definition
    if (selectedLanguage.definition) {
      extractCitationKeys(selectedLanguage.definition).forEach(key => refIds.add(key));
    }
    
    // Extract inline citations from operation assumptions
    if (resolvedProperties) {
      for (const q of resolvedProperties.queries) {
        if (q.assumption) {
          extractCitationKeys(q.assumption).forEach(key => refIds.add(key));
        }
      }
      for (const t of resolvedProperties.transformations) {
        if (t.assumption) {
          extractCitationKeys(t.assumption).forEach(key => refIds.add(key));
        }
      }
    }
    
    // Build result from global references, preserving order from selectedLanguage.references first
    const globalRefMap = new Map(graphData.references.map(ref => [ref.id, ref]));
    const refs: KCReference[] = [];
    const addedIds = new Set<string>();
    
    // First add references in order from selectedLanguage.references
    for (const ref of selectedLanguage.references ?? []) {
      if (!addedIds.has(ref.id)) {
        refs.push(ref);
        addedIds.add(ref.id);
      }
    }
    
    // Then add any additional inline citations from global references
    for (const id of refIds) {
      if (!addedIds.has(id)) {
        const ref = globalRefMap.get(id);
        if (ref) {
          refs.push(ref);
          addedIds.add(id);
        }
      }
    }
    
    // Sort by global reference number
    refs.sort((a, b) => (getGlobalRefNumber(a.id) ?? Infinity) - (getGlobalRefNumber(b.id) ?? Infinity));
    
    return refs;
  });

  function scrollToReferences(e: MouseEvent | KeyboardEvent) {
    e.preventDefault();
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Handler for inline citation clicks (receives key string, not MouseEvent)
  function handleCitationClick(_key: string) {
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectOperationCell(op: KCOpEntry, type: 'query' | 'transformation') {
    if (!selectedLanguage || !onOperationCellSelect) return;
    onOperationCellSelect({
      language: selectedLanguage,
      operationCode: op.code,
      operationLabel: op.label,
      operationType: type,
      support: op
    });
  }
</script>

<div class="content-wrapper">
  <div class="scrollable-content">
    {#if selectedLanguage}
      <div class="language-details">
        <MathText as="h3" className="text-xl font-bold text-gray-900 mb-2" text={selectedLanguage.name} />
        <MathText as="h4" className="text-sm text-gray-600 mb-4" text={selectedLanguage.fullName} />
        
        <p class="text-gray-700 mb-6">
          <MathText 
            text={selectedLanguage.definition} 
            className="inline"
            onCitationClick={handleCitationClick}
          />{#if selectedLanguage.definitionRefs?.length}{#each selectedLanguage.definitionRefs as refId}<button 
                class="ref-badge"
                onclick={scrollToReferences}
                title="View reference"
              >[{getGlobalRefNumber(refId) ?? '?'}]</button>{/each}{/if}
        </p>

        <div class="space-y-4">
          {#snippet operationSection(heading: string, ops: KCOpEntry[], opType: 'query' | 'transformation')}
          <div>
            <h5 class="font-semibold text-gray-900 mb-2">{heading}</h5>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
              {#each ops as op}
                {@const display = getOperationTractabilityDisplay(op, opType)}
                <button
                  type="button"
                  class="op-row grid grid-cols-[auto,1fr] items-start gap-x-2"
                  class:op-row--clickable={isOperationsView}
                  onclick={() => selectOperationCell(op, opType)}
                  disabled={!isOperationsView}
                >
                  <span class={`op-symbol ${display.cssClass}`} title={display.label}>
                    {@html display.symbolHtml}
                  </span>
                  <div class="text-sm leading-5 text-left">
                    <div>
                      <strong>{op.code}</strong>
                      {#if op.label}
                        <span> (</span>
                        <MathText text={op.label} className="inline" />
                        <span>)</span>
                      {/if}
                      {#if op.refs?.length}{#each op.refs as refId}<span 
                            class="ref-badge"
                            role="link"
                            tabindex="0"
                            onclick={scrollToReferences}
                            onkeydown={(e) => e.key === 'Enter' && scrollToReferences(e)}
                            title="View reference"
                          >[{getGlobalRefNumber(refId) ?? '?'}]</span>{/each}{/if}
                    </div>
                    {#if op.assumption}
                      <div class="text-xs text-gray-500">
                        <span>Assuming </span>
                        <MathText 
                          text={formatAssumptionForMathText(op.assumption)} 
                          className="inline"
                          onCitationClick={handleCitationClick}
                        />
                      </div>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          </div>
          {/snippet}

          {@render operationSection('Queries', (resolvedProperties?.queries ?? []).filter((op) => shouldShowOperation(op, 'query')), 'query')}
          {@render operationSection('Transformations', (resolvedProperties?.transformations ?? []).filter((op) => shouldShowOperation(op, 'transformation')), 'transformation')}
        </div>
        
        <ReferenceList references={allReferences} bind:anchorElement={referencesSection} />
      </div>
    {:else}
      <div class="welcome-message">
        <h3 class="text-lg font-semibold text-gray-700 mb-2">Tractable Circuit Zoo</h3>
        <p class="text-gray-600 text-sm mb-4">
          {viewMode === 'graph'
            ? 'Click on a node or edge for more information.'
            : 'Click on any cell for more information.'}
        </p>
      </div>
    {/if}
    
    <DynamicLegend graphData={legendGraphData} selectedNode={selectedLanguage} viewMode={viewMode} />
  </div>
</div>
  
  <style>
    .language-details, .welcome-message {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 0.5rem;
      padding: 1rem;
      margin-bottom: 1rem;
    }

    .ref-badge.inline {
      margin-left: 0.25em;
    }

    .op-row {
      background: none;
      border: none;
      padding: 0.25rem;
      margin: -0.25rem;
      border-radius: 0.25rem;
      width: 100%;
      cursor: default;
    }

    .op-row:disabled {
      opacity: 1;
    }

    .op-row--clickable {
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .op-row--clickable:hover {
      background: #f0f9ff;
    }

    .op-symbol {
      display: inline-grid;
      width: 1.35rem;
      height: 1.2rem;
      place-items: center;
      border-radius: 0.2rem;
      font-family: KaTeX_Main, "Times New Roman", serif;
      font-size: 0.95rem;
      font-weight: 700;
      line-height: 1;
    }
  </style>
