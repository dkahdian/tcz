<script lang="ts">
  import type { ReferenceForTooltip } from '../../../routes/contribute/logic.js';

  type Language = {
    id: string;
    name: string;
  };

  type Relationship = {
    sourceId: string;
    targetId: string;
    status: string;
    description?: string;
    assumption?: string;
    refs: string[];
  };

  type BaselineRelationship = {
    status: string;
    description?: string;
    assumption?: string;
    refs: string[];
    derived?: boolean;
  };

  type StatusOption = {
    value: string;
    label: string;
    description: string;
  };

  type Props = {
    isOpen: boolean;
    onClose: () => void;
    onSave: (relationship: Relationship) => void;
    languages: Language[];
    statusOptions: StatusOption[];
    availableRefs?: ReferenceForTooltip[];
    baselineRelations?: Map<string, BaselineRelationship>; // key is "sourceId->targetId"
    initialData?: Relationship; // For editing existing relationships
  };

  let { 
    isOpen = false, 
    onClose, 
    onSave, 
    languages, 
    statusOptions, 
    availableRefs = [],
    baselineRelations = new Map(),
    initialData
  }: Props = $props();

  let sourceId = $state('');
  let targetId = $state('');
  let status = $state<string>('');
  let description = $state('');
  let assumption = $state('');
  let selectedRefs = $state<string[]>([]);
  
  // Track if we're in edit mode to prevent auto-populate from overwriting
  let isEditMode = $state(false);

  // Populate form when initialData is provided (edit mode)
  $effect(() => {
    if (isOpen && initialData) {
      isEditMode = true;
      sourceId = initialData.sourceId;
      targetId = initialData.targetId;
      status = initialData.status;
      description = initialData.description || '';
      assumption = initialData.assumption || '';
      selectedRefs = [...initialData.refs];
    } else if (isOpen && !initialData) {
      isEditMode = false;
    }
  });

  // Auto-populate when source and target are selected (only in non-edit mode)
  $effect(() => {
    // Skip auto-populate when editing an existing queue item
    if (isEditMode) return;
    
    if (sourceId && targetId && sourceId !== targetId) {
      const key = `${sourceId}->${targetId}`;
      const baseline = baselineRelations.get(key);
      
      if (baseline) {
        // Relationship exists - populate with existing data
        status = baseline.status;
        description = baseline.description || '';
        assumption = baseline.assumption || '';
        selectedRefs = [...baseline.refs];
      } else {
        // No baseline exists - clear to defaults for a new edge
        status = '';
        description = '';
        assumption = '';
        selectedRefs = [];
      }
    }
  });

  function resetForm() {
    sourceId = '';
    targetId = '';
    status = '';
    description = '';
    assumption = '';
    selectedRefs = [];
    isEditMode = false;
  }

  function handleSubmit() {
    if (!sourceId || !targetId || !status || sourceId === targetId) return;
    
    onSave({
      sourceId,
      targetId,
      status,
      description: description || undefined,
      assumption: assumption || undefined,
      refs: selectedRefs
    });
    
    resetForm();
    onClose();
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  function toggleRef(refId: string) {
    if (selectedRefs.includes(refId)) {
      selectedRefs = selectedRefs.filter(r => r !== refId);
    } else {
      selectedRefs = [...selectedRefs, refId];
    }
  }

</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onclick={handleCancel}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
      <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10">
        <h2 class="text-2xl font-bold text-white">Manage Relationship</h2>
        <p class="text-blue-100 mt-1">Add or update succinctness relationships</p>
      </div>

      <div class="p-6 space-y-4">
        <!-- Source and Target -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="rel-source" class="block text-sm font-medium text-gray-700 mb-1">
              Source Language <span class="text-red-500">*</span>
            </label>
            <select
              id="rel-source"
              bind:value={sourceId}
              class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select source...</option>
              {#each languages as lang}
                <option value={lang.id}>{lang.name}</option>
              {/each}
            </select>
          </div>

          <div>
            <label for="rel-target" class="block text-sm font-medium text-gray-700 mb-1">
              Target Language <span class="text-red-500">*</span>
            </label>
            <select
              id="rel-target"
              bind:value={targetId}
              class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select target...</option>
              {#each languages as lang}
                <option value={lang.id} disabled={lang.id === sourceId}>{lang.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Status -->
        <div>
          <label for="rel-status" class="block text-sm font-medium text-gray-700 mb-1">
            Classification <span class="text-red-500">*</span>
          </label>
          <select
            id="rel-status"
            bind:value={status}
            class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select classification...</option>
            {#each statusOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          {#if status}
            {@const selectedOption = statusOptions.find(o => o.value === status)}
            {#if selectedOption}
              <p class="text-xs text-gray-500 mt-1">{selectedOption.description}</p>
            {/if}
          {/if}
        </div>

        <!-- Description -->
        <div>
          <label for="rel-description" class="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="rel-description"
            bind:value={description}
            rows="3"
            class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            placeholder="Describe this succinctness relationship (optional)..."
          ></textarea>
        </div>

        <!-- Assumption -->
        <div>
          <label for="rel-assumption" class="block text-sm font-medium text-gray-700 mb-1">
            Assumption
          </label>
          <input
            type="text"
            id="rel-assumption"
            bind:value={assumption}
            class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., the polynomial hierarchy does not collapse"
          />
          <p class="text-xs text-gray-500 mt-1">
            Complexity assumption for the relationship, displayed as "assuming {'{assumption}'}".
          </p>
        </div>

        <!-- References -->
        {#if availableRefs.length > 0}
          <fieldset>
            <legend class="block text-sm font-medium text-gray-700 mb-2">References</legend>
            <div class="flex flex-wrap gap-2">
              {#each availableRefs as ref}
                <button
                  type="button"
                  onclick={() => toggleRef(ref.id)}
                  class={`px-3 py-1 text-sm rounded-lg border-2 transition-colors ${
                    selectedRefs.includes(ref.id)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                  }`}
                  title={ref.title}
                >
                  {ref.id}
                </button>
              {/each}
            </div>
          </fieldset>
        {/if}

        <!-- Actions -->
        <div class="flex gap-3 justify-end pt-4 border-t">
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
            disabled={!sourceId || !targetId || !status || sourceId === targetId}
            class="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Save Relationship
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
