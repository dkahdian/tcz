<script lang="ts">
  import MathText from './MathText.svelte';
  import type {
    KCLanguage,
    LanguageClassification,
    LanguageVisibilityParam,
    ViewMode
  } from '$lib/types.js';
  import { ORIGINAL_KCM_LANGUAGE_IDS } from '$lib/data/filters/language-scope-filters.js';
  import { QUERIES, TRANSFORMATIONS } from '$lib/data/operations.js';

  let {
    languages = [],
    value,
    viewMode = 'graph',
    onChange
  }: {
    languages?: KCLanguage[];
    value: LanguageVisibilityParam;
    viewMode?: ViewMode;
    onChange: (value: LanguageVisibilityParam) => void;
  } = $props();

  let search = $state('');
  let languagesExpanded = $state(false);
  let queriesExpanded = $state(false);
  let transformationsExpanded = $state(false);

  function getSortedLanguages(items: KCLanguage[]): KCLanguage[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  const sortedLanguages = $derived(getSortedLanguages(languages));
  const queryItems = $derived(
    Object.entries(QUERIES).map(([id, op]) => ({ id, code: op.code, label: op.label }))
  );
  const transformationItems = $derived(
    Object.entries(TRANSFORMATIONS).map(([id, op]) => ({ id, code: op.code, label: op.label }))
  );
  const showGraphOperationDisplay = $derived(viewMode === 'graph');
  const showQueryColumnVisibility = $derived(viewMode === 'queries');
  const showTransformationColumnVisibility = $derived(viewMode === 'transforms');
  const showQueries = $derived(showGraphOperationDisplay || showQueryColumnVisibility);
  const showTransformations = $derived(
    showGraphOperationDisplay || showTransformationColumnVisibility
  );

  const filteredLanguages = $derived(
    sortedLanguages.filter((language) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return (
        language.name.toLowerCase().includes(needle) ||
        language.fullName.toLowerCase().includes(needle)
      );
    })
  );
  const filteredQueries = $derived(
    queryItems.filter((op) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return op.code.toLowerCase().includes(needle) || op.label.toLowerCase().includes(needle);
    })
  );
  const filteredTransformations = $derived(
    transformationItems.filter((op) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return op.code.toLowerCase().includes(needle) || op.label.toLowerCase().includes(needle);
    })
  );
  const hasSearch = $derived(search.trim().length > 0);
  const languagesOpen = $derived(hasSearch || languagesExpanded);
  const queriesOpen = $derived(hasSearch || queriesExpanded);
  const transformationsOpen = $derived(hasSearch || transformationsExpanded);

  function getVisibleIds(param: LanguageVisibilityParam): Set<string> {
    const ids = new Set(param.ids);

    switch (param.mode) {
      case 'all':
        return new Set(languages.map((language) => language.id));
      case 'only':
        return ids;
      case 'except':
        return new Set(
          languages
            .map((language) => language.id)
            .filter((languageId) => !ids.has(languageId))
        );
      default:
        return new Set(languages.map((language) => language.id));
    }
  }

  function normalizeFromVisibleIds(visibleIds: Set<string>): LanguageVisibilityParam {
    const allIds = languages.map((language) => language.id);
    const visibleList = allIds.filter((id) => visibleIds.has(id));
    const hiddenList = allIds.filter((id) => !visibleIds.has(id));

    if (hiddenList.length === 0) {
      return { ...value, mode: 'all', ids: [] };
    }

    if (visibleList.length <= hiddenList.length) {
      return { ...value, mode: 'only', ids: visibleList };
    }

    return { ...value, mode: 'except', ids: hiddenList };
  }

  function isLanguageVisible(languageId: string): boolean {
    return getVisibleIds(value).has(languageId);
  }

  function toggleLanguage(languageId: string) {
    const visibleIds = getVisibleIds(value);
    if (visibleIds.has(languageId)) {
      visibleIds.delete(languageId);
    } else {
      visibleIds.add(languageId);
    }
    onChange(normalizeFromVisibleIds(visibleIds));
  }

  function setAllVisible() {
    onChange({
      ...value,
      mode: 'all',
      ids: []
    });
  }

  function setNoneVisible() {
    onChange({
      ...value,
      mode: 'only',
      ids: []
    });
  }

  function setOnlyOriginalKcmVisible() {
    const visibleIds = getVisibleIds(value);
    const availableKcmIds = ORIGINAL_KCM_LANGUAGE_IDS.filter((id) =>
      languages.some((language) => language.id === id)
    );
    const visibleFamilyAndUnionIds = languages
      .filter((language) => (language.classification ?? 'plain') !== 'plain')
      .map((language) => language.id)
      .filter((id) => visibleIds.has(id));

    onChange({
      ...value,
      mode: 'only',
      ids: Array.from(new Set([...availableKcmIds, ...visibleFamilyAndUnionIds]))
    });
  }

  function resetPicker() {
    search = '';
    onChange({ mode: 'all', ids: [] });
  }

  function sectionStateLabel(open: boolean): string {
    return open ? 'Collapse' : 'Expand';
  }

  function getHiddenQueryIds(): Set<string> {
    return new Set(value.hiddenQueryIds ?? []);
  }

  function getHiddenTransformationIds(): Set<string> {
    return new Set(value.hiddenTransformationIds ?? []);
  }

  function getGraphQueryIds(): Set<string> {
    return new Set(value.graphQueryIds ?? []);
  }

  function getGraphTransformationIds(): Set<string> {
    return new Set(value.graphTransformationIds ?? []);
  }

  function isQueryVisible(id: string): boolean {
    return !getHiddenQueryIds().has(id);
  }

  function isTransformationVisible(id: string): boolean {
    return !getHiddenTransformationIds().has(id);
  }

  function isGraphQueryDisplayed(id: string): boolean {
    return getGraphQueryIds().has(id);
  }

  function isGraphTransformationDisplayed(id: string): boolean {
    return getGraphTransformationIds().has(id);
  }

  function toggleMatrixOperation(kind: 'query' | 'transformation', id: string) {
    const hidden = kind === 'query' ? getHiddenQueryIds() : getHiddenTransformationIds();
    if (hidden.has(id)) {
      hidden.delete(id);
    } else {
      hidden.add(id);
    }

    onChange({
      ...value,
      hiddenQueryIds: kind === 'query' ? [...hidden] : (value.hiddenQueryIds ?? []),
      hiddenTransformationIds:
        kind === 'transformation' ? [...hidden] : (value.hiddenTransformationIds ?? [])
    });
  }

  function setMatrixOperationsVisible(kind: 'query' | 'transformation', visible: boolean) {
    onChange({
      ...value,
      hiddenQueryIds:
        kind === 'query' ? (visible ? [] : queryItems.map((op) => op.id)) : (value.hiddenQueryIds ?? []),
      hiddenTransformationIds:
        kind === 'transformation'
          ? visible
            ? []
            : transformationItems.map((op) => op.id)
          : (value.hiddenTransformationIds ?? [])
    });
  }

  function toggleGraphOperation(kind: 'query' | 'transformation', id: string) {
    const selected = kind === 'query' ? getGraphQueryIds() : getGraphTransformationIds();
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }

    onChange({
      ...value,
      graphQueryIds: kind === 'query' ? [...selected] : (value.graphQueryIds ?? []),
      graphTransformationIds:
        kind === 'transformation' ? [...selected] : (value.graphTransformationIds ?? [])
    });
  }

  function setGraphOperationsDisplayed(kind: 'query' | 'transformation', selected: boolean) {
    onChange({
      ...value,
      graphQueryIds:
        kind === 'query' ? (selected ? queryItems.map((op) => op.id) : []) : (value.graphQueryIds ?? []),
      graphTransformationIds:
        kind === 'transformation'
          ? selected
            ? transformationItems.map((op) => op.id)
            : []
          : (value.graphTransformationIds ?? [])
    });
  }

  function getClassificationIds(classification: LanguageClassification): string[] {
    return languages
      .filter((language) => (language.classification ?? 'plain') === classification)
      .map((language) => language.id);
  }

  function getClassificationButtonLabel(classification: Exclude<LanguageClassification, 'plain'>): string {
    const ids = getClassificationIds(classification);
    if (ids.length === 0) {
      return classification === 'family' ? 'Families' : 'Unions';
    }

    const visibleIds = getVisibleIds(value);
    const allVisible = ids.every((id) => visibleIds.has(id));
    return `${allVisible ? 'Hide' : 'Show'} ${classification === 'family' ? 'families' : 'unions'}`;
  }

  function toggleClassification(classification: Exclude<LanguageClassification, 'plain'>) {
    const ids = getClassificationIds(classification);
    if (ids.length === 0) return;

    const visibleIds = getVisibleIds(value);
    const allVisible = ids.every((id) => visibleIds.has(id));
    const nextVisibleIds = new Set(visibleIds);

    if (allVisible) {
      for (const id of ids) nextVisibleIds.delete(id);
    } else {
      for (const id of ids) nextVisibleIds.add(id);
    }

    onChange(normalizeFromVisibleIds(nextVisibleIds));
  }

  const visibleCount = $derived(getVisibleIds(value).size);
  const visibleQueryCount = $derived(queryItems.filter((op) => isQueryVisible(op.id)).length);
  const visibleTransformationCount = $derived(
    transformationItems.filter((op) => isTransformationVisible(op.id)).length
  );
  const graphQueryCount = $derived(queryItems.filter((op) => isGraphQueryDisplayed(op.id)).length);
  const graphTransformationCount = $derived(
    transformationItems.filter((op) => isGraphTransformationDisplayed(op.id)).length
  );
  const searchPlaceholder = $derived.by(() => {
    if (showGraphOperationDisplay) return 'Search languages, queries, or operations';
    if (showQueryColumnVisibility) return 'Search languages or queries';
    if (showTransformationColumnVisibility) return 'Search languages or transformations';
    return 'Search languages';
  });
  const summaryText = $derived.by(() => {
    if (showGraphOperationDisplay) {
      return `${visibleCount} languages visible, ${graphQueryCount} queries and ${graphTransformationCount} transforms displayed`;
    }
    if (showQueryColumnVisibility) {
      return `${visibleCount} languages, ${visibleQueryCount} queries visible`;
    }
    if (showTransformationColumnVisibility) {
      return `${visibleCount} languages, ${visibleTransformationCount} transforms visible`;
    }
    return `${visibleCount} of ${languages.length} languages visible`;
  });
</script>

<div class="picker-shell">
  <input
    type="search"
    bind:value={search}
    class="search-input"
    placeholder={searchPlaceholder}
    aria-label={searchPlaceholder}
  />

  <div class="picker-summary">
    <span>{summaryText}</span>
    <span class="summary-mode">{value.mode === 'all' ? 'all visible' : value.mode === 'only' ? 'only selected' : 'hide selected'}</span>
  </div>

  <div class="picker-list" role="list">
    {#if filteredLanguages.length > 0}
      <div class="section-header">
        <button
          type="button"
          class="section-toggle"
          aria-expanded={languagesOpen}
          onclick={() => (languagesExpanded = !languagesExpanded)}
        >
          <span class="section-chevron" aria-hidden="true">{languagesOpen ? 'v' : '>'}</span>
          <span class="section-label">Languages</span>
          <span class="section-count">{filteredLanguages.length}</span>
          <span class="sr-only">{sectionStateLabel(languagesOpen)} languages</span>
        </button>
        {#if languagesOpen}
          <div class="section-actions">
            <button type="button" class="toolbar-btn" onclick={() => toggleClassification('family')}>
              {getClassificationButtonLabel('family')}
            </button>
            <button type="button" class="toolbar-btn" onclick={() => toggleClassification('union')}>
              {getClassificationButtonLabel('union')}
            </button>
            <button type="button" class="toolbar-btn" onclick={setOnlyOriginalKcmVisible}>Only KCM</button>
            <button type="button" class="toolbar-btn" onclick={setAllVisible}>Show all</button>
            <button type="button" class="toolbar-btn" onclick={setNoneVisible}>Hide all</button>
            <button type="button" class="toolbar-btn subtle" onclick={resetPicker}>Reset</button>
          </div>
        {/if}
      </div>
      {#if languagesOpen}
        {#each filteredLanguages as language (language.id)}
          <label class="picker-item">
            <input
              type="checkbox"
              checked={isLanguageVisible(language.id)}
              onchange={() => toggleLanguage(language.id)}
            />
            <div class="item-copy">
              <MathText text={language.name} className="item-name" />
              <div class="item-meta">{language.fullName}</div>
            </div>
          </label>
        {/each}
      {/if}
    {/if}

    {#if showQueries && filteredQueries.length > 0}
      <div class="section-header">
        <button
          type="button"
          class="section-toggle"
          aria-expanded={queriesOpen}
          onclick={() => (queriesExpanded = !queriesExpanded)}
        >
          <span class="section-chevron" aria-hidden="true">{queriesOpen ? 'v' : '>'}</span>
          <span class="section-label">Queries</span>
          <span class="section-count">{filteredQueries.length}</span>
          <span class="sr-only">{sectionStateLabel(queriesOpen)} queries</span>
        </button>
        {#if queriesOpen}
          <div class="section-actions">
            {#if showGraphOperationDisplay}
              <button type="button" class="toolbar-btn" onclick={() => setGraphOperationsDisplayed('query', true)}>Show all</button>
              <button type="button" class="toolbar-btn" onclick={() => setGraphOperationsDisplayed('query', false)}>Clear</button>
            {:else}
              <button type="button" class="toolbar-btn" onclick={() => setMatrixOperationsVisible('query', true)}>Show all</button>
              <button type="button" class="toolbar-btn" onclick={() => setMatrixOperationsVisible('query', false)}>Hide all</button>
            {/if}
          </div>
        {/if}
      </div>
      {#if queriesOpen}
        {#each filteredQueries as op (op.id)}
          <label class="picker-item">
            <input
              type="checkbox"
              checked={showGraphOperationDisplay ? isGraphQueryDisplayed(op.id) : isQueryVisible(op.id)}
              onchange={() => showGraphOperationDisplay ? toggleGraphOperation('query', op.id) : toggleMatrixOperation('query', op.id)}
            />
            <div class="item-copy">
              <span class="item-name">{op.code}</span>
              <div class="item-meta">{showGraphOperationDisplay ? `Display ${op.label} on graph nodes` : op.label}</div>
            </div>
          </label>
        {/each}
      {/if}
    {/if}

    {#if showTransformations && filteredTransformations.length > 0}
      <div class="section-header">
        <button
          type="button"
          class="section-toggle"
          aria-expanded={transformationsOpen}
          onclick={() => (transformationsExpanded = !transformationsExpanded)}
        >
          <span class="section-chevron" aria-hidden="true">{transformationsOpen ? 'v' : '>'}</span>
          <span class="section-label">Transforms</span>
          <span class="section-count">{filteredTransformations.length}</span>
          <span class="sr-only">{sectionStateLabel(transformationsOpen)} transforms</span>
        </button>
        {#if transformationsOpen}
          <div class="section-actions">
            {#if showGraphOperationDisplay}
              <button type="button" class="toolbar-btn" onclick={() => setGraphOperationsDisplayed('transformation', true)}>Show all</button>
              <button type="button" class="toolbar-btn" onclick={() => setGraphOperationsDisplayed('transformation', false)}>Clear</button>
            {:else}
              <button type="button" class="toolbar-btn" onclick={() => setMatrixOperationsVisible('transformation', true)}>Show all</button>
              <button type="button" class="toolbar-btn" onclick={() => setMatrixOperationsVisible('transformation', false)}>Hide all</button>
            {/if}
          </div>
        {/if}
      </div>
      {#if transformationsOpen}
        {#each filteredTransformations as op (op.id)}
          <label class="picker-item">
            <input
              type="checkbox"
              checked={showGraphOperationDisplay ? isGraphTransformationDisplayed(op.id) : isTransformationVisible(op.id)}
              onchange={() => showGraphOperationDisplay ? toggleGraphOperation('transformation', op.id) : toggleMatrixOperation('transformation', op.id)}
            />
            <div class="item-copy">
              <span class="item-name">{op.code}</span>
              <div class="item-meta">{showGraphOperationDisplay ? `Display ${op.label} on graph nodes` : op.label}</div>
            </div>
          </label>
        {/each}
      {/if}
    {/if}

    {#if filteredLanguages.length === 0 && (!showQueries || filteredQueries.length === 0) && (!showTransformations || filteredTransformations.length === 0)}
      <div class="empty-state">No visibility items match this search.</div>
    {/if}
  </div>
</div>

<style>
  .picker-shell {
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
    height: 100%;
    min-height: 0;
  }

  .search-input {
    width: 100%;
    padding: 0.42rem 0.65rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.6rem;
    font-size: 0.82rem;
    background: #fff;
  }

  .toolbar-btn {
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 999px;
    padding: 0.24rem 0.52rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .toolbar-btn.subtle {
    color: #475569;
  }

  .picker-summary {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.72rem;
    color: #475569;
  }

  .summary-mode {
    text-transform: capitalize;
    white-space: nowrap;
  }

  .picker-list {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    flex: 1 1 auto;
    min-height: 24rem;
    overflow-y: auto;
    padding-right: 0.15rem;
  }

  .picker-item {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.45rem;
    align-items: center;
    padding: 0.32rem 0.52rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.6rem;
    background: #fff;
  }

  .section-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.32rem 0.15rem 0.24rem;
    background: #f8fafc;
  }

  .section-label {
    color: #334155;
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .section-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.34rem;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    padding: 0.12rem 0;
    cursor: pointer;
  }

  .section-toggle:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
    border-radius: 0.25rem;
  }

  .section-chevron {
    width: 0.75rem;
    color: #64748b;
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1;
    text-align: center;
  }

  .section-count {
    color: #64748b;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .section-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.25rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .picker-item input {
    margin: 0;
  }

  .item-copy {
    min-width: 0;
  }

  :global(.item-name) {
    font-weight: 600;
    color: #0f172a;
    font-size: 0.84rem;
  }

  .item-meta {
    margin-top: 0.05rem;
    font-size: 0.69rem;
    color: #64748b;
    line-height: 1.2;
  }

  .empty-state {
    padding: 0.55rem;
    border: 1px dashed #cbd5e1;
    border-radius: 0.75rem;
    color: #64748b;
    font-size: 0.74rem;
    text-align: center;
  }

  @media (max-width: 960px) {
    .section-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .section-actions {
      justify-content: flex-start;
    }
  }
</style>
