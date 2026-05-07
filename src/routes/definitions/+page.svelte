<script lang="ts">
	import MathText from '$lib/components/MathText.svelte';
	import { initialGraphData } from '$lib/data/index.js';

	type Definition = NonNullable<typeof initialGraphData.definitions>[number];

	// Definitions are edited in docs/definitions.tex and synced into database.json.
	const definitions = (initialGraphData.definitions ?? []) as Definition[];
	const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));

	const coreDefinitionIds = [
		'representation-language',
		'language-family',
		'succinctness-language',
		'succinctness-family',
		'tractability'
	];

	function definitionsById(ids: string[]): Definition[] {
		return ids
			.map((id) => definitionById.get(id))
			.filter((definition): definition is Definition => Boolean(definition));
	}

	function isQueryDefinition(definition: Definition): boolean {
		return definition.id.startsWith('query-') && definition.id !== 'query-operation';
	}

	function isTransformationDefinition(definition: Definition): boolean {
		return (
			definition.id.startsWith('transformation-') &&
			definition.id !== 'transformation-operation'
		);
	}

	const coreDefinitions = definitionsById(coreDefinitionIds);
	const queryIntro = definitionById.get('query-operation');
	const transformationIntro = definitionById.get('transformation-operation');
	const queryDefinitions = definitions.filter(isQueryDefinition);
	const transformationDefinitions = definitions.filter(isTransformationDefinition);
</script>

<svelte:head>
	<title>Definitions - Tractable Circuit Zoo</title>
</svelte:head>

<div class="definitions-page">
	<header class="page-header">
		<nav class="nav-links" aria-label="Breadcrumb">
			<a href="/" class="back-link">&lt;- Back to Zoo</a>
			<a href="/about" class="back-link">About</a>
		</nav>
		<h1>Definitions</h1>
	</header>

	<main class="definitions-content">
		<section>
			<h2>Core Concepts</h2>
			<div class="definition-flow">
				{#each coreDefinitions as definition}
					<article class="definition-block" id={definition.id}>
						<h3><MathText text={definition.title} as="span" /></h3>
						<MathText text={definition.statement} as="p" className="definition-text" />
					</article>
				{/each}
			</div>
		</section>

		<section>
			<h2>Queries</h2>
			{#if queryIntro}
				<div class="definition-intro" id={queryIntro.id}>
					<MathText text={queryIntro.statement} as="p" className="definition-text" />
				</div>
			{/if}
			<div class="operation-list">
				{#each queryDefinitions as definition}
					<article class="operation-row" id={definition.id}>
						<h3 class="operation-name">
							<MathText text={definition.title} as="span" />
						</h3>
						<MathText text={definition.statement} as="p" className="operation-description" />
					</article>
				{/each}
			</div>
		</section>

		<section>
			<h2>Transformations</h2>
			{#if transformationIntro}
				<div class="definition-intro" id={transformationIntro.id}>
					<MathText text={transformationIntro.statement} as="p" className="definition-text" />
				</div>
			{/if}
			<div class="operation-list">
				{#each transformationDefinitions as definition}
					<article class="operation-row" id={definition.id}>
						<h3 class="operation-name">
							<MathText text={definition.title} as="span" />
						</h3>
						<MathText text={definition.statement} as="p" className="operation-description" />
					</article>
				{/each}
			</div>
		</section>
	</main>
</div>

<style>
	:global(body) {
		overflow: auto;
	}

	.definitions-page {
		max-width: 48rem;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		color: #334155;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.nav-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-bottom: 1rem;
	}

	.back-link {
		color: #2563eb;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 0.5rem;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: #1e293b;
		margin: 0 0 0.6rem;
	}

	h3 {
		font-size: 0.98rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 0.35rem;
	}

	.definitions-content section {
		margin-bottom: 1.65rem;
	}

	p,
	:global(.definition-text),
	:global(.operation-description) {
		line-height: 1.6;
		margin: 0;
		color: #475569;
	}

	code {
		font-size: 0.92em;
		color: #0f172a;
		background: #f1f5f9;
		border-radius: 0.25rem;
		padding: 0.05rem 0.22rem;
	}

	.definition-flow {
		display: grid;
		gap: 1.1rem;
	}

	.definition-block,
	.definition-intro,
	.operation-row {
		scroll-margin-top: 1rem;
	}

	.definition-intro {
		margin-bottom: 0.75rem;
	}

	.operation-list {
		display: grid;
		gap: 0.45rem;
	}

	.operation-row {
		display: grid;
		grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
		gap: 0.8rem;
		padding: 0.55rem 0;
		border-top: 1px solid #e2e8f0;
	}

	.operation-row:first-child {
		border-top: none;
	}

	.operation-name {
		align-self: start;
		margin: 0;
	}

	a {
		color: #2563eb;
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}

	@media (max-width: 640px) {
		.operation-row {
			grid-template-columns: 1fr;
			gap: 0.18rem;
		}
	}
</style>
