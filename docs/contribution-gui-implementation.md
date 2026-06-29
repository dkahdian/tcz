# Contribution GUI Implementation Plan

This document describes an implementation path for the contribution GUI contract. The core idea is to grow the existing sandbox mode into a contribution-capable editing mode instead of creating a separate contribution workflow.

## Product Shape

Sandbox mode becomes the contribution authoring mode for matrix views.

The graph remains canonical-only and read-only. Sandbox mode is unavailable on the graph, and contribution previews do not alter graph data. Contributors should not place graph nodes.

The succinctness, query, and transformation matrix views become the primary contribution work surface. The sidebar becomes the editor for whatever is selected:

- selected language: language metadata editor;
- selected succinctness cell or edge: directed relation editor;
- selected query/transformation cell: operation support editor.

The existing sandbox header controls should be extended rather than replaced:

- keep the sandbox toggle;
- keep reset;
- keep the draft-change count;
- add warning/error status;
- add submit.

Clicking submit opens a modal that collects contributor name, email, optional GitHub handle, and optional note. The final action in that modal submits the contribution.

The current `/contribute` page should eventually disappear. Before removing it, harvest its useful parts: reference parsing, queue persistence, submission history, GitHub dispatch submission, existing add/edit forms, and queue item summaries.

## Data Model Direction

The current sandbox model already has the right backbone: a list of edits is applied over the canonical database, then the whole candidate database is validated and propagated.

Expand sandbox edits to cover:

- language additions;
- language metadata edits;
- directed succinctness relation additions/edits, including description, assumption, and references;
- query and transformation support edits, including description, assumption, and references;
- reference and assumption additions/reuse;
- contributor metadata at submission time.

The implementation should avoid a second parallel "contribution queue" model. The existing contribution queue code can be mined, but the long-term model should be one sandbox edit list plus derived submission payloads.

## Editing Semantics

Propagation currently takes roughly 3 seconds, so not every keystroke should run validation and propagation.

Fields should be grouped by whether they affect logical propagation.

Logical fields should update the evaluated sandbox promptly:

- relation status;
- operation support status;
- language identity/classification when adding a language;
- language name or existence;
- assumption changes.

These fields should commit immediately when changed through quick-picks/selects, or on blur when edited through a text/select field (specifically, on blur of the individual fields, not the whole language or relation cell). Each commit runs the all-at-once sandbox validation and propagation.

Plaintext and bookkeeping fields may stay in local dirty state while the user is typing:

- language full name;
- definition/description text;
- relation description;
- operation description;
- notes;
- references.

Plaintext fields should autosave locally while dirty. They should flush into the sandbox edit list on blur (specifically, on blur of the whole language or relation cell, not on blur of individual subfields) and must flush before final submission. This avoids explicit save buttons without running propagation on every keystroke.

Reusing a reference should update local draft state immediately, but it should not force expensive propagation on every reference interaction. Adding a brand-new reference via BibTeX should update the draft reference registry immediately so the reference can be selected in the current editor. It may run lightweight structural/reference validation, but it should not require full logical propagation unless it is committed together with a logical edit. Reference changes must be included in the next validation pass and before submission.

Submission must always run a final full validation and propagation pass over the complete sandbox edit list, including all dirty plaintext and reference state.

## Language Editing

When sandbox mode is active and a language is selected, the sidebar should expose edit controls immediately.

Existing languages may be edited except for immutable name/identity and classification fields. The editor should allow full name, definition text, definition references, query support, and transformation support according to the contract.

Language tags are deprecated and removed from the canonical language model. The app should not expose tag creation, tag editing, or read-only language tag rendering.

The language sidebar should continue to show query and transformation support in read-only summary form. The query/transformation rows should link to their respective matrix views regardless of whether sandbox mode is active.

## UI Elements

### Header Controls

The existing header should remain compact.

When sandbox mode is off:

- `Sandbox` toggle: enters contribution/sandbox mode for matrix views.

When sandbox mode is on:

- `Sandbox` toggle: indicates active editing mode and shows the total draft-change count, including dirty unflushed metadata edits;
- `Reset`: clears all sandbox edits and dirty sidebar state after confirmation if there are unsaved changes;
- warning/error badge: shows the current validation state;
- `Submit`: flushes dirty state, runs final validation/propagation, and opens the contributor-info modal if no blocking errors remain.

The warning/error badge should be clickable. It should open a small popover listing blocking errors first, then warnings. Blocking errors disable final submission; warnings do not.

### Matrix Controls

The graph has no contribution controls.

The succinctness matrix should support:

- row/column header click: select language and show language sidebar;
- relation cell click: select the directed relation represented by that cell;
- unknown relation cell click in sandbox mode: select the directed relation and make it editable;
- status quick-pick popover in sandbox mode: preserve the existing fast status editing path;
- status quick-pick selection: commit immediately and run validation/propagation;
- `(+)` at the end of the language axis: open add-language modal.

The query and transformation matrices should support:

- row header click: select language and show language sidebar;
- column header click: select operation and show operation description;
- operation cell click: select the language/operation claim;
- unknown operation cell click in sandbox mode: select the claim and make it editable;
- status quick-pick popover in sandbox mode: preserve the existing fast status editing path;
- status quick-pick selection: commit immediately and run validation/propagation;
- `(+)` at the end of the language axis: open add-language modal.

The `(+)` affordance should be visually small and stable. It should not resize the matrix. It should be keyboard-focusable and should have a tooltip/title such as `Add language`.

### Sidebar Field Controls

Sidebar editors should use ordinary form controls, not modal-first editing.

Use these controls consistently:

- status: select/dropdown with the same options as the current sandbox quick-picks;
- assumptions: direct dropdown/list over the canonical JSON assumptions, with an `Add assumption` option;
- references: searchable multi-select dropdown over existing and draft references, with an `Add reference` option when the search has no match;
- description/definition/plaintext: textarea with local dirty state;
- classification: segmented control or select with `plain`, `class`, and `union`, defaulting to `plain`.

Dirty fields should be visibly marked in the sidebar. This can be subtle: for example, a small "Unsaved" pill on the panel or a changed-field border. Dirty fields count toward the header draft-change count even before they have flushed into the evaluated sandbox edit list.

### Rich Text Editing

Definition and description fields should use a compact source-first rich editor rather than a full WYSIWYG editor.

The field has two modes:

- read mode: show the final rendered `MathText` output only;
- edit mode: replace the rendered output with a CodeMirror editor and a compact toolbar.

Clicking inside a rendered field opens edit mode. Clicking `Preview`, or blurring outside the whole editor shell, commits the source text, closes CodeMirror, and returns to the rendered output. Blur inside toolbar dropdowns must not close the editor.

The toolbar should use compact symbols with tooltips, not plaintext labels:

- reference: `[bib]`;
- language or class: cursive `L`;
- relation: arrow;
- operation: `[CO]`;
- math: `$`;
- preview: plaintext `Preview`.

The reference dropdown should provide:

- a `\citep` / `\citet` toggle;
- a search field over reference keys, titles, and BibTeX text;
- an optional locator field, allowed for both citation commands;
- an `Add new reference` action at the bottom that opens a BibTeX paste flow and makes the new key immediately insertable.

The language dropdown should merge ordinary languages and classes. The picker searches all languages and inserts the correct macro:

- ordinary and union languages: `\langref{Name}`;
- fixed classes: `\langfam{Base}{Parameter}`;
- plural checkbox: appends the optional `{s}` argument.

The relation dropdown should provide two searchable language selectors. The macro is inferred from the current relation status:

- `poly`: insert `\compilespoly{source}{target}`;
- `unknown-poly-quasi`: insert `\compilesquasi{source}{target}`;
- `no-poly-unknown-quasi`: insert `\nocompilespoly{source}{target}`;
- `no-quasi`: insert `\nocompilesquasi{source}{target}`;
- `unknown`: show `Nothing to cite`;
- `no-poly-quasi`: ask what the sentence is citing, with options `No polynomial compilation` and `Quasipolynomial compilation exists`, then insert `\nocompilespoly` or `\compilesquasi` respectively.

The operation dropdown should provide searchable language and operation selectors. The macro is inferred from the selected claim:

- `poly`: insert `\supportspoly{language}{operation}`;
- `unknown-poly-quasi`: insert `\supportsquasi{language}{operation}`;
- `no-poly-unknown-quasi`: insert `\nosupportspoly{language}{operation}`;
- `no-poly-quasi`: ask what the sentence is citing, then insert `\nosupportspoly` or `\supportsquasi`;
- `no-quasi`: insert `\nosupportsquasi{language}{operation}`;
- unknown: show `Nothing to cite`.

The math button should insert `$...$`, wrapping the current selection when text is selected and placing the cursor inside the delimiters otherwise.

Assumptions remain separate metadata fields. The rich text editor may not set or replace the logical assumption field.

### Reference Picker

The reference picker should support:

- search by id, title, author text if available, and BibTeX text;
- multi-select for relation, operation, and definition references;
- an `Add reference` row when the search has no useful match;
- BibTeX paste flow;
- immediate availability of the new reference in the current picker after it is accepted.

BibTeX alone is enough to create a new draft reference. The LaTeX/reference pipeline should parse BibTeX into display metadata, so the GUI does not need to require title or URL fields.

Adding a reference does not close the parent relation/language/operation editor. It returns the user to the same field with the new reference selected.

### Assumption Picker

The assumption picker should support:

- selecting an existing assumption from the canonical JSON `assumptions` list;
- clearing an assumption;
- `Add assumption`;
- free-text entry for the new assumption.

New assumptions should create warnings until reviewed, but should not block submission.

### Contributor Submit Modal

The submit modal should collect:

- name, required;
- email, required;
- GitHub handle, optional;
- note, optional.

The modal should show a compact summary of the draft: added languages, edited languages, relation edits, operation edits, new references, warnings, and blocking errors if any appeared after final validation.

The final button should be disabled unless name and email are present and final validation has no blocking errors.

### Language Sidebar

When sandbox mode is off, the language sidebar remains a detail panel.

When sandbox mode is on, selecting a language shows the same detail panel with inline edit controls for editable fields. Existing language names and classifications remain read-only. New sandbox languages may show editable identity/classification fields until the identity is committed, subject to validation.

Query and transformation summaries stay visible on the language sidebar in both modes. Each row should be a link-style button that switches to the corresponding matrix view and selects that operation cell for the current language. This behavior should exist regardless of whether sandbox mode is active.

### Relation Sidebar

The relation sidebar should show exactly one directed relation at a time. If the currently selected pair has both directions populated, the sidebar may include a compact reverse-direction summary, but editing controls apply only to the selected direction.

The selected direction should be visually explicit using source and target labels plus an arrow. Source and target are read-only when selected from a matrix cell.

### Operation Sidebar

The operation sidebar should distinguish operation-definition browsing from operation-claim editing.

Selecting an operation column shows read-only operation definition details. Selecting a language/operation cell shows claim details, and in sandbox mode exposes claim editing controls.

Language and operation are read-only when selected from a matrix cell.

### Dirty State

Dirty state exists at the sidebar-editor level and at the individual field level.

The header draft-change count includes:

- committed sandbox edits;
- dirty plaintext fields;
- dirty reference selections;
- dirty assumption selections;
- dirty contributor-independent metadata fields.

Dirty state should be persisted locally with the rest of sandbox state so a contributor can leave and return without losing text. On final submit, all dirty state is flushed into sandbox edits before validation.

## Adding Languages

The matrix views should expose language creation through the existing empty gray corner marker. In sandbox mode, replace that marker with a blue `New Language` button. This keeps the control stable and avoids adding fake matrix rows or columns.

The add-language modal should ask only for:

- classification, defaulting to `plain`;
- display name for `plain` and `union`;
- base name plus parameter symbol for `class`;
- full name;
- definition or description text.

`plain` and `union` use the same fields because both render through `\langref{...}`. `class` uses separate base and parameter fields because it renders through `\langfam{base}{parameter}`.

It should not ask for operation support immediately. After the language is added to sandbox mode, the contributor can fill query/transformation support from the operation matrices and relations from the succinctness matrix.

New sandbox languages should appear immediately in the non-graph tables. They should be excluded from the graph because graph display is canonical-only. In fact, no changes from sandbox mode should ever be reflected in the graph, until the contribution is accepted and merged into the canonical database.

New language ordering is a one-dimensional layout problem. The existing canonical ordering follows a topological ordering based on accepted `poly` edges. You should use a similar topological ordering for new languages: follow the existing ordering of canonical languages, and place a new language after it enters the queue for the topological sort. This ensures that the ordering respects the old canonical ordering, and that new languages are ordered consistently with respect to the succinctness partial order. The ordering should be deterministic and stable across sessions, so that a contributor can return to a draft and see the same ordering.

## Relation Editing

Succinctness relations are directed. Clicking any matrix cell, including an unknown cell, should select that directed relation.

In sandbox mode, status quick-picks should remain directly in the matrix cells. This preserves the current fast sandbox interaction. Editing the status in the sidebar should also be possible, with a similar dropdown.

The sidebar relation editor should expose:

- source and target, read-only once selected from a cell;
- status;
- optional assumption;
- optional references;
- optional description.

Changing status should immediately update the sandbox edit and run validation/propagation. Metadata fields should follow the dirty/blur behavior described above.

Changing the assumption should also run validation/propagation on blur, because assumptions are part of the logical claim.

## Operation Editing

Clicking a query or transformation cell should select that operation claim and show the operation editor in the sidebar.

The editor should expose:

- language, read-only once selected from a cell;
- operation, read-only once selected from a cell;
- status;
- optional assumption;
- optional references;
- optional description.

Unknown/unfilled operation cells are editable in sandbox mode. Contributors are not required to fill explicit unknowns.

Status changes should update the sandbox immediately. Assumption changes should run validation/propagation on blur. Other metadata fields should autosave locally and flush on blur/submission.

## Warnings And Errors

Blocking validation errors prevent submission:

- structural invalidity;
- invalid status code;
- invalid source/target/language id;
- directed relation from a language to itself;
- sandbox propagation contradiction.

Warnings do not prevent submission:

- missing reference;
- missing description;
- unusual or new free-text assumption.

The sandbox header should show whether the draft has blocking errors or warnings. The sidebar should show field-local warnings where possible.

Warnings should be grouped by entity type, for example:

- language warnings;
- relation warnings;
- operation warnings;
- reference warnings;
- assumption warnings.

## Submission Flow

Submitting from sandbox mode should:

1. Flush all dirty sidebar state into the sandbox edit list.
2. Run full validation and propagation.
3. Block if there are errors.
4. Show warnings but allow continuation.
5. Open contributor-info modal.
6. Collect mandatory name, mandatory email, optional GitHub handle, and optional note.
7. Submit the derived contribution payload through the existing GitHub dispatch path.
8. Record submission history.
9. Clear sandbox state on success.

The new sandbox-based submission payload does not need to remain backward-compatible with the old `/contribute` payload shape. The GitHub dispatch receiver should be updated in the same implementation, and the end-to-end path should be tested comprehensively.

## Contract Alignment Checklist

The implementation must preserve the contribution contract:

- contributions are one all-at-once candidate database, not independent accepted edits;
- language additions collect classification immediately and default to `plain`;
- existing language names and classifications remain immutable;
- operation claims are edited per cell and do not expose batch mechanics;
- relation claims are directed;
- references are reusable and searchable, with BibTeX creation on failed search;
- assumptions come from a small canonical JSON list, with free-text creation for new assumptions;
- tags are deprecated and not editable;
- missing references/descriptions are warnings, not blockers;
- contradictions under propagation are blockers;
- graph placement is system-owned and never contributor/reviewer-owned;
- graph view remains canonical-only while sandbox mode is used for contribution authoring.

## Implementation Steps

1. Extract only the necessary reusable logic from `/contribute`: possibly, but not necessarily, reference handling, queue persistence, submission history, GitHub dispatch, and form utilities. Do not carry forward tag editing.
2. Expand `SandboxEdit` and `applySandboxEdits` to support language and reference edits.
3. Add dirty-state management for sidebar editors with blur/submission flushing.
4. Extend matrix components with add-language controls and editable unknown operation/relation cells in sandbox mode.
5. Convert `LanguageInfo`, `EdgeInfo`, and `OperationInfo` into read/edit sidebar panels depending on sandbox mode.
6. Add sandbox header warnings, submit button, and contributor-info modal.
7. Generate contribution submission payloads from sandbox state.
8. Delete `/contribute` as soon as reusable parts are harvested and the integrated flow no longer depends on it.
