# Contribution GUI Contract

This document defines the contribution workflow contract for a user-facing GUI. It is not a UI sketch. It describes what a contributor must be able to express, what the system must validate, and what a submitted contribution means.

## Goal

The GUI should cover the common contribution path without requiring contributors to edit the generated LaTeX files directly. A contributor should be able to propose:

- a new representation language, including definition text, references, and known query/transformation support;
- edits to an existing language, except for immutable identity fields;
- a directed succinctness relation between two languages, including status, assumptions, references, and explanatory text;
- edits to existing directed succinctness relations and operation support claims, subject to validation.

Every GUI submission is still a proposal. It must pass automated validation before submission, but it must also be manually reviewed before acceptance.

## Core Model

The contribution GUI should be built as a structured patch over the current database, using the same all-at-once validation model as sandbox mode. A queued contribution is not a sequence of independent edits. It is one candidate world:

1. Clone the current database.
2. Apply all queued user edits.
3. Run structural validation and propagation.
4. Block submission if the resulting database is contradictory or structurally invalid.
5. If valid, submit the whole patch for maintainer review.

Validation must evaluate the whole queue at once, because a new language, its references, its operation support, and its relations may only make sense together.

## Language Contributions

When adding a language, the contributor must choose a language classification immediately. The default is `plain`.

Supported classifications:

- `plain`: a single ordinary representation language, rendered as `\langref{...}` in generated LaTeX.
- `family`: a fixed-parameter family/member, rendered as `\langfam{base}{parameter}` in generated LaTeX.
- `union`: a union over family members, rendered as `\langref{...}` in generated LaTeX but treated separately in the app for filtering and semantics.

For `family` languages, the GUI must collect the base name and parameter symbol separately. For example, `OBDD` plus `<` should produce the internal/display form for `OBDD$_<$`.

Required language fields:

- classification: `plain`, `family`, or `union`;
- display name, generated or entered according to classification;
- full name;
- definition text.

Optional but supported language fields:

- definition references;
- query support claims;
- transformation support claims.

References and descriptions are optional, but missing references or missing explanatory text should produce warnings before submission.

## Editing Existing Languages

For existing languages, contributors may edit language metadata except the language name and classification. The name is immutable because it is used in display, LaTeX round-tripping, and many cross-references. The classification is immutable because changing it can change the meaning and LaTeX rendering contract of the existing language identity.

Editable fields include:

- full name;
- definition text;
- definition references;
- query support;
- transformation support.

The existing values should load into the editor. The contributor can adjust them and resubmit the resulting candidate patch.

## Operation Support Claims

New and edited languages may include query and transformation support. Contributors do not need to explicitly fill unknown cells. Unspecified operation support remains unchanged for existing languages and defaults to unknown for new languages.

For every explicitly supplied operation claim, the contributor may provide:

- operation type: query or transformation;
- operation;
- status code;
- optional assumption;
- optional references;
- optional description.

The GUI may warn when a non-unknown operation claim has no reference or no description, but this must not by itself block submission.

The contributor-facing model is individual operation cells. Existing or future batch-claim storage is internal. GUI submissions must not create new batch claims or require contributors to understand batch selectors/templates. A later maintainer-facing batch editor may expose batches explicitly.

## Succinctness Relation Contributions

Succinctness relations are always directed. A relation from `A` to `B` and a relation from `B` to `A` are separate contributions.

For each relation, the contributor must provide:

- source language;
- target language;
- status code.

For each relation, the contributor may provide:

- optional assumption;
- optional references;
- optional description.

Supported status codes are the full current status vocabulary:

- `poly`;
- `no-poly-unknown-quasi`;
- `no-poly-quasi`;
- `unknown-poly-quasi`;
- `unknown-both`;
- `no-quasi`.

For `no-poly-quasi`, the GUI contract uses one combined description. The lower-level data model may contain separate no-polynomial and quasipolynomial proof components, but contributors are not required to split the justification.

## Editing Existing Relations

Existing directed relations should load into the relation editor with their current status, assumption, references, and description.

The contributor may edit any relation metadata. Status changes are allowed only if the resulting all-queue candidate patch passes sandbox-style validation. For example:

- changing `no-poly-unknown-quasi` to `poly` should be blocked if sandbox validation finds a contradiction;
- changing `no-poly-unknown-quasi` to `no-poly-quasi` may be allowed when the added quasipolynomial claim is consistent.

## References

References are reusable first-class objects. A contributor should be able to search existing references and attach them to language definitions, operation claims, and relation claims.

If the search does not find the needed reference, the contributor may add a new reference by supplying BibTeX. The system should parse the BibTeX into a display title and URL when possible, while allowing user correction.

Missing references are allowed, but should trigger a warning before submission.

## Deprecated Metadata

Language tags are deprecated and removed from the canonical language model. The GUI should not expose tag creation, tag editing, or read-only language tag rendering as part of contribution authoring.

## Graph Placement And Visibility

Contributors do not provide graph coordinates. Reviewers are not required to place nodes as part of accepting an otherwise valid contribution.

When a contribution introduces a language, the system must generate a default graph position for that language before it becomes part of the canonical database. Accepted canonical languages should not be left without an entry in `defaultNodePositionsByLanguageName`.

Placement should be algorithmic and deterministic. Existing canonical node positions are treated as anchors, and newly introduced languages are placed relative to those anchors using their accepted relations and classifications.

ELK is the preferred layout engine for this. The installed ELK stack supports fixed-position and incremental layout concepts, including `org.eclipse.elk.stress.fixed`, `org.eclipse.elk.position`, and interactive layout options. The implementation should prototype an ELK-based anchored layout first:

- use existing canonical positions as fixed anchors;
- lay out only newly introduced languages and any temporary edges needed to place them;
- preserve the existing graph as much as possible;
- fall back to a deterministic reserved placement region if the anchored layout cannot produce a satisfactory position.

Graph placement is a system responsibility, not a contributor or reviewer responsibility. Maintainers may later adjust canonical positions for visual polish, but manual positioning must not be required for contribution acceptance.

Language visibility follows the existing classification behavior unless explicitly changed later. Plain languages and fixed family members should be visible by default. Union languages should remain hidden by default through the language visibility filter, while still being searchable/selectable where the GUI needs them.

## Assumptions

Assumptions should be selected from existing assumptions when possible, with a free-text option for new assumptions. Examples include assumptions already present in the database, such as `P \neq NP`.

Assumption text is optional. It is part of the claim metadata and participates in generated descriptions and review.

## Warnings Versus Blocking Errors

Warnings should be shown for review-quality issues that do not make the patch invalid:

- missing reference on a claim;
- missing description on a claim;
- missing reference on a language definition;
- unusual or new free-text assumption.

Blocking errors should prevent submission:

- structurally invalid data;
- unknown source or target language;
- duplicate or malformed new language identity;
- directed relation from a language to itself;
- invalid status code;
- contradictions found by sandbox-style validation/propagation.

## Review Contract

Passing validation means the contribution is internally consistent with the current database. It does not mean the contribution is accepted.

Every submission should become a reviewable artifact for maintainers. Maintainers may still reject or revise a valid contribution for research, citation, style, or scope reasons.
