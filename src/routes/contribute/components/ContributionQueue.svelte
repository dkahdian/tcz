<script lang="ts">
  import type { LanguageToAdd, RelationshipEntry, ReferenceToAdd } from '../types.js';
  import { relationKey } from '../logic.js';
  import LanguageQueueItem from './LanguageQueueItem.svelte';
  import ReferenceQueueItem from './ReferenceQueueItem.svelte';
  import RelationshipQueueItem from './RelationshipQueueItem.svelte';

  import { generateReferenceId } from '$lib/utils/reference-id.js';

  /**
   * Display all queued contribution items
   */
  let {
    languages,
    languagesToAdd,
    languagesToEdit,
    newReferences,
    relationships,
    modifiedRelations,
    existingReferenceIds = [],
    expandedLanguageToAddIndex,
    expandedLanguageToEditIndex,
    expandedReferenceIndex,
    expandedRelationshipIndex,
    onToggleExpandLanguageToAdd,
    onToggleExpandLanguageToEdit,
    onToggleExpandReference,
    onToggleExpandRelationship,
    onEditLanguageToAdd,
    onEditLanguageToEdit,
    onDeleteLanguageToAdd,
    onDeleteLanguageToEdit,
    onEditReference,
    onDeleteReference,
    onEditRelationship,
    onDeleteRelationship
  }: {
    languages: Array<{ id: string; name: string }>;
    languagesToAdd: LanguageToAdd[];
    languagesToEdit: LanguageToAdd[];
    newReferences: ReferenceToAdd[];
    relationships: RelationshipEntry[];
    modifiedRelations: Set<string>;
    existingReferenceIds?: string[];
    expandedLanguageToAddIndex: number | null;
    expandedLanguageToEditIndex: number | null;
    expandedReferenceIndex: number | null;
    expandedRelationshipIndex: number | null;
    onToggleExpandLanguageToAdd: (index: number) => void;
    onToggleExpandLanguageToEdit: (index: number) => void;
    onToggleExpandReference: (index: number) => void;
    onToggleExpandRelationship: (index: number) => void;
    onEditLanguageToAdd: (index: number) => void;
    onEditLanguageToEdit: (index: number) => void;
    onDeleteLanguageToAdd: (index: number) => void;
    onDeleteLanguageToEdit: (index: number) => void;
    onEditReference: (index: number) => void;
    onDeleteReference: (index: number) => void;
    onEditRelationship: (index: number) => void;
    onDeleteRelationship: (index: number, key: string) => void;
  } = $props();

  const hasAnyItems = $derived(
    languagesToAdd.length > 0 ||
    languagesToEdit.length > 0 ||
    newReferences.length > 0 ||
    relationships.filter((rel) => modifiedRelations.has(relationKey(rel.sourceId, rel.targetId))).length > 0
  );

  /**
   * Compute the existing reference IDs at each index, including both existing and previous new references.
   * This is used to generate unique IDs for new references in the preview.
   */
  function getExistingIdsAtIndex(index: number): string[] {
    const ids = [...existingReferenceIds];
    const idsSet = new Set(ids);
    for (let i = 0; i < index; i++) {
      const prevId = generateReferenceId(newReferences[i].bibtex, idsSet);
      ids.push(prevId);
      idsSet.add(prevId);
    }
    return ids;
  }
</script>

<div class="space-y-3">
  <h2 class="text-lg font-bold text-gray-900">Queued Changes</h2>
  <p class="text-sm text-gray-600">Items you've added will appear here.</p>
  
  <div class="space-y-2">
    <!-- References -->
    {#each newReferences as ref, index}
      <ReferenceQueueItem
        reference={ref}
        {index}
        existingReferenceIds={getExistingIdsAtIndex(index)}
        isExpanded={expandedReferenceIndex === index}
        onToggleExpand={onToggleExpandReference}
        onEdit={onEditReference}
        onDelete={onDeleteReference}
      />
    {/each}

    <!-- Languages to Add -->
    {#each languagesToAdd as lang, index}
      <LanguageQueueItem
        language={lang}
        {index}
        isExpanded={expandedLanguageToAddIndex === index}
        isEdit={false}
        onToggleExpand={onToggleExpandLanguageToAdd}
        onEdit={onEditLanguageToAdd}
        onDelete={onDeleteLanguageToAdd}
      />
    {/each}

    <!-- Languages to Edit -->
    {#each languagesToEdit as lang, index}
      <LanguageQueueItem
        language={lang}
        {index}
        isExpanded={expandedLanguageToEditIndex === index}
        isEdit={true}
        onToggleExpand={onToggleExpandLanguageToEdit}
        onEdit={onEditLanguageToEdit}
        onDelete={onDeleteLanguageToEdit}
      />
    {/each}

    <!-- Relationships -->
    {#each relationships as rel, index}
      {@const isModified = modifiedRelations.has(relationKey(rel.sourceId, rel.targetId))}
      <RelationshipQueueItem
        {languages}
        relationship={rel}
        {index}
        {isModified}
        isExpanded={expandedRelationshipIndex === index}
        onToggleExpand={onToggleExpandRelationship}
        onEdit={onEditRelationship}
        onDelete={onDeleteRelationship}
      />
    {/each}

    {#if !hasAnyItems}
      <div class="text-center py-8 text-gray-500 italic">
        No changes queued yet. Use the buttons below to add items.
      </div>
    {/if}
  </div>
</div>
