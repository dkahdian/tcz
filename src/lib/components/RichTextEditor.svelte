<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, tick } from 'svelte';
  import { EditorState, EditorSelection } from '@codemirror/state';
  import { EditorView, keymap, placeholder } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import MathText from './MathText.svelte';
  import type {
    DirectedSuccinctnessRelation,
    FilteredGraphData,
    GraphData,
    KCLanguage,
    KCReference
  } from '$lib/types.js';
  import { QUERIES, TRANSFORMATIONS, resolveLanguageProperties } from '$lib/data/operations.js';
  import { extractCitationKeys } from '$lib/utils/math-text.js';
  import { parseBibtex } from '$lib/data/references.js';

  type ToolPanel = 'reference' | 'language' | 'relation' | 'operation' | null;

  let {
    value,
    graphData,
    placeholderText = 'Click to edit.',
    rows = 5,
    currentLanguage = null,
    onCommit,
    onAddReference
  }: {
    value: string;
    graphData: GraphData | FilteredGraphData;
    placeholderText?: string;
    rows?: number;
    currentLanguage?: KCLanguage | null;
    onCommit: (value: string) => void;
    onAddReference?: (bibtex: string) => string | null;
  } = $props();

  let shell: HTMLDivElement | null = $state(null);
  let editorHost: HTMLDivElement | null = $state(null);
  let referenceModal: HTMLDivElement | null = $state(null);
  let view: EditorView | null = null;
  let editing = $state(false);
  let draft = $state(value ?? '');
  let activePanel = $state<ToolPanel>(null);
  let focusedPicker = $state<string | null>(null);

  let citationCommand = $state<'citep' | 'citet'>('citep');
  let referenceSearch = $state('');
  let selectedReferenceId = $state('');
  let citationLocator = $state('');
  let bibtexDraft = $state('');
  let referenceError = $state<string | null>(null);
  let referenceModalOpen = $state(false);

  let languageSearch = $state('');
  let selectedLanguageId = $state('');
  let pluralLanguage = $state(false);

  let relationSourceSearch = $state('');
  let relationTargetSearch = $state('');
  let relationSourceId = $state(currentLanguage?.id ?? '');
  let relationTargetId = $state('');

  let operationLanguageSearch = $state('');
  let operationSearch = $state('');
  let operationLanguageId = $state(currentLanguage?.id ?? '');
  let operationCode = $state('');

  const sortedReferences = $derived(
    [...(graphData.references ?? [])].sort((a, b) => a.id.localeCompare(b.id))
  );

  const filteredReferences = $derived.by<KCReference[]>(() => {
    const needle = referenceSearch.trim().toLowerCase();
    const references = sortedReferences;
    if (!needle) return references.slice(0, 8);
    return references
      .filter((reference) =>
        [reference.id, reference.title, reference.bibtex, reference.href]
          .some((part) => (part ?? '').toLowerCase().includes(needle))
      )
      .slice(0, 8);
  });

  const filteredLanguages = $derived.by<KCLanguage[]>(() => {
    const needle = languageSearch.trim().toLowerCase();
    return searchLanguages(needle).slice(0, 8);
  });

  const relationSourceOptions = $derived.by<KCLanguage[]>(() =>
    searchLanguages(relationSourceSearch.trim().toLowerCase()).slice(0, 6)
  );
  const relationTargetOptions = $derived.by<KCLanguage[]>(() =>
    searchLanguages(relationTargetSearch.trim().toLowerCase()).slice(0, 6)
  );
  const operationLanguageOptions = $derived.by<KCLanguage[]>(() =>
    searchLanguages(operationLanguageSearch.trim().toLowerCase()).slice(0, 6)
  );

  const operationOptions = $derived.by(() => {
    const needle = operationSearch.trim().toLowerCase();
    const operations = [
      ...Object.values(QUERIES).map((operation) => ({ ...operation, kind: 'query' as const })),
      ...Object.values(TRANSFORMATIONS).map((operation) => ({ ...operation, kind: 'transformation' as const }))
    ];

    return operations
      .filter((operation) =>
        !needle ||
        operation.code.toLowerCase().includes(needle) ||
        operation.label.toLowerCase().includes(needle)
      )
      .slice(0, 8);
  });

  const unresolvedCitationKeys = $derived.by(() => {
    const known = new Set((graphData.references ?? []).map((reference) => reference.id));
    return extractCitationKeys(draft).filter((key) => !known.has(key));
  });

  $effect(() => {
    if (!editing) {
      draft = value ?? '';
    }
  });

  $effect(() => {
    if (currentLanguage?.id) {
      if (!relationSourceId) relationSourceId = currentLanguage.id;
      if (!operationLanguageId) operationLanguageId = currentLanguage.id;
    }
  });

  $effect(() => {
    if (!browser || !editing || !editorHost || view) return;

    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: draft,
        extensions: [
          history(),
          EditorView.lineWrapping,
          placeholder(placeholderText),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              draft = update.state.doc.toString();
            }
          }),
          EditorView.theme({
            '&': {
              minHeight: `${Math.max(rows, 3) * 1.45}rem`
            },
            '.cm-content': {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.86rem'
            }
          })
        ]
      })
    });

    view.focus();
  });

  onDestroy(() => {
    view?.destroy();
  });

  function searchLanguages(needle: string): KCLanguage[] {
    const languages = [...(graphData.languages ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return languages;
    return languages
      .map((language) => ({ language, score: scoreLanguage(language, needle) }))
      .filter(({ score }) => score < Number.POSITIVE_INFINITY)
      .sort((a, b) => a.score - b.score || a.language.name.localeCompare(b.language.name))
      .map(({ language }) => language);
  }

  function normalizeSearchText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\$/g, '')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactSearchText(text: string): string {
    return normalizeSearchText(text).replace(/[^a-z0-9]+/g, '');
  }

  function scoreLanguage(language: KCLanguage, needle: string): number {
    const normalizedNeedle = normalizeSearchText(needle);
    const compactNeedle = compactSearchText(needle);
    const fields = [language.name, language.fullName, language.id].filter(Boolean);

    let best = Number.POSITIVE_INFINITY;
    for (const field of fields) {
      const normalized = normalizeSearchText(field);
      const compact = compactSearchText(field);
      if (normalized === normalizedNeedle || compact === compactNeedle) best = Math.min(best, 0);
      else if (normalized.startsWith(normalizedNeedle)) best = Math.min(best, 1);
      else if (compact.startsWith(compactNeedle)) best = Math.min(best, 2);
      else if (normalized.includes(normalizedNeedle)) best = Math.min(best, 3);
      else if (compact.includes(compactNeedle)) best = Math.min(best, 4);
    }

    return best;
  }

  async function openEditor() {
    if (editing) return;
    editing = true;
    activePanel = null;
    await tick();
  }

  function closeEditor() {
    activePanel = null;
    referenceModalOpen = false;
    const committed = draft;
    if (committed !== value) {
      onCommit(committed);
    }
    editing = false;
    view?.destroy();
    view = null;
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (
      !shell ||
      !(next instanceof Node) ||
      (!shell.contains(next) && !referenceModal?.contains(next))
    ) {
      closeEditor();
    }
  }

  function togglePanel(panel: Exclude<ToolPanel, null>) {
    activePanel = activePanel === panel ? null : panel;
    referenceModalOpen = false;
    referenceError = null;
    focusedPicker = null;
  }

  function insertText(text: string, cursorOffset = text.length) {
    if (!view) return;
    const ranges = view.state.selection.ranges;
    const changes = ranges.map((range) => ({ from: range.from, to: range.to, insert: text }));
    const primary = ranges[0];
    const cursor = primary.from + cursorOffset;

    view.dispatch({
      changes,
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true
    });
    view.focus();
    activePanel = null;
  }

  function selectLanguageForInsert(language: KCLanguage) {
    selectedLanguageId = language.id;
    languageSearch = language.name;
    focusedPicker = null;
  }

  function selectRelationSource(language: KCLanguage) {
    relationSourceId = language.id;
    relationSourceSearch = language.name;
    focusedPicker = null;
  }

  function selectRelationTarget(language: KCLanguage) {
    relationTargetId = language.id;
    relationTargetSearch = language.name;
    focusedPicker = null;
  }

  function selectOperationLanguage(language: KCLanguage) {
    operationLanguageId = language.id;
    operationLanguageSearch = language.name;
    focusedPicker = null;
  }

  function wrapSelection(prefix: string, suffix: string, emptyBody = '') {
    if (!view) return;
    const selection = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(selection.from, selection.to);
    const body = selectedText || emptyBody;
    const insertion = `${prefix}${body}${suffix}`;
    const cursorOffset = selectedText ? insertion.length : prefix.length;

    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: insertion },
      selection: EditorSelection.cursor(selection.from + cursorOffset),
      scrollIntoView: true
    });
    view.focus();
    activePanel = null;
  }

  function insertReference(referenceId: string) {
    if (!referenceId) return;
    const locator = citationLocator.trim();
    const options = locator ? `[${locator}]` : '';
    insertText(`\\${citationCommand}${options}{${referenceId}}`);
  }

  function selectReference(referenceId: string) {
    selectedReferenceId = referenceId;
    referenceSearch = referenceId;
    focusedPicker = null;
  }

  function openReferenceModal() {
    referenceModalOpen = true;
    referenceError = null;
    bibtexDraft = '';
  }

  function closeReferenceModal() {
    referenceModalOpen = false;
    referenceError = null;
  }

  function addReference() {
    const bibtex = bibtexDraft.trim();
    if (!bibtex) {
      referenceError = 'Paste a BibTeX entry first.';
      return;
    }

    const parsed = parseBibtex(bibtex);
    const referenceId = onAddReference?.(bibtex) ?? (parsed.id !== 'unknown' ? parsed.id : null);
    if (!referenceId) {
      referenceError = 'Could not create a reference key from that BibTeX entry.';
      return;
    }

    bibtexDraft = '';
    referenceModalOpen = false;
    referenceError = null;
    selectedReferenceId = referenceId;
    referenceSearch = referenceId;
  }

  function splitFamilyName(name: string): { base: string; parameter: string } | null {
    const match = /^(.+)\$_(.+)\$$/.exec(name);
    if (!match) return null;
    return {
      base: match[1],
      parameter: match[2].replace(/^\{|\}$/g, '')
    };
  }

  function languageMacro(language: KCLanguage): string {
    const suffix = pluralLanguage ? '{s}' : '';
    const family = language.classification === 'family' ? splitFamilyName(language.name) : null;
    if (family) {
      return `\\langfam{${family.base}}{${family.parameter}}${suffix}`;
    }
    return `\\langref{${language.name}}${suffix}`;
  }

  function insertSelectedLanguage() {
    const language = graphData.languages.find((candidate) => candidate.id === selectedLanguageId);
    if (!language) return;
    insertText(languageMacro(language));
  }

  function lookupRelation(sourceId: string, targetId: string): DirectedSuccinctnessRelation | null {
    const sourceIndex = graphData.adjacencyMatrix.indexByLanguage[sourceId];
    const targetIndex = graphData.adjacencyMatrix.indexByLanguage[targetId];
    if (sourceIndex === undefined || targetIndex === undefined) return null;
    return graphData.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex] ?? null;
  }

  function relationMacroFor(status: string, focus?: 'no-poly' | 'quasi'): string | null {
    if (status === 'poly' || status === 'unknown-poly-quasi') return 'edgeref';
    if (status === 'no-quasi' || status === 'no-poly-unknown-quasi') return 'nedgeref';
    if (status === 'no-poly-quasi') return focus === 'quasi' ? 'edgeref' : focus === 'no-poly' ? 'nedgeref' : null;
    return null;
  }

  function insertRelation(focus?: 'no-poly' | 'quasi') {
    if (!relationSourceId || !relationTargetId) return;
    const relation = lookupRelation(relationSourceId, relationTargetId);
    if (!relation) return;
    const command = relationMacroFor(relation.status, focus);
    if (!command) return;
    insertText(`\\${command}{${relationSourceId}}{${relationTargetId}}`);
  }

  function supportForOperation(languageId: string, code: string) {
    const language = graphData.languages.find((candidate) => candidate.id === languageId);
    if (!language) return null;
    const resolved = resolveLanguageProperties(language.properties.queries, language.properties.transformations);
    return [...resolved.queries, ...resolved.transformations].find((operation) => operation.code === code) ?? null;
  }

  function insertOperation() {
    if (!operationLanguageId || !operationCode) return;
    const support = supportForOperation(operationLanguageId, operationCode);
    if (!support || support.complexity === 'unknown-to-us') return;
    const command = support.complexity === 'poly' ? 'opref' : 'nopref';
    insertText(`\\${command}{${operationLanguageId}}{${operationCode}}`);
  }
</script>

{#if editing}
  <div class="rich-editor-shell" bind:this={shell} onfocusout={handleFocusOut}>
    <div class="toolbar" role="toolbar" aria-label="Rich text insertion tools">
      <button type="button" class="tool-button citation-tool" title="Insert reference" onclick={() => togglePanel('reference')}>[n]</button>
      <button type="button" class="tool-button tool-button--math" title="Insert language or family" onclick={() => togglePanel('language')}>
        <MathText text={'$\\mathcal{L}$'} className="inline" />
      </button>
      <button type="button" class="tool-button tool-button--math" title="Insert relation" onclick={() => togglePanel('relation')}>
        <MathText text={'$\\to$'} className="inline" />
      </button>
      <button type="button" class="tool-button" title="Insert operation" onclick={() => togglePanel('operation')}>[CO]</button>
      <button type="button" class="tool-button" title="Wrap selection in math" onclick={() => wrapSelection('$', '$', '')}>$</button>
      <button type="button" class="preview-button" onclick={closeEditor}>Preview</button>
    </div>

    {#if activePanel === 'reference'}
      <div class="tool-panel">
        <div class="segmented">
          <button type="button" class:active={citationCommand === 'citep'} onclick={() => citationCommand = 'citep'}>Parenthetical</button>
          <button type="button" class:active={citationCommand === 'citet'} onclick={() => citationCommand = 'citet'}>Textual</button>
        </div>
        <input class="panel-input" bind:value={citationLocator} placeholder="Optional locator, e.g. Theorem 4.2" />
        <input
          class="panel-input"
          bind:value={referenceSearch}
          onfocus={() => focusedPicker = 'reference'}
          oninput={() => selectedReferenceId = ''}
          placeholder="key"
        />
        {#if focusedPicker === 'reference'}
          <div class="result-list">
            {#each filteredReferences as reference}
              <button
                type="button"
                class="result-row"
                class:active={selectedReferenceId === reference.id}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => selectReference(reference.id)}
              >
                <strong>{reference.id}</strong>
                <span><MathText text={reference.title} className="inline" /></span>
              </button>
            {/each}
            <button type="button" class="result-row add-row" onmousedown={(event) => event.preventDefault()} onclick={openReferenceModal}>
              Add new reference
            </button>
          </div>
        {/if}
        <button type="button" class="panel-action" disabled={!selectedReferenceId} onclick={() => insertReference(selectedReferenceId)}>
          Insert citation
        </button>
      </div>
    {:else if activePanel === 'language'}
      <div class="tool-panel">
        <input
          class="panel-input"
          bind:value={languageSearch}
          onfocus={() => focusedPicker = 'language'}
          oninput={() => selectedLanguageId = ''}
          placeholder="Search languages and families"
        />
        <label class="panel-check">
          <input type="checkbox" bind:checked={pluralLanguage} />
          <span>Plural</span>
        </label>
        {#if focusedPicker === 'language'}
          <div class="mini-results">
            {#each filteredLanguages as language}
              <button
                type="button"
                class:active={selectedLanguageId === language.id}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => selectLanguageForInsert(language)}
              >
                <MathText text={language.name} className="inline" />
              </button>
            {/each}
          </div>
        {/if}
        <button type="button" class="panel-action" disabled={!selectedLanguageId} onclick={insertSelectedLanguage}>
          Insert language
        </button>
      </div>
    {:else if activePanel === 'relation'}
      <div class="tool-panel">
        <div class="selector-grid">
          <div>
            <input
              class="panel-input"
              bind:value={relationSourceSearch}
              onfocus={() => focusedPicker = 'relation-source'}
              oninput={() => relationSourceId = ''}
              placeholder="Source language"
            />
            {#if focusedPicker === 'relation-source'}
              <div class="mini-results">
                {#each relationSourceOptions as language}
                  <button
                    type="button"
                    class:active={relationSourceId === language.id}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => selectRelationSource(language)}
                  >
                    <MathText text={language.name} className="inline" />
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <div>
            <input
              class="panel-input"
              bind:value={relationTargetSearch}
              onfocus={() => focusedPicker = 'relation-target'}
              oninput={() => relationTargetId = ''}
              placeholder="Target language"
            />
            {#if focusedPicker === 'relation-target'}
              <div class="mini-results">
                {#each relationTargetOptions as language}
                  <button
                    type="button"
                    class:active={relationTargetId === language.id}
                    onmousedown={(event) => event.preventDefault()}
                    onclick={() => selectRelationTarget(language)}
                  >
                    <MathText text={language.name} className="inline" />
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
        {#if relationSourceId && relationTargetId}
          {@const relation = lookupRelation(relationSourceId, relationTargetId)}
          {#if !relation || relation.status === 'unknown-both'}
            <p class="panel-note">Nothing to cite.</p>
          {:else if relation.status === 'no-poly-quasi'}
            <p class="panel-note">What are you citing here?</p>
            <div class="panel-actions-inline">
              <button type="button" class="panel-action" onclick={() => insertRelation('no-poly')}>No polynomial compilation</button>
              <button type="button" class="panel-action" onclick={() => insertRelation('quasi')}>Quasipolynomial compilation exists</button>
            </div>
          {:else if relationMacroFor(relation.status)}
            <button type="button" class="panel-action" onclick={() => insertRelation()}>Insert citation</button>
          {:else}
            <p class="panel-note">Nothing to cite.</p>
          {/if}
        {/if}
      </div>
    {:else if activePanel === 'operation'}
      <div class="tool-panel">
        <input
          class="panel-input"
          bind:value={operationLanguageSearch}
          onfocus={() => focusedPicker = 'operation-language'}
          oninput={() => operationLanguageId = ''}
          placeholder="Language"
        />
        {#if focusedPicker === 'operation-language'}
          <div class="mini-results">
            {#each operationLanguageOptions as language}
              <button
                type="button"
                class:active={operationLanguageId === language.id}
                onmousedown={(event) => event.preventDefault()}
                onclick={() => selectOperationLanguage(language)}
              >
                <MathText text={language.name} className="inline" />
              </button>
            {/each}
          </div>
        {/if}
        <input class="panel-input" bind:value={operationSearch} onfocus={() => focusedPicker = 'operation'} placeholder="Operation, e.g. CO" />
        {#if focusedPicker === 'operation'}
          <div class="mini-results">
            {#each operationOptions as operation}
              <button type="button" class:active={operationCode === operation.code} onmousedown={(event) => event.preventDefault()} onclick={() => operationCode = operation.code}>
                {operation.code} <span><MathText text={operation.label} className="inline" /></span>
              </button>
            {/each}
          </div>
        {/if}
        {#if operationLanguageId && operationCode}
          {@const support = supportForOperation(operationLanguageId, operationCode)}
          {#if !support || support.complexity === 'unknown-to-us'}
            <p class="panel-note">Nothing to cite.</p>
          {:else}
            <button type="button" class="panel-action" onclick={insertOperation}>Insert citation</button>
          {/if}
        {/if}
      </div>
    {/if}

    <div class="editor-host" bind:this={editorHost}></div>
    {#if unresolvedCitationKeys.length}
      <p class="editor-warning">Unknown reference: {unresolvedCitationKeys.join(', ')}</p>
    {/if}
  </div>
{:else}
  <button type="button" class="rendered-field" onclick={openEditor}>
    {#if value?.trim()}
      <MathText text={value} className="inline" />
    {:else}
      <span class="empty-placeholder">{placeholderText}</span>
    {/if}
  </button>
{/if}

{#if referenceModalOpen}
  <div class="reference-modal-backdrop" role="presentation" onclick={closeReferenceModal}>
    <div
      class="reference-modal"
      bind:this={referenceModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-reference-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <header>
        <h4 id="new-reference-title">New Reference</h4>
      </header>
      <textarea class="panel-textarea" bind:value={bibtexDraft} placeholder={'@article{...}'}></textarea>
      {#if referenceError}<p class="panel-error">{referenceError}</p>{/if}
      <footer>
        <button type="button" class="secondary" onclick={closeReferenceModal}>Cancel</button>
        <button type="button" class="primary" onclick={addReference}>Add Reference</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .rendered-field {
    display: block;
    width: 100%;
    padding: 0.45rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 0.35rem;
    background: transparent;
    color: #374151;
    text-align: left;
    line-height: 1.5;
    cursor: text;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  .rendered-field:hover {
    border-color: #bfdbfe;
    background: #f8fafc;
  }

  .empty-placeholder {
    color: #94a3b8;
    font-style: italic;
  }

  .rich-editor-shell {
    border: 1px solid #bfdbfe;
    border-radius: 0.45rem;
    background: white;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.08);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem;
    border-bottom: 1px solid #dbeafe;
    background: #f8fafc;
  }

  .tool-button,
  .preview-button {
    min-width: 1.85rem;
    height: 1.75rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    background: white;
    color: #0f172a;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }

  .tool-button:hover,
  .preview-button:hover {
    border-color: #2563eb;
    color: #1d4ed8;
  }

  .citation-tool {
    color: #2563eb;
  }

  .tool-button--math {
    display: inline-grid;
    place-items: center;
  }

  .preview-button {
    margin-left: auto;
    min-width: 4rem;
    padding: 0 0.6rem;
    font-weight: 650;
  }

  .tool-panel {
    display: grid;
    gap: 0.45rem;
    padding: 0.55rem;
    border-bottom: 1px solid #dbeafe;
    background: #ffffff;
  }

  .panel-input,
  .panel-textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    padding: 0.38rem 0.45rem;
    color: #0f172a;
    font-size: 0.8rem;
  }

  .panel-textarea {
    min-height: 5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    resize: vertical;
  }

  .segmented {
    display: inline-flex;
    width: fit-content;
    border: 1px solid #cbd5e1;
    border-radius: 0.35rem;
    overflow: hidden;
  }

  .segmented button {
    border: 0;
    border-right: 1px solid #cbd5e1;
    background: white;
    padding: 0.32rem 0.55rem;
    color: #334155;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .segmented button:last-child {
    border-right: 0;
  }

  .segmented button.active,
  .mini-results button.active {
    background: #dbeafe;
    color: #1d4ed8;
  }

  .result-list,
  .mini-results {
    display: grid;
    gap: 0.18rem;
    max-height: 14rem;
    overflow: auto;
  }

  .result-row,
  .mini-results button {
    display: grid;
    gap: 0.1rem;
    width: 100%;
    border: 1px solid #e2e8f0;
    border-radius: 0.3rem;
    background: #f8fafc;
    padding: 0.24rem 0.38rem;
    color: #0f172a;
    text-align: left;
    cursor: pointer;
    font-size: 0.76rem;
    line-height: 1.2;
  }

  .result-row:hover,
  .mini-results button:hover {
    border-color: #93c5fd;
    background: #eff6ff;
  }

  .result-row.active,
  .mini-results button.active {
    border-color: #2563eb;
    background: #dbeafe;
    color: #1d4ed8;
  }

  .add-row {
    position: sticky;
    bottom: 0;
    border-color: #2563eb;
    color: #1d4ed8;
    font-weight: 750;
  }

  .result-row span,
  .mini-results span,
  .panel-note {
    color: #64748b;
    font-size: 0.72rem;
    line-height: 1.25;
  }

  .panel-check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: #334155;
    font-size: 0.8rem;
  }

  .panel-action {
    width: fit-content;
    border: 1px solid #2563eb;
    border-radius: 0.3rem;
    background: #2563eb;
    color: white;
    padding: 0.36rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
  }

  .panel-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .panel-actions-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .panel-error,
  .editor-warning {
    margin: 0;
    color: #b91c1c;
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .editor-warning {
    padding: 0.35rem 0.55rem 0.5rem;
    border-top: 1px solid #fee2e2;
    background: #fef2f2;
  }

  .selector-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.45rem;
  }

  .editor-host {
    text-align: left;
  }

  :global(.cm-editor) {
    border-radius: 0 0 0.45rem 0.45rem;
  }

  :global(.cm-editor.cm-focused) {
    outline: none;
  }

  :global(.cm-scroller) {
    line-height: 1.45;
  }

  .reference-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(15, 23, 42, 0.45);
  }

  .reference-modal {
    width: min(30rem, 100%);
    display: grid;
    gap: 0.65rem;
    border: 1px solid #bfdbfe;
    border-radius: 0.5rem;
    background: #fff;
    padding: 1rem;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  }

  .reference-modal h4 {
    margin: 0;
    color: #1e3a8a;
    font-size: 0.95rem;
    font-weight: 800;
  }

  .reference-modal footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .reference-modal footer button {
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    background: white;
    padding: 0.35rem 0.55rem;
    color: #0f172a;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }

  .reference-modal footer .primary {
    border-color: #2563eb;
    background: #2563eb;
    color: #fff;
  }
</style>
