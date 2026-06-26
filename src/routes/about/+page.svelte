<script lang="ts">
	import MathText from '$lib/components/MathText.svelte';
	import { getGlobalRefNumber, getReferences } from '$lib/data/references.js';

	const aboutReferences = getReferences('Fargier_2013', 'TCZ_Forthcoming');
</script>

<svelte:head>
	<title>About - Tractable Circuit Zoo</title>
</svelte:head>

<div class="about-page">
	<header class="about-header">
		<a href="/" class="back-link">&lt;- Back to Zoo</a>
		<h1>Welcome to the Tractable Circuit Zoo</h1>
	</header>

	<main class="about-content">
		<section>
			<MathText
				as="p"
				text={`Boolean functions are one of the most basic objects in computer science, with countless applications demanding their efficient representation, manipulation, and querying. However, the \\emph{succinctness} of a representation is usually in tension with its \\emph{tractability} for manipulation and querying. The \\emph{tractable circuit zoo} catalogs known representation languages together with their relations in terms of succinctness and tractability. While research in the area spans many decades, lots of progress has been made just recently, and much work remains. We hope the zoo may serve as an open source survey of the area that grows as our understanding does.`}
			/>
		</section>

		<section>
			<h2>Zoo Features</h2>
			<MathText
				as="p"
				text={`In addition to the manually maintained database of representation languages and their succinctness and tractability relations, the zoo performs automated reasoning using simple inference rules. For example, succinctness is transitive: if A compiles to B and B compiles to C, then A compiles to C. Throughout the zoo, \\emph{zebra} cells—i.e., cells with a striped background—denote results which were derived automatically in this way.`}
			/>
			<p>
				This makes it easy to check consistency of the database, and reduces the number of
				relations that need to be manually entered. It also makes it fun to consider
				“possible worlds”. By entering “sandbox mode” the user can enter hypothetical
				(yet unproven) relations and immediately visualize what other relations follow
				from their hypotheses. The zoo is
				<a href="https://github.com/dkahdian/tcz" target="_blank" rel="noopener noreferrer">
					open source
				</a>
				and will soon have a user interface for contributing directly through the website.
			</p>
		</section>

		<section>
			<h2>Central Concepts</h2>
			<MathText
				as="p"
				text={`We give informal descriptions of some central concepts, leaving formal definitions to the literature (see, e.g., \\citet{Fargier_2013,TCZ_Forthcoming}).`}
			/>

			<MathText
				as="p"
				text={`\\textbf{Representation Language}: A representation language is a method of expressing Boolean functions, such as a truth table or a class of Boolean circuits. Slightly more formally, a representation language is a pair $(R,I)$ where $R$ is a set of strings (over some fixed alphabet) and $I$ is an \\emph{interpretation function} that maps each $r\\in R$ to the Boolean function that $r$ \\emph{represents}. The \\emph{size} of a representation $r\\in R$ is its length (number of symbols) denoted $|r|$.`}
			/>

			<MathText
				as="p"
				text={`\\textbf{Succinctness}: Let $A$ and $B$ be representation languages. We say $a\\in A$ and $b\\in B$ are \\emph{equivalent} if they represent the same function. We say $A$ is \\emph{at least as succinct as} $B$, denoted $A\\le B$, if for every $b\\in B$ there is an equivalent and not too much larger $a\\in A$, specifically, $|a|\\le |b|^{O(1)}$.`}
			/>

			<MathText
				as="p"
				text={`\\textbf{Tractability}: We say a query (such as "is $f$ satisfiable?") is \\emph{tractable} for a representation language $A$ if there exists an algorithm which given any $a\\in A$ answers the query in polynomial time (in the input length $|a|$). Similarly, a transformation (such as "negate $f$" or "conjoin $f$ and $g$") is tractable for representation language $A$ if there exists an algorithm which given input representation(s) in $A$ computes a correct output representation in $A$ in polynomial time (in the length of the input).`}
			/>
		</section>

		<section>
			<h2>Some Technical Notes</h2>
			<MathText
				as="p"
				text={`\\textbf{Non-Strings}: For representation languages not directly defined as strings, e.g. circuits or decision diagrams, one may freely take a reasonable encoding of the object into a string, and the theory will be unaffected (since it does not distinguish between polynomial changes in size). Equivalently, one may think of a separate size measure defined directly on such objects (e.g, the number of nodes) which is polynomially related to the length of reasonable encodings.`}
			/>

			<MathText
				as="p"
				text={`\\textbf{Classes of Representation Languages}: We’d like to include representation languages like $OBDD_<$, which contains all OBDDs respecting a specific variable order $<$. However, there are infinitely many different $OBDD_<$ languages, one for every choice of $<$. Therefore we include \\emph{classes of representation languages} in the zoo. For example, $\\{OBDD_<\\}_{orders <}$. We extend the definition of succinctness to classes as follows. We say class $\\mathcal{B}$ is at least as succinct as class $\\mathcal{A}$, denoted $\\mathcal{B}\\le \\mathcal{A}$, if for every $A\\in \\mathcal{A}$ there exists a $B\\in \\mathcal{B}$ such that $B\\le A$. In the special case of singleton classes (classes containing a single representation language), this recovers the behavior of the usual definition of succinctness. For larger classes, it behaves in the intuitive way. For example $OBDD\\le \\{OBDD_<\\}$ but $\\{OBDD_<\\}\\not\\le OBDD$, and $\\{SDNNF_T\\}\\le \\{OBDD_<\\}$ but $\\{OBDD_<\\}\\not\\le\\{SDNNF_T\\}$. Such a definition allows us to consider representation languages and classes of representation languages in a common way. To avoid excessive braces throughout the zoo, we just write $OBDD_<$ to mean the class $\\{OBDD_<\\}$ (and similar for classes involving vtrees).`}
			/>

			<MathText
				as="p"
				text={`\\textbf{Quasipolynomial Succinctness}: Actually, we further distinguish between polynomial and quasipolynomial size since some central languages are known to support quasipolynomial compilations, whereas others have exponential separations. See the succinctness table for notation. Recall that functions with \\emph{polynomial} growth are in $n^{O(1)}$ whereas functions with \\emph{quasipolynomial} growth are in $n^{\\log^{O(1)} n}$.`}
			/>
		</section>

		<section class="references-section">
			<h2>
				References
				<a class="full-bibliography-link" href="/bibliography">(full bibliography)</a>
			</h2>

			<ol class="reference-list">
				{#each aboutReferences as reference}
					<li class="reference-item">
						<span class="reference-number">[{getGlobalRefNumber(reference.id) ?? '?'}]</span>
						{#if reference.href && reference.href !== '#'}
							<a
								class="reference-link"
								href={reference.href}
								target="_blank"
								rel="noreferrer noopener"
							>
								{reference.title}
							</a>
						{:else}
							<span>{reference.title}</span>
						{/if}
					</li>
				{/each}
			</ol>
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

	.about-content section {
		margin-bottom: 1.5rem;
	}

	p {
		line-height: 1.65;
		margin: 0 0 0.75rem;
		color: #475569;
	}

	.about-content :global(.math-text) {
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

	.references-section {
		border-top: 1px solid #e2e8f0;
		padding-top: 1rem;
	}

	.full-bibliography-link {
		font-size: 0.8125rem;
		font-weight: 500;
		margin-left: 0.35rem;
	}

	.reference-list {
		display: grid;
		gap: 0.55rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.reference-item {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
		color: #475569;
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.reference-number {
		color: #0f172a;
		font-weight: 600;
	}

	.reference-link {
		overflow-wrap: anywhere;
	}
</style>
