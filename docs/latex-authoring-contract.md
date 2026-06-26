# LaTeX Authoring Contract

This document defines the canonical human-authored LaTeX schema for TCZ data.
It is a breaking replacement for the old generated-body format that exposed
internal JSON IDs, parser comments, labels, classification fields, and batch
claim IDs.

The goal is that everything after the document header and macro definitions is
human-readable, human-editable, and semantically interpretable from visible
LaTeX alone.

## Core Rules

The LaTeX body is the authoring source. The JSON database is the structured
runtime representation derived from it.

The parser must not require:

- internal language IDs such as `lang_89649e36`;
- hidden metadata comments such as `% lang=..., op=...`;
- parser-owned labels such as `\label{def:lang_...}`;
- `\classification{...}` fields;
- definition-reference macros such as `\defref{...}`;
- batch claim IDs;
- global reference fields such as `\references{...}`.

The parser may use only visible semantic macros and environment structure.

Every generated LaTeX file must be deterministic. A round trip
`JSON -> LaTeX -> JSON -> LaTeX` must preserve the same authored semantics,
although whitespace and generated ordering may normalize.

## Language Identity

Languages are identified by their visible `\shortname{...}` macro.

Plain and union-like languages use:

```tex
\shortname{\langref{CNF}}
```

Family/member languages use:

```tex
\shortname{\langfam{OBDD}{<}}
```

The generator must emit macro-wrapped short names. Bare names such as
`\shortname{CNF}` are invalid in canonical output.

The internal app model must not store or require `classification`. Family status
is inferred from `\langfam`. Plain-vs-union visibility is not modeled as a
classification. The existing classification-based language-scope filter is
deprecated and replaced by an explicit default-visible-language list that
preserves the current default view.

## Concept Definitions

Concept definitions are authored in `docs/definitions.tex`.

Canonical schema:

```tex
\begin{concept}
\title{Representation Language}
\begin{description}
A \emph{representation language} $L$ is a set of Boolean formulas ...
\citep{Darwiche_2002}
\end{description}
\end{concept}
```

There is no `\key`, `\label`, or `\defref`. Concept identities used by the app
are derived from normalized titles at runtime. If a title changes, the derived
anchor changes with it.

Concept references in prose should be ordinary text, not `\defref` links.
For example, write `Consistency` rather than `\defref{query-co}{Consistency}`.

Inline citations in the description are the only authoring source for
definition references.

## Language Definitions

Canonical schema:

```tex
\begin{language}
\shortname{\langref{CNF}}
\fullname{Conjunctive Normal Form}
\begin{description}
A \langref{CNF} is a conjunction of clauses ...
\end{description}
\end{language}
```

Family/member example:

```tex
\begin{language}
\shortname{\langfam{OBDD}{<}}
\fullname{Ordered Binary Decision Diagrams with a fixed variable order}
\begin{description}
...
\end{description}
\end{language}
```

Language definition references are inline citations in the description.
The JSON `definitionRefs` field is deprecated. If a runtime reference index is
needed, it is derived from citations in the description.

## Status Macros

The status vocabulary is exactly:

```tex
\poly
\nopolyunknownquasi
\nopolyquasi
\unknownpolyquasi
\unknownboth
\noquasi
```

The parser maps these to the existing status strings:

```text
\poly               -> poly
\nopolyunknownquasi -> no-poly-unknown-quasi
\nopolyquasi        -> no-poly-quasi
\unknownpolyquasi   -> unknown-poly-quasi
\unknownboth        -> unknown-both
\noquasi            -> no-quasi
```

No aliases are canonical.

## Assumptions

Assumptions are written with:

```tex
\assuming{$P \neq NP$}
```

The macro does not add math delimiters. Authors must include math delimiters
when desired.

If present, `\assuming{...}` must occur immediately before the description
environment in `succinctnessclaim`, `queryclaim`, `transformationclaim`, and
`batchclaim`.

## Relation Macros

The new relation-reference macros are:

```tex
\compilespoly{source}{target}
\compilesquasi{source}{target}
\nocompilespoly{source}{target}
\nocompilesquasi{source}{target}
```

Arguments may be concrete language references or `\thislang` inside a batch
claim.

Legacy `\edgeref` and `\nedgeref` are deprecated. The generator must emit the
new relation macros. Existing prose should be migrated to the new macros.

Outside `\selector{...}`, relation macros are semantic assertions against the
current candidate database, not just rendered links. LaTeX import must fail if a
relation macro references a directed relation that is not true after the
complete candidate database has been parsed and validated. GUI contribution
submission must run the same check against the queued candidate database.

Inside `\selector{...}`, relation macros are predicates used to choose the
current `\thislang` expansion set. Selector predicates are evaluated against the
complete candidate database during batch expansion.

Truth table:

```text
\compilespoly{A}{B}      requires A -> B status poly
\compilesquasi{A}{B}     requires A -> B status poly, no-poly-quasi, or unknown-poly-quasi
\nocompilespoly{A}{B}    requires A -> B status no-poly-unknown-quasi, no-poly-quasi, or no-quasi
\nocompilesquasi{A}{B}   requires A -> B status no-quasi
```

The GUI rich-text relation button must choose one of these macros from the
selected directed relation status case-by-case:

```text
poly                  -> \compilespoly, or \compilesquasi if the user asks for the weaker statement
no-poly-unknown-quasi -> \nocompilespoly
no-poly-quasi         -> ask whether to cite no-polynomial or quasipolynomial compilation
unknown-poly-quasi    -> \compilesquasi
unknown-both          -> no relation macro is available
no-quasi              -> \nocompilesquasi, or \nocompilespoly if the user asks for the weaker statement
```

## Operation Result Macros

Query and transformation results have first-class reference macros:

```tex
\supportspoly{language}{operation}
\supportsquasi{language}{operation}
\nosupportspoly{language}{operation}
\nosupportsquasi{language}{operation}
```

The first argument is a language reference. The second argument is an operation
code macro such as `\VA`, `\CT`, `\ANDC`, or `\FO`.

Outside hypothetical prose, these macros are semantic assertions against the
current candidate database. LaTeX import and GUI submission must fail if the
operation result is not true after the complete candidate has been parsed and
validated.

Truth table:

```text
\supportspoly{L}{Q}     requires operation status poly
\supportsquasi{L}{Q}    requires operation status poly, no-poly-quasi, or unknown-poly-quasi
\nosupportspoly{L}{Q}   requires operation status no-poly-unknown-quasi, no-poly-quasi, or no-quasi
\nosupportsquasi{L}{Q}  requires operation status no-quasi
```

These macros should not be used for hypothetical claims. For example, keep
phrases like "If L supported Q in polynomial time..." as prose, because the
assertion is intentionally not true in the candidate database.

## Succinctness Claims

Canonical schema:

```tex
\begin{succinctnessclaim}
\source{\langref{d-SDNNF}}
\target{\langref{d-DNNF}}
\status{\poly}
\assuming{$P \neq NP$}
\begin{description}
As defined by \citet{Amarilli_2018}, ...
\end{description}
\end{succinctnessclaim}
```

The assumption line is omitted when there is no assumption.

The rendered claim text is generated from `\source`, `\target`, and `\status`.
The parser does not read identity, status, or references from prose.

Inline citations in the description are the authoring source for claim
references.

## Operation Macros

Query operation macros:

```tex
\CO
\VA
\CE
\IM
\EQ
\SE
\CT
\ME
```

Transformation operation macros:

```tex
\CD
\FO
\SFO
\NOTC
\ANDC
\ANDBC
\ORC
\ORBC
```

The parser maps each macro to the corresponding operation code. There is no
canonical fallback such as `\op{AND_BC}`.

## Atomic Query Claims

Canonical schema:

```tex
\begin{queryclaim}
\language{\langref{CNF}}
\operation{\VA}
\status{\poly}
\assuming{$P \neq NP$}
\begin{description}
A \langref{CNF} representation is valid iff every clause in it is valid
\citep{Darwiche_2002}.
\end{description}
\end{queryclaim}
```

The assumption line is omitted when there is no assumption.

The rendered claim text is generated from `\language`, `\operation`, and
`\status`.

## Atomic Transformation Claims

Canonical schema:

```tex
\begin{transformationclaim}
\language{\langref{CNF}}
\operation{\ANDC}
\status{\poly}
\begin{description}
Conjunction of \langref{CNF} representations is trivially another
\langref{CNF} representation \citep{Darwiche_2002}.
\end{description}
\end{transformationclaim}
```

The schema is identical to query claims except for the environment name and
operation namespace.

## Batch Claims

Batch claims are selector-style grouped operation claims. They expand into
ordinary operation support entries before propagation.

Canonical schema:

```tex
\begin{batchclaim}
\selector{\isin{
  \langref{cSDD},
  \langref{d-SDNNF},
  \langref{DNNF},
  \langref{FBDD},
  \langref{OBDD}
}}
\operation{\ANDC}
\status{\noquasi}
\begin{description}
In \thislang, every clause has a polynomial-size representation. If \thislang
supported \ANDC, then every \langref{CNF} could be compiled into \thislang.
\end{description}
\end{batchclaim}
```

Selector with constraints:

```tex
\begin{batchclaim}
\selector{
  \compilespoly{\langref{OBDD}}{\thislang},
  \compilespoly{\thislang}{\langref{DNNF}}
}
\operation{\ANDBC}
\status{\noquasi}
\begin{description}
...
\end{description}
\end{batchclaim}
```

Mixed selector:

```tex
\begin{batchclaim}
\selector{
  \isin{
    \langfam{d-SDNNF}{T},
    \langfam{uOBDD}{<}
  },
  \compilespoly{\thislang}{\langref{d-SDNNF}}
}
\operation{\ORBC}
\status{\nopolyunknownquasi}
\assuming{$P \neq NP$}
\begin{description}
...
\end{description}
\end{batchclaim}
```

Selector clauses are comma-separated and always interpreted as conjunction.
There is no OR selector syntax. Cases requiring OR must be split into multiple
batch claims.

Supported selector clauses:

```tex
\isin{language-list}
\compilespoly{source}{target}
\compilesquasi{source}{target}
\nocompilespoly{source}{target}
\nocompilesquasi{source}{target}
```

`\thislang` is the current language being tested by the selector and expanded
by the batch. It is meaningful only inside `batchclaim`.

Batch claims do not expose IDs. The implementation must derive deterministic
internal IDs from normalized visible content.

## References

There is no `\references` macro.

Authors cite sources inline with ordinary citation commands:

```tex
\citep{Darwiche_2002}
\citet[Theorem 5]{Vinall-Smeeth_2024}
```

The reference registry is `docs/refs.bib`. Citation indexes are computed from
inline citations at runtime or build time. They are not separate authoring
fields and should not be persisted in canonical JSON unless a generated cache
is introduced explicitly.

## Internal JSON Requirements

The new JSON model should remove:

- `classification` from languages;
- `definitionRefs` from languages;
- persisted `refs` arrays that only duplicate inline citations;
- language-level `references` arrays;
- hidden LaTeX-only identity fields.

Batch claims retain structured selector data internally. If an internal `id` is
needed, it is generated from a hash of the normalized selector. Selectors must
therefore be unique within the relevant operation-claim namespace. The user
never sees the ID.

## Validation Requirements

The parser must reject:

- unknown language macros in claims or selectors;
- duplicate language short names;
- malformed language, claim, selector, operation, status, or assumption blocks;
- `\thislang` outside `batchclaim`;
- duplicate batch selectors within the same operation-claim namespace;
- OR-like selector syntax;
- operation macros from the wrong namespace where that distinction matters;
- missing required fields;
- hidden legacy metadata in canonical generated output.

Validation and propagation remain all-at-once. A LaTeX import produces one
candidate database, then structural validation and propagation decide whether it
is accepted for review or blocked.
