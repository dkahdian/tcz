<script lang="ts">
  /**
   * Action buttons for adding/editing contribution items
   */
  let {
    onAddLanguage,
    onEditLanguage,
    onManageRelationships,
    onAddReference
  }: {
    onAddLanguage: () => void;
    onEditLanguage: () => void;
    onManageRelationships: () => void;
    onAddReference: () => void;
  } = $props();
</script>

<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
  <button
    type="button"
    onclick={onAddLanguage}
    class="px-3 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
  >
    New Language
  </button>
  
  <button
    type="button"
    onclick={onEditLanguage}
    class="px-3 py-3 bg-yellow-600 hover:bg-yellow-700 text-white font-medium rounded-lg transition-colors"
  >
    Edit Language
  </button>
  
  <button
    type="button"
    onclick={onManageRelationships}
    class="px-3 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
  >
    Relationship
  </button>
  
  <button
    type="button"
    onclick={onAddReference}
    class="px-3 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
  >
    Reference
  </button>
</div>
