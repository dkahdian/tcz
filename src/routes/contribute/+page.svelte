<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import AddLanguageModal from '$lib/components/contribute/AddLanguageModal.svelte';
  import AddReferenceModal from '$lib/components/contribute/AddReferenceModal.svelte';
  import AddSeparatingFunctionModal from '$lib/components/contribute/AddSeparatingFunctionModal.svelte';
  import ManageRelationshipModal from '$lib/components/contribute/ManageRelationshipModal.svelte';
  import ContributionQueue from './components/ContributionQueue.svelte';
  import ActionButtons from './components/ActionButtons.svelte';
  import PreviewButton from './components/PreviewButton.svelte';
  import { 
    relationKey, 
    buildBaselineRelations,
    getAvailableReferences,
    getAvailableLanguages,
    getAvailableSeparatingFunctions,
    convertLanguageForEdit
  } from './logic.js';
  import {
    isString,
    sanitizeStringArray,
    sanitizeTags,
    sanitizeSubmissionId,
    cloneLanguageEntry,
    cloneRelationshipEntry,
    cloneSeparatingFunctionToAdd,
    cloneQueueEntry,
    cloneCustomTag,
    createSubmissionId,
    createQueueEntryId,
    formatHistoryTimestamp,
    formatHistorySummary
  } from './utils.js';
  import { generateReferenceId } from '$lib/utils/reference-id.js';
  import { generateLanguageId } from '$lib/utils/language-id.js';
  import type {
    LanguageToAdd,
    RelationshipEntry,
    CustomTag,
    SeparatingFunctionToAdd,
    SubmissionHistoryEntry,
    ContributorInfo
  } from './types.js';
  import { loadSubmissionHistory, deriveQueueEntriesFromHistory } from '$lib/utils/submission-history.js';

  type OperationResult = { success: boolean; error?: string };

  import { initialGraphData } from '$lib/data/index.js';
  import {
    applyContributionQueue,
    type ContributionQueueEntry,
    type ContributionQueueState
  } from '$lib/data/contribution-transforms.js';
  import {
    QUEUE_STORAGE_KEY,
    CONTRIBUTOR_STORAGE_KEY,
    savePreviewDataset,
    loadQueuedChanges
  } from '$lib/contribution-storage.js';
  import type { ReferenceToAdd } from './types.js';

  type QueueLanguage = { queueEntryId: string; payload: LanguageToAdd };
  type QueueRelationship = { queueEntryId: string; payload: RelationshipEntry };
  type QueueSeparatingFunction = { queueEntryId: string; payload: SeparatingFunctionToAdd };
  type QueueReference = { queueEntryId: string; ref: ReferenceToAdd };

  // Queue manipulation functions that reference component state
  function addQueueEntry(entry: ContributionQueueEntry) {
    queueEntries = [...queueEntries, entry];
  }

  function updateQueueEntry<K extends ContributionQueueEntry['kind']>(
    entryId: string,
    kind: K,
    payload: Extract<ContributionQueueEntry, { kind: K }>['payload']
  ) {
    queueEntries = queueEntries.map((entry) => {
      if (entry.id === entryId && entry.kind === kind) {
        const updated = { ...entry, payload } as Extract<ContributionQueueEntry, { kind: K }>;
        return updated;
      }
      return entry;
    });
  }

  function removeQueueEntry(entryId: string) {
    queueEntries = queueEntries.filter((entry) => entry.id !== entryId);
  }

  let { data }: { data: PageData } = $props();

  const complexityOptions = Object.values(data.complexityOptions)
    .filter((option) => !option.internal);

  const statusOptions: Array<{
    value: string;
    label: string;
    description: string;
  }> = data.relationTypes
    .filter((type) => !data.complexityOptions[type.id]?.internal)
    .map((type) => ({
      value: type.id,
      label: type.name,
      description: type.description ?? ''
    }));

  // Build baseline relations from adjacency matrix
  const baselineRelations = buildBaselineRelations(data.adjacencyMatrix);

  // Contributor information
  let contributorEmail = $state('');
  let contributorGithub = $state('');
  let contributorNote = $state('');

  // Ordered queue of all contribution entries
  let queueEntries = $state<ContributionQueueEntry[]>([]);

  // Per-kind views derived from queue (replaces manual $effect splitting)
  const languagesToAdd = $derived(
    queueEntries
      .filter((e): e is Extract<ContributionQueueEntry, { kind: 'language:new' }> => e.kind === 'language:new')
      .map((e): QueueLanguage => ({ queueEntryId: e.id, payload: e.payload }))
  );
  const languagesToEdit = $derived(
    queueEntries
      .filter((e): e is Extract<ContributionQueueEntry, { kind: 'language:edit' }> => e.kind === 'language:edit')
      .map((e): QueueLanguage => ({ queueEntryId: e.id, payload: e.payload }))
  );
  const relationships = $derived(
    queueEntries
      .filter((e): e is Extract<ContributionQueueEntry, { kind: 'relationship' }> => e.kind === 'relationship')
      .map((e): QueueRelationship => ({ queueEntryId: e.id, payload: e.payload }))
  );
  const newReferences = $derived(
    queueEntries
      .filter((e): e is Extract<ContributionQueueEntry, { kind: 'reference' }> => e.kind === 'reference')
      .map((e): QueueReference => ({ queueEntryId: e.id, ref: e.payload }))
  );
  const newSeparatingFunctions = $derived(
    queueEntries
      .filter((e): e is Extract<ContributionQueueEntry, { kind: 'separator' }> => e.kind === 'separator')
      .map((e): QueueSeparatingFunction => ({ queueEntryId: e.id, payload: e.payload }))
  );

  // Track expanded state for chip UI
  let expandedLanguageToAddIndex = $state<number | null>(null);
  let expandedLanguageToEditIndex = $state<number | null>(null);
  let expandedRelationshipIndex = $state<number | null>(null);
  let expandedReferenceIndex = $state<number | null>(null);
  let expandedSeparatingFunctionIndex = $state<number | null>(null);

  // Modal state — discriminated union replaces 11 separate state variables.
  // Only one modal is open at a time.
  type ModalState =
    | { kind: 'none' }
    | { kind: 'add-language' }
    | { kind: 'edit-queued-add', index: number }
    | { kind: 'select-language-to-edit' }
    | { kind: 'edit-existing-language', name: string }
    | { kind: 'edit-queued-edit', index: number }
    | { kind: 'add-reference' }
    | { kind: 'edit-reference', index: number }
    | { kind: 'add-sep-fn' }
    | { kind: 'edit-sep-fn', index: number }
    | { kind: 'add-relationship' }
    | { kind: 'edit-relationship', index: number };

  let modal = $state<ModalState>({ kind: 'none' });

  function closeModal() {
    modal = { kind: 'none' };
  }

  // Local state for the language selector modal only
  let selectedLanguageToEdit = $state<string>('');

  // Track which relationships have been modified from baseline
  let modifiedRelations = $state(new Set<string>());
  let queuePersistenceReady = $state(false);

  let customTags = $state<CustomTag[]>([]);

  const languageAddPayloads = $derived(languagesToAdd.map((entry) => entry.payload));
  const languageEditPayloads = $derived(languagesToEdit.map((entry) => entry.payload));
  const referenceValues = $derived(newReferences.map((entry) => entry.ref));
  const separatingFunctionPayloads = $derived(newSeparatingFunctions.map((entry) => entry.payload));
  const relationshipPayloads = $derived(relationships.map((entry) => entry.payload));

  // Derived modal-related computations for template use
  const isAddLangOpen = $derived(modal.kind === 'add-language' || modal.kind === 'edit-queued-add');
  const isEditLangOpen = $derived(modal.kind === 'edit-existing-language' || modal.kind === 'edit-queued-edit');
  const editAddIndex = $derived(modal.kind === 'edit-queued-add' ? modal.index : null);
  const editEditIndex = $derived(modal.kind === 'edit-queued-edit' ? modal.index : null);
  const editRefIndex = $derived(modal.kind === 'edit-reference' ? modal.index : null);
  const editSepIndex = $derived(modal.kind === 'edit-sep-fn' ? modal.index : null);
  const editRelIndex = $derived(modal.kind === 'edit-relationship' ? modal.index : null);
  const editLangInitialData = $derived.by(() => {
    const m = modal;
    if (m.kind === 'edit-queued-edit') return languagesToEdit[m.index]?.payload;
    if (m.kind === 'edit-existing-language') {
      const lang = data.languages.find(l => l.name === m.name);
      return lang ? convertLanguageForEdit(lang) : undefined;
    }
    return undefined;
  });

  // Submission metadata & history
  let activeSubmissionId = $state('');
  let supersedesSubmissionId = $state<string | null>(null);
  let submissionHistory = $state<SubmissionHistoryEntry[]>([]);
  let isHistoryOpen = $state(false);


  // Derived state: check if queue has any items
  const hasQueuedItems = $derived(
    queueEntries.length > 0 ||
    customTags.length > 0 ||
    modifiedRelations.size > 0
  );

  let previousHasQueuedItems = false;

  $effect(() => {
    if (!browser) return;

    const currentlyQueued = hasQueuedItems;

    if (currentlyQueued && !previousHasQueuedItems && !activeSubmissionId) {
      activeSubmissionId = createSubmissionId();
    }

    if (!currentlyQueued && previousHasQueuedItems) {
      activeSubmissionId = createSubmissionId();
      supersedesSubmissionId = null;
    }

    previousHasQueuedItems = currentlyQueued;
  });

  onMount(() => {
    if (!browser) {
      queuePersistenceReady = true;
      return;
    }

    submissionHistory = loadSubmissionHistory();

    try {
      const stored = loadQueuedChanges();
      if (stored) {
        queueEntries = stored.entries.map(cloneQueueEntry);
        customTags = sanitizeTags(stored.customTags);
        modifiedRelations = new Set(sanitizeStringArray(stored.modifiedRelations));
        activeSubmissionId = sanitizeSubmissionId(stored.submissionId) ?? '';
        supersedesSubmissionId = sanitizeSubmissionId(stored.supersedesSubmissionId);
      }

      // Restore contributor info
      const contributorStored = localStorage.getItem(CONTRIBUTOR_STORAGE_KEY);
      if (contributorStored) {
        const contributorParsed = JSON.parse(contributorStored) as Partial<ContributorInfo>;
        if (isString(contributorParsed?.email)) contributorEmail = contributorParsed.email;
        if (isString(contributorParsed?.github)) contributorGithub = contributorParsed.github;
        if (isString(contributorParsed?.note)) contributorNote = contributorParsed.note;
      }
    } catch (error) {
      console.warn('Failed to restore queued changes from storage', error);
    } finally {
      queuePersistenceReady = true;
    }

    if (!activeSubmissionId) {
      activeSubmissionId = createSubmissionId();
    }
  });

  function updateModifiedRelations(updater: (current: Set<string>) => Set<string>) {
    const next = updater(modifiedRelations);
    modifiedRelations = new Set(next);
  }

  function recordModification(rel: RelationshipEntry) {
    const key = relationKey(rel.sourceId, rel.targetId);
    updateModifiedRelations((current) => {
      const updated = new Set(current);
      updated.add(key);
      return updated;
    });
  }

  function clearModificationByKey(key: string) {
    updateModifiedRelations((current) => {
      if (!current.has(key)) return current;
      const updated = new Set(current);
      updated.delete(key);
      return updated;
    });
  }

  $effect(() => {
    if (!queuePersistenceReady || !browser) return;

    if (!activeSubmissionId) {
      activeSubmissionId = createSubmissionId();
    }

    const isEmptyQueue =
      queueEntries.length === 0 &&
      customTags.length === 0 &&
      modifiedRelations.size === 0;

    if (isEmptyQueue) {
      try {
        localStorage.removeItem(QUEUE_STORAGE_KEY);
      } catch (error) {
        console.warn('Failed to clear queued changes from storage', error);
      }
      supersedesSubmissionId = null;
      return;
    }

    const snapshot: ContributionQueueState = {
      entries: queueEntries.map(cloneQueueEntry),
      customTags: customTags.map(cloneCustomTag),
      modifiedRelations: Array.from(modifiedRelations),
      submissionId: activeSubmissionId,
      supersedesSubmissionId: supersedesSubmissionId ?? null
    };
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('Failed to persist queued changes', error);
    }
  });

  // Persist contributor info separately
  $effect(() => {
    if (!queuePersistenceReady || !browser) return;
    
    const info: ContributorInfo = {
      email: contributorEmail,
      github: contributorGithub,
      note: contributorNote
    };
    
    try {
      localStorage.setItem(CONTRIBUTOR_STORAGE_KEY, JSON.stringify(info));
    } catch (error) {
      console.warn('Failed to persist contributor info', error);
    }
  });

  // Build preview dataset snapshot for the main map
  $effect(() => {
    if (!queuePersistenceReady || !browser) return;

    if (!hasQueuedItems) {
      savePreviewDataset(null);
      return;
    }

    const queuePayload: ContributionQueueState = {
      entries: queueEntries.map(cloneQueueEntry),
      customTags: customTags.map(cloneCustomTag),
      modifiedRelations: Array.from(modifiedRelations),
      submissionId: activeSubmissionId,
      supersedesSubmissionId: supersedesSubmissionId ?? null
    };

    try {
      const dataset = applyContributionQueue(initialGraphData, queuePayload);
      savePreviewDataset(dataset);
    } catch (error) {
      console.error('Failed to build preview dataset:', error);
    }
  });

  // Modal handlers — consolidated by entity type using modal state union

  function handleLanguageAddSubmit(language: LanguageToAdd): OperationResult {
    if (modal.kind === 'edit-queued-add') {
      const entry = languagesToAdd[modal.index];
      if (entry) {
        const payload = cloneLanguageEntry(language);
        payload.id = entry.payload.id ?? payload.id ?? generateLanguageId(payload.name);
        updateQueueEntry(entry.queueEntryId, 'language:new', payload);
      }
    } else {
      const payload = cloneLanguageEntry(language);
      payload.id = payload.id ?? generateLanguageId(payload.name);
      addQueueEntry({ id: createQueueEntryId(), kind: 'language:new', payload });
    }
    return { success: true };
  }

  function handleLanguageEditSubmit(language: LanguageToAdd): OperationResult {
    if (modal.kind === 'edit-queued-edit') {
      const entry = languagesToEdit[modal.index];
      if (entry) {
        const payload = cloneLanguageEntry(language);
        payload.id = entry.payload.id ?? payload.id;
        updateQueueEntry(entry.queueEntryId, 'language:edit', payload);
      }
    } else {
      const languageId = language.id ?? generateLanguageId(language.name);
      const existing = languagesToEdit.find((e) =>
        (e.payload.id ?? generateLanguageId(e.payload.name)) === languageId
      );
      if (existing) {
        const payload = cloneLanguageEntry(language);
        payload.id = languageId;
        updateQueueEntry(existing.queueEntryId, 'language:edit', payload);
      } else {
        const payload = cloneLanguageEntry(language);
        payload.id = languageId;
        addQueueEntry({ id: createQueueEntryId(), kind: 'language:edit', payload });
      }
    }
    return { success: true };
  }

  function handleReferenceSubmit(ref: ReferenceToAdd) {
    if (modal.kind === 'edit-reference') {
      const entry = newReferences[modal.index];
      if (entry) updateQueueEntry(entry.queueEntryId, 'reference', ref);
    } else {
      addQueueEntry({ id: createQueueEntryId(), kind: 'reference', payload: ref });
    }
  }

  function handleSepFnSubmit(sf: SeparatingFunctionToAdd) {
    if (modal.kind === 'edit-sep-fn') {
      const entry = newSeparatingFunctions[modal.index];
      if (entry) updateQueueEntry(entry.queueEntryId, 'separator', cloneSeparatingFunctionToAdd(sf));
    } else {
      addQueueEntry({ id: createQueueEntryId(), kind: 'separator', payload: cloneSeparatingFunctionToAdd(sf) });
    }
  }

  function handleRelationshipSubmit(relationship: RelationshipEntry) {
    if (modal.kind === 'edit-relationship') {
      const entry = relationships[modal.index];
      if (entry) {
        updateQueueEntry(entry.queueEntryId, 'relationship', cloneRelationshipEntry(relationship));
      }
    } else {
      const key = relationKey(relationship.sourceId, relationship.targetId);
      const existing = relationships.find((e) => relationKey(e.payload.sourceId, e.payload.targetId) === key);
      if (existing) {
        updateQueueEntry(existing.queueEntryId, 'relationship', cloneRelationshipEntry(relationship));
      } else {
        addQueueEntry({ id: createQueueEntryId(), kind: 'relationship', payload: cloneRelationshipEntry(relationship) });
      }
    }
    recordModification(relationship);
  }

  function handleDeleteLanguageToAdd(index: number) {
    const entry = languagesToAdd[index];
    if (!entry) return;
    const langId = entry.payload.id ?? generateLanguageId(entry.payload.name);
    deleteLanguage(entry.queueEntryId, langId);
  }

  function handleDeleteLanguageToEdit(index: number) {
    const entry = languagesToEdit[index];
    if (!entry) return;
    const langId = entry.payload.id ?? generateLanguageId(entry.payload.name);
    deleteLanguage(entry.queueEntryId, langId);
  }

  function handleDeleteRelationship(index: number) {
    const entry = relationships[index];
    if (!entry) return;
    removeQueueEntry(entry.queueEntryId);
    clearModificationByKey(relationKey(entry.payload.sourceId, entry.payload.targetId));
  }

  // Cascade delete: when a language is deleted, remove its relationships
  function deleteLanguage(queueEntryId: string, langId: string) {
    const relatedRelationshipIds = relationships
      .filter((entry) => entry.payload.sourceId === langId || entry.payload.targetId === langId)
      .map((entry) => entry.queueEntryId);

    const idsToRemove = new Set([queueEntryId, ...relatedRelationshipIds]);
    queueEntries = queueEntries.filter((entry) => !idsToRemove.has(entry.id));

    updateModifiedRelations((current) => {
      if (current.size === 0) return current;
      const updated = new Set(current);
      for (const key of Array.from(updated)) {
        if (key.startsWith(`${langId}->`) || key.endsWith(`->${langId}`)) {
          updated.delete(key);
        }
      }
      return updated;
    });
  }

  // Cascade delete: when a reference is deleted, remove it from all dependencies
  function deleteReference(index: number) {
    const referenceEntry = newReferences[index];
    if (!referenceEntry) return;

    const existingIds = new Set(data.existingReferences.map((r) => r.id));
    for (let i = 0; i < index; i++) {
      const id = generateReferenceId(newReferences[i].ref.bibtex, existingIds);
      existingIds.add(id);
    }

    const refId = generateReferenceId(referenceEntry.ref.bibtex, existingIds);

    queueEntries = queueEntries.map((entry) => {
      if (entry.kind === 'language:new' || entry.kind === 'language:edit') {
        if (!entry.payload.definitionRefs.includes(refId)) return entry;
        const updated = cloneLanguageEntry(entry.payload);
        updated.definitionRefs = updated.definitionRefs.filter((r) => r !== refId);
        return { ...entry, payload: updated };
      }

      if (entry.kind === 'relationship') {
        if (!entry.payload.refs.includes(refId)) {
          return entry;
        }
        const updated = cloneRelationshipEntry(entry.payload);
        updated.refs = updated.refs.filter((r) => r !== refId);
        return { ...entry, payload: updated };
      }

      if (entry.kind === 'separator') {
        if (!entry.payload.refs.includes(refId)) return entry;
        const updated = cloneSeparatingFunctionToAdd(entry.payload);
        updated.refs = updated.refs.filter((r) => r !== refId);
        return { ...entry, payload: updated };
      }

      return entry;
    });

    removeQueueEntry(referenceEntry.queueEntryId);

    customTags = customTags.map((tag) => ({ ...tag, refs: tag.refs.filter((r) => r !== refId) }));
  }

  function deleteSeparatingFunction(index: number) {
    const entry = newSeparatingFunctions[index];
    if (!entry) return;

    const shortName = entry.payload.shortName;
    removeQueueEntry(entry.queueEntryId);

    queueEntries = queueEntries.map((queueEntry) => {
      if (queueEntry.kind !== 'relationship' || !queueEntry.payload.separatingFunctionIds) {
        return queueEntry;
      }

      if (!queueEntry.payload.separatingFunctionIds.includes(shortName)) {
        return queueEntry;
      }

      const updated = cloneRelationshipEntry(queueEntry.payload);
      updated.separatingFunctionIds = (updated.separatingFunctionIds || []).filter((id) => id !== shortName);
      return { ...queueEntry, payload: updated };
    });
  }

  function toggleHistoryPanel() {
    const nextOpen = !isHistoryOpen;
    isHistoryOpen = nextOpen;
    if (nextOpen) {
      submissionHistory = loadSubmissionHistory();
    }
  }

  function loadSubmissionFromHistory(entry: SubmissionHistoryEntry) {
    try {
      const payload = entry.payload;

      queueEntries = deriveQueueEntriesFromHistory(payload);
      customTags = payload.customTags.map(cloneCustomTag);
      modifiedRelations = new Set(payload.modifiedRelations);

      contributorEmail = payload.contributor.email;
      contributorGithub = payload.contributor.github;
      contributorNote = payload.contributor.note;

      supersedesSubmissionId = payload.submissionId;
      activeSubmissionId = createSubmissionId();

      submissionHistory = loadSubmissionHistory();
      isHistoryOpen = false;

      // Reset transient UI state
      modal = { kind: 'none' };
      expandedLanguageToAddIndex = null;
      expandedLanguageToEditIndex = null;
      expandedRelationshipIndex = null;
      expandedReferenceIndex = null;
    } catch (error) {
      console.error('Failed to load submission from history', error);
      alert('Unable to load this submission. It was saved before ordered queues were supported.');
    }
  }

  function clearSupersedeLink() {
    supersedesSubmissionId = null;
  }

  function handleSubmit(event: Event) {
    event.preventDefault();
    
    // Queue is already persisted via $effect, force full page reload to preview
    if (browser) {
      window.location.href = '/';
    }
  }
</script>

<svelte:head>
  <title>Contribute - Tractable Circuit Zoo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 py-12 px-4 sm:px-6 lg:px-8">
  <div class="max-w-4xl mx-auto">
    <div class="text-center mb-12">
      <h1 class="text-5xl font-extrabold text-gray-900 mb-4 tracking-tight">
        Contribute to the Tractable Circuit Zoo
      </h1>
      <p class="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
        Help improve the Tractable Circuit Zoo by adding new languages or updating existing ones.
      </p>
      <p class="mt-4">
        <a href="https://github.com/dkahdian/tcz" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          View on GitHub
        </a>
      </p>
    </div>

    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">
      <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6">
        <h2 class="text-2xl font-bold text-white">Submission Form</h2>
        <p class="text-blue-100 mt-1">Fill out the details below to contribute</p>
      </div>

      <div class="p-8 sm:p-10">
        <form onsubmit={handleSubmit} class="space-y-8">
          <!-- Contributor Information (Shared) -->
          <div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-200">
            <h2 class="text-lg font-bold text-gray-900 mb-4">Contributor Information</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="contributor-email" class="block text-sm font-medium text-gray-700 mb-1">
                  Email Address <span class="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="contributor-email"
                  bind:value={contributorEmail}
                  required
                  class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="your.email@example.com"
                />
              </div>
              <div>
                <label for="contributor-github" class="block text-sm font-medium text-gray-700 mb-1">
                  GitHub Username (optional)
                </label>
                <input
                  type="text"
                  id="contributor-github"
                  bind:value={contributorGithub}
                  class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="@username"
                />
              </div>
            </div>
            <div class="mt-4">
              <label for="contributor-note" class="block text-sm font-medium text-gray-700 mb-1">
                Note (optional)
              </label>
              <textarea
                id="contributor-note"
                bind:value={contributorNote}
                rows="3"
                class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                placeholder="Add any clarifications or additional context for your contribution..."
              ></textarea>
              <p class="mt-1 text-xs text-gray-500">This note will be included in the pull request description.</p>
            </div>
          </div>

          <div class="flex justify-end">
            {#if supersedesSubmissionId}
              <div class="mr-auto mb-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-sm">
                <span class="font-medium">Editing prior submission</span>
                <button
                  type="button"
                  onclick={clearSupersedeLink}
                  class="rounded-md border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
                >
                  Stop
                </button>
              </div>
            {/if}
            <button
              type="button"
              onclick={toggleHistoryPanel}
              class="mb-3 inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-blue-400 hover:text-blue-600"
            >
              <span aria-hidden="true">🗂️</span>
              Submission history
              <svg class={`h-3 w-3 transition-transform ${isHistoryOpen ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          {#if isHistoryOpen}
            <div class="mb-6 rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 shadow-sm">
              <div class="mb-3 flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-800">Previous submissions</h3>
                <button
                  type="button"
                  onclick={toggleHistoryPanel}
                  class="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200/70 hover:text-gray-700"
                >
                  Close
                </button>
              </div>
              {#if submissionHistory.length === 0}
                <p class="text-sm text-gray-500">No saved submissions yet. Submit once to keep a snapshot.</p>
              {:else}
                <ul class="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {#each submissionHistory as entry}
                    {@const summary = formatHistorySummary(entry)}
                    {@const timestamp = formatHistoryTimestamp(entry.createdAt)}
                    <li class="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="space-y-1">
                          <div class="text-sm font-medium text-gray-800">{timestamp}</div>
                          <div class="text-xs text-gray-600">{summary}</div>
                          {#if entry.supersededBySubmissionId}
                            <div class="text-xs font-medium text-amber-600">Superseded</div>
                          {:else if entry.payload.submissionId === supersedesSubmissionId}
                            <div class="text-xs font-medium text-emerald-600">Currently editing clone</div>
                          {/if}
                        </div>
                        <button
                          type="button"
                          onclick={() => loadSubmissionFromHistory(entry)}
                          class="rounded-md border border-blue-500 px-3 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                        >
                          Load
                        </button>
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}

          <!-- Queued Items Section -->
          <ContributionQueue
            languages={getAvailableLanguages(data.languages, languageAddPayloads, languageEditPayloads)}
            languagesToAdd={languageAddPayloads}
            languagesToEdit={languageEditPayloads}
            newReferences={referenceValues}
            newSeparatingFunctions={separatingFunctionPayloads}
            relationships={relationshipPayloads}
            {modifiedRelations}
            existingReferenceIds={data.existingReferences.map(r => r.id)}
            {expandedLanguageToAddIndex}
            {expandedLanguageToEditIndex}
            {expandedReferenceIndex}
            {expandedSeparatingFunctionIndex}
            {expandedRelationshipIndex}
            onToggleExpandLanguageToAdd={(index) => expandedLanguageToAddIndex = expandedLanguageToAddIndex === index ? null : index}
            onToggleExpandLanguageToEdit={(index) => expandedLanguageToEditIndex = expandedLanguageToEditIndex === index ? null : index}
            onToggleExpandReference={(index) => expandedReferenceIndex = expandedReferenceIndex === index ? null : index}
            onToggleExpandSeparatingFunction={(index) => expandedSeparatingFunctionIndex = expandedSeparatingFunctionIndex === index ? null : index}
            onToggleExpandRelationship={(index) => expandedRelationshipIndex = expandedRelationshipIndex === index ? null : index}
            onEditLanguageToAdd={(index) => { modal = { kind: 'edit-queued-add', index }; }}
            onEditLanguageToEdit={(index) => { modal = { kind: 'edit-queued-edit', index }; }}
            onDeleteLanguageToAdd={handleDeleteLanguageToAdd}
            onDeleteLanguageToEdit={handleDeleteLanguageToEdit}
            onEditReference={(index) => { modal = { kind: 'edit-reference', index }; }}
            onDeleteReference={deleteReference}
            onEditSeparatingFunction={(index) => { modal = { kind: 'edit-sep-fn', index }; }}
            onDeleteSeparatingFunction={deleteSeparatingFunction}
            onEditRelationship={(index) => { modal = { kind: 'edit-relationship', index }; }}
            onDeleteRelationship={(index) => handleDeleteRelationship(index)}
          />
          <!-- END Queued Items Section -->

          <!-- Action Buttons -->
          <ActionButtons
            onAddLanguage={() => { modal = { kind: 'add-language' }; }}
            onEditLanguage={() => { modal = { kind: 'select-language-to-edit' }; }}
            onManageRelationships={() => { modal = { kind: 'add-relationship' }; }}
            onAddReference={() => { modal = { kind: 'add-reference' }; }}
            onAddSeparatingFunction={() => { modal = { kind: 'add-sep-fn' }; }}
          />

          <!-- Preview Button -->
          <PreviewButton disabled={!hasQueuedItems} />
        </form>
      </div>
    </div>
  </div>
</div>

<!-- Modals -->
<AddLanguageModal
  isOpen={isAddLangOpen}
  onClose={closeModal}
  onAdd={handleLanguageAddSubmit}
  isEdit={editAddIndex !== null}
  initialData={editAddIndex !== null ? languagesToAdd[editAddIndex]?.payload : undefined}
  queries={Object.values(data.queries).map(q => ({ code: q.code, name: q.label }))}
  transformations={Object.values(data.transformations).map(t => ({ code: t.code, name: t.label }))}
  complexityOptions={complexityOptions.map(p => ({ value: p.code, label: p.label, description: p.description || '' }))}
  existingTags={[...data.existingTags, ...customTags].map(t => ({ label: t.label, color: t.color || '#6366f1', description: '', refs: [] }))}
  availableRefs={getAvailableReferences(data.existingReferences, referenceValues)}
/>

<AddLanguageModal
  isOpen={isEditLangOpen}
  onClose={closeModal}
  onAdd={handleLanguageEditSubmit}
  isEdit={true}
  initialData={editLangInitialData}
  queries={Object.values(data.queries).map(q => ({ code: q.code, name: q.label }))}
  transformations={Object.values(data.transformations).map(t => ({ code: t.code, name: t.label }))}
  complexityOptions={complexityOptions.map(p => ({ value: p.code, label: p.label, description: p.description || '' }))}
  existingTags={[...data.existingTags, ...customTags].map(t => ({ label: t.label, color: t.color || '#6366f1', description: '', refs: [] }))}
  availableRefs={getAvailableReferences(data.existingReferences, referenceValues)}
/>

<!-- Language Selector Modal for Editing -->
{#if modal.kind === 'select-language-to-edit'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onclick={closeModal}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-white rounded-xl shadow-2xl max-w-md w-full" onclick={(e) => e.stopPropagation()}>
      <div class="bg-gradient-to-r from-yellow-600 to-yellow-700 px-6 py-4">
        <h2 class="text-2xl font-bold text-white">Select Language to Edit</h2>
        <p class="text-yellow-100 mt-1">Choose an existing language</p>
      </div>
      
      <div class="p-6">
        <label for="language-selector" class="block text-sm font-medium text-gray-700 mb-2">
          Language <span class="text-red-500">*</span>
        </label>
        <select
          id="language-selector"
          bind:value={selectedLanguageToEdit}
          class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
        >
          <option value="">Choose a language...</option>
          {#each data.languages as lang}
            <option value={lang.name}>{lang.name}</option>
          {/each}
        </select>
        
        <div class="flex gap-3 justify-end pt-4 mt-4 border-t">
          <button
            type="button"
            onclick={() => {
              selectedLanguageToEdit = '';
              closeModal();
            }}
            class="px-4 py-2 border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedLanguageToEdit}
            onclick={() => {
              if (selectedLanguageToEdit) {
                modal = { kind: 'edit-existing-language', name: selectedLanguageToEdit };
                selectedLanguageToEdit = '';
              }
            }}
            class="px-4 py-2 bg-yellow-600 text-white font-medium rounded-lg hover:bg-yellow-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<AddReferenceModal
  isOpen={modal.kind === 'add-reference' || modal.kind === 'edit-reference'}
  onClose={closeModal}
  onAdd={handleReferenceSubmit}
  initialValue={editRefIndex !== null ? newReferences[editRefIndex]?.ref : undefined}
  isEditMode={editRefIndex !== null}
/>

<AddSeparatingFunctionModal
  isOpen={modal.kind === 'add-sep-fn' || modal.kind === 'edit-sep-fn'}
  onClose={closeModal}
  onAdd={handleSepFnSubmit}
  initialValue={editSepIndex !== null ? newSeparatingFunctions[editSepIndex]?.payload : undefined}
  availableRefs={getAvailableReferences(data.existingReferences, referenceValues)}
  isEditMode={editSepIndex !== null}
/>

<ManageRelationshipModal
  isOpen={modal.kind === 'add-relationship' || modal.kind === 'edit-relationship'}
  onClose={closeModal}
  onSave={handleRelationshipSubmit}
  initialData={editRelIndex !== null ? relationships[editRelIndex]?.payload : undefined}
  languages={getAvailableLanguages(data.languages, languageAddPayloads, languageEditPayloads)}
  {statusOptions}
  availableRefs={getAvailableReferences(data.existingReferences, referenceValues)}
  availableSeparatingFunctions={getAvailableSeparatingFunctions(data.existingSeparatingFunctions, separatingFunctionPayloads)}
  {baselineRelations}
/>

<style>
  :global(body) {
    margin: 0;
  }
</style>
