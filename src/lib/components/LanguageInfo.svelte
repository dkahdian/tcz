<script lang="ts">
  import MathText from './MathText.svelte';
  import type { 
    KCLanguage, 
    GraphData, 
    KCOpEntry, 
    KCOpSupportMap, 
    SelectedEdge,
    FilteredGraphData,
    KCLanguagePropertiesResolved,
    KCReference,
    SelectedOperationCell
  } from '$lib/types.js';
  import { resolveLanguageProperties } from '$lib/data/operations.js';
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
    onEdgeSelect,
    onOperationCellSelect,
    viewMode = 'graph' as ViewMode
  }: {
    selectedLanguage: KCLanguage | null;
    graphData: GraphData | FilteredGraphData;
    filteredGraphData?: GraphData | FilteredGraphData;
    onEdgeSelect: (edge: SelectedEdge) => void;
    onOperationCellSelect?: (cell: SelectedOperationCell) => void;
    viewMode?: ViewMode;
  } = $props();

  const isOperationsView = $derived(viewMode === 'queries' || viewMode === 'transforms');
  const isStudiedOperation = (op: KCOpEntry) =>
    op.complexity !== 'unknown-to-us' || Boolean(op.assumption || op.description || op.refs?.length);

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

  interface RelationshipStatement {
    target: string;
    linkText: string;
    suffixText: string;
    refs: string[];
  }

  const languageLookup = $derived.by<Map<string, KCLanguage>>(() => {
    const lookup = new Map<string, KCLanguage>();
    for (const language of graphData.languages) {
      lookup.set(language.id, language);
    }
    return lookup;
  });

  // Helper to generate a descriptive statement from a transformation status
  function getStatusDescription(status: string, fromLangId: string, toLangId: string): { linkText: string; suffixText: string } {
    const from = languageLookup.get(fromLangId)?.name ?? fromLangId;
    const to = languageLookup.get(toLangId)?.name ?? toLangId;
    const linkText = `${from} converts to ${to}`;
    
    switch (status) {
      case 'poly':
        return { linkText, suffixText: ' in polynomial time' };
      case 'not-poly':
        return { linkText: `No polynomial compilation from ${from} to ${to}`, suffixText: '' };
      case 'no-quasi':
        return { linkText: `Exponential gap between ${from} and ${to}`, suffixText: '' };
      case 'no-poly-quasi':
        return { linkText, suffixText: ' in quasi-polynomial time only' };
      case 'no-poly-unknown-quasi':
        return { linkText: `No polynomial compilation from ${from} to ${to}`, suffixText: '; quasi-polynomial unknown' };
      case 'unknown-poly-quasi':
        return { linkText: `Polynomial compilation unknown from ${from} to ${to}`, suffixText: '; quasi-polynomial exists' };
      case 'unknown-both':
        return { linkText: `Complexity of compilation from ${from} to ${to}`, suffixText: ' is unknown' };
      case 'unknown':
        return { linkText: `Complexity of compilation from ${from} to ${to}`, suffixText: ' is unknown' };
      default:
        return { linkText: `${from} relates to ${to}`, suffixText: '' };
    }
  }

  const languageRelationships = $derived.by<RelationshipStatement[]>(() => {
    if (!selectedLanguage) return [];
    const { id, name } = selectedLanguage;
    const { adjacencyMatrix } = graphData;

    const statements: RelationshipStatement[] = [];
    const forwardStatuses = new Map<string, string>();

    const sourceIndex = adjacencyMatrix.indexByLanguage[id];
    if (sourceIndex === undefined) return statements;

    const { languageIds, matrix } = adjacencyMatrix;

    for (let targetIndex = 0; targetIndex < languageIds.length; targetIndex += 1) {
      const relation = matrix[sourceIndex]?.[targetIndex];
      if (!relation) continue;

      const target = languageIds[targetIndex];
      forwardStatuses.set(target, relation.status);
      const desc = getStatusDescription(relation.status, id, target);
      statements.push({
        target,
        linkText: desc.linkText,
        suffixText: desc.suffixText,
        refs: relation.refs ?? []
      });
    }

    for (let sourceIndexIter = 0; sourceIndexIter < languageIds.length; sourceIndexIter += 1) {
      if (sourceIndexIter === sourceIndex) continue;

      const relation = matrix[sourceIndexIter]?.[sourceIndex];
      if (!relation) continue;

      const source = languageIds[sourceIndexIter];
      const forwardStatus = forwardStatuses.get(source);
      if (forwardStatus && forwardStatus === relation.status) {
        continue;
      }

      const desc = getStatusDescription(relation.status, source, id);
      statements.push({
        target: source,
        linkText: desc.linkText,
        suffixText: desc.suffixText,
        refs: relation.refs ?? []
      });
    }

    return statements.sort((a, b) => {
      const aName = languageLookup.get(a.target)?.name ?? a.target;
      const bName = languageLookup.get(b.target)?.name ?? b.target;
      return aName.localeCompare(bName);
    });
  });

  function scrollToReferences(e: MouseEvent | KeyboardEvent) {
    e.preventDefault();
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Handler for inline citation clicks (receives key string, not MouseEvent)
  function handleCitationClick(_key: string) {
    referencesSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectEdge(targetId: string) {
    if (!selectedLanguage || !onEdgeSelect) return;
    
    const sourceId = selectedLanguage.id;
    const nodeA = sourceId < targetId ? sourceId : targetId;
    const nodeB = sourceId < targetId ? targetId : sourceId;
    
    const sourceIndex = graphData.adjacencyMatrix.indexByLanguage[nodeA];
    const targetIndex = graphData.adjacencyMatrix.indexByLanguage[nodeB];
    
    const forwardRelation = sourceIndex !== undefined && targetIndex !== undefined 
      ? graphData.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex] ?? null
      : null;
    const backwardRelation = sourceIndex !== undefined && targetIndex !== undefined
      ? graphData.adjacencyMatrix.matrix[targetIndex]?.[sourceIndex] ?? null
      : null;
    
    const sourceLang = languageLookup.get(nodeA);
    const targetLang = languageLookup.get(nodeB);
    
    if (sourceLang && targetLang) {
      onEdgeSelect({
        id: `${nodeA}-${nodeB}`,
        source: nodeA,
        target: nodeB,
        sourceName: sourceLang.name,
        targetName: targetLang.name,
        forward: forwardRelation,
        backward: backwardRelation,
        refs: [...(forwardRelation?.refs || []), ...(backwardRelation?.refs || [])]
      });
    }
  }

  const handleRelationshipClick = (targetId: string) => (event: MouseEvent) => {
    event.preventDefault();
    selectEdge(targetId);
  };

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

        {#if selectedLanguage.tags?.length}
          <div class="mb-4 flex flex-wrap gap-2">
            {#each selectedLanguage.tags as tag}
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={`background:${tag.color ?? '#e5e7eb'}20; color:${tag.color ?? '#374151'}; border:1px solid ${tag.color ?? '#e5e7eb'}`}
                title={tag.description || ''}>
                <MathText text={tag.label} className="inline" />
                {#if tag.refs?.length}
                  {#each tag.refs as refId}
                    <button 
                      class="ref-badge inline"
                      onclick={scrollToReferences}
                      title="View reference"
                    >[{getGlobalRefNumber(refId) ?? '?'}]</button>
                  {/each}
                {/if}
              </span>
            {/each}
          </div>
        {/if}
        
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
                    {display.symbol}
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

          {@render operationSection('Queries', (resolvedProperties?.queries ?? []).filter(isStudiedOperation), 'query')}
          {@render operationSection('Transformations', (resolvedProperties?.transformations ?? []).filter(isStudiedOperation), 'transformation')}
        </div>
        {#if !isOperationsView && languageRelationships.length}
          <!-- TODO: Fix multi-line link text causing newline injection before suffix -->
          <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h5 class="font-semibold text-gray-900 mb-2">Relationships</h5>
            <div class="space-y-1 text-sm">
              {#each languageRelationships as statement}
                <div class="flex items-start gap-2">
                  <div class="flex-1 text-gray-700">
                    <MathText
                      as="a"
                      href="#"
                      className="edge-link inline"
                      text={statement.linkText}
                      title="View edge details"
                      onclick={handleRelationshipClick(statement.target)}
                    />
                    <span> </span>
                    <MathText text={statement.suffixText} className="inline" />
                    {#if statement.refs?.length}
                      {#each statement.refs as refId}
                        <button 
                          class="ref-badge"
                          onclick={scrollToReferences}
                          title="View reference"
                        >[{getGlobalRefNumber(refId) ?? '?'}]</button>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        
        <ReferenceList references={allReferences} bind:anchorElement={referencesSection} />
      </div>
    {:else}
      <div class="welcome-message">
        <h3 class="text-lg font-semibold text-gray-700 mb-2">Tractable Circuit Zoo</h3>
        <p class="text-gray-600 text-sm mb-4">
          Click on a node or edge for more information.
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
