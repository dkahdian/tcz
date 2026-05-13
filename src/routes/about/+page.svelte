<script lang="ts">
	import { onMount, tick } from 'svelte';
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
	const definitionIds = new Set(definitions.map((definition) => definition.id));

	let definitionsDetails: HTMLDetailsElement | null = null;

	async function openDefinitionsForHash() {
		const hash = decodeURIComponent(window.location.hash.slice(1));
		if (!hash || (hash !== 'definitions' && !definitionIds.has(hash))) return;

		if (definitionsDetails) {
			definitionsDetails.open = true;
			await tick();
			document.getElementById(hash)?.scrollIntoView();
		}
	}

	onMount(() => {
		openDefinitionsForHash();
		window.addEventListener('hashchange', openDefinitionsForHash);

		return () => {
			window.removeEventListener('hashchange', openDefinitionsForHash);
		};
	});
</script>

<svelte:head>
	<title>About - Tractable Circuit Zoo</title>
</svelte:head>

<div class="about-page">
	<header class="about-header">
		<a href="/" class="back-link">&lt;- Back to Zoo</a>
		<h1>About the Tractable Circuit Zoo</h1>
	</header>

	<main class="about-content">
		<section>
			<h2>What is this?</h2>
			<p>
				The Tractable Circuit Zoo is a visual guide to tractable circuit languages.
				We display succinctness relations between languages and operations they support.
				We build on the foundational work of
				<a href="https://arxiv.org/abs/1106.1819" target="_blank" rel="noopener">
					Darwiche &amp; Marquis (2002)
				</a>
				and incorporate results from subsequent research.
			</p>
		</section>

		<section>
			<h2>How to read the zoo</h2>
			<p>
				A <strong>representation language</strong> is a restricted circuit or formula format for Boolean functions. The zoo compares these languages in two ways: how succinctly one language can simulate another, and which operations can be performed efficiently once a function has been compiled into a language.
			</p>
			<p>
				Some entries are ordinary languages, while others are <strong>families</strong> or <strong>unions</strong>. A family fixes a structural parameter, such as an order or tree shape, and a union language allows any member of that family. For example, <MathText text={`\\langfam{OBDD}{<}`} className="inline" /> fixes an order, while <MathText text={`\\langref{OBDD}`} className="inline" /> ranges over all orders.
			</p>
		</section>

		<section>
			<h2>Succinctness and operations</h2>
			<p>
				A language <MathText text={`A`} className="inline" /> is <strong>at least as succinct as</strong> a language <MathText text={`B`} className="inline" /> when every <MathText text={`B`} className="inline" /> representation can be compiled into an equivalent <MathText text={`A`} className="inline" /> representation with only polynomial blowup. A separating function shows that such a polynomial compilation cannot exist.
			</p>
			<p>
				For operations, "polynomial time" means there is an algorithm whose running time is polynomial in the input representation size. Negative entries record known lower bounds, sometimes under standard complexity assumptions.
			</p>
		</section>

		<section>
			<details class="definitions-panel" id="definitions" bind:this={definitionsDetails}>
				<summary>
					<h2>Definitions</h2>
				</summary>

				<div class="definitions-content">
					<p class="definitions-description">
						These definitions are generated from <code class="source-path">docs/definitions.tex</code>.
						The lists below group the same source definitions into core concepts, queries, and transformations.
					</p>

					<section>
						<h3>Core Concepts</h3>
						<div class="definition-flow">
							{#each coreDefinitions as definition}
								<article class="definition-block" id={definition.id}>
									<h4><MathText text={definition.title} as="span" /></h4>
									<MathText text={definition.statement} as="p" className="definition-text" />
								</article>
							{/each}
						</div>
					</section>

					<section>
						<h3>Queries</h3>
						{#if queryIntro}
							<div class="definition-intro" id={queryIntro.id}>
								<MathText text={queryIntro.statement} as="p" className="definition-text" />
							</div>
						{/if}
						<div class="operation-list">
							{#each queryDefinitions as definition}
								<article class="operation-row" id={definition.id}>
									<h4 class="operation-name">
										<MathText text={definition.title} as="span" />
									</h4>
									<MathText text={definition.statement} as="p" className="operation-description" />
								</article>
							{/each}
						</div>
					</section>

					<section>
						<h3>Transformations</h3>
						{#if transformationIntro}
							<div class="definition-intro" id={transformationIntro.id}>
								<MathText text={transformationIntro.statement} as="p" className="definition-text" />
							</div>
						{/if}
						<div class="operation-list">
							{#each transformationDefinitions as definition}
								<article class="operation-row" id={definition.id}>
									<h4 class="operation-name">
										<MathText text={definition.title} as="span" />
									</h4>
									<MathText text={definition.statement} as="p" className="operation-description" />
								</article>
							{/each}
						</div>
					</section>
				</div>
			</details>
		</section>

		<section>
			<h2>References</h2>
			<p>
				The full bibliography lists the references used across the zoo.
				<a href="/bibliography">Open the full bibliography</a>.
			</p>
		</section>

		<section>
			<h2>Automated reasoning</h2>
			<p>
				Not all of folklore is explicitly documented. We use automated reasoning to derive portions of the zoo, and provide sketch proofs. Such results are shown with gray diagonal stripes.
			</p>
		</section>
	</main>
</div>

<style>
	.about-page {
		max-width: 48rem;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		color: #334155;
	}

	.about-header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-block;
		margin-bottom: 1rem;
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
		margin: 0;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: #1e293b;
		margin: 0 0 0.5rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 700;
		color: #1e293b;
		margin: 0 0 0.6rem;
	}

	h4 {
		font-size: 0.98rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 0.35rem;
	}

	.about-content section {
		margin-bottom: 1.5rem;
	}

	p {
		line-height: 1.65;
		margin: 0 0 0.75rem;
		color: #475569;
	}

	.definitions-panel {
		border-top: 1px solid #e2e8f0;
		border-bottom: 1px solid #e2e8f0;
		padding: 0.8rem 0;
		scroll-margin-top: 1rem;
	}

	.definitions-panel summary {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
		list-style: none;
	}

	.definitions-panel summary::-webkit-details-marker {
		display: none;
	}

	.definitions-panel summary::after {
		content: "+";
		flex: 0 0 auto;
		color: #2563eb;
		font-weight: 700;
	}

	.definitions-panel[open] summary::after {
		content: "-";
	}

	.definitions-panel summary h2 {
		margin: 0;
	}

	.definitions-content {
		margin-top: 1rem;
	}

	.definitions-content section {
		margin-bottom: 1.65rem;
	}

	.definitions-content section:last-child {
		margin-bottom: 0;
	}

	.definitions-description,
	:global(.definition-text),
	:global(.operation-description) {
		line-height: 1.6;
		margin: 0 0 0.85rem;
		color: #475569;
	}

	.source-path {
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
		.definitions-panel summary {
			align-items: flex-start;
		}

		.operation-row {
			grid-template-columns: 1fr;
			gap: 0.18rem;
		}
	}
</style>
