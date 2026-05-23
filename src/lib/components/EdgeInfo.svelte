<script lang="ts">
  import MathText from './MathText.svelte';
  import type { SelectedEdge, GraphData, FilteredGraphData, KCReference, KCSeparatingFunction, DirectedSuccinctnessRelation, ViewMode } from '$lib/types.js';
  import { getComplexityFromCatalog } from '$lib/data/complexities.js';
  import { extractCitationKeys, formatAssumptionForMathText } from '$lib/utils/math-text.js';
  import { getGlobalRefNumber } from '$lib/data/references.js';
  import DynamicLegend from './DynamicLegend.svelte';
  import ReferenceList from './ReferenceList.svelte';
  
  let { selectedEdge, graphData, filteredGraphData, viewMode = 'graph' as ViewMode }: { 
    selectedEdge: SelectedEdge | null; 
    graphData: GraphData | FilteredGraphData;
    filteredGraphData?: GraphData | FilteredGraphData;
    viewMode?: ViewMode;
  } = $props();

  // Use filteredGraphData for the legend if provided, otherwise fall back to graphData
  const legendGraphData = $derived(filteredGraphData ?? graphData);
  
  let referencesSection: HTMLElement | null = $state(null);

  function lookupRelationPair(sourceData: GraphData | FilteredGraphData, source: string, target: string) {
    const { adjacencyMatrix } = sourceData;
    const sourceIdx = adjacencyMatrix.indexByLanguage[source];
    const targetIdx = adjacencyMatrix.indexByLanguage[target];

    if (sourceIdx === undefined || targetIdx === undefined) return null;

    return {
      forward: adjacencyMatrix.matrix[sourceIdx][targetIdx],
      backward: adjacencyMatrix.matrix[targetIdx][sourceIdx]
    };
  }

  // Look up edge data from the displayed graph when available so status text
  // reflects active filters; fall back to the base graph for linked hidden edges.
  const originalEdge = $derived.by(() => {
    if (!selectedEdge) return null;

    const filteredPair = filteredGraphData
      ? lookupRelationPair(filteredGraphData, selectedEdge.source, selectedEdge.target)
      : null;
    const basePair = lookupRelationPair(graphData, selectedEdge.source, selectedEdge.target);
    const pair = filteredPair && (filteredPair.forward || filteredPair.backward) ? filteredPair : basePair;

    if (!pair) return selectedEdge;

    return {
      ...selectedEdge,
      forward: pair.forward,
      backward: pair.backward
    };
  });

  // Create a map for looking up separating functions by shortName
  const separatingFunctionMap = $derived.by(() => {
    const map = new Map<string, (typeof graphData.separatingFunctions)[number]>();
    for (const sf of graphData.separatingFunctions) {
      map.set(sf.shortName, sf);
    }
    return map;
  });

  // Look up separating functions for a relation by IDs
  function getSeparatingFunctionsForRelation(relation: { separatingFunctionIds?: string[] } | null) {
    if (!relation?.separatingFunctionIds?.length) return [];
    return relation.separatingFunctionIds
      .map(id => separatingFunctionMap.get(id))
      .filter((sf): sf is NonNullable<typeof sf> => sf !== undefined);
  }

  // Pre-compute separating functions for both directions
  const forwardSeparatingFunctions = $derived(
    originalEdge?.forward ? getSeparatingFunctionsForRelation(originalEdge.forward) : []
  );

  const backwardSeparatingFunctions = $derived(
    originalEdge?.backward ? getSeparatingFunctionsForRelation(originalEdge.backward) : []
  );

  // Collect all unique references from both directions, including inline citations
  const edgeReferences = $derived.by<KCReference[]>(() => {
    if (!originalEdge) return [];

    const refIds = new Set<string>();
    const refs: KCReference[] = [];

    const collectRefs = (relation: { refs: string[]; description?: string; separatingFunctionIds?: string[] } | null) => {
      if (!relation) return;
      relation.refs.forEach((id) => refIds.add(id));
      
      // Extract citation keys from description
      if (relation.description) {
        extractCitationKeys(relation.description).forEach((key) => refIds.add(key));
      }
      
      // Look up separating functions by ID and collect their refs and inline citations
      getSeparatingFunctionsForRelation(relation).forEach((fn) => {
        fn.refs.forEach((id) => refIds.add(id));
        // Also extract citations from separating function description
        if (fn.description) {
          extractCitationKeys(fn.description).forEach((key) => refIds.add(key));
        }
      });
    };

    collectRefs(originalEdge.forward);
    collectRefs(originalEdge.backward);

    const referenceMap = new Map(graphData.references.map((ref) => [ref.id, ref]));
    for (const id of refIds) {
      const ref = referenceMap.get(id);
      if (ref) {
        refs.push(ref);
      }
    }

    // Sort by global reference number
    refs.sort((a, b) => (getGlobalRefNumber(a.id) ?? Infinity) - (getGlobalRefNumber(b.id) ?? Infinity));

    return refs;
  });

  function getStatusLabel(status: string): string {
    const complexity = getComplexityFromCatalog(graphData.complexities, status);
    return complexity.description;
  }

  function getStatusComplexity(status: string) {
    return getComplexityFromCatalog(graphData.complexities, status);
  }

  function getStatusCssClass(status: string): string {
    return getStatusComplexity(status).cssClass;
  }

  function getStatusNotation(status: string): string {
    return getStatusComplexity(status).notation;
  }

  /**
   * Split a compound status label at the semicolon so the assumption can be
   * inserted after the first part (the primary claim) rather than at the
   * very end.  For simple statuses (no semicolon) prefix is the full label
   * and suffix is empty.
   */
  function splitStatusLabel(status: string): { prefix: string; suffix: string } {
    const label = getStatusLabel(status);
    const idx = label.indexOf(';');
    if (idx !== -1) {
      return { prefix: label.slice(0, idx), suffix: label.slice(idx) };
    }
    return { prefix: label, suffix: '' };
  }

  function scrollToReferences(e: MouseEvent) {
    e.preventDefault();
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Handler for inline citation clicks (receives key string, not MouseEvent)
  function handleCitationClick(_key: string) {
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

</script>

{#if selectedEdge}
  <div class="content-wrapper">
    <div class="scrollable-content">
      <div class="edge-details">
        <h3 class="text-xl font-bold text-gray-900 mb-4">
          <MathText text={selectedEdge.sourceName} className="inline" />
          <span> ↔ </span>
          <MathText text={selectedEdge.targetName} className="inline" />
        </h3>
        
        <div class="space-y-4">
{#snippet directionBlock(fromName: string, toName: string, relation: DirectedSuccinctnessRelation, separatingFns: KCSeparatingFunction[])}
            <div class="direction-block">
              {#if false}<h5 class="font-semibold text-gray-900 mb-2">
                <MathText text={fromName} className="inline" />
                <span> → </span>
                <MathText text={toName} className="inline" />
              </h5>{/if}
              <div class={`succinctness-statement ${getStatusCssClass(relation.status)}`}>
                <MathText text={fromName} className="inline" />
                <span class="compile-arrow">→</span>
                <MathText text={toName} className="inline" />
                <span class="order-statement">
                  (<MathText text={toName} className="inline" />
                  <MathText text={getStatusNotation(relation.status)} className="inline succinctness-notation" />
                  <MathText text={fromName} className="inline" />)
                </span>
              </div>
              {#if true}
                {@const parts = splitStatusLabel(relation.status)}
                <h5 class="edge-status-heading">
                  {parts.prefix}{#if relation.assumption}{' '}assuming <MathText text={formatAssumptionForMathText(relation.assumption)} className="inline" />{/if}{parts.suffix}{#if relation.refs.length}{' '}{#each relation.refs as refId}<button 
                      class="ref-badge"
                      onclick={scrollToReferences}
                      title="View reference"
                    >[{getGlobalRefNumber(refId) ?? '?'}]</button>{/each}{/if}
                </h5>
              {/if}
              {#if relation.description}
                <MathText 
                  text={relation.description} 
                  className="edge-description-text" 
                  wrapMode="hyphenate"
                  lang="en"
                  onCitationClick={handleCitationClick}
                />
              {/if}
              
              {#if separatingFns.length > 0}
                <div class="mt-3">
                  <h6 class="text-sm font-semibold text-gray-900 mb-2">Separating Functions</h6>
                  <div class="space-y-2">
                    {#each separatingFns as fn}
                      <div class="p-2 bg-blue-50 border border-blue-200 rounded">
                        <div class="font-medium text-sm text-gray-900">
                          <MathText text={fn.name} className="inline" />{#if fn.refs.length}{#each fn.refs as refId}<button 
                                class="ref-badge"
                                onclick={scrollToReferences}
                                title="View reference"
                              >[{getGlobalRefNumber(refId) ?? '?'}]</button>{/each}{/if}
                        </div>
                        <MathText 
                          text={fn.description} 
                          className="text-xs text-gray-600 mt-1 block"
                          onCitationClick={handleCitationClick}
                        />
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/snippet}

{#snippet unknownDirectionBlock(fromName: string, toName: string)}
            <div class="direction-block">
              <div class={`succinctness-statement ${getStatusCssClass('unknown-both')}`}>
                <MathText text={fromName} className="inline" />
                <span class="compile-arrow">→</span>
                <MathText text={toName} className="inline" />
                <span class="order-statement">
                  (<MathText text={toName} className="inline" />
                  <MathText text={getStatusNotation('unknown-both')} className="inline succinctness-notation" />
                  <MathText text={fromName} className="inline" />)
                </span>
              </div>
              <h5 class="edge-status-heading">Unknown</h5>
              <p class="edge-description-text">No information available.</p>
            </div>
          {/snippet}

          {#if originalEdge && !originalEdge.forward}
            {@render unknownDirectionBlock(selectedEdge.sourceName, selectedEdge.targetName)}
          {/if}

          {#if originalEdge?.forward}
            {@render directionBlock(selectedEdge.sourceName, selectedEdge.targetName, originalEdge.forward, forwardSeparatingFunctions)}
          {/if}
          
          {#if originalEdge?.backward}
            {@render directionBlock(selectedEdge.targetName, selectedEdge.sourceName, originalEdge.backward, backwardSeparatingFunctions)}
          {/if}
        </div>
        
        <ReferenceList references={edgeReferences} bind:anchorElement={referencesSection} />
      </div>
      
      <DynamicLegend graphData={legendGraphData} selectedEdge={selectedEdge} viewMode={viewMode} />
    </div>
  </div>
{/if}

<style>
  .edge-details {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .direction-block {
    padding: 0.75rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.375rem;
  }

  .succinctness-statement {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    width: fit-content;
    max-width: 100%;
    margin-bottom: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .compile-arrow {
    font-family: KaTeX_Main, "Times New Roman", serif;
    font-size: 1.05rem;
    font-weight: 700;
  }

  .order-statement {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
    color: inherit;
  }

  .succinctness-notation {
    font-weight: 700;
  }

  .edge-status-heading {
    margin: 0 0 0.4rem;
    color: #1f2937;
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .edge-description-text {
    display: block;
    margin-bottom: 0.5rem;
    color: #4b5563;
    font-size: 0.875rem;
    font-style: normal;
    line-height: 1.5;
    overflow-wrap: break-word;
    hyphens: auto;
    hyphenate-character: "-";
  }
</style>
