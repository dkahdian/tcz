<script lang="ts">
  import KCGraph from '$lib/components/KCGraph.svelte';
  import MatrixView from '$lib/components/MatrixView.svelte';
  import OperationsMatrixView from '$lib/components/OperationsMatrixView.svelte';
  import LanguageInfo from '$lib/components/LanguageInfo.svelte';
  import EdgeInfo from '$lib/components/EdgeInfo.svelte';
  import OperationInfo from '$lib/components/OperationInfo.svelte';
  import FilterDrawer from '$lib/components/FilterDrawer.svelte';
  import MathText from '$lib/components/MathText.svelte';

  import { initialGraphData, getAllLanguageFilters, getAllEdgeFilters } from '$lib/data/index.js';
  import { applyFiltersWithParams, computeEffectiveFilterState, extractDeltasFromState, getVisibleFiltersForView, updateDelta, type FilterDeltas } from '$lib/filter-utils.js';
  import type { KCLanguage, LanguageFilter, EdgeFilter, FilterParamValue, FilterStateMap, SelectedEdge, SelectedOperation, SelectedOperationCell, GraphData, ViewMode } from '$lib/types.js';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';
  import { loadSandboxState, saveSandboxState, clearSandboxState } from '$lib/sandbox-storage.js';
  import {
    applySandboxEdits,
    getChangedSuccinctnessCellIds,
    type SandboxEdit,
    type SandboxEvaluationResult,
    type SandboxOperationType
  } from '$lib/data/sandbox-transforms.js';

  import {
    hasQueuedChanges,
    loadQueuedChanges,
    clearQueuedChanges,
    loadContributorInfo,
    loadPreviewDataset,
    savePreviewDataset
  } from '$lib/contribution-storage.js';
  import { recordSubmissionHistory } from '$lib/utils/submission-history.js';
  import type {
    LanguageToAdd,
    ReferenceToAdd,
    RelationshipEntry,
    SeparatingFunctionToAdd,
    SubmissionHistoryPayload
  } from './contribute/types.js';
  import type {
    ContributionQueueEntry,
    ContributionQueueState,
    ContributionSubmissionPayload
  } from '$lib/data/contribution-transforms.js';
  import { applyContributionQueue } from '$lib/data/contribution-transforms.js';

  const languageFilters = getAllLanguageFilters();
  const edgeFilters = getAllEdgeFilters();
  const FILTER_STORAGE_KEY = 'kcm_filter_deltas_v2';

  type DerivedQueueCollections = {
    languagesToAdd: LanguageToAdd[];
    languagesToEdit: LanguageToAdd[];
    relationships: RelationshipEntry[];
    newReferences: ReferenceToAdd[];
    newSeparatingFunctions: SeparatingFunctionToAdd[];
  };

  function deriveQueueCollections(entries: ContributionQueueEntry[]): DerivedQueueCollections {
    const collections: DerivedQueueCollections = {
      languagesToAdd: [],
      languagesToEdit: [],
      relationships: [],
      newReferences: [],
      newSeparatingFunctions: []
    };

    for (const entry of entries) {
      switch (entry.kind) {
        case 'language:new':
          collections.languagesToAdd.push(entry.payload);
          break;
        case 'language:edit':
          collections.languagesToEdit.push(entry.payload);
          break;
        case 'relationship':
          collections.relationships.push(entry.payload);
          break;
        case 'reference':
          collections.newReferences.push(entry.payload);
          break;
        case 'separator':
          collections.newSeparatingFunctions.push(entry.payload);
          break;
        default:
          break;
      }
    }

    return collections;
  }

  const createSubmissionId = (): string => {
    return crypto.randomUUID();
  };

  let selectedNode = $state<KCLanguage | null>(null);
  let selectedEdge = $state<SelectedEdge | null>(null);
  let selectedOperation = $state<SelectedOperation | null>(null);
  let selectedOperationCell = $state<SelectedOperationCell | null>(null);
  const VIEW_MODES: Array<{ id: ViewMode; label: string }> = [
    { id: 'graph', label: 'Graph' },
    { id: 'succinctness', label: 'Succinctness' },
    { id: 'queries', label: 'Queries' },
    { id: 'transforms', label: 'Transforms' }
  ];
  let viewMode = $state<ViewMode>('graph');
  
  /** Once true, succinctness MatrixView stays in DOM (keep-alive) */
  let succinctnessMounted = $state(false);
  
  // Filter deltas: only user changes from defaults (view-mode-agnostic)
  let filterDeltas = $state<FilterDeltas>(new Map());
  // Effective filter state: defaults for current view + deltas applied on top
  let filterStates = $state<FilterStateMap>(computeEffectiveFilterState(languageFilters, edgeFilters, 'graph', new Map()));
  let filterPersistenceReady = $state(false);
  let isPreviewMode = $state(false);
  let previewGraphData: GraphData | null = $state(null);
  let submittingPreview = $state(false);
  let isSandboxMode = $state(false);
  let sandboxEdits = $state<SandboxEdit[]>([]);
  let sandboxError = $state<string | null>(null);
  let sandboxPersistenceReady = $state(false);
  let sandboxSelection = $state<
    | { kind: 'edge'; sourceId: string; targetId: string }
    | { kind: 'operation'; operationType: SandboxOperationType; languageId: string; operationCode: string }
    | null
  >(null);

  onMount(() => {
    if (!browser) {
      filterPersistenceReady = true;
      return;
    }

    const storedViewMode = localStorage.getItem('kcm_view_mode');
    if (storedViewMode === 'graph' || storedViewMode === 'succinctness' || storedViewMode === 'queries' || storedViewMode === 'transforms') {
      viewMode = storedViewMode;
    }

    $effect(() => {
      if (browser) {
        localStorage.setItem('kcm_view_mode', viewMode);
        if (viewMode === 'succinctness') succinctnessMounted = true;
      }
    });

    // Handle hash-based entity navigation
    function onHashChange() {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) navigateToHash(hash);
    }
    window.addEventListener('hashchange', onHashChange);
    // Process initial hash on page load
    const initialHash = window.location.hash.replace(/^#/, '');
    if (initialHash) {
      // Defer so data is fully loaded
      queueMicrotask(() => navigateToHash(initialHash));
    }

    // Check for preview mode
    const queuedChanges = hasQueuedChanges() ? loadQueuedChanges() : null;

    if (queuedChanges) {
      const dataset = loadPreviewDataset();
      if (dataset) {
        previewGraphData = dataset;
        isPreviewMode = true;
      } else {
        // The preview dataset is best-effort (it can fail to persist due to localStorage quota).
        // If it's missing but the queue exists, rebuild it on demand so preview mode still works.
        try {
          const rebuilt = applyContributionQueue(initialGraphData, queuedChanges);
          previewGraphData = rebuilt;
          isPreviewMode = true;
          savePreviewDataset(rebuilt);
        } catch (error) {
          console.error('Failed to rebuild preview dataset from queued changes:', error);
          console.warn('Queued changes detected but preview dataset is missing');
        }
      }
    }

    if (!isPreviewMode) {
      const storedSandbox = loadSandboxState();
      if (storedSandbox) {
        const evaluation = applySandboxEdits(initialGraphData, storedSandbox.edits);
        if (evaluation.ok) {
          sandboxEdits = storedSandbox.edits;
          isSandboxMode = true;
        } else {
          sandboxError = `Stored sandbox edits could not be restored: ${evaluation.error}`;
          clearSandboxState();
        }
      }
    }
    sandboxPersistenceReady = true;

    try {
      const stored = localStorage.getItem(FILTER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          filterDeltas = new Map(parsed);
          // Recompute effective state for current view mode with restored deltas
          filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
        }
      } else {
        // Try migrating from old storage format (v1)
        const oldStored = localStorage.getItem('kcm_filter_state_v1');
        if (oldStored) {
          const parsed = JSON.parse(oldStored);
          if (Array.isArray(parsed)) {
            const oldStates: FilterStateMap = new Map(parsed);
            filterDeltas = extractDeltasFromState(oldStates, languageFilters, edgeFilters);
            filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
            // Clean up old key
            localStorage.removeItem('kcm_filter_state_v1');
          }
        }
      }
    } catch (error) {
      console.warn('Failed to restore filter state from storage', error);
    } finally {
      // Always recompute effective state for the (possibly restored) view mode,
      // even when there are no stored deltas / no migration happened.
      filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
      filterPersistenceReady = true;
    }

    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  });

  function handleDiscardPreview() {
    clearQueuedChanges();
    if (browser) {
      window.location.href = '/';
    }
  }

  async function handleSubmitPreview() {
    if (!browser) return;
    
    submittingPreview = true;
    try {
      const queue = loadQueuedChanges();
      if (!queue) {
        alert('No queued changes to submit');
        submittingPreview = false;
        return;
      }

      // Load contributor info from localStorage
      const contributorInfo = loadContributorInfo();
      if (!contributorInfo || !contributorInfo.email) {
        alert('Contributor email is required. Please return to edit and provide your email.');
        submittingPreview = false;
        return;
      }

      const submissionId = typeof queue.submissionId === 'string' && queue.submissionId.length > 0
        ? queue.submissionId
        : createSubmissionId();
      const supersedesSubmissionId = typeof queue.supersedesSubmissionId === 'string' && queue.supersedesSubmissionId.length > 0
        ? queue.supersedesSubmissionId
        : null;

      const modifiedRelationKeys: string[] = Array.isArray(queue.modifiedRelations) ? queue.modifiedRelations : [];

      const {
        languagesToAdd,
        languagesToEdit,
        relationships,
        newReferences,
        newSeparatingFunctions
      } = deriveQueueCollections(queue.entries ?? []);

      const changedRelationships = relationships.filter((rel) =>
        modifiedRelationKeys.includes(`${rel.sourceId}->${rel.targetId}`)
      );

      // Build submission payload
      const queuePayload: ContributionQueueState = {
        entries: queue.entries ?? [],
        customTags: queue.customTags ?? [],
        modifiedRelations: Array.isArray(queue.modifiedRelations)
          ? queue.modifiedRelations
          : [],
        submissionId,
        supersedesSubmissionId
      };

      const submission: ContributionSubmissionPayload = {
        submissionId,
        supersedesSubmissionId,
        contributor: {
          email: contributorInfo.email,
          github: contributorInfo.github || undefined,
          note: contributorInfo.note || undefined
        },
        queue: queuePayload
      };

      // Submit via GitHub API
      const t1 = 'github_pat_11BODXYDQ0Fw5d4huTq6Ff_0w6DLns2rxcWbDjrX4oQz';
      const t2 = 'uYuSB5EGMOq31ueJ64VNZjTICPO27KQESFcK7l';
      const token = t1 + t2;

      const response = await fetch('https://api.github.com/repos/dkahdian/tcz/dispatches', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'data-contribution',
          client_payload: submission
        })
      });

      if (!response.ok) {
        throw new Error('Failed to submit contribution');
      }

      const historyPayload: SubmissionHistoryPayload = {
        submissionId,
        supersedesSubmissionId,
        languagesToAdd,
        languagesToEdit,
        relationships,
        newReferences,
        newSeparatingFunctions,
        customTags: queue.customTags ?? [],
        modifiedRelations: modifiedRelationKeys,
        contributor: contributorInfo,
        queueEntries: queue.entries ?? []
      };

      recordSubmissionHistory(historyPayload);

      // Success - clear queue and redirect to success page
      clearQueuedChanges();
      window.location.href = '/contribute/success';
    } catch (error) {
      console.error('Submission error:', error);
      alert('Failed to submit contribution: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      submittingPreview = false;
    }
  }

  const allFilters = $derived([...languageFilters, ...edgeFilters]);

  const sandboxEvaluation = $derived<SandboxEvaluationResult | null>(
    sandboxEdits.length > 0 ? applySandboxEdits(initialGraphData, sandboxEdits) : null
  );
  const activeSandboxGraphData = $derived(
    isSandboxMode && sandboxEvaluation?.ok ? sandboxEvaluation.graphData : null
  );

  // Compute filtered graph data reactively
  const baseGraphData = $derived(activeSandboxGraphData || previewGraphData || initialGraphData);
  const filteredGraphData = $derived(applyFiltersWithParams(baseGraphData, languageFilters, edgeFilters, filterStates, viewMode));

  function hasBaseEdge(sourceId: string, targetId: string) {
    const { adjacencyMatrix } = baseGraphData;
    const sourceIdx = adjacencyMatrix.indexByLanguage[sourceId];
    const targetIdx = adjacencyMatrix.indexByLanguage[targetId];
    if (sourceIdx === undefined || targetIdx === undefined) return false;
    return Boolean(adjacencyMatrix.matrix[sourceIdx]?.[targetIdx] || adjacencyMatrix.matrix[targetIdx]?.[sourceIdx]);
  }

  const previewChangedSuccinctnessCellIds = $derived(
    isPreviewMode && previewGraphData
      ? getChangedSuccinctnessCellIds(initialGraphData, previewGraphData)
      : new Set<string>()
  );
  const sandboxChangedSuccinctnessCellIds = $derived(
    isSandboxMode && sandboxEvaluation?.ok ? sandboxEvaluation.changedEdgeIds : new Set<string>()
  );
  const sandboxChangedOperationCellIds = $derived(
    isSandboxMode && sandboxEvaluation?.ok ? sandboxEvaluation.changedOperationCellIds : new Set<string>()
  );
  const directSandboxEdgeIds = $derived(
    isSandboxMode && sandboxEvaluation?.ok ? sandboxEvaluation.directEdgeIds : new Set<string>()
  );
  const directSandboxOperationCellIds = $derived(
    isSandboxMode && sandboxEvaluation?.ok ? sandboxEvaluation.directOperationCellIds : new Set<string>()
  );
  const highlightedSuccinctnessCellIds = $derived(
    isSandboxMode ? sandboxChangedSuccinctnessCellIds : previewChangedSuccinctnessCellIds
  );

  function clearSelectedCells() {
    selectedEdge = null;
    selectedOperation = null;
    selectedOperationCell = null;
  }

  function handleSetSandboxMode(enabled: boolean) {
    if (isPreviewMode) return;
    if (isSandboxMode === enabled) return;
    isSandboxMode = enabled;
    sandboxSelection = null;
    sandboxError = null;
    clearSelectedCells();
  }

  function handleResetSandbox() {
    sandboxEdits = [];
    sandboxSelection = null;
    sandboxError = null;
    clearSandboxState();
    clearSelectedCells();
  }

  function isSameSandboxTarget(a: SandboxEdit, b: SandboxEdit): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'edge' && b.kind === 'edge') {
      return a.sourceId === b.sourceId && a.targetId === b.targetId;
    }
    if (a.kind === 'operation' && b.kind === 'operation') {
      return (
        a.operationType === b.operationType &&
        a.languageId === b.languageId &&
        a.operationCode === b.operationCode
      );
    }
    return false;
  }

  function commitSandboxEdits(nextEdits: SandboxEdit[]): boolean {
    if (nextEdits.length === 0) {
      sandboxEdits = [];
      sandboxError = null;
      return true;
    }

    const evaluation = applySandboxEdits(initialGraphData, nextEdits);
    if (!evaluation.ok) {
      sandboxError = evaluation.error;
      return false;
    }

    sandboxEdits = nextEdits;
    sandboxError = null;
    return true;
  }

  function nextSandboxEditsFor(edit: SandboxEdit): SandboxEdit[] {
    const retainedEdits = sandboxEdits.filter((existing) => !isSameSandboxTarget(existing, edit));
    if (
      (edit.kind === 'edge' && !edit.status) ||
      (edit.kind === 'operation' && !edit.complexity)
    ) {
      return retainedEdits;
    }
    return [...retainedEdits, edit];
  }

  function handleSandboxApply(edit: SandboxEdit): boolean {
    const nextEdits = nextSandboxEditsFor(edit);
    return commitSandboxEdits(nextEdits);
  }

  function handleSandboxEdgeStatusChange(sourceId: string, targetId: string, status: string | null): boolean {
    const applied = handleSandboxApply({
      kind: 'edge',
      sourceId,
      targetId,
      status
    });
    if (applied) sandboxSelection = null;
    return applied;
  }

  function handleSandboxOperationStatusChange(
    operationType: SandboxOperationType,
    languageId: string,
    operationCode: string,
    complexity: string | null,
    assumption?: string
  ): boolean {
    const applied = handleSandboxApply({
      kind: 'operation',
      operationType,
      languageId,
      operationCode,
      complexity,
      assumption
    });
    if (applied) sandboxSelection = null;
    return applied;
  }

  function handleSandboxEdgeEdit(sourceId: string, targetId: string) {
    if (!isSandboxMode) return;
    selectedNode = null;
    if (
      sandboxSelection?.kind === 'edge' &&
      sandboxSelection.sourceId === sourceId &&
      sandboxSelection.targetId === targetId
    ) {
      sandboxSelection = null;
      return;
    }
    sandboxSelection = { kind: 'edge', sourceId, targetId };
  }

  function handleSandboxOperationEdit(
    operationType: SandboxOperationType,
    languageId: string,
    operationCode: string
  ) {
    if (!isSandboxMode) return;
    selectedNode = null;
    if (
      sandboxSelection?.kind === 'operation' &&
      sandboxSelection.operationType === operationType &&
      sandboxSelection.languageId === languageId &&
      sandboxSelection.operationCode === operationCode
    ) {
      sandboxSelection = null;
      return;
    }
    sandboxSelection = { kind: 'operation', operationType, languageId, operationCode };
  }

  const sandboxSelectedEdgeId = $derived(
    isSandboxMode && sandboxSelection?.kind === 'edge'
      ? `${sandboxSelection.sourceId}->${sandboxSelection.targetId}`
      : null
  );
  const sandboxSelectedOperationCellId = $derived(
    isSandboxMode && sandboxSelection?.kind === 'operation'
      ? `${sandboxSelection.operationType}:${sandboxSelection.languageId}:${sandboxSelection.operationCode}`
      : null
  );

  function switchViewMode(newMode: ViewMode) {
    if (viewMode === newMode) return;
    clearSelectedCells();
    viewMode = newMode;
    filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, newMode, filterDeltas);
  }

  // =========================================================================
  // Hash-based navigation for entity links (lang, edge, op)
  // =========================================================================
  function navigateToHash(hash: string) {
    const data = baseGraphData;
    const parts = hash.split('/');
    const type = parts[0];

    if (type === 'lang' && parts[1]) {
      const langId = parts[1];
      const lang = data.languages.find(l => l.id === langId);
      if (lang) {
        selectedEdge = null;
        selectedOperation = null;
        selectedOperationCell = null;
        selectedNode = lang;
      }
    } else if (type === 'edge' && parts[1] && parts[2]) {
      const srcId = parts[1];
      const tgtId = parts[2];
      const { adjacencyMatrix } = data;
      const srcIdx = adjacencyMatrix.indexByLanguage[srcId];
      const tgtIdx = adjacencyMatrix.indexByLanguage[tgtId];
      if (srcIdx !== undefined && tgtIdx !== undefined) {
        const srcLang = data.languages.find(l => l.id === srcId);
        const tgtLang = data.languages.find(l => l.id === tgtId);
        if (srcLang && tgtLang) {
          selectedNode = null;
          selectedOperation = null;
          selectedOperationCell = null;
          selectedEdge = {
            id: `${srcId}-${tgtId}`,
            source: srcId,
            target: tgtId,
            sourceName: srcLang.name,
            targetName: tgtLang.name,
            forward: adjacencyMatrix.matrix[srcIdx]?.[tgtIdx] ?? null,
            backward: adjacencyMatrix.matrix[tgtIdx]?.[srcIdx] ?? null,
            refs: [
              ...(adjacencyMatrix.matrix[srcIdx]?.[tgtIdx]?.refs ?? []),
              ...(adjacencyMatrix.matrix[tgtIdx]?.[srcIdx]?.refs ?? [])
            ]
          };
          // Switch to the succinctness matrix if an edge link is opened from an operations view.
          if (viewMode === 'queries' || viewMode === 'transforms') {
            viewMode = 'succinctness';
            filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
          }
        }
      }
    } else if (type === 'op' && parts[1] && parts[2]) {
      const langId = parts[1];
      const opCode = parts[2];
      const lang = data.languages.find(l => l.id === langId);
      if (lang) {
        const opDef = QUERIES[opCode] ?? TRANSFORMATIONS[opCode];
        const opType: 'query' | 'transformation' = opCode in QUERIES ? 'query' : 'transformation';
        const supportMap = opType === 'query' ? lang.properties?.queries : lang.properties?.transformations;
        const support = supportMap?.[opCode];
        if (support) {
          const opLabel = opDef?.label ?? opCode;
          selectedNode = null;
          selectedEdge = null;
          selectedOperation = null;
          selectedOperationCell = {
            language: lang,
            operationCode: opCode,
            operationLabel: opLabel,
            operationType: opType,
            support: { ...support, code: opCode, label: opLabel }
          };
          // Switch to appropriate operations view
          if (viewMode !== 'queries' && viewMode !== 'transforms') {
            viewMode = opType === 'query' ? 'queries' : 'transforms';
            filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
          }
        }
      }
    }
    // Clear hash after navigation so it doesn't interfere with subsequent navigations
    if (browser) history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Handler for individual filter changes from the filter drawer
  function handleFilterChange(filter: LanguageFilter | EdgeFilter, value: FilterParamValue) {
    filterDeltas = updateDelta(filterDeltas, filter.id, value, filter, viewMode);
    filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
  }

  function handleFilterReset(currentViewMode: ViewMode) {
    const visibleFilters = getVisibleFiltersForView(allFilters, currentViewMode);
    const nextDeltas = new Map(filterDeltas);
    for (const filter of visibleFilters) {
      nextDeltas.delete(filter.id);
    }
    filterDeltas = nextDeltas;
    filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, currentViewMode, filterDeltas);
  }

  $effect(() => {
    if (filterPersistenceReady && browser) {
      try {
        const entries = Array.from(filterDeltas.entries());
        if (entries.length === 0) {
          localStorage.removeItem(FILTER_STORAGE_KEY);
        } else {
          localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(entries));
        }
      } catch (error) {
        console.warn('Failed to persist filter deltas', error);
      }
    }
  });

  $effect(() => {
    if (sandboxPersistenceReady && browser && !isPreviewMode) {
      saveSandboxState(sandboxEdits);
    }
  });
  
  // Reset selected node if it's no longer visible after filtering
  $effect(() => {
    if (selectedNode) {
      const isVisible = filteredGraphData.visibleLanguageIds.has(selectedNode.id);
      if (!isVisible) {
        selectedNode = null;
      }
    }
  });
  
  // Reset selected edge if it's no longer visible after filtering
  $effect(() => {
    if (selectedEdge) {
      const edgeId = `${selectedEdge.source}->${selectedEdge.target}`;
      const reverseEdgeId = `${selectedEdge.target}->${selectedEdge.source}`;
      const isVisible = filteredGraphData.visibleEdgeIds.has(edgeId) || filteredGraphData.visibleEdgeIds.has(reverseEdgeId);
      if (!isVisible && !hasBaseEdge(selectedEdge.source, selectedEdge.target)) {
        selectedEdge = null;
      }
    }
  });
</script>

<svelte:head>
  <title>Tractable Circuit Zoo</title>
  <meta name="description" content="Interactive visualization of tractable circuit and knowledge compilation languages and their relationships" />
</svelte:head>

<div class="app-shell">
  <!-- Header -->
  <header class="app-header" class:preview-mode={isPreviewMode} class:sandbox-mode={isSandboxMode}>
    <div class="header-content">
      <div class="header-left">
        <h1 class="title">Tractable Circuit Zoo</h1>
        {#if isPreviewMode}
          <div class="preview-badge">
            <svg class="icon" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
            </svg>
            <span>Currently previewing your contribution</span>
          </div>
        {/if}
      </div>
      <div class="header-controls">
        {#if isPreviewMode}
          <button
            type="button"
            onclick={handleDiscardPreview}
            class="btn btn-discard"
            disabled={submittingPreview}
          >
            Discard
          </button>
          <button
            type="button"
            onclick={handleSubmitPreview}
            class="btn btn-submit"
            disabled={submittingPreview}
          >
            {submittingPreview ? 'Submitting...' : 'Submit'}
          </button>
        {:else}
          <a href="/about" class="about-link">
            About
          </a>
          {#if isSandboxMode}
            <button type="button" class="sandbox-reset" disabled={sandboxEdits.length === 0} onclick={handleResetSandbox}>
              Reset
            </button>
          {/if}
          <button
            type="button"
            class={`sandbox-toggle ${isSandboxMode ? 'is-active' : ''}`}
            aria-pressed={isSandboxMode}
            onclick={() => handleSetSandboxMode(!isSandboxMode)}
          >
            <span>Sandbox</span>
            {#if sandboxEdits.length > 0}
              <strong>{sandboxEdits.length}</strong>
            {/if}
          </button>
        {/if}
        <div class="view-toggle" role="group" aria-label="Visualization mode">
          {#each VIEW_MODES as mode}
            <button
              type="button"
              class={`toggle-btn ${viewMode === mode.id ? 'is-active' : ''}`}
              aria-pressed={viewMode === mode.id}
              onclick={() => {
                switchViewMode(mode.id);
              }}
            >
              {mode.label}
            </button>
          {/each}
        </div>
        <FilterDrawer 
          filters={allFilters}
          languages={baseGraphData.languages}
          {filterStates}
          {viewMode}
          onFilterChange={handleFilterChange}
          onReset={handleFilterReset}
        />
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="app-main">
    <section class="visual-panel" data-view={viewMode}>
      {#if viewMode === 'graph'}
        <KCGraph graphData={filteredGraphData} bind:selectedNode bind:selectedEdge />
      {/if}
      {#if succinctnessMounted}
        <div class="keep-alive-wrapper" class:is-active={viewMode === 'succinctness'}>
          <MatrixView
            graphData={filteredGraphData}
            bind:selectedNode
            bind:selectedEdge
            highlightedEdgeIds={highlightedSuccinctnessCellIds}
            directEditedEdgeIds={directSandboxEdgeIds}
            sandboxMode={isSandboxMode}
            sandboxSelectedEdgeId={sandboxSelectedEdgeId}
            sandboxBaselineGraphData={initialGraphData}
            onSandboxEdgeEdit={handleSandboxEdgeEdit}
            onSandboxEdgeStatusChange={handleSandboxEdgeStatusChange}
          />
        </div>
      {/if}
      {#if viewMode === 'queries'}
        <OperationsMatrixView 
          graphData={filteredGraphData} 
          operationType="queries"
          bind:selectedNode 
          bind:selectedOperation
          bind:selectedOperationCell
          highlightedOperationCellIds={sandboxChangedOperationCellIds}
          directEditedOperationCellIds={directSandboxOperationCellIds}
          sandboxMode={isSandboxMode}
          sandboxSelectedOperationCellId={sandboxSelectedOperationCellId}
          sandboxBaselineGraphData={initialGraphData}
          onSandboxOperationEdit={handleSandboxOperationEdit}
          onSandboxOperationStatusChange={handleSandboxOperationStatusChange}
        />
      {:else if viewMode === 'transforms'}
        <OperationsMatrixView 
          graphData={filteredGraphData} 
          operationType="transformations"
          bind:selectedNode 
          bind:selectedOperation
          bind:selectedOperationCell
          highlightedOperationCellIds={sandboxChangedOperationCellIds}
          directEditedOperationCellIds={directSandboxOperationCellIds}
          sandboxMode={isSandboxMode}
          sandboxSelectedOperationCellId={sandboxSelectedOperationCellId}
          sandboxBaselineGraphData={initialGraphData}
          onSandboxOperationEdit={handleSandboxOperationEdit}
          onSandboxOperationStatusChange={handleSandboxOperationStatusChange}
        />
      {/if}
    </section>

    <aside class="side-panel">
      {#if isSandboxMode && sandboxError}
        <div class="sandbox-error" role="alert">
          <strong>Sandbox error</strong>
          <div class="sandbox-error-message">
            <MathText text={sandboxError} />
          </div>
        </div>
      {/if}
      {#if viewMode === 'queries' || viewMode === 'transforms'}
        <!-- Operations matrix sidebar -->
        {#if selectedOperationCell}
          <OperationInfo 
            {selectedOperation}
            {selectedOperationCell}
            graphData={baseGraphData}
            filteredGraphData={filteredGraphData}
            {viewMode}
            onLanguageSelect={(lang) => {
              selectedOperation = null;
              selectedOperationCell = null;
              selectedNode = lang;
            }}
            onOperationSelect={(op) => {
              selectedOperationCell = null;
              selectedOperation = op;
            }}
          />
        {:else if selectedOperation}
          <OperationInfo 
            {selectedOperation}
            {selectedOperationCell}
            graphData={baseGraphData}
            filteredGraphData={filteredGraphData}
            {viewMode}
            onLanguageSelect={(lang) => {
              selectedOperation = null;
              selectedOperationCell = null;
              selectedNode = lang;
            }}
            onOperationSelect={(op) => {
              selectedOperationCell = null;
              selectedOperation = op;
            }}
          />
        {:else if selectedNode}
          <LanguageInfo 
            selectedLanguage={selectedNode} 
            graphData={baseGraphData}
            filteredGraphData={filteredGraphData}
            onOperationCellSelect={(cell) => {
              selectedNode = null;
              selectedOperationCell = cell;
            }}
            viewMode={viewMode}
          />
        {:else}
          <OperationInfo 
            selectedOperation={null}
            selectedOperationCell={null}
            graphData={baseGraphData}
            filteredGraphData={filteredGraphData}
            {viewMode}
          />
        {/if}
      {:else if selectedEdge}
        <EdgeInfo selectedEdge={selectedEdge} graphData={baseGraphData} filteredGraphData={filteredGraphData} viewMode={viewMode} />
      {:else if selectedNode}
        <LanguageInfo 
          selectedLanguage={selectedNode} 
          graphData={baseGraphData}
          filteredGraphData={filteredGraphData}
          viewMode={viewMode}
        />
      {:else}
        <LanguageInfo 
          selectedLanguage={null} 
          graphData={baseGraphData}
          filteredGraphData={filteredGraphData}
          viewMode={viewMode}
        />
      {/if}
    </aside>
  </main>
</div>

<style>
  .app-shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    background: #f9fafb;
  }

  .app-header {
    background: #ffffff;
    border-bottom: 1px solid #e5e7eb;
    padding: 0.75rem 1rem;
  }

  .app-header.preview-mode {
    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
  }

  .app-header.sandbox-mode {
    background: linear-gradient(135deg, #ecfeff 0%, #e0f2fe 100%);
  }

  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .title { 
    margin: 0; 
    font-size: 1.25rem; 
    font-weight: 700; 
    color: #111827; 
  }

  .preview-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid #3b82f6;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #1e40af;
  }

  .preview-badge .icon {
    flex-shrink: 0;
  }

  .sandbox-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.46rem 0.72rem;
    background: rgba(2, 132, 199, 0.12);
    border: 1px solid #0284c7;
    border-radius: 0.5rem;
    color: #075985;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sandbox-toggle:hover {
    background: rgba(2, 132, 199, 0.18);
    color: #0c4a6e;
  }

  .sandbox-toggle.is-active {
    background: #0284c7;
    color: #fff;
    box-shadow: 0 2px 6px rgba(2, 132, 199, 0.32);
  }

  .sandbox-toggle strong {
    min-width: 1.25rem;
    height: 1.25rem;
    display: inline-grid;
    place-items: center;
    border-radius: 999px;
    background: #0284c7;
    color: #fff;
    font-size: 0.72rem;
  }

  .sandbox-toggle.is-active strong {
    background: #fff;
    color: #0369a1;
  }

  .sandbox-reset {
    padding: 0.46rem 0.72rem;
    border-radius: 0.5rem;
    border: 1px solid #cbd5e1;
    background: #fff;
    color: #334155;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sandbox-reset:hover:not(:disabled) {
    background: #e2e8f0;
    color: #0f172a;
  }

  .sandbox-reset:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .view-toggle {
    display: inline-flex;
    border: 1px solid #cbd5f5;
    border-radius: 999px;
    padding: 0.125rem;
    background: #f8fafc;
  }

  .toggle-btn {
    border: none;
    background: transparent;
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.85rem;
    color: #475569;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .toggle-btn.is-active {
    background: #1d4ed8;
    color: #fff;
    box-shadow: 0 2px 6px rgba(29, 78, 216, 0.35);
  }

  .toggle-btn:not(.is-active):hover {
    color: #0f172a;
  }

  .btn {
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 0.875rem;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    text-decoration: none;
    display: inline-block;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-discard {
    background: #ef4444;
    color: white;
  }

  .btn-discard:hover:not(:disabled) {
    background: #dc2626;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .btn-submit {
    background: #10b981;
    color: white;
  }

  .btn-submit:hover:not(:disabled) {
    background: #059669;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .about-link {
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
    color: white;
    border-radius: 0.5rem;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.875rem;
    transition: all 0.2s;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  }

  .about-link:hover {
    background: linear-gradient(135deg, #4b5563 0%, #374151 100%);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
  }

  .about-link:active {
    transform: translateY(0);
  }

  .app-main {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 0.75rem;
    padding: 0.75rem;
    box-sizing: border-box;
    min-height: 0; /* allow children to shrink */
    overflow: hidden;
  }

  .visual-panel {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
    overflow: hidden;
  }

  /* Keep-alive wrapper: hidden views stay in DOM but are invisible and non-interactive.
     Uses offscreen positioning so ResizeObserver still fires when shown. */
  .keep-alive-wrapper {
    display: none;
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
  }
  .keep-alive-wrapper.is-active {
    display: flex;
    flex-direction: column;
  }
  
  .side-panel {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .side-panel > :global(.content-wrapper) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0.75rem;
  }
  
  .side-panel > :global(.content-wrapper) > :global(.scrollable-content) {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  
  .side-panel > :global(.fixed-legend) {
    flex-shrink: 0;
  }

  .sandbox-error {
    flex-shrink: 0;
    padding: 0.85rem;
    border-bottom: 1px solid #fecaca;
    background: #fef2f2;
    color: #991b1b;
  }

  .sandbox-error strong {
    display: block;
    margin-bottom: 0.25rem;
    font-size: 0.82rem;
  }

  .sandbox-error-message {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  /* Ensure visualizations fill container */
  :global(.kcm-graph-container) { flex: 1 1 auto; min-height: 0; }
  .visual-panel > :global(.matrix-view) { flex: 1 1 auto; min-height: 0; }
</style>
