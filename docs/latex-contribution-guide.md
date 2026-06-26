# Contributing Through LaTeX

Edit the body of the LaTeX docs, not the generated header or macro definitions.

## Common macros
Use these to refer to languages.
```tex
\langref{<shortname>}({<optional suffix>})
\langfam{<base>}{<parameter>}({<optional suffix>})
```

Use these to refer to directed succinctness facts.
```tex
\compilespoly{<source>}{<target>}
\compilesquasi{<source>}{<target>}
\nocompilespoly{<source>}{<target>}
\nocompilesquasi{<source>}{<target>}
```
Outside `\selector{...}`, these are checked claims, not decorative links. The
LaTeX import and GUI contribution queue fail if the referenced directed relation
is not true in the current candidate database.

Inside `\selector{...}`, relation macros are predicates over `\thislang`.

```tex
\compilespoly{A}{B}    true when A -> B is \poly
\compilesquasi{A}{B}   true when A -> B has known polynomial or quasipolynomial compilation
\nocompilespoly{A}{B}  true when A -> B has no polynomial compilation
\nocompilesquasi{A}{B} true when A -> B is \noquasi
```

When using the GUI editor, prefer the relation button. It picks the right macro
from the selected directed relation and blocks unknown cases.

Use these to refer to query or transformation results.
```tex
\supportspoly{<language>}{<operation>}
\supportsquasi{<language>}{<operation>}
\nosupportspoly{<language>}{<operation>}
\nosupportsquasi{<language>}{<operation>}
```
These are also checked claims. The operation argument should be one of the
operation code macros below, e.g. `\supportspoly{\langref{CNF}}{\VA}`.

```tex
\supportspoly{L}{Q}     true when L supports Q in polynomial time
\supportsquasi{L}{Q}    true when L supports Q in polynomial or quasipolynomial time
\nosupportspoly{L}{Q}   true when L does not support Q in polynomial time
\nosupportsquasi{L}{Q}  true when L does not support Q in quasipolynomial time
```

Use these to refer to sources.
```tex
\citep{<bibtex key>}
\citet([<optional page or theorem>]){<bibtex key>}
```

Statuses: `\poly`, `\nopolyunknownquasi`, `\nopolyquasi`,
`\unknownpolyquasi`, `\unknownboth`, `\noquasi`.

Operation code table:
```tex
\CO Consistency      \VA Validity          \CE Clausal entailment
\IM Implicant        \EQ Equivalence       \SE Sentential entailment
\CT Model Counting   \ME Model enumeration
\CD Conditioning     \FO Forgetting        \SFO Singleton forgetting
\ANDC Conjunction    \ANDBC Bounded conjunction
\ORC Disjunction     \ORBC Bounded disjunction   \NOTC Negation
```

## Concept Definitions (in `definitions.tex`)
```tex
\begin{concept}
\title{<concept name>}
\begin{description}
<English definition, including any relevant references>
\end{description}
\end{concept}
```

## Language Definitions (in `languages.tex`)
```tex
\begin{language}
\shortname{<\langref or \langfam command>}
\fullname{<language name in English>}
\begin{description}
<English description of the language, including any relevant references>
\end{description}
\end{language}
```

## Succinctness Claims (in `succinctness.tex`)
```tex
\begin{succinctnessclaim}
\source{<source language \langref or \langfam command>}
\target{<target language \langref or \langfam command>}
\status{<status macro, e.g. \poly>}
(optionally \assuming{<assumption>})
\begin{description}
<English description of the succinctness claim, including any relevant references>
\end{description}
\end{succinctnessclaim}
```

## Query And Transformation Claims (in `queries.tex` and `transformations.tex`)
```tex
\begin{queryclaim} or \begin{transformationclaim}
\language{<language \langref or \langfam command>}
\operation{<operation macro, e.g. \VA>}
\status{<status macro, e.g. \poly>}
(optionally \assuming{<assumption>})
\begin{description}
<English description of the claim, including any relevant references>
\end{description}
\end{queryclaim} or \end{transformationclaim}
```

Use the same shape with `transformationclaim` for transformations.

## Batch Claims (when multiple languages share the same claim, in `transformations.tex` or `queries.tex`)
```tex
\begin{batchclaim}
\selector{\isin{\langref{cSDD}, \langref{d-SDNNF}, \langref{DNNF}}}
\operation{\ANDC}
\status{\noquasi}
(optionally \assuming{<assumption>})
\begin{description}
In \thislang, every clause has a polynomial-size representation ...
\citep{TCZ_Forthcoming}
\end{description}
\end{batchclaim}
```

Selectors can also use compilation constraints. Clauses are always AND; for OR,
write separate batch claims.
