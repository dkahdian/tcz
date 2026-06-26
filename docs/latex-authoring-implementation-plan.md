# LaTeX Authoring Implementation Plan

This plan migrates TCZ from generated LaTeX with hidden machine metadata to a
human-authored semantic LaTeX schema. The migration is intentionally breaking.
Old comments, labels, classification fields, and batch IDs should be removed
rather than preserved as canonical authoring surface.

## Goals

- Make the LaTeX body fully human-readable and semantically explicit.
- Remove body-level internal IDs, parser comments, generated labels, and batch
  IDs.
- Remove `classification` from the internal app model.
- Deprecate and remove the classification-based language-scope filter.
- Preserve current default language visibility through an explicit default
  visible-language list.
- Migrate `definitions.tex` into the same semantic authoring model.
- Keep JSON/LaTeX bijection strict and deterministic.
- Preserve all current data semantics through migration.

## Non-Goals

- Do not maintain the old LaTeX body format as canonical.
- Do not add compatibility aliases to generated output.
- Do not expose `\references{...}` or global reference metadata in LaTeX.
- Do not keep language `classification` as an authored or internal field.
- Do not keep `\defref` as a canonical authoring macro.
- Do not persist citation indexes in canonical JSON unless an explicit generated
  cache is introduced.

## Phase 0: Freeze And Inventory

1. Record current generated artifacts:
   - `docs/languages.tex`
   - `docs/succinctness.tex`
   - `docs/queries.tex`
   - `docs/transformations.tex`
   - `docs/definitions.tex`
   - `docs/refs.bib`
   - `src/lib/data/database.json`
2. Add a migration branch or checkpoint commit before code changes.
3. Generate a semantic inventory from current JSON:
   - language short names and full names;
   - language definitions;
   - conceptual definitions;
   - explicit succinctness relations;
   - explicit query and transformation supports;
   - batch claims and expanded language sets;
   - inline citation keys per description;
   - assumptions.
4. Save this inventory as a test fixture for semantic diffing.

## Phase 1: Redesign Data Types

1. Remove `classification?: LanguageClassification` from `KCLanguage`.
2. Remove `LanguageClassification` if no longer needed elsewhere.
3. Remove language `definitionRefs`.
4. Remove language-level `references`.
5. Remove persisted `refs` arrays whose only source is inline citations.
6. Add a shared citation-index utility that computes citation keys from text at
   runtime or build time:
   - relation citation indexes derive from relation descriptions;
   - operation citation indexes derive from operation descriptions;
   - batch citation indexes derive from batch descriptions;
   - concept citation indexes derive from concept descriptions;
   - language definition citation indexes derive from language descriptions.
7. Keep `KCBatchSelector` but simplify assumptions:
   - list selectors represent `\isin`;
   - multiple selector clauses are implicit `allOf`;
   - no authored `anyOf`;
   - split OR cases into separate batch claims.
8. Keep `KCBatchClaim.id` only if needed internally, and derive it from a hash
   of the normalized selector.
9. Enforce selector uniqueness within the relevant operation-claim namespace so
   selector-hash IDs are stable and collision-resistant in practice.
10. Replace conceptual definition IDs with runtime slugs derived from normalized
    titles, unless a non-authoring generated cache needs them.

## Phase 2: Remove Classification-Driven UI

1. Delete `src/lib/data/language-classifications.ts`.
2. Remove `LANGUAGE_CLASSIFICATIONS` imports.
3. Remove `language-scope-filters.ts` and the classification-based
   `language-visibility` filter.
4. Remove `LanguageVisibilityPicker` from the active UI path.
5. Create an explicit default-visible-language list from the current default
   view, so removing classification does not change the default graph or matrix
   language set.
6. Update view defaults to use this explicit list rather than hidden union
   classification.
7. Refactor rich text insertion:
   - detect class languages from the display/name shape or normalized language
     identity, not `classification`;
   - emit `\langfam{base}{parameter}` when the language identity is class-like;
   - emit `\langref{name}` otherwise.
8. Refactor new-language/contribution UI:
   - replace classification selector with a simpler choice between language and
     class;
   - language creates `\langref{name}`;
   - class creates `\langfam{base}{parameter}`;
   - no union-specific path.
9. Update sandbox edit types and storage validation to remove classification.
10. Remove classification wording from contribution docs after the LaTeX
    migration docs are accepted.

## Phase 3: Define Macro Runtime

1. Update generated LaTeX preambles with new environments:
   - `language`
   - `succinctnessclaim`
   - `queryclaim`
   - `transformationclaim`
   - `batchclaim`
   - `concept`
   - `description`
2. Define field macros:
   - `\shortname`
   - `\fullname`
   - `\source`
   - `\target`
   - `\language`
   - `\operation`
   - `\status`
   - `\selector`
   - `\assuming`
   - `\title`
3. Define status macros:
   - `\poly`
   - `\nopolyunknownquasi`
   - `\nopolyquasi`
   - `\unknownpolyquasi`
   - `\unknownboth`
   - `\noquasi`
4. Define operation macros:
   - query macros: `\CO`, `\VA`, `\CE`, `\IM`, `\EQ`, `\SE`, `\CT`, `\ME`;
   - transformation macros: `\CD`, `\FO`, `\SFO`, `\NOTC`, `\ANDC`,
     `\ANDBC`, `\ORC`, `\ORBC`.
5. Define relation macros:
   - `\compilespoly`
   - `\compilesquasi`
   - `\nocompilespoly`
   - `\nocompilesquasi`
6. Define selector macros:
   - `\isin`
   - `\thislang`
7. Keep `\langref`, `\langfam`, `\citep`, and `\citet`.
8. Remove `\defref` from canonical output and migrate existing definition prose
   to ordinary text.
9. Keep legacy `\edgeref`, `\nedgeref`, `\opref`, and `\nopref` only if needed
   temporarily for old descriptions during migration, but do not emit them in
   new canonical output.
10. Implement one shared relation-macro validation table:
    - `\compilespoly` requires relation status `poly`;
    - `\compilesquasi` requires `poly`, `no-poly-quasi`, or
      `unknown-poly-quasi`;
    - `\nocompilespoly` requires `no-poly-unknown-quasi`, `no-poly-quasi`, or
      `no-quasi`;
    - `\nocompilesquasi` requires `no-quasi`.

## Phase 4: Rewrite LaTeX Generator

1. Generate `languages.tex` using `language` blocks.
2. Generate `definitions.tex` using `concept` blocks.
3. Generate `succinctness.tex` using `succinctnessclaim` blocks.
4. Generate `queries.tex` using `queryclaim` and `batchclaim` blocks.
5. Generate `transformations.tex` using `transformationclaim` and `batchclaim`
   blocks.
6. Remove reference-grouped sections from generated claim files.
7. Remove table-of-contents grouping if it no longer helps human editing.
8. Generate stable ordering:
   - languages by canonical language order;
   - concepts by current definitions order;
   - succinctness claims by source/target display order;
   - operation claims by language order, then operation order;
   - batch claims by operation order, selector key, then status.
9. Emit no hidden metadata comments in canonical body.
10. Emit no parser-owned labels for languages, concepts, or claims.
11. Emit no classification.
12. Emit no `\defref`.
13. Emit no persisted references that duplicate inline citations.
14. Emit assumptions immediately before description.
15. Emit `\thislang` in batch descriptions where the old template used
    `$\\mathcal{L}$`.

## Phase 5: Rewrite LaTeX Parser

1. Replace line-oriented hidden-comment parsing with block parsing.
2. Parse balanced environments and commands:
   - do not rely on one field per physical line;
   - preserve description content verbatim except for normalization required by
     JSON storage.
3. Parse language blocks:
   - require `\shortname`;
   - require `\fullname`;
   - require `description`;
   - reject duplicate short names;
   - infer class identity from `\langfam`.
4. Parse concept blocks:
   - require `\title`;
   - require `description`;
   - derive runtime slug from normalized title;
   - reject labels, keys, and `\defref`.
5. Parse succinctness claims:
   - require `\source`, `\target`, `\status`, and `description`;
   - optional `\assuming` must be immediately before description;
   - compute citation indexes from description when needed.
6. Parse query and transformation claims:
   - require `\language`, `\operation`, `\status`, and `description`;
   - validate operation namespace;
   - compute citation indexes from description when needed.
7. Parse batch claims:
   - require `\selector`, `\operation`, `\status`, and `description`;
   - optional `\assuming` must be immediately before description;
   - parse comma-separated selector clauses as implicit all-of;
   - parse `\isin{...}` as a list selector;
   - parse relation selector clauses using relation macros;
   - require `\thislang` only where selectors/descriptions need the variable;
   - derive internal ID from selector hash if an ID is needed;
   - reject duplicate selectors within the operation-claim namespace;
   - reject OR-like selector syntax.
8. Do not write parsed citation indexes into canonical JSON.
9. After constructing the complete candidate database, validate every relation
   macro found outside selectors against the candidate database. Import fails if
   any macro asserts a directed relation that is not true under the shared
   relation-macro table.
10. Evaluate relation macros inside selectors as predicates during batch
    expansion, using the same truth table. Selector predicates choose the
    `\thislang` expansion set rather than acting as prose assertions.
11. Reject old canonical body metadata:
   - `% lang=...`;
   - `% Reference ID: ...`;
   - `\label{def:lang_...}`;
   - `\label{kdef:...}`;
   - `\begin{batchclaim}[id=...]`;
   - `\classification{...}`;
   - `\references{...}`;
   - `\defref{...}`.

## Phase 6: Migrate Existing Data

1. Run old JSON through the new generator to produce new LaTeX.
2. Convert existing descriptions:
   - `$\\mathcal{L}$` in batch templates -> `\thislang`;
   - `\edgeref`/`\nedgeref` -> new relation macros where mechanically safe;
   - `\opref`/`\nopref` -> operation claim prose or new operation references if
     such references are still needed.
3. Convert conceptual definitions:
   - `\begin{definition}\label{kdef:...}` -> `\begin{concept}`;
   - title line -> `\title{...}`;
   - body -> `description`;
   - `\defref{...}{label}` -> plain `label`;
   - `\defref{...}` -> plain title text where possible.
4. Remove `definitionRefs` from generated language blocks.
5. Remove classification data.
6. Remove persisted reference arrays that duplicate inline citations.
7. Ensure every previous explicit claim is represented in new LaTeX.
8. Ensure every previous batch expansion produces the same operation support
   entries after parsing and expansion.

## Phase 7: Semantic Diff Tests

1. Add a semantic-normalization script that compares old and new databases while
   ignoring removed fields:
   - language IDs may differ only if all references are remapped correctly;
   - classification is ignored;
   - citation indexes are computed during comparison;
   - batch IDs are compared through selector and expansion, not literal ID.
2. Test `old JSON -> new LaTeX -> new JSON`.
3. Test `new JSON -> new LaTeX -> new JSON`.
4. Test `new LaTeX -> new JSON -> new LaTeX`.
5. Compare:
   - language count and identities;
   - explicit relation matrix;
   - explicit operation supports;
   - batch expansion results;
   - assumptions;
   - descriptions;
   - citation keys;
   - concept titles and descriptions;
   - propagation outputs.
6. Run the existing app checks after migration.
7. Run database stats before and after migration and compare expected deltas.

## Phase 8: Validation And Review UX

1. Update parser errors to point to the environment and field, not internal IDs.
2. Make errors actionable:
   - unknown language shortname;
   - unknown operation macro;
   - invalid status macro;
   - missing description;
   - malformed selector;
   - `\thislang` outside batch;
   - duplicate batch selector;
   - relation macro does not match the current directed relation status;
   - hidden legacy metadata found.
3. Add warnings for:
   - no citation in a description;
   - no explanatory prose beyond generated claim fields;
   - assumption without citation;
   - selector that expands to zero languages.
4. Keep warnings non-blocking unless they produce invalid structure.

## Phase 8.5: GUI Authoring Support

1. Update the rich-text relation insertion button to emit the new relation
   macros instead of `\edgeref` and `\nedgeref`.
2. Choose the macro case-by-case from the selected directed relation status:
   - `poly`: insert `\compilespoly`, with an option for `\compilesquasi` if the
     contributor wants the weaker statement;
   - `no-poly-unknown-quasi`: insert `\nocompilespoly`;
   - `no-poly-quasi`: ask whether the sentence cites no-polynomial compilation
     or quasipolynomial compilation, then insert `\nocompilespoly` or
     `\compilesquasi`;
   - `unknown-poly-quasi`: insert `\compilesquasi`;
   - `unknown-both`: disable relation insertion and show that there is no known
     relation to cite;
   - `no-quasi`: insert `\nocompilesquasi`, with an option for
     `\nocompilespoly` if the contributor wants the weaker statement.
3. Run relation-macro validation against the sandbox candidate database before
   enabling final GUI contribution submission.
4. Re-run the same validation after flushing dirty text fields in the final
   submit flow, so stale relation references fail the queue.
5. Surface failures next to the field containing the invalid macro and in the
   submission error summary.

## Phase 9: Remove Old Paths

1. Remove old parser code paths for:
   - `% lang=...`;
   - old claim prose parsing;
   - old `batchclaim` optional args;
   - language labels as identity;
   - conceptual definition labels as identity;
   - `\defref` entity rendering.
2. Remove classification files, types, and imports.
3. Remove classification-based language visibility filter UI and defaults.
4. Add the explicit default-visible-language list that preserves current
   default visibility.
5. Remove or rewrite docs that instruct contributors to edit old generated
   claim bodies.
6. Update package scripts only if command names need to change. Prefer keeping:
   - `npm run to-json`
   - `npm run to-latex`
   - `npm run check`

## Phase 10: Acceptance Criteria

The migration is done only when all are true:

- canonical LaTeX body contains no internal JSON IDs;
- canonical LaTeX body contains no hidden parser comments;
- canonical language definitions contain no generated labels;
- canonical conceptual definitions contain no generated labels;
- canonical LaTeX contains no `\classification`;
- canonical LaTeX contains no `\defref`;
- internal app types no longer include language classification;
- classification-based language-scope filter is gone;
- current default language visibility is preserved by an explicit list;
- citation indexes are computed from inline citations rather than persisted as
  authored JSON fields;
- batch claims are selector-style and ID-free in LaTeX;
- batch internal IDs, if retained, are selector hashes;
- old and new semantic inventories match after expected field removals;
- validation and propagation pass;
- the app builds and renders the migrated database.

## Risks

- Removing classification can accidentally change default visibility. Mitigate
  this by snapshotting the current default-visible-language list before removal.
- Selector-hash batch IDs depend on selector uniqueness. The parser must enforce
  uniqueness before writing JSON.
- Citation extraction must handle `\citep`, `\citet`, optional locators, and
  multiple keys.
- Block parsing must handle nested braces and multiline fields correctly.
- Removing `\defref` means concept title changes may change runtime anchors.
- Removing old parser compatibility will make stale LaTeX branches fail hard.

## Suggested Implementation Order

1. Add semantic inventory tests against current data.
2. Refactor app classification usage and remove language-scope filter.
3. Add new macro preambles and generator output.
4. Add new parser.
5. Migrate existing docs with the new generator.
6. Run semantic diff and fix mismatches.
7. Delete old parser and old generated-body assumptions.
8. Update contributor docs and command help.
