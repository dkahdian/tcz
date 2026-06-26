<script lang="ts">
  import MathText from './MathText.svelte';
  import RichTextEditor from './RichTextEditor.svelte';
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
    onSandboxLanguageEdit,
    onSandboxLanguageReset,
    onSandboxReferenceAdd,
    sandboxMode = false,
    sandboxEdited = false,
    viewMode = 'graph' as ViewMode
  }: {
    selectedLanguage: KCLanguage | null;
    graphData: GraphData | FilteredGraphData;
    filteredGraphData?: GraphData | FilteredGraphData;
    onOperationCellSelect?: (cell: SelectedOperationCell) => void;
    onSandboxLanguageEdit?: (languageId: string, fields: { fullName?: string; definition?: string }) => void;
    onSandboxLanguageReset?: (languageId: string) => void;
    onSandboxReferenceAdd?: (bibtex: string) => string | null;
    sandboxMode?: boolean;
    sandboxEdited?: boolean;
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
  let draftLanguageId = $state<string | null>(null);
  let draftFullName = $state('');
  let draftDefinition = $state('');

  $effect(() => {
    if (selectedLanguage?.id !== draftLanguageId) {
      draftLanguageId = selectedLanguage?.id ?? null;
      draftFullName = selectedLanguage?.fullName ?? '';
      draftDefinition = selectedLanguage?.definition ?? '';
    }
  });

  // Collect references from inline citations and operation support.
  const allReferences = $derived.by<KCReference[]>(() => {
    if (!selectedLanguage) return [];

    const refIds = new Set<string>();

    if (selectedLanguage.definition) {
      extractCitationKeys(selectedLanguage.definition).forEach(key => refIds.add(key));
    }

    if (resolvedProperties) {
      for (const q of resolvedProperties.queries) {
        q.refs?.forEach(key => refIds.add(key));
        if (q.description) {
          extractCitationKeys(q.description).forEach(key => refIds.add(key));
        }
        if (q.assumption) {
          extractCitationKeys(q.assumption).forEach(key => refIds.add(key));
        }
      }
      for (const t of resolvedProperties.transformations) {
        t.refs?.forEach(key => refIds.add(key));
        if (t.description) {
          extractCitationKeys(t.description).forEach(key => refIds.add(key));
        }
        if (t.assumption) {
          extractCitationKeys(t.assumption).forEach(key => refIds.add(key));
        }
      }
    }

    const globalRefMap = new Map(graphData.references.map(ref => [ref.id, ref]));
    const refs: KCReference[] = [];
    const addedIds = new Set<string>();

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

  function flushLanguageMetadata() {
    if (!selectedLanguage || !sandboxMode || !onSandboxLanguageEdit) return;
    const fields: { fullName?: string; definition?: string } = {};
    if (draftFullName !== selectedLanguage.fullName) fields.fullName = draftFullName;
    if (draftDefinition !== selectedLanguage.definition) fields.definition = draftDefinition;
    if (Object.keys(fields).length > 0) {
      onSandboxLanguageEdit(selectedLanguage.id, fields);
    }
  }

  function resetLanguageEdit() {
    if (!selectedLanguage || !sandboxMode || !onSandboxLanguageReset) return;
    onSandboxLanguageReset(selectedLanguage.id);
  }
</script>

<div class="content-wrapper">
  <div class="scrollable-content">
    {#if selectedLanguage}
      <div class="language-details">
        <MathText as="h3" className="text-xl font-bold text-gray-900 mb-2" text={selectedLanguage.name} />
        {#if sandboxMode && sandboxEdited}
          <div class="sandbox-editor-actions">
            <button type="button" class="sandbox-cell-reset" onclick={resetLanguageEdit}>Reset</button>
          </div>
        {/if}
        {#if sandboxMode}
          <label class="editor-label" for="language-full-name">Full Name</label>
          <input
            id="language-full-name"
            class="sidebar-input"
            bind:value={draftFullName}
            onblur={flushLanguageMetadata}
          />
        {:else}
          <MathText as="h4" className="text-sm text-gray-600 mb-4" text={selectedLanguage.fullName} />
        {/if}
        
        {#if sandboxMode}
          <label class="editor-label" for="language-definition">Definition</label>
          <RichTextEditor
            value={draftDefinition}
            {graphData}
            currentLanguage={selectedLanguage}
            placeholderText="Click to edit the definition."
            rows={5}
            onCommit={(nextValue: string) => {
              draftDefinition = nextValue;
              flushLanguageMetadata();
            }}
            onAddReference={onSandboxReferenceAdd}
          />
        {:else}
          <p class="text-gray-700 mb-6">
            <MathText
              text={selectedLanguage.definition}
              className="inline"
              onCitationClick={handleCitationClick}
            />
          </p>
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
                  class:op-row--clickable={Boolean(onOperationCellSelect)}
                  onclick={() => selectOperationCell(op, opType)}
                  disabled={!onOperationCellSelect}
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
      margin: 0.8rem 0 0.25rem;
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
      min-height: 7rem;
      resize: vertical;
      line-height: 1.45;
      margin-bottom: 1rem;
    }

    .sidebar-input:focus,
    .sidebar-textarea:focus {
      border-color: #2563eb;
      outline: 2px solid rgba(37, 99, 235, 0.16);
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
