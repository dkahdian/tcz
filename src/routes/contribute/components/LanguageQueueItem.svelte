<script lang="ts">
  import MathText from '$lib/components/MathText.svelte';
  import { formatAssumptionForMathText } from '$lib/utils/math-text.js';
	import type { LanguageToAdd } from '../types.js';
	import GenericQueueItem from './GenericQueueItem.svelte';

	/**
	 * Display a single queued language (for add or edit)
	 */
	let {
		language,
		index,
		isExpanded = false,
		isEdit = false,
		onToggleExpand,
		onEdit,
		onDelete
	}: {
		language: LanguageToAdd;
		index: number;
		isExpanded?: boolean;
		isEdit?: boolean;
		onToggleExpand: (index: number) => void;
		onEdit: (index: number) => void;
		onDelete: (index: number) => void;
	} = $props();

	const colorScheme = isEdit ? 'yellow' : 'green';
</script>

<GenericQueueItem
	type={isEdit ? 'Edit Language' : 'New Language'}
	title={language.name}
	subtitle={language.definition}
	{colorScheme}
	{index}
	{isExpanded}
	{onToggleExpand}
	{onEdit}
	{onDelete}
>
	{#snippet children()}
		<div class="space-y-3 text-xs">
			<div>
				<div class="font-semibold text-gray-700 mb-1">Full Name:</div>
				<div class="bg-white p-2 rounded border">
					<MathText text={language.fullName} className="text-gray-900 block" />
				</div>
			</div>
			<div>
				<div class="font-semibold text-gray-700 mb-1">Definition:</div>
				<div class="bg-white p-2 rounded border">
					<MathText text={language.definition} className="text-gray-900 block" />
				</div>
			</div>
			{#if language.definitionRefs && language.definitionRefs.length > 0}
				<div>
					<div class="font-semibold text-gray-700 mb-1">
						Definition References ({language.definitionRefs.length}):
					</div>
					<div class="flex flex-wrap gap-1">
						{#each language.definitionRefs as ref}
							<span class="inline-block bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs border border-purple-300">
								{ref}
							</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if language.existingReferences && language.existingReferences.length > 0}
				<div>
					<div class="font-semibold text-gray-700 mb-1">
						Existing References ({language.existingReferences.length}):
					</div>
					<div class="flex flex-wrap gap-1">
						{#each language.existingReferences as ref}
							<span class="inline-block bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs border border-gray-300">
								{ref}
							</span>
						{/each}
					</div>
				</div>
			{/if}
			{#if language.queries && Object.keys(language.queries).length > 0}
				<div>
					<div class="font-semibold text-gray-700 mb-1">
						Query Support ({Object.keys(language.queries).length}):
					</div>
					<div class="grid grid-cols-2 gap-2">
						{#each Object.entries(language.queries) as [code, support]}
								<div class="bg-white p-2 rounded border">
									<div class="font-medium">{code}</div>
									<div class="text-gray-600">{support.complexity}</div>
									{#if support.assumption}
										<div class="text-gray-500 italic text-xs">
											<span>Assuming </span><MathText text={formatAssumptionForMathText(support.assumption)} className="inline" />
										</div>
									{/if}
								{#if support.refs.length > 0}
									<div class="text-gray-500 text-xs">Refs: [{support.refs.join(', ')}]</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
			{#if language.transformations && Object.keys(language.transformations).length > 0}
				<div>
					<div class="font-semibold text-gray-700 mb-1">
						Transformation Support ({Object.keys(language.transformations).length}):
					</div>
					<div class="grid grid-cols-2 gap-2">
						{#each Object.entries(language.transformations) as [code, support]}
								<div class="bg-white p-2 rounded border">
									<div class="font-medium">{code}</div>
									<div class="text-gray-600">{support.complexity}</div>
									{#if support.assumption}
										<div class="text-gray-500 italic text-xs">
											<span>Assuming </span><MathText text={formatAssumptionForMathText(support.assumption)} className="inline" />
										</div>
									{/if}
								{#if support.refs.length > 0}
									<div class="text-gray-500 text-xs">Refs: [{support.refs.join(', ')}]</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/snippet}
</GenericQueueItem>
