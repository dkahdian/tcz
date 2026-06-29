<script lang="ts">
	import ReferenceClaimTags from '$lib/components/ReferenceClaimTags.svelte';
	import { initialGraphData } from '$lib/data/index.js';
	import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';
	import { allReferences, getGlobalRefNumber } from '$lib/data/references.js';
	import type { KCReference } from '$lib/types.js';

	type SortMode = 'alpha' | 'year';
	type ClaimKind = 'query' | 'transformation' | 'edge';

	type ClaimTag =
		| {
				id: string;
				kind: 'edge';
				sourceName: string;
				targetName: string;
				href: string;
				status: string;
				title: string;
		  }
		| {
				id: string;
				kind: 'query' | 'transformation';
				languageName: string;
				operationCode: string;
				href: string;
				status: string;
				title: string;
		  };

	let searchQuery = $state('');
	let sortMode: SortMode = $state('alpha');
	let copiedRefId: string | null = $state(null);

	const claimTagsByRef = $derived.by(() => {
		const languageById = new Map(initialGraphData.languages.map((language) => [language.id, language]));
		const tagsByRef = new Map<string, Map<string, ClaimTag>>();

		const registerTag = (refId: string, tag: ClaimTag) => {
			const normalizedRefId = refId.toLowerCase();
			const existing = tagsByRef.get(normalizedRefId) ?? new Map<string, ClaimTag>();
			existing.set(tag.id, tag);
			tagsByRef.set(normalizedRefId, existing);
		};

		const edgeLanguageIds = initialGraphData.adjacencyMatrix.languageIds;
		const edgeMatrix = initialGraphData.adjacencyMatrix.matrix;

		for (let sourceIndex = 0; sourceIndex < edgeLanguageIds.length; sourceIndex += 1) {
			for (let targetIndex = 0; targetIndex < edgeLanguageIds.length; targetIndex += 1) {
				const relation = edgeMatrix[sourceIndex]?.[targetIndex];
				if (!relation) continue;
				if (relation.derived) continue;

				const sourceId = edgeLanguageIds[sourceIndex];
				const targetId = edgeLanguageIds[targetIndex];
				const sourceName = languageById.get(sourceId)?.name ?? sourceId;
				const targetName = languageById.get(targetId)?.name ?? targetId;

				const refIds = new Set<string>([
					...(relation.refs ?? []),
					...(relation.noPolyDescription && !relation.noPolyDescription.derived
						? relation.noPolyDescription.refs
						: []),
					...(relation.quasiDescription && !relation.quasiDescription.derived
						? relation.quasiDescription.refs
						: [])
				]);

				if (refIds.size === 0) continue;

				const edgeTag: ClaimTag = {
					id: `edge:${sourceId}->${targetId}`,
					kind: 'edge',
					sourceName,
					targetName,
					href: `/#edge/${sourceId}/${targetId}`,
					status: relation.status,
					title: `Open ${sourceName} -> ${targetName} on the map`
				};

				for (const refId of refIds) {
					registerTag(refId, edgeTag);
				}
			}
		}

		for (const language of initialGraphData.languages) {
			for (const [safeKey, opDef] of Object.entries(QUERIES)) {
				const support =
					language.properties.queries?.[safeKey] ?? language.properties.queries?.[opDef.code];
				if (!support?.refs?.length) continue;
				if (support.derived) continue;

				const queryTag: ClaimTag = {
					id: `query:${language.id}:${safeKey}`,
					kind: 'query',
					languageName: language.name,
					operationCode: opDef.code,
					href: `/#op/${language.id}/${safeKey}`,
					status: support.complexity ?? 'unknown-to-us',
					title: `Open ${language.name}: ${opDef.code} on the map`
				};

				for (const refId of support.refs) {
					registerTag(refId, queryTag);
				}
			}

			for (const [safeKey, opDef] of Object.entries(TRANSFORMATIONS)) {
				const support =
					language.properties.transformations?.[safeKey] ??
					language.properties.transformations?.[opDef.code];
				if (!support?.refs?.length) continue;
				if (support.derived) continue;

				const transformationTag: ClaimTag = {
					id: `transformation:${language.id}:${safeKey}`,
					kind: 'transformation',
					languageName: language.name,
					operationCode: opDef.code,
					href: `/#op/${language.id}/${safeKey}`,
					status: support.complexity ?? 'unknown-to-us',
					title: `Open ${language.name}: ${opDef.code} on the map`
				};

				for (const refId of support.refs) {
					registerTag(refId, transformationTag);
				}
			}
		}

		const kindOrder: Record<ClaimKind, number> = {
			query: 0,
			transformation: 1,
			edge: 2
		};

		const sortLabel = (tag: ClaimTag): string => {
			if (tag.kind === 'edge') {
				return `${tag.sourceName}->${tag.targetName}`;
			}
			return `${tag.languageName}:${tag.operationCode}`;
		};

		const finalized = new Map<string, ClaimTag[]>();
		for (const [normalizedRefId, tagMap] of tagsByRef.entries()) {
			const sortedTags = [...tagMap.values()].sort((left, right) => {
				const kindDiff = kindOrder[left.kind] - kindOrder[right.kind];
				if (kindDiff !== 0) return kindDiff;
				return sortLabel(left).localeCompare(sortLabel(right));
			});
			finalized.set(normalizedRefId, sortedTags);
		}

		return finalized;
	});

	function extractYear(ref: KCReference): number {
		const match = ref.bibtex.match(/year\s*=\s*[{"']?(\d{4})/i);
		return match ? parseInt(match[1]) : 9999;
	}

	function extractLastName(ref: KCReference): string {
		return ref.id.replace(/_\d+[a-z]?$/, '');
	}

	function getClaimTagsForRef(refId: string): ClaimTag[] {
		return claimTagsByRef.get(refId.toLowerCase()) ?? [];
	}

	const filtered = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		let refs = allReferences;

		if (q) {
			refs = refs.filter(
				(ref) =>
					ref.title.toLowerCase().includes(q) ||
					ref.id.toLowerCase().includes(q) ||
					ref.bibtex.toLowerCase().includes(q)
			);
		}

		const sorted = [...refs];
		if (sortMode === 'year') {
			sorted.sort((a, b) => {
				const ya = extractYear(a);
				const yb = extractYear(b);
				if (ya !== yb) return ya - yb;
				return extractLastName(a).localeCompare(extractLastName(b));
			});
		} else {
			sorted.sort((a, b) => extractLastName(a).localeCompare(extractLastName(b)));
		}

		return sorted;
	});

	async function copyBibtex(bibtex: string, refId: string) {
		try {
			await navigator.clipboard.writeText(bibtex);
			copiedRefId = refId;
			setTimeout(() => {
				copiedRefId = null;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy BibTeX:', err);
		}
	}
</script>

<svelte:head>
	<title>Bibliography — Tractable Circuit Zoo</title>
</svelte:head>

<div class="page">
	<header>
		<a href="/" class="back">← Back to Zoo</a>
		<h1>Bibliography</h1>
		<p class="subtitle">
			{allReferences.length} references used across the Tractable Circuit Zoo
		</p>
	</header>

	<div class="controls">
		<input
			type="text"
			class="search"
			placeholder="Search by title, author, or key…"
			bind:value={searchQuery}
		/>
		<div class="sort-toggle" role="group" aria-label="Sort order">
			<button
				class="sort-btn"
				class:active={sortMode === 'alpha'}
				onclick={() => (sortMode = 'alpha')}
			>
				A–Z
			</button>
			<button
				class="sort-btn"
				class:active={sortMode === 'year'}
				onclick={() => (sortMode = 'year')}
			>
				Year
			</button>
		</div>
	</div>

	{#if filtered.length === 0}
		<p class="empty">No references match "{searchQuery}"</p>
	{:else}
		<p class="count">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
		<ul class="refs">
			{#each filtered as ref (ref.id)}
				{@const claimTags = getClaimTagsForRef(ref.id)}
				<li class="ref" id={ref.id}>
					<span class="ordinal" title={`Reference ${getGlobalRefNumber(ref.id) ?? '?'}`}>[bib]</span>
					<span class="year-badge">{extractYear(ref) < 9999 ? extractYear(ref) : '—'}</span>
					<div class="ref-main">
						{#if ref.href && ref.href !== '#'}
							<a class="ref-link" href={ref.href} target="_blank" rel="noreferrer noopener">
								{ref.title}
							</a>
						{:else}
							<span class="ref-text">{ref.title}</span>
						{/if}
						<span class="ref-key">{ref.id}</span>
						{#if claimTags.length > 0}
							<ReferenceClaimTags claimTags={claimTags} />
						{/if}
					</div>
					<button
						class="copy"
						class:copied={copiedRefId === ref.id}
						onclick={() => copyBibtex(ref.bibtex, ref.id)}
						title="Copy BibTeX"
					>
						{copiedRefId === ref.id ? '✓' : 'bib'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 56rem;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
		color: #334155;
		font-family: system-ui, -apple-system, sans-serif;
	}

	header {
		margin-bottom: 1.5rem;
	}

	.back {
		display: inline-block;
		margin-bottom: 0.75rem;
		color: #2563eb;
		text-decoration: none;
		font-size: 0.8125rem;
	}

	.back:hover {
		text-decoration: underline;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 0.25rem;
		letter-spacing: -0.01em;
	}

	.subtitle {
		color: #94a3b8;
		font-size: 0.8125rem;
		margin: 0;
	}

	.controls {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		margin-bottom: 1rem;
	}

	.search {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid #e2e8f0;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		color: #334155;
		background: #f8fafc;
		outline: none;
		transition: border-color 0.15s;
	}

	.search::placeholder {
		color: #94a3b8;
	}

	.search:focus {
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}

	.sort-toggle {
		display: flex;
		border: 1px solid #e2e8f0;
		border-radius: 0.375rem;
		overflow: hidden;
		flex-shrink: 0;
	}

	.sort-btn {
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		border: none;
		background: #f8fafc;
		color: #64748b;
		cursor: pointer;
		transition: all 0.15s;
	}

	.sort-btn:first-child {
		border-right: 1px solid #e2e8f0;
	}

	.sort-btn.active {
		background: #1e293b;
		color: #fff;
	}

	.sort-btn:not(.active):hover {
		background: #e2e8f0;
	}

	.empty {
		text-align: center;
		color: #94a3b8;
		font-size: 0.875rem;
		padding: 3rem 0;
	}

	.count {
		font-size: 0.75rem;
		color: #94a3b8;
		margin: 0 0 0.5rem;
	}

	.refs {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.ref {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.625rem 0.5rem;
		border-bottom: 1px solid #f1f5f9;
		transition: background 0.1s;
	}

	.ref:hover {
		background: #f8fafc;
	}

	.ref:last-child {
		border-bottom: none;
	}

	.ordinal {
		flex-shrink: 0;
		font-size: 0.6875rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #94a3b8;
		min-width: 1.75rem;
		text-align: right;
	}

	.year-badge {
		flex-shrink: 0;
		font-size: 0.6875rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #64748b;
		background: #f1f5f9;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		min-width: 2.25rem;
		text-align: center;
	}

	.ref-main {
		flex: 1;
		min-width: 0;
		padding-top: 0.05rem;
	}

	.ref-link {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: #1e40af;
		text-decoration: none;
		word-break: break-word;
	}

	.ref-link:hover {
		text-decoration: underline;
		color: #1d4ed8;
	}

	.ref-text {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: #475569;
		word-break: break-word;
	}

	.ref-key {
		display: block;
		font-size: 0.6875rem;
		color: #94a3b8;
		font-family: 'SFMono-Regular', 'Consolas', monospace;
		margin-top: 0.125rem;
	}

	.copy {
		flex-shrink: 0;
		align-self: flex-start;
		margin-top: 0.08rem;
		font-size: 0.6875rem;
		font-weight: 600;
		color: #94a3b8;
		background: none;
		border: 1px solid #e2e8f0;
		border-radius: 0.25rem;
		padding: 0.125rem 0.375rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.copy:hover {
		color: #475569;
		border-color: #cbd5e1;
		background: #f1f5f9;
	}

	.copy.copied {
		color: #16a34a;
		border-color: #86efac;
		background: #f0fdf4;
	}
</style>
