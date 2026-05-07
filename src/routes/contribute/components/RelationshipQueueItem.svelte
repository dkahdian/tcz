<script lang="ts">
	import type { RelationshipEntry } from '../types.js';
	import { relationKey } from '../logic.js';
	import GenericQueueItem from './GenericQueueItem.svelte';
  import MathText from '$lib/components/MathText.svelte';
  import { formatAssumptionForMathText } from '$lib/utils/math-text.js';

	/**
	 * Display a single queued relationship
	 */
	let {
		languages,
		relationship,
		index,
		isExpanded = false,
		isModified = false,
		onToggleExpand,
		onEdit,
		onDelete
	}: {
		languages: Array<{ id: string; name: string }>;
		relationship: RelationshipEntry;
		index: number;
		isExpanded?: boolean;
		isModified?: boolean;
		onToggleExpand: (index: number) => void;
		onEdit: (index: number) => void;
		onDelete: (index: number, key: string) => void;
	} = $props();

	const idToName = new Map(languages.map(lang => [lang.id, lang.name]));
	const key = relationKey(relationship.sourceId, relationship.targetId);
	const sourceName = idToName.get(relationship.sourceId) ?? relationship.sourceId;
	const targetName = idToName.get(relationship.targetId) ?? relationship.targetId;
	const subtitle = `${sourceName} → ${targetName}`;
</script>

{#if isModified}
	<GenericQueueItem
		type="Relationship"
		title={subtitle}
		subtitle={relationship.status}
		colorScheme="blue"
		{index}
		{isExpanded}
		{onToggleExpand}
		onEdit={() => onEdit(index)}
		onDelete={() => onDelete(index, key)}
	>
		{#snippet children()}
			<div class="space-y-3 text-xs">
				<div>
					<div class="font-semibold text-gray-700 mb-1">Source Language:</div>
					<div class="bg-white p-2 rounded border">
						<MathText text={sourceName} className="font-medium text-gray-900" />
					</div>
				</div>
				<div>
					<div class="font-semibold text-gray-700 mb-1">Target Language:</div>
					<div class="bg-white p-2 rounded border">
						<MathText text={targetName} className="font-medium text-gray-900" />
					</div>
				</div>
				<div>
					<div class="font-semibold text-gray-700 mb-1">Classification:</div>
					<div class="bg-white p-2 rounded border">
						<span class="font-mono text-gray-900">{relationship.status}</span>
					</div>
				</div>
				{#if relationship.description}
					<div>
						<div class="font-semibold text-gray-700 mb-1">Description:</div>
						<div class="bg-white p-2 rounded border">
							<MathText text={relationship.description} className="text-gray-700" />
						</div>
					</div>
				{/if}
				{#if relationship.assumption}
					<div>
						<div class="font-semibold text-gray-700 mb-1">Assumption:</div>
						<div class="bg-white p-2 rounded border">
							<span class="text-gray-700">Assuming </span>
							<MathText text={formatAssumptionForMathText(relationship.assumption)} className="inline text-gray-700" />
						</div>
					</div>
				{/if}
				{#if relationship.separatingFunctionIds && relationship.separatingFunctionIds.length > 0}
					<div>
						<div class="font-semibold text-gray-700 mb-1">
							Separating Functions ({relationship.separatingFunctionIds.length}):
						</div>
						<div class="flex flex-wrap gap-1">
							{#each relationship.separatingFunctionIds as sfId}
								<span class="inline-block bg-orange-100 text-orange-800 px-2 py-0.5 rounded text-xs border border-orange-300">
									{sfId}
								</span>
							{/each}
						</div>
					</div>
				{/if}
				{#if relationship.refs && relationship.refs.length > 0}
					<div>
						<div class="font-semibold text-gray-700 mb-1">
							References ({relationship.refs.length}):
						</div>
						<div class="flex flex-wrap gap-1">
							{#each relationship.refs as ref}
								<span class="inline-block bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs border border-purple-300">
									{ref}
								</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/snippet}
	</GenericQueueItem>
{/if}
