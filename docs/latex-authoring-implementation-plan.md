# LaTeX Authoring Architecture

This note records the current implementation shape for the LaTeX contribution
route. The normative schema is `docs/latex-authoring-contract.md`; the
contributor-facing guide is `docs/latex-contribution-guide.md`.

## Canonical Flow

The canonical authoring files are:

- `docs/definitions.tex`
- `docs/languages.tex`
- `docs/succinctness.tex`
- `docs/queries.tex`
- `docs/transformations.tex`
- `docs/refs.bib`

`scripts/latex-bijection.ts` owns the conversion in both directions:

- `npm run to-json` parses the LaTeX files into `src/lib/data/database.json`,
  validates semantic relation/operation macros, then refreshes derived data.
- `npm run to-latex` generates canonical LaTeX from `database.json`.
- `npm run latex:roundtrip` runs `to-latex -> to-json -> to-latex`.

The GitHub contribution workflow runs the round-trip before opening a PR. A
round-trip failure rejects the submitted contribution.

## Parser Contract

The parser accepts only visible semantic structure:

- `language`, `concept`, `succinctnessclaim`, `queryclaim`,
  `transformationclaim`, and `batchclaim` environments;
- visible identity fields such as `\shortname`, `\fullname`, `\source`,
  `\target`, `\operation`, `\status`, `\selector`, and `\assuming`;
- inline citations through ordinary `\citep` and `\citet`;
- semantic relation and operation-result macros.

The parser rejects old generated-body metadata such as hidden `% lang=...`
comments, labels used as identities, `\classification`, `\references`,
`\defref`, `\edgeref`, `\nedgeref`, `\opref`, and `\nopref`.

## Runtime Model

Language IDs remain internal JSON/runtime identifiers. They are not an authoring
surface in LaTeX prose. Human-authored LaTeX identifies languages with
`\langref{...}` and `\langfam{...}{...}`.

The app no longer stores a language classification field. Class/member status is
inferred from the visible language name shape and emitted as `\langfam`.
Default visibility is preserved by an explicit default-visible-language list,
not by classification.

Citation indexes are derived from inline citation commands. They are not edited
through global `\references{...}` fields.

Batch claims are stored internally with deterministic IDs derived from visible
selector content. The user never authors or sees a batch ID.

## Validation

Relation macros are checked against the complete candidate database:

- `\compilespoly` requires a polynomial compilation relation.
- `\compilesquasi` requires a polynomial or quasipolynomial compilation
  relation.
- `\nocompilespoly` requires no polynomial compilation.
- `\nocompilesquasi` requires no quasipolynomial compilation.

Operation-result macros are checked similarly:

- `\supportspoly`
- `\supportsquasi`
- `\nosupportspoly`
- `\nosupportsquasi`

Inside batch selectors, relation macros are selector predicates over
`\thislang`. Outside selectors, they are checked assertions.

## Verification Before Commit

Run:

```sh
npm run latex:roundtrip
npm run check
```

The round-trip may normalize generated LaTeX or BibTeX casing. Commit those
normalizations when they are semantically intended.
