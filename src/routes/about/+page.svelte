<script lang="ts">
	import MathText from '$lib/components/MathText.svelte';
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
			<h2>Definitions</h2>
			<p>
				The full generated glossary has the project definitions for core concepts, queries, and transformations.
				<a href="/definitions">Open the definitions page</a>.
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
	:global(body) {
		overflow: auto;
	}

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

	.about-content section {
		margin-bottom: 1.5rem;
	}

	p {
		line-height: 1.65;
		margin: 0 0 0.75rem;
		color: #475569;
	}

	a {
		color: #2563eb;
		text-decoration: none;
	}

	a:hover {
		text-decoration: underline;
	}
</style>
