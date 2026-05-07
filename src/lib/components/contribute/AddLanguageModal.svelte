<script lang="ts">
  import type { ReferenceForTooltip } from '../../../routes/contribute/logic.js';

  type Language = {
    id?: string;
    name: string;
    fullName: string;
    definition: string;
    definitionRefs: string[];
    queries: Record<string, { complexity: string; assumption?: string; refs: string[] }>;
    transformations: Record<string, { complexity: string; assumption?: string; refs: string[] }>;
    tags: Array<{ label: string; color: string; description?: string; refs: string[] }>;
    existingReferences: string[];
  };

  type Query = { code: string; name: string };
  type Transformation = { code: string; name: string };
  type ComplexityOption = { value: string; label: string; description: string };
  type Tag = { label: string; color: string; description?: string; refs: string[] };

  type OperationResult = {
    success: boolean;
    error?: string;
  };

  type MaybePromise<T> = T | Promise<T>;

  type Props = {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (language: Language) => MaybePromise<void | OperationResult>;
    queries: Query[];
    transformations: Transformation[];
    complexityOptions: ComplexityOption[];
    existingTags: Tag[];
    availableRefs?: ReferenceForTooltip[];
    isEdit?: boolean;
    initialData?: Language;
  };

  let {
    isOpen = false,
    onClose,
    onAdd,
    queries,
    transformations,
    complexityOptions,
    existingTags,
    availableRefs = [],
    isEdit = false,
    initialData
  }: Props = $props();

  let name = $state('');
  let languageId = $state<string | undefined>(undefined);
  let fullName = $state('');
  let definition = $state('');
  let definitionRefs = $state<string[]>([]);
  let querySupport = $state<Record<string, { complexity: string; assumption?: string; refs: string[] }>>({});
  let transformationSupport = $state<Record<string, { complexity: string; assumption?: string; refs: string[] }>>({});
  let selectedTags = $state<Tag[]>([]);
  let selectedExistingRefs = $state<string[]>([]);
  let errorMessage = $state<string | null>(null);

  // Initialize from initial data if editing, and always reset init flags
  // so the fill-all-slots effect re-runs (guards against stale state when
  // the modal is closed by switching to a different modal without resetForm).
  $effect(() => {
    if (isOpen) {
      if (isEdit && initialData) {
        languageId = initialData.id;
        name = initialData.name;
        fullName = initialData.fullName;
        definition = initialData.definition;
        definitionRefs = [...initialData.definitionRefs];
        querySupport = { ...initialData.queries };
        transformationSupport = { ...initialData.transformations };
        selectedTags = [...initialData.tags];
        selectedExistingRefs = [...initialData.existingReferences];
        errorMessage = null;
      }
      queriesInitialized = false;
      transformationsInitialized = false;
    }
  });

  function resetForm() {
    languageId = undefined;
    name = '';
    fullName = '';
    definition = '';
    definitionRefs = [];
    querySupport = {};
    transformationSupport = {};
    selectedTags = [];
    selectedExistingRefs = [];
    queriesInitialized = false;
    transformationsInitialized = false;
    errorMessage = null;
  }

  async function handleSubmit() {
    if (!name.trim() || !fullName.trim() || !definition.trim()) {
      errorMessage = 'Please fill out all required fields.';
      return;
    }

    try {
      const result = await onAdd({
        id: languageId,
        name: name.trim(),
        fullName: fullName.trim(),
        definition: definition.trim(),
        definitionRefs,
        queries: querySupport,
        transformations: transformationSupport,
        tags: selectedTags,
        existingReferences: selectedExistingRefs
      });

      const operationResult: OperationResult | undefined =
        result && typeof result === 'object' && 'success' in result
          ? result as OperationResult
          : undefined;

      if (operationResult && !operationResult.success) {
        errorMessage = operationResult.error ?? 'Unable to add language. Please review your input.';
        return;
      }

      errorMessage = null;
      resetForm();
      onClose?.();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unexpected error while adding the language.';
    }
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  function toggleDefinitionRef(refId: string) {
    if (definitionRefs.includes(refId)) {
      definitionRefs = definitionRefs.filter(r => r !== refId);
    } else {
      definitionRefs = [...definitionRefs, refId];
    }
  }

  function toggleExistingRef(refId: string) {
    if (selectedExistingRefs.includes(refId)) {
      selectedExistingRefs = selectedExistingRefs.filter(r => r !== refId);
    } else {
      selectedExistingRefs = [...selectedExistingRefs, refId];
    }
  }

  function toggleTag(tag: Tag) {
    if (selectedTags.some(t => t.label === tag.label)) {
      selectedTags = selectedTags.filter(t => t.label !== tag.label);
    } else {
      selectedTags = [...selectedTags, tag];
    }
  }

  function toggleQueryRef(queryCode: string, refId: string) {
    if (!querySupport[queryCode]) return;
    const refs = querySupport[queryCode].refs;
    if (refs.includes(refId)) {
      querySupport[queryCode].refs = refs.filter(r => r !== refId);
    } else {
      querySupport[queryCode].refs = [...refs, refId];
    }
    querySupport = { ...querySupport };
  }

  function toggleTransformRef(transformCode: string, refId: string) {
    if (!transformationSupport[transformCode]) return;
    const refs = transformationSupport[transformCode].refs;
    if (refs.includes(refId)) {
      transformationSupport[transformCode].refs = refs.filter(r => r !== refId);
    } else {
      transformationSupport[transformCode].refs = [...refs, refId];
    }
    transformationSupport = { ...transformationSupport };
  }

  let queriesInitialized = $state(false);
  let transformationsInitialized = $state(false);

  // Initialize support records for all queries/transformations
  $effect(() => {
    if (queries.length > 0 && !queriesInitialized) {
      const merged: typeof querySupport = {};
      queries.forEach(q => {
        if (isEdit && initialData && initialData.queries[q.code]) {
          // Copy data from initialData, creating new objects for reactivity
          const source = initialData.queries[q.code];
          merged[q.code] = { 
            complexity: source.complexity, 
            assumption: source.assumption || '', 
            refs: [...source.refs] 
          };
        } else {
          merged[q.code] = { complexity: 'unknown-to-us', assumption: '', refs: [] };
        }
      });
      querySupport = merged;
      queriesInitialized = true;
    }
  });

  $effect(() => {
    if (transformations.length > 0 && !transformationsInitialized) {
      const merged: typeof transformationSupport = {};
      transformations.forEach(t => {
        if (isEdit && initialData) {
          // Try both display code (∧C) and safe keys to find matching data
          let source = initialData.transformations[t.code];
          if (!source) {
            // Look for safe key that maps to this display code
            const safeKey = Object.keys(initialData.transformations).find(key => {
              return initialData.transformations[key] !== undefined && (
                key === t.code ||
                (t.code === '∧C' && key === 'AND_C') ||
                (t.code === '∧BC' && key === 'AND_BC') ||
                (t.code === '∨C' && key === 'OR_C') ||
                (t.code === '∨BC' && key === 'OR_BC') ||
                (t.code === '¬C' && key === 'NOT_C')
              );
            });
            if (safeKey) {
              source = initialData.transformations[safeKey];
            }
          }
          // Copy data, creating new objects for reactivity
          merged[t.code] = source
            ? { complexity: source.complexity, assumption: source.assumption || '', refs: [...source.refs] }
            : { complexity: 'unknown-to-us', assumption: '', refs: [] };
        } else {
          merged[t.code] = { complexity: 'unknown-to-us', assumption: '', refs: [] };
        }
      });
      transformationSupport = merged;
      transformationsInitialized = true;
    }
  });
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onclick={handleCancel}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
      <div class="bg-gradient-to-r from-green-600 to-green-700 px-6 py-4 sticky top-0 z-10">
        <h2 class="text-2xl font-bold text-white">{isEdit ? 'Edit' : 'Add New'} Language</h2>
        <p class="text-green-100 mt-1">Define a knowledge compilation language</p>
      </div>

      <div class="p-6 space-y-6">
        {#if errorMessage}
          <div class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMessage}
          </div>
        {/if}

        <!-- Basic Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-bold text-gray-900">Basic Information</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label for="lang-name" class="block text-sm font-medium text-gray-700 mb-1">
                Short Name <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="lang-name"
                bind:value={name}
                placeholder="e.g., 'OBDD', 'd-DNNF'"
                class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>

            <div>
              <label for="lang-fullname" class="block text-sm font-medium text-gray-700 mb-1">
                Full Name <span class="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="lang-fullname"
                bind:value={fullName}
                placeholder="e.g., 'Ordered Binary Decision Diagrams'"
                class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>

          <div>
            <label for="lang-definition" class="block text-sm font-medium text-gray-700 mb-1">
              Definition <span class="text-red-500">*</span>
            </label>
            <textarea
              id="lang-definition"
              bind:value={definition}
              placeholder="Formal definition of this language..."
              rows="3"
              class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            ></textarea>
          </div>

          {#if availableRefs.length > 0}
            <fieldset>
              <legend class="block text-sm font-medium text-gray-700 mb-2">Definition References</legend>
              <div class="flex flex-wrap gap-2">
                {#each availableRefs as ref}
                  <button
                    type="button"
                    onclick={() => toggleDefinitionRef(ref.id)}
                    class={`px-3 py-1 text-sm rounded-lg border-2 transition-colors ${
                      definitionRefs.includes(ref.id)
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-green-300'
                    }`}
                    title={ref.title}
                  >
                    {ref.id}
                  </button>
                {/each}
              </div>
            </fieldset>
          {/if}
        </div>

        <!-- Queries -->
        <div class="space-y-4 border-t pt-6">
          <h3 class="text-lg font-bold text-gray-900">Query Support</h3>
          <div class="space-y-3">
            {#each queries as query}
              {#if querySupport[query.code]}
                <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label for="query-{query.code}-complexity" class="block text-xs font-medium text-gray-700 mb-1">{query.name}</label>
                      <select
                        id="query-{query.code}-complexity"
                        bind:value={querySupport[query.code].complexity}
                        class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                      >
                        {#each complexityOptions as option}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    </div>
                    <div>
                      <label for="query-{query.code}-assumption" class="block text-xs font-medium text-gray-700 mb-1">Assumption</label>
                      <input
                        id="query-{query.code}-assumption"
                        type="text"
                        bind:value={querySupport[query.code].assumption}
                        placeholder="e.g., P \\neq NP"
                        class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                      />
                  </div>
                </div>
                  {#if availableRefs.length > 0}
                    <div class="mt-2 flex flex-wrap gap-1">
                      {#each availableRefs as ref}
                        <button
                          type="button"
                          onclick={() => toggleQueryRef(query.code, ref.id)}
                          class={`px-2 py-0.5 text-xs rounded ${
                            querySupport[query.code].refs.includes(ref.id)
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                          title={ref.title}
                        >
                          {ref.id}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        </div>

        <!-- Transformations -->
        <div class="space-y-4 border-t pt-6">
          <h3 class="text-lg font-bold text-gray-900">Transformation Support</h3>
          <div class="space-y-3">
            {#each transformations as transform}
              {#if transformationSupport[transform.code]}
                <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label for="transform-{transform.code}-complexity" class="block text-xs font-medium text-gray-700 mb-1">{transform.name}</label>
                      <select
                        id="transform-{transform.code}-complexity"
                        bind:value={transformationSupport[transform.code].complexity}
                        class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                      >
                        {#each complexityOptions as option}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    </div>
                    <div>
                      <label for="transform-{transform.code}-assumption" class="block text-xs font-medium text-gray-700 mb-1">Assumption</label>
                      <input
                        id="transform-{transform.code}-assumption"
                        type="text"
                        bind:value={transformationSupport[transform.code].assumption}
                        placeholder="e.g., P \\neq NP"
                        class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                      />
                  </div>
                </div>
                  {#if availableRefs.length > 0}
                    <div class="mt-2 flex flex-wrap gap-1">
                      {#each availableRefs as ref}
                        <button
                          type="button"
                          onclick={() => toggleTransformRef(transform.code, ref.id)}
                          class={`px-2 py-0.5 text-xs rounded ${
                            transformationSupport[transform.code].refs.includes(ref.id)
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                          title={ref.title}
                        >
                          {ref.id}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        </div>

        <!-- Tags -->
        {#if existingTags.length > 0}
          <div class="space-y-4 border-t pt-6">
            <h3 class="text-lg font-bold text-gray-900">Tags</h3>
            <div class="flex flex-wrap gap-2">
              {#each existingTags as tag}
                <button
                  type="button"
                  onclick={() => toggleTag(tag)}
                  class={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                    selectedTags.some(t => t.label === tag.label)
                      ? 'ring-2 ring-offset-2'
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  style="background-color: {tag.color}; color: white; {selectedTags.some(t => t.label === tag.label) ? `ring-color: ${tag.color};` : ''}"
                >
                  {tag.label}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Actions -->
        <div class="flex gap-3 justify-end pt-6 border-t sticky bottom-0 bg-white">
          <button
            type="button"
            onclick={handleCancel}
            class="px-4 py-2 border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={handleSubmit}
            disabled={!name.trim() || !fullName.trim() || !definition.trim()}
            class="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isEdit ? 'Update' : 'Add'} Language
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
