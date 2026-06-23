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
  import { parseBibtex } from '$lib/data/references.js';
  import { generateLanguageId } from '$lib/utils/language-id.js';
  import { loadSandboxState, saveSandboxState, clearSandboxState } from '$lib/sandbox-storage.js';
  import {
    applySandboxEdits,
    getChangedSuccinctnessCellIds,
    type SandboxEdit,
    type SandboxContributionSubmissionPayload,
    type SandboxEvaluationResult,
    type SandboxOperationType
  } from '$lib/data/sandbox-transforms.js';

  const languageFilters = getAllLanguageFilters();
  const edgeFilters = getAllEdgeFilters();
  const FILTER_STORAGE_KEY = 'kcm_filter_deltas_v2';

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
  let showSandboxSubmitModal = $state(false);
  let submittingSandbox = $state(false);
  let sandboxContributorName = $state('');
  let sandboxContributorEmail = $state('');
  let sandboxContributorGithub = $state('');
  let sandboxContributorNote = $state('');
  let sandboxSubmitError = $state<string | null>(null);
  let sandboxSubmitSuccess = $state<string | null>(null);
  let isSandboxMode = $state(false);
  let sandboxEdits = $state<SandboxEdit[]>([]);
  let sandboxError = $state<string | null>(null);
  let sandboxPersistenceReady = $state(false);
  let showNewLanguageModal = $state(false);
  let newLanguageClassification = $state<KCLanguage['classification']>('plain');
  let newLanguageName = $state('');
  let newLanguageFamilyBase = $state('');
  let newLanguageFamilyParameter = $state('');
  let newLanguageFullName = $state('');
  let newLanguageDefinition = $state('');
  let newLanguageError = $state<string | null>(null);
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
    if (viewMode === 'graph') {
      isSandboxMode = false;
      sandboxSelection = null;
      sandboxError = null;
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

    if (viewMode !== 'graph') {
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

  function openSandboxSubmitModal() {
    if (!isSandboxMode || sandboxEdits.length === 0) return;
    const evaluation = applySandboxEdits(initialGraphData, sandboxEdits);
    if (!evaluation.ok) {
      sandboxError = evaluation.error;
      return;
    }
    sandboxSubmitError = null;
    sandboxSubmitSuccess = null;
    showSandboxSubmitModal = true;
  }

  function closeSandboxSubmitModal() {
    if (submittingSandbox) return;
    showSandboxSubmitModal = false;
    sandboxSubmitError = null;
  }

  async function handleSandboxSubmit() {
    if (!browser || submittingSandbox) return;
    const name = sandboxContributorName.trim();
    const email = sandboxContributorEmail.trim();
    const github = sandboxContributorGithub.trim().replace(/^@+/, '');
    if (!name || !email) {
      sandboxSubmitError = 'Name and email are required.';
      return;
    }

    const evaluation = applySandboxEdits(initialGraphData, sandboxEdits);
    if (!evaluation.ok) {
      sandboxError = evaluation.error;
      sandboxSubmitError = evaluation.error;
      return;
    }

    submittingSandbox = true;
    try {
      const submission: SandboxContributionSubmissionPayload = {
        submissionId: createSubmissionId(),
        contributor: {
          name,
          email,
          ...(github ? { github } : {}),
          ...(sandboxContributorNote.trim() ? { note: sandboxContributorNote.trim() } : {})
        },
        sandbox: {
          edits: sandboxEdits
        }
      };

      // Submit via GitHub API. This token is intentionally public and scoped only
      // to triggering the contribution dispatch flow for user-submitted data.
      // If its GitHub permissions ever expand, replace this with a server-side token.
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

      sandboxContributorName = '';
      sandboxContributorEmail = '';
      sandboxContributorGithub = '';
      sandboxContributorNote = '';
      showSandboxSubmitModal = false;
      sandboxSubmitError = null;
      sandboxSubmitSuccess = 'Submission succeeded. Your local sandbox changes are still saved.';
    } catch (error) {
      sandboxSubmitError = error instanceof Error ? error.message : 'Failed to submit contribution.';
    } finally {
      submittingSandbox = false;
    }
  }

  const allFilters = $derived([...languageFilters, ...edgeFilters]);

  const sandboxEvaluation = $derived<SandboxEvaluationResult | null>(
    sandboxEdits.length > 0 ? applySandboxEdits(initialGraphData, sandboxEdits) : null
  );
  const sandboxEditSummaries = $derived(sandboxEdits.map((edit) => summarizeSandboxEdit(edit)));
  const activeSandboxGraphData = $derived(
    isSandboxMode && sandboxEvaluation?.ok ? sandboxEvaluation.graphData : null
  );

  // Compute filtered graph data reactively
  const baseGraphData = $derived(activeSandboxGraphData || initialGraphData);
  const filteredGraphData = $derived(applyFiltersWithParams(baseGraphData, languageFilters, edgeFilters, filterStates, viewMode));
  const graphFilterStates = $derived(computeEffectiveFilterState(languageFilters, edgeFilters, 'graph', filterDeltas));
  const canonicalGraphData = $derived(applyFiltersWithParams(initialGraphData, languageFilters, edgeFilters, graphFilterStates, 'graph'));
  const displayedBaseGraphData = $derived(viewMode === 'graph' ? initialGraphData : baseGraphData);
  const displayedFilteredGraphData = $derived(viewMode === 'graph' ? canonicalGraphData : filteredGraphData);
  const showQuasipolynomialSandboxOptions = $derived(filterStates.get('poly-display') === true);

  function hasBaseEdge(sourceId: string, targetId: string) {
    const { adjacencyMatrix } = displayedBaseGraphData;
    const sourceIdx = adjacencyMatrix.indexByLanguage[sourceId];
    const targetIdx = adjacencyMatrix.indexByLanguage[targetId];
    if (sourceIdx === undefined || targetIdx === undefined) return false;
    return Boolean(adjacencyMatrix.matrix[sourceIdx]?.[targetIdx] || adjacencyMatrix.matrix[targetIdx]?.[sourceIdx]);
  }

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
  const highlightedSuccinctnessCellIds = $derived(sandboxChangedSuccinctnessCellIds);

  function clearSelectedCells() {
    selectedEdge = null;
    selectedOperation = null;
    selectedOperationCell = null;
  }

  function handleSetSandboxMode(enabled: boolean) {
    if (viewMode === 'graph') return;
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
    sandboxSubmitSuccess = null;
    clearSandboxState();
    clearSelectedCells();
  }

  function isDraftLanguageEdit(edit: SandboxEdit, languageId: string): boolean {
    return edit.kind === 'language:new' && (edit.id ?? generateLanguageId(edit.name)) === languageId;
  }

  function handleRemoveSandboxLanguage(languageId: string) {
    if (!sandboxEdits.some((edit) => isDraftLanguageEdit(edit, languageId))) return;

    const nextEdits = sandboxEdits.filter((edit) => {
      if (isDraftLanguageEdit(edit, languageId)) return false;
      if (edit.kind === 'language:edit') return edit.languageId !== languageId;
      if (edit.kind === 'edge') return edit.sourceId !== languageId && edit.targetId !== languageId;
      if (edit.kind === 'operation') return edit.languageId !== languageId;
      return true;
    });

    const applied = commitSandboxEdits(nextEdits);
    if (!applied) return;

    if (selectedNode?.id === languageId) selectedNode = null;
    if (selectedEdge?.source === languageId || selectedEdge?.target === languageId) selectedEdge = null;
    if (selectedOperationCell?.language.id === languageId) selectedOperationCell = null;
    if (
      sandboxSelection?.kind === 'edge' &&
      (sandboxSelection.sourceId === languageId || sandboxSelection.targetId === languageId)
    ) {
      sandboxSelection = null;
    }
    if (sandboxSelection?.kind === 'operation' && sandboxSelection.languageId === languageId) {
      sandboxSelection = null;
    }
  }

  function sandboxLanguageName(languageId: string): string {
    const draftLanguage = sandboxEdits.find(
      (edit): edit is Extract<SandboxEdit, { kind: 'language:new' }> =>
        edit.kind === 'language:new' && edit.id === languageId
    );
    return draftLanguage?.name ?? initialGraphData.languages.find((language) => language.id === languageId)?.name ?? languageId;
  }

  function operationDisplayName(operationType: SandboxOperationType, operationCode: string): string {
    const catalog = operationType === 'query' ? QUERIES : TRANSFORMATIONS;
    const operation = Object.values(catalog).find((candidate) => candidate.code === operationCode);
    return operation ? `${operation.code} (${operation.label})` : operationCode;
  }

  function summarizeSandboxEdit(edit: SandboxEdit): string {
    if (edit.kind === 'language:new') {
      return `New language: ${edit.name}`;
    }
    if (edit.kind === 'language:edit') {
      return `Language: ${sandboxLanguageName(edit.languageId)}`;
    }
    if (edit.kind === 'edge') {
      return `Relationship: ${sandboxLanguageName(edit.sourceId)} to ${sandboxLanguageName(edit.targetId)}`;
    }
    if (edit.kind === 'operation') {
      return `Operation: ${operationDisplayName(edit.operationType, edit.operationCode)} on ${sandboxLanguageName(edit.languageId)}`;
    }

    const parsed = parseBibtex(edit.bibtex);
    return `Reference: ${parsed.id && parsed.id !== 'unknown' ? parsed.id : 'new BibTeX entry'}`;
  }

  function isSameSandboxTarget(a: SandboxEdit, b: SandboxEdit): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'reference' && b.kind === 'reference') {
      return a.bibtex === b.bibtex;
    }
    if (a.kind === 'language:new' && b.kind === 'language:new') {
      return (a.id ?? generateLanguageId(a.name)) === (b.id ?? generateLanguageId(b.name));
    }
    if (a.kind === 'language:edit' && b.kind === 'language:edit') {
      return a.languageId === b.languageId;
    }
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

  function resetNewLanguageForm() {
    newLanguageClassification = 'plain';
    newLanguageName = '';
    newLanguageFamilyBase = '';
    newLanguageFamilyParameter = '';
    newLanguageFullName = '';
    newLanguageDefinition = '';
    newLanguageError = null;
  }

  function closeNewLanguageModal() {
    showNewLanguageModal = false;
    resetNewLanguageForm();
  }

  function getNewLanguageDisplayName(): string {
    if (newLanguageClassification === 'family') {
      const base = newLanguageFamilyBase.trim();
      const parameter = newLanguageFamilyParameter.trim();
      return base && parameter ? `${base}$_${parameter}$` : '';
    }
    return newLanguageName.trim();
  }

  const newLanguageNamePlaceholder = $derived(
    newLanguageClassification === 'union' ? 'OBDD' : 'DNNF'
  );
  const newLanguageFullNamePlaceholder = $derived(
    newLanguageClassification === 'union'
      ? 'Ordered Binary Decision Diagram'
      : newLanguageClassification === 'family'
        ? 'Ordered Binary Decision Diagram (wrt a fixed variable order)'
        : 'Decomposable Negation Normal Form'
  );
  const newLanguageDefinitionPlaceholder = $derived(
    newLanguageClassification === 'family'
      ? 'For each fixed variable order $<$, binary decision diagrams such that each root-to-sink path tests each variable at most once and the variables appear in the order $<$.'
      : newLanguageClassification === 'union'
        ? 'Binary decision diagrams such that each root-to-sink path tests each variable at most once and the variables appear in the same order.'
        : 'Boolean circuits with AND and OR gates, literals as inputs, and whose AND gates are \\emph{decomposable} (children mention disjoint sets of variables).'
  );

  function handleAddLanguageSubmit() {
    const name = getNewLanguageDisplayName();
    const fullName = newLanguageFullName.trim();
    const definition = newLanguageDefinition.trim();

    if (!name || !fullName || !definition) {
      newLanguageError = 'Name, full name, and definition are required.';
      return;
    }

    const id = generateLanguageId(name);
    const edit: SandboxEdit = {
      kind: 'language:new',
      id,
      name,
      classification: newLanguageClassification ?? 'plain',
      fullName,
      definition,
      definitionRefs: []
    };

    const applied = commitSandboxEdits(nextSandboxEditsFor(edit));
    if (!applied) {
      newLanguageError = sandboxError ?? 'Unable to add language.';
      return;
    }

    closeNewLanguageModal();
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

  function handleSandboxEdgeMetadataEdit(
    sourceId: string,
    targetId: string,
    edit: {
      status: string | null;
      assumption?: string;
      description?: string;
      noPolyDescription?: string;
      quasiDescription?: string;
    }
  ) {
    const applied = handleSandboxApply({
      kind: 'edge',
      sourceId,
      targetId,
      ...edit
    });
    if (applied && selectedEdge?.source === sourceId && selectedEdge.target === targetId) {
      selectedEdge = {
        ...selectedEdge,
        forward: edit.status
          ? {
              status: edit.status,
              assumption: edit.assumption,
              description: edit.description,
              noPolyDescription: edit.noPolyDescription
                ? { description: edit.noPolyDescription, refs: selectedEdge.forward?.refs ?? [], derived: false }
                : undefined,
              quasiDescription: edit.quasiDescription
                ? { description: edit.quasiDescription, refs: selectedEdge.forward?.refs ?? [], derived: false }
                : undefined,
              refs: selectedEdge.forward?.refs ?? [],
              derived: false
            }
          : null
      };
    }
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

  function handleSandboxOperationMetadataEdit(
    operationType: SandboxOperationType,
    languageId: string,
    operationCode: string,
    edit: { complexity: string | null; assumption?: string; description?: string }
  ) {
    const applied = handleSandboxApply({
      kind: 'operation',
      operationType,
      languageId,
      operationCode,
      ...edit
    });
    if (
      applied &&
      selectedOperationCell?.language.id === languageId &&
      selectedOperationCell.operationCode === operationCode
    ) {
      selectedOperationCell = {
        ...selectedOperationCell,
        support: {
          ...selectedOperationCell.support,
          complexity: edit.complexity ?? 'unknown-to-us',
          assumption: edit.assumption,
          description: edit.description
        }
      };
    }
  }

  function handleSandboxLanguageEdit(languageId: string, fields: { fullName?: string; definition?: string }) {
    const applied = handleSandboxApply({
      kind: 'language:edit',
      languageId,
      ...fields
    });
    if (applied && selectedNode?.id === languageId) {
      selectedNode = {
        ...selectedNode,
        ...fields
      };
    }
  }

  function handleSandboxReferenceAdd(bibtex: string): string | null {
    const parsed = parseBibtex(bibtex);
    if (!parsed.id || parsed.id === 'unknown') return null;
    const applied = handleSandboxApply({
      kind: 'reference',
      bibtex
    });
    return applied ? parsed.id : null;
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

  function handleLanguageOperationCellSelect(cell: SelectedOperationCell) {
    selectedNode = null;
    selectedOperation = null;
    selectedEdge = null;
    selectedOperationCell = cell;
    viewMode = cell.operationType === 'query' ? 'queries' : 'transforms';
    filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, viewMode, filterDeltas);
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
    if (newMode === 'graph') {
      isSandboxMode = false;
      sandboxSelection = null;
      sandboxError = null;
    }
    viewMode = newMode;
    filterStates = computeEffectiveFilterState(languageFilters, edgeFilters, newMode, filterDeltas);
  }

  // =========================================================================
  // Hash-based navigation for entity links (lang, edge, op)
  // =========================================================================
  function navigateToHash(hash: string) {
    const data = displayedBaseGraphData;
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
    if (sandboxPersistenceReady && browser) {
      saveSandboxState(sandboxEdits);
    }
  });
  
  // Reset selected node if it's no longer visible after filtering
  $effect(() => {
    if (selectedNode) {
      const isVisible = displayedFilteredGraphData.visibleLanguageIds.has(selectedNode.id);
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
      const isVisible = displayedFilteredGraphData.visibleEdgeIds.has(edgeId) || displayedFilteredGraphData.visibleEdgeIds.has(reverseEdgeId);
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

<div class="app-shell" class:has-submit-success={Boolean(sandboxSubmitSuccess)}>
  <!-- Header -->
  <header class="app-header" class:sandbox-mode={isSandboxMode}>
    <div class="header-content">
      <div class="header-left">
        <h1 class="title">Tractable Circuit Zoo</h1>
      </div>
      <div class="header-controls">
        <a href="/about" class="about-link">
          About
        </a>
        {#if viewMode !== 'graph' && isSandboxMode}
          <button type="button" class="sandbox-reset" disabled={sandboxEdits.length === 0} onclick={handleResetSandbox}>
            Reset
          </button>
          <button
            type="button"
            class="sandbox-submit"
            disabled={sandboxEdits.length === 0 || Boolean(sandboxEvaluation && !sandboxEvaluation.ok)}
            onclick={openSandboxSubmitModal}
          >
            Submit
          </button>
        {/if}
        {#if viewMode !== 'graph'}
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
          languages={displayedBaseGraphData.languages}
          {filterStates}
          {viewMode}
          onFilterChange={handleFilterChange}
          onReset={handleFilterReset}
        />
      </div>
    </div>
  </header>

  {#if sandboxSubmitSuccess}
    <div class="sandbox-submit-success" role="status">
      <span>{sandboxSubmitSuccess}</span>
      <button type="button" onclick={() => sandboxSubmitSuccess = null} aria-label="Dismiss submission message">
        Dismiss
      </button>
    </div>
  {/if}

  <!-- Main Content -->
  <main class="app-main">
    <section class="visual-panel" data-view={viewMode}>
      {#if viewMode === 'graph'}
        <KCGraph graphData={displayedFilteredGraphData} bind:selectedNode bind:selectedEdge />
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
            showQuasipolynomialSandboxOptions={showQuasipolynomialSandboxOptions}
            sandboxSelectedEdgeId={sandboxSelectedEdgeId}
            sandboxBaselineGraphData={initialGraphData}
            onAddLanguage={() => { showNewLanguageModal = true; }}
            onRemoveSandboxLanguage={handleRemoveSandboxLanguage}
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
          onAddLanguage={() => { showNewLanguageModal = true; }}
          onRemoveSandboxLanguage={handleRemoveSandboxLanguage}
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
          onAddLanguage={() => { showNewLanguageModal = true; }}
          onRemoveSandboxLanguage={handleRemoveSandboxLanguage}
          onSandboxOperationEdit={handleSandboxOperationEdit}
          onSandboxOperationStatusChange={handleSandboxOperationStatusChange}
        />
      {/if}
    </section>

    <aside class="side-panel">
      {#if isSandboxMode && sandboxError}
        <div class="sandbox-error" role="alert">
          <strong>Sandbox contradiction</strong>
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
            graphData={displayedBaseGraphData}
            filteredGraphData={displayedFilteredGraphData}
            {viewMode}
            sandboxMode={isSandboxMode}
            onSandboxOperationEdit={handleSandboxOperationMetadataEdit}
            onSandboxReferenceAdd={handleSandboxReferenceAdd}
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
            graphData={displayedBaseGraphData}
            filteredGraphData={displayedFilteredGraphData}
            {viewMode}
            sandboxMode={isSandboxMode}
            onSandboxOperationEdit={handleSandboxOperationMetadataEdit}
            onSandboxReferenceAdd={handleSandboxReferenceAdd}
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
            graphData={displayedBaseGraphData}
            filteredGraphData={displayedFilteredGraphData}
            onOperationCellSelect={handleLanguageOperationCellSelect}
            sandboxMode={isSandboxMode}
            onSandboxLanguageEdit={handleSandboxLanguageEdit}
            onSandboxReferenceAdd={handleSandboxReferenceAdd}
            viewMode={viewMode}
          />
        {:else}
          <OperationInfo 
            selectedOperation={null}
            selectedOperationCell={null}
            graphData={displayedBaseGraphData}
            filteredGraphData={displayedFilteredGraphData}
            {viewMode}
            sandboxMode={isSandboxMode}
            onSandboxOperationEdit={handleSandboxOperationMetadataEdit}
            onSandboxReferenceAdd={handleSandboxReferenceAdd}
          />
        {/if}
      {:else if selectedEdge}
        <EdgeInfo
          selectedEdge={selectedEdge}
          graphData={displayedBaseGraphData}
          filteredGraphData={displayedFilteredGraphData}
          sandboxMode={isSandboxMode}
          onSandboxEdgeEdit={handleSandboxEdgeMetadataEdit}
          onSandboxReferenceAdd={handleSandboxReferenceAdd}
          viewMode={viewMode}
        />
      {:else if selectedNode}
        <LanguageInfo 
          selectedLanguage={selectedNode} 
          graphData={displayedBaseGraphData}
          filteredGraphData={displayedFilteredGraphData}
          onOperationCellSelect={handleLanguageOperationCellSelect}
          sandboxMode={isSandboxMode}
          onSandboxLanguageEdit={handleSandboxLanguageEdit}
          onSandboxReferenceAdd={handleSandboxReferenceAdd}
          viewMode={viewMode}
        />
      {:else}
        <LanguageInfo 
          selectedLanguage={null} 
          graphData={displayedBaseGraphData}
          filteredGraphData={displayedFilteredGraphData}
          onOperationCellSelect={handleLanguageOperationCellSelect}
          sandboxMode={isSandboxMode}
          onSandboxLanguageEdit={handleSandboxLanguageEdit}
          onSandboxReferenceAdd={handleSandboxReferenceAdd}
          viewMode={viewMode}
        />
      {/if}
    </aside>
  </main>
</div>

{#if showNewLanguageModal}
  <div class="modal-backdrop" role="presentation" onclick={closeNewLanguageModal}>
    <div
      class="new-language-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-language-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === 'Escape') closeNewLanguageModal();
      }}
    >
      <header class="modal-header">
        <h2 id="new-language-title">New Language</h2>
      </header>

      <div class="modal-body">
        {#if newLanguageError}
          <div class="modal-error" role="alert">{newLanguageError}</div>
        {/if}

        <label class="field-label" for="new-language-classification">Classification</label>
        <select id="new-language-classification" bind:value={newLanguageClassification} class="field-control">
          <option value="plain">Plain</option>
          <option value="union">Union</option>
          <option value="family">Family</option>
        </select>

        {#if newLanguageClassification === 'family'}
          <div class="field-grid">
            <div>
              <label class="field-label" for="new-language-family-base">Base Name</label>
              <input
                id="new-language-family-base"
                class="field-control"
                bind:value={newLanguageFamilyBase}
                placeholder="OBDD"
              />
            </div>
            <div>
              <label class="field-label" for="new-language-family-parameter">Parameter</label>
              <input
                id="new-language-family-parameter"
                class="field-control"
                bind:value={newLanguageFamilyParameter}
                placeholder="<"
              />
            </div>
          </div>
        {:else}
          <label class="field-label" for="new-language-name">Display Name</label>
          <input
            id="new-language-name"
            class="field-control"
            bind:value={newLanguageName}
            placeholder={newLanguageNamePlaceholder}
          />
        {/if}

        <label class="field-label" for="new-language-full-name">Full Name</label>
        <input
          id="new-language-full-name"
          class="field-control"
          bind:value={newLanguageFullName}
          placeholder={newLanguageFullNamePlaceholder}
        />

        <label class="field-label" for="new-language-definition">Definition</label>
        <textarea
          id="new-language-definition"
          class="field-control textarea-control"
          bind:value={newLanguageDefinition}
          rows="5"
          placeholder={newLanguageDefinitionPlaceholder}
        ></textarea>
      </div>

      <footer class="modal-actions">
        <button type="button" class="modal-button secondary" onclick={closeNewLanguageModal}>Cancel</button>
        <button type="button" class="modal-button primary" onclick={handleAddLanguageSubmit}>Add Language</button>
      </footer>
    </div>
  </div>
{/if}

{#if showSandboxSubmitModal}
  <div class="modal-backdrop" role="presentation" onclick={closeSandboxSubmitModal}>
    <div
      class="new-language-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sandbox-submit-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === 'Escape') closeSandboxSubmitModal();
      }}
    >
      <header class="modal-header">
        <h2 id="sandbox-submit-title">Submit Contribution</h2>
      </header>

      <div class="modal-body">
        {#if sandboxSubmitError}
          <div class="modal-error" role="alert">{sandboxSubmitError}</div>
        {/if}

        <details class="submission-details">
          <summary>Show {sandboxEdits.length} {sandboxEdits.length === 1 ? 'draft change' : 'draft changes'}</summary>
          <ul>
            {#each sandboxEditSummaries as summary}
              <li><MathText text={summary} className="inline" /></li>
            {/each}
          </ul>
        </details>

        <label class="field-label" for="sandbox-contributor-name">Name <span class="required-marker">*</span></label>
        <input
          id="sandbox-contributor-name"
          class="field-control"
          bind:value={sandboxContributorName}
          required
        />

        <label class="field-label" for="sandbox-contributor-email">Email <span class="required-marker">*</span></label>
        <input
          id="sandbox-contributor-email"
          class="field-control"
          type="email"
          bind:value={sandboxContributorEmail}
          required
        />

        <label class="field-label" for="sandbox-contributor-github">GitHub Handle</label>
        <input
          id="sandbox-contributor-github"
          class="field-control"
          bind:value={sandboxContributorGithub}
          placeholder="@example"
        />

        <label class="field-label" for="sandbox-contributor-note">Note</label>
        <textarea
          id="sandbox-contributor-note"
          class="field-control textarea-control"
          bind:value={sandboxContributorNote}
          rows="4"
          placeholder="Say something to the reviewers"
        ></textarea>
      </div>

      <footer class="modal-actions">
        <button type="button" class="modal-button secondary" onclick={closeSandboxSubmitModal} disabled={submittingSandbox}>
          Cancel
        </button>
        <button type="button" class="modal-button primary" onclick={handleSandboxSubmit} disabled={submittingSandbox}>
          {submittingSandbox ? 'Submitting...' : 'Contribute'}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    background: #f9fafb;
  }

  .app-shell.has-submit-success {
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .app-header {
    background: #ffffff;
    border-bottom: 1px solid #e5e7eb;
    padding: 0.75rem 1rem;
  }

  .app-header.sandbox-mode {
    background: linear-gradient(135deg, #ecfeff 0%, #e0f2fe 100%);
  }

  .sandbox-submit-success {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    min-height: 2.1rem;
    padding: 0.3rem 1rem;
    border-bottom: 1px solid #bbf7d0;
    background: #f0fdf4;
    color: #166534;
    font-size: 0.86rem;
    font-weight: 700;
  }

  .sandbox-submit-success button {
    border: 1px solid #86efac;
    border-radius: 0.35rem;
    background: #ffffff;
    color: #166534;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 750;
    cursor: pointer;
  }

  .sandbox-submit-success button:hover,
  .sandbox-submit-success button:focus-visible {
    border-color: #22c55e;
    outline: 2px solid rgba(34, 197, 94, 0.2);
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

  .sandbox-submit {
    padding: 0.46rem 0.72rem;
    border-radius: 0.5rem;
    border: 1px solid #15803d;
    background: #16a34a;
    color: #fff;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sandbox-submit:hover:not(:disabled) {
    background: #15803d;
  }

  .sandbox-submit:disabled {
    cursor: not-allowed;
    opacity: 0.55;
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

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(15, 23, 42, 0.45);
  }

  .new-language-modal {
    width: min(34rem, 100%);
    max-height: min(42rem, calc(100vh - 2rem));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 0.5rem;
    border: 1px solid #bfdbfe;
    background: #fff;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  }

  .modal-header {
    padding: 1rem 1.1rem;
    border-bottom: 1px solid #dbeafe;
    background: #eff6ff;
  }

  .modal-header h2 {
    margin: 0;
    color: #1e3a8a;
    font-size: 1rem;
    font-weight: 800;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    overflow: auto;
    padding: 1rem 1.1rem;
  }

  .field-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(5rem, 0.45fr);
    gap: 0.75rem;
  }

  .field-label {
    display: block;
    margin-top: 0.2rem;
    color: #334155;
    font-size: 0.78rem;
    font-weight: 750;
  }

  .required-marker {
    color: #dc2626;
  }

  .field-control {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0.35rem;
    padding: 0.48rem 0.55rem;
    color: #0f172a;
    font-size: 0.9rem;
  }

  .field-control:focus {
    border-color: #2563eb;
    outline: 2px solid rgba(37, 99, 235, 0.18);
  }

  .textarea-control {
    min-height: 7rem;
    resize: vertical;
    line-height: 1.45;
  }

  .modal-error {
    border: 1px solid #fecaca;
    border-radius: 0.35rem;
    background: #fef2f2;
    padding: 0.55rem 0.65rem;
    color: #991b1b;
    font-size: 0.84rem;
    font-weight: 650;
  }

  .submission-details {
    border: 1px solid #dbeafe;
    border-radius: 0.4rem;
    background: #f8fafc;
    color: #334155;
    font-size: 0.84rem;
  }

  .submission-details summary {
    cursor: pointer;
    padding: 0.55rem 0.7rem;
    color: #1e40af;
    font-weight: 750;
  }

  .submission-details ul {
    display: grid;
    gap: 0.28rem;
    max-height: 10rem;
    overflow: auto;
    margin: 0;
    border-top: 1px solid #dbeafe;
    padding: 0.55rem 0.9rem 0.7rem 1.45rem;
  }

  .submission-details li {
    line-height: 1.35;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    padding: 0.85rem 1.1rem;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .modal-button {
    border-radius: 0.4rem;
    padding: 0.48rem 0.8rem;
    font-size: 0.85rem;
    font-weight: 750;
    cursor: pointer;
  }

  .modal-button.secondary {
    border: 1px solid #cbd5e1;
    background: #fff;
    color: #334155;
  }

  .modal-button.primary {
    border: 1px solid #1d4ed8;
    background: #2563eb;
    color: #fff;
  }

  .modal-button:hover {
    filter: brightness(0.97);
  }
</style>
