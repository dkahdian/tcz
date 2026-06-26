  <script lang="ts">
  import MathText from './MathText.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
  import AssumptionPicker from './AssumptionPicker.svelte';
  import { onMount } from 'svelte';
  import type { SelectedEdge, GraphData, FilteredGraphData, KCReference, DirectedSuccinctnessRelation, ViewMode } from '$lib/types.js';
  import { getComplexityFromCatalog } from '$lib/data/complexities.js';
  import { extractCitationKeys, formatAssumptionForMathText } from '$lib/utils/math-text.js';
  import { getGlobalRefNumber } from '$lib/data/references.js';
  import DynamicLegend from './DynamicLegend.svelte';
  import ReferenceList from './ReferenceList.svelte';
  
  let {
    selectedEdge,
    graphData,
    filteredGraphData,
    sandboxMode = false,
    sandboxEdited = false,
    onSandboxEdgeEdit,
    onSandboxEdgeReset,
    onSandboxReferenceAdd,
    viewMode = 'graph' as ViewMode
  }: {
    selectedEdge: SelectedEdge | null; 
    graphData: GraphData | FilteredGraphData;
    filteredGraphData?: GraphData | FilteredGraphData;
    sandboxMode?: boolean;
    sandboxEdited?: boolean;
    onSandboxEdgeEdit?: (
      sourceId: string,
      targetId: string,
      edit: {
        status: string | null;
        assumption?: string;
        description?: string;
        noPolyDescription?: string;
        quasiDescription?: string;
      }
    ) => void;
    onSandboxEdgeReset?: (sourceId: string, targetId: string) => void;
    onSandboxReferenceAdd?: (bibtex: string) => string | null;
    viewMode?: ViewMode;
  } = $props();

  // Use filteredGraphData for the legend if provided, otherwise fall back to graphData
  const legendGraphData = $derived(filteredGraphData ?? graphData);
  
  let referencesSection: HTMLElement | null = $state(null);
  let draftEdgeKey = $state<string | null>(null);
  let draftEdgeStatus = $state('');
  let draftEdgeAssumption = $state('');
  let draftEdgeDescription = $state('');
  let draftNoPolyDescription = $state('');
  let draftQuasiDescription = $state('');
  let statusDropdownOpen = $state(false);
  let statusDropdownRoot: HTMLElement | null = $state(null);

  const relationStatusOptions = [
    'poly',
    'no-poly-unknown-quasi',
    'no-poly-quasi',
    'unknown-poly-quasi',
    'no-quasi'
  ];
  const statusChoices = [null, ...relationStatusOptions] as const;

  $effect(() => {
    const key = selectedEdge ? `${selectedEdge.source}->${selectedEdge.target}` : null;
    if (key !== draftEdgeKey) {
      draftEdgeKey = key;
      draftEdgeStatus = originalEdge?.forward?.status ?? '';
      draftEdgeAssumption = originalEdge?.forward?.assumption ?? '';
      draftEdgeDescription = originalEdge?.forward?.description ?? '';
      draftNoPolyDescription =
        originalEdge?.forward?.noPolyDescription?.description ?? originalEdge?.forward?.description ?? '';
      draftQuasiDescription = originalEdge?.forward?.quasiDescription?.description ?? '';
      statusDropdownOpen = false;
    }
  });

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!statusDropdownOpen || !(target instanceof Node)) return;
      if (!statusDropdownRoot?.contains(target)) {
        statusDropdownOpen = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        statusDropdownOpen = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  });

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

  // Collect all unique references from both directions, including inline citations
  const edgeReferences = $derived.by<KCReference[]>(() => {
    if (!originalEdge) return [];

    const refIds = new Set<string>();
    const refs: KCReference[] = [];

    const collectRefs = (relation: { refs: string[]; description?: string } | null) => {
      if (!relation) return;
      relation.refs.forEach((id) => refIds.add(id));
      
      // Extract citation keys from description
      if (relation.description) {
        extractCitationKeys(relation.description).forEach((key) => refIds.add(key));
      }
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

  function commitSelectedEdgeEdit() {
    if (!selectedEdge || !sandboxMode || !onSandboxEdgeEdit) return;
    onSandboxEdgeEdit(selectedEdge.source, selectedEdge.target, {
      status: draftEdgeStatus || null,
      assumption: draftEdgeAssumption.trim() || undefined,
      description: draftEdgeDescription.trim() || undefined,
      noPolyDescription: draftNoPolyDescription.trim() || undefined,
      quasiDescription: draftQuasiDescription.trim() || undefined
    });
  }

  function commitSelectedEdgeStatus(status: string | null) {
    draftEdgeStatus = status ?? '';
    statusDropdownOpen = false;
    commitSelectedEdgeEdit();
  }

  function commitSelectedEdgeAssumption(assumption: string) {
    draftEdgeAssumption = assumption;
    commitSelectedEdgeEdit();
  }

  function resetSelectedEdgeEdit() {
    if (!selectedEdge || !sandboxMode || !onSandboxEdgeReset) return;
    onSandboxEdgeReset(selectedEdge.source, selectedEdge.target);
  }

  function statusForDisplay(status: string | null) {
    return status || 'unknown-both';
  }

  function displayedDraftStatus(fallback?: string) {
    return statusForDisplay(draftEdgeStatus || fallback || null);
  }

  function derivedLabel(label: string, derived?: boolean) {
    return derived ? `${label} (derived)` : label;
  }

</script>

{#if selectedEdge}
  <div class="content-wrapper">
    <div class="scrollable-content">
      <div class="edge-details">
        <h3 class="text-xl font-bold text-gray-900 mb-4">
          <MathText text={selectedEdge.sourceName} className="inline" />
          <span> &harr; </span>
          <MathText text={selectedEdge.targetName} className="inline" />
        </h3>
        {#if sandboxMode && sandboxEdited}
          <div class="sandbox-editor-actions">
            <button type="button" class="sandbox-cell-reset" onclick={resetSelectedEdgeEdit}>Reset</button>
          </div>
        {/if}
        
        <div class="space-y-4">
{#snippet directionBlock(fromName: string, toName: string, relation: DirectedSuccinctnessRelation, editable = false)}
            <div class="direction-block">
              {#if false}<h5 class="font-semibold text-gray-900 mb-2">
                <MathText text={fromName} className="inline" />
                <span> &rarr; </span>
                <MathText text={toName} className="inline" />
              </h5>{/if}
              {#if sandboxMode && editable}
                <div class="status-control" bind:this={statusDropdownRoot}>
                  <button
                    type="button"
                    class={`succinctness-statement status-trigger ${getStatusCssClass(statusForDisplay(draftEdgeStatus || relation.status))}`}
                    aria-expanded={statusDropdownOpen}
                    onclick={() => statusDropdownOpen = !statusDropdownOpen}
                  >
                    <MathText text={fromName} className="inline" />
                    <span class="compile-arrow">&rarr;</span>
                    <MathText text={toName} className="inline" />
                    <span class="order-statement">
                      (<MathText text={toName} className="inline" />
                      <MathText text={getStatusNotation(statusForDisplay(draftEdgeStatus || relation.status))} className="inline succinctness-notation" />
                      <MathText text={fromName} className="inline" />)
                    </span>
                  </button>
                  {#if statusDropdownOpen}
                    <div class="status-dropdown">
                      {#each statusChoices as status}
                        {@const displayStatus = statusForDisplay(status)}
                        <button
                          type="button"
                          class={`status-option ${getStatusCssClass(displayStatus)}`}
                          onclick={() => commitSelectedEdgeStatus(status)}
                        >
                          <span class="status-option-statement">
                            <MathText text={fromName} className="inline" />
                            <span class="compile-arrow">&rarr;</span>
                            <MathText text={toName} className="inline" />
                            <span class="order-statement">
                              (<MathText text={toName} className="inline" />
                              <MathText text={getStatusNotation(displayStatus)} className="inline succinctness-notation" />
                              <MathText text={fromName} className="inline" />)
                            </span>
                          </span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
                {@const parts = splitStatusLabel(displayedDraftStatus(relation.status))}
                <div class="status-detail">
                  <div class="status-detail-copy">
                    {parts.prefix}{parts.suffix}
                  </div>
                  <AssumptionPicker
                    value={draftEdgeAssumption}
                    {graphData}
                    label={derivedLabel('Assumption', relation.derived)}
                    onCommit={commitSelectedEdgeAssumption}
                  />
                </div>
              {:else}
              <div class={`succinctness-statement ${getStatusCssClass(relation.status)}`}>
                <MathText text={fromName} className="inline" />
                <span class="compile-arrow">&rarr;</span>
                <MathText text={toName} className="inline" />
                <span class="order-statement">
                  (<MathText text={toName} className="inline" />
                  <MathText text={getStatusNotation(relation.status)} className="inline succinctness-notation" />
                  <MathText text={fromName} className="inline" />)
                </span>
              </div>
              {/if}
              {#if !(sandboxMode && editable)}
                {@const parts = splitStatusLabel(relation.status)}
                <h5 class="edge-status-heading">
                  {parts.prefix}{#if relation.assumption}{' '}assuming <MathText text={formatAssumptionForMathText(relation.assumption)} className="inline" />{/if}{parts.suffix}{#if relation.refs.length}{' '}{#each relation.refs as refId}<button 
                      class="ref-badge"
                      onclick={scrollToReferences}
                      title="View reference"
                    >[{getGlobalRefNumber(refId) ?? '?'}]</button>{/each}{/if}
                </h5>
              {/if}
              {#if relation.description && !(sandboxMode && editable)}
                <MathText
                  text={relation.description}
                  className="edge-description-text"
                  wrapMode="hyphenate"
                  lang="en"
                  onCitationClick={handleCitationClick}
                />
              {/if}
              {#if sandboxMode && editable}
                <div class="edge-editor">
                  {#if draftEdgeStatus === 'no-poly-quasi' || relation.status === 'no-poly-quasi'}
                    <label class="editor-label" for="edge-no-poly-description">
                      {derivedLabel('Polynomial Gap', relation.noPolyDescription?.derived ?? relation.derived)}
                    </label>
                    <RichTextEditor
                      value={draftNoPolyDescription}
                      {graphData}
                      placeholderText="Click to edit the polynomial lower-bound description."
                      rows={4}
                      onCommit={(nextValue: string) => {
                        draftNoPolyDescription = nextValue;
                        commitSelectedEdgeEdit();
                      }}
                      onAddReference={onSandboxReferenceAdd}
                    />
                    <label class="editor-label" for="edge-quasi-description">
                      {derivedLabel('Quasipolynomial Compilation', relation.quasiDescription?.derived ?? relation.derived)}
                    </label>
                    <RichTextEditor
                      value={draftQuasiDescription}
                      {graphData}
                      placeholderText="Click to edit the quasipolynomial upper-bound description."
                      rows={4}
                      onCommit={(nextValue: string) => {
                        draftQuasiDescription = nextValue;
                        commitSelectedEdgeEdit();
                      }}
                      onAddReference={onSandboxReferenceAdd}
                    />
                  {:else}
                    <label class="editor-label" for="edge-description">{derivedLabel('Description', relation.derived)}</label>
                    <RichTextEditor
                      value={draftEdgeDescription}
                      {graphData}
                      placeholderText="Click to edit the relation description."
                      rows={4}
                      onCommit={(nextValue: string) => {
                        draftEdgeDescription = nextValue;
                        commitSelectedEdgeEdit();
                      }}
                      onAddReference={onSandboxReferenceAdd}
                    />
                  {/if}
                </div>
              {/if}
            </div>
          {/snippet}

{#snippet unknownDirectionBlock(fromName: string, toName: string)}
            <div class="direction-block">
              {#if sandboxMode}
                <div class="status-control" bind:this={statusDropdownRoot}>
                  <button
                    type="button"
                    class={`succinctness-statement status-trigger ${getStatusCssClass(statusForDisplay(draftEdgeStatus))}`}
                    aria-expanded={statusDropdownOpen}
                    onclick={() => statusDropdownOpen = !statusDropdownOpen}
                  >
                    <MathText text={fromName} className="inline" />
                    <span class="compile-arrow">&rarr;</span>
                    <MathText text={toName} className="inline" />
                    <span class="order-statement">
                      (<MathText text={toName} className="inline" />
                      <MathText text={getStatusNotation(statusForDisplay(draftEdgeStatus))} className="inline succinctness-notation" />
                      <MathText text={fromName} className="inline" />)
                    </span>
                  </button>
                  {#if statusDropdownOpen}
                    <div class="status-dropdown">
                      {#each statusChoices as status}
                        {@const displayStatus = statusForDisplay(status)}
                        <button
                          type="button"
                          class={`status-option ${getStatusCssClass(displayStatus)}`}
                          onclick={() => commitSelectedEdgeStatus(status)}
                        >
                          <span class="status-option-statement">
                            <MathText text={fromName} className="inline" />
                            <span class="compile-arrow">&rarr;</span>
                            <MathText text={toName} className="inline" />
                            <span class="order-statement">
                              (<MathText text={toName} className="inline" />
                              <MathText text={getStatusNotation(displayStatus)} className="inline succinctness-notation" />
                              <MathText text={fromName} className="inline" />)
                            </span>
                          </span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <div class={`succinctness-statement ${getStatusCssClass(statusForDisplay(draftEdgeStatus))}`}>
                  <MathText text={fromName} className="inline" />
                  <span class="compile-arrow">&rarr;</span>
                  <MathText text={toName} className="inline" />
                  <span class="order-statement">
                    (<MathText text={toName} className="inline" />
                    <MathText text={getStatusNotation(statusForDisplay(draftEdgeStatus))} className="inline succinctness-notation" />
                    <MathText text={fromName} className="inline" />)
                  </span>
                </div>
              {/if}
              {#if sandboxMode}
                {@const parts = splitStatusLabel(displayedDraftStatus())}
                <div class="status-detail">
                  <div class="status-detail-copy">
                    {parts.prefix}{parts.suffix}
                  </div>
                  <AssumptionPicker
                    value={draftEdgeAssumption}
                    {graphData}
                    onCommit={commitSelectedEdgeAssumption}
                  />
                </div>
              {/if}
              {#if !sandboxMode}
                <h5 class="edge-status-heading">Unknown</h5>
              {/if}
              {#if !sandboxMode}
                <p class="edge-description-text">No information available.</p>
              {/if}
              {#if sandboxMode}
                <div class="edge-editor">
                  {#if draftEdgeStatus === 'no-poly-quasi'}
                    <label class="editor-label" for="edge-no-poly-description">Polynomial Gap</label>
                    <RichTextEditor
                      value={draftNoPolyDescription}
                      {graphData}
                      placeholderText="Click to edit the polynomial lower-bound description."
                      rows={4}
                      onCommit={(nextValue: string) => {
                        draftNoPolyDescription = nextValue;
                        commitSelectedEdgeEdit();
                      }}
                      onAddReference={onSandboxReferenceAdd}
                    />
                    <label class="editor-label" for="edge-quasi-description">Quasipolynomial Compilation</label>
                    <RichTextEditor
                      value={draftQuasiDescription}
                      {graphData}
                      placeholderText="Click to edit the quasipolynomial upper-bound description."
                      rows={4}
                      onCommit={(nextValue: string) => {
                        draftQuasiDescription = nextValue;
                        commitSelectedEdgeEdit();
                      }}
                      onAddReference={onSandboxReferenceAdd}
                    />
                  {:else}
                    <label class="editor-label" for="edge-description">Description</label>
                    <RichTextEditor
                      value={draftEdgeDescription}
                      {graphData}
                      placeholderText="Click to edit the relation description."
                      rows={4}
                      onCommit={(nextValue: string) => {
                        draftEdgeDescription = nextValue;
                        commitSelectedEdgeEdit();
                      }}
                      onAddReference={onSandboxReferenceAdd}
                    />
                  {/if}
                </div>
              {/if}
            </div>
          {/snippet}

          {#if originalEdge && !originalEdge.forward}
            {@render unknownDirectionBlock(selectedEdge.sourceName, selectedEdge.targetName)}
          {/if}

          {#if originalEdge?.forward}
            {@render directionBlock(selectedEdge.sourceName, selectedEdge.targetName, originalEdge.forward, true)}
          {/if}
          
          {#if originalEdge?.backward}
            {@render directionBlock(selectedEdge.targetName, selectedEdge.sourceName, originalEdge.backward, false)}
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
    position: relative;
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

  .status-control {
    position: relative;
    width: fit-content;
    max-width: 100%;
  }

  .status-trigger {
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
  }

  .status-trigger:hover {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
  }

  .status-dropdown {
    position: absolute;
    z-index: 20;
    display: grid;
    gap: 0.2rem;
    width: min(22rem, calc(100vw - 3rem));
    max-height: 15rem;
    overflow: auto;
    margin-top: 0.25rem;
    border: 1px solid #bfdbfe;
    border-radius: 0.4rem;
    background: white;
    padding: 0.3rem;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
  }

  .status-option {
    display: grid;
    gap: 0.12rem;
    width: 100%;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    padding: 0.32rem 0.4rem;
    text-align: left;
    cursor: pointer;
  }

  .status-option:hover {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
  }

  .status-option-statement {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.8rem;
  }

  .status-detail {
    display: grid;
    gap: 0.35rem;
    margin: -0.1rem 0 0.65rem;
  }

  .status-detail-copy {
    color: #1f2937;
    font-size: 0.88rem;
    font-weight: 700;
    line-height: 1.35;
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

  .edge-editor {
    margin-top: 0.75rem;
    border-top: 1px solid #e2e8f0;
    padding-top: 0.75rem;
  }

  .sandbox-editor-actions {
    display: flex;
    justify-content: flex-end;
    margin: -0.25rem 0 0.55rem;
  }

  .sandbox-cell-reset {
    border: 1px solid #cbd5e1;
    border-radius: 0.35rem;
    background: #fff;
    color: #475569;
    padding: 0.25rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 750;
    cursor: pointer;
  }

  .sandbox-cell-reset:hover,
  .sandbox-cell-reset:focus-visible {
    background: #f1f5f9;
    color: #0f172a;
    outline: 2px solid rgba(37, 99, 235, 0.16);
  }

  .editor-label {
    display: block;
    margin: 0.65rem 0 0.25rem;
    color: #334155;
    font-size: 0.75rem;
    font-weight: 750;
  }

  .sidebar-input,
  .sidebar-textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0.35rem;
    padding: 0.45rem 0.5rem;
    color: #0f172a;
    font-size: 0.88rem;
  }

  .sidebar-textarea {
    min-height: 5.5rem;
    resize: vertical;
    line-height: 1.45;
  }

  .sidebar-input:focus,
  .sidebar-textarea:focus {
    border-color: #2563eb;
    outline: 2px solid rgba(37, 99, 235, 0.16);
  }
</style>
