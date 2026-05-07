<script lang="ts">
  import LanguageVisibilityPicker from './LanguageVisibilityPicker.svelte';
  import MathText from './MathText.svelte';
  import {
    areFilterValuesEqual,
    getFilterDefault,
    getVisibleFiltersForView
  } from '$lib/filter-utils.js';
  import type {
    EdgeFilter,
    FilterParamValue,
    FilterStateMap,
    KCLanguage,
    LanguageFilter,
    LanguageVisibilityParam,
    ViewMode
  } from '$lib/types.js';

  type AnyFilter = LanguageFilter | EdgeFilter;

  let {
    filters = [],
    languages = [],
    filterStates,
    viewMode = 'graph' as ViewMode,
    onFilterChange,
    onReset
  }: {
    filters?: AnyFilter[];
    languages?: KCLanguage[];
    filterStates: FilterStateMap;
    viewMode?: ViewMode;
    onFilterChange: (filter: AnyFilter, value: FilterParamValue) => void;
    onReset: (viewMode: ViewMode) => void;
  } = $props();

  let isOpen = $state(false);
  const visibleFilters = $derived(getVisibleFiltersForView(filters, viewMode));
  const orderedFilters = $derived.by(() => {
    const priority: Record<string, number> = { 'poly-display': 0, 'language-visibility': 99 };
    return [...visibleFilters].sort((a, b) => {
      const pa = priority[a.id] ?? 1;
      const pb = priority[b.id] ?? 1;
      if (pa !== pb) return pa - pb;
      return visibleFilters.indexOf(a) - visibleFilters.indexOf(b);
    });
  });

  function getFilterValue(filter: AnyFilter): FilterParamValue {
    return filterStates.get(filter.id) ?? getFilterDefault(filter, viewMode);
  }

  function isFilterActive(filter: AnyFilter): boolean {
    return !areFilterValuesEqual(getFilterValue(filter), getFilterDefault(filter, viewMode));
  }

  const activeFilters = $derived(visibleFilters.filter((filter) => isFilterActive(filter)));

  function getSummary(): string {
    if (activeFilters.length === 0) {
      return 'Default view';
    }

    if (activeFilters.length === 1) {
      return '1 active filter';
    }

    return `${activeFilters.length} active filters`;
  }

  function setFilterValue(filter: AnyFilter, value: FilterParamValue) {
    onFilterChange(filter, value);
  }

  function getSelectValue(filter: AnyFilter): string {
    return String(getFilterValue(filter));
  }

  function getLanguageVisibilityValue(filter: AnyFilter): LanguageVisibilityParam {
    const value = getFilterValue(filter);
    if (typeof value === 'object' && value !== null && 'mode' in value && 'ids' in value) {
      return value as LanguageVisibilityParam;
    }

    return { mode: 'all', ids: [] };
  }

  function toggleBooleanFilter(filter: AnyFilter) {
    setFilterValue(filter, getFilterValue(filter) !== true);
  }
</script>

<div class="filter-shell">
  <button
    type="button"
    class="trigger-btn"
    aria-expanded={isOpen}
    aria-haspopup="dialog"
    onclick={() => (isOpen = !isOpen)}
  >
    <span class="trigger-label">Filters</span>
    <span class="trigger-summary">{getSummary()}</span>
  </button>

  {#if isOpen}
    <div class="drawer-backdrop" aria-hidden="true" onclick={() => (isOpen = false)}></div>
    <div class="drawer-panel" role="dialog" aria-label="Filters">
      <div class="drawer-header">
        <div>
          <div class="eyebrow">{viewMode}</div>
          <h2>Filters</h2>
        </div>
        <div class="header-actions">
          <button type="button" class="reset-btn" onclick={() => onReset(viewMode)}>Reset</button>
          <button type="button" class="close-btn" onclick={() => (isOpen = false)}>Close</button>
        </div>
      </div>

      <div class="drawer-body">
        {#each orderedFilters as filter (filter.id)}
          <div class="filter-row" class:filter-row--language-picker={filter.controlType === 'language-picker'}>
            {#if filter.controlType === 'language-picker'}
              <div class="filter-block">
                <div class="field-copy">
                  <MathText text={filter.name} className="filter-name" />
                </div>
                <LanguageVisibilityPicker
                  languages={languages}
                  value={getLanguageVisibilityValue(filter)}
                  {viewMode}
                  onChange={(value) => setFilterValue(filter, value)}
                />
              </div>
            {:else if filter.controlType === 'dropdown' && filter.options}
              <label class="filter-field">
                <div class="field-copy">
                  <MathText text={filter.name} className="filter-name" />
                </div>
                <select
                  class="field-select"
                  value={getSelectValue(filter)}
                  onchange={(event) => setFilterValue(filter, (event.target as HTMLSelectElement).value)}
                >
                  {#each filter.options as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <label class="toggle-field">
                <input
                  type="checkbox"
                  checked={getFilterValue(filter) === true}
                  onchange={() => toggleBooleanFilter(filter)}
                />
                <div class="field-copy">
                  <MathText text={filter.name} className="filter-name" />
                </div>
              </label>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .filter-shell {
    position: relative;
    z-index: 41;
  }

  .trigger-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    min-width: 11rem;
    max-width: 16rem;
    padding: 0.48rem 0.72rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.65rem;
    background: #fff;
    color: #0f172a;
    cursor: pointer;
  }

  .trigger-label {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475569;
  }

  .trigger-summary {
    font-size: 0.83rem;
    font-weight: 600;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.28);
    z-index: 39;
  }

  .drawer-panel {
    position: fixed;
    top: 0.5rem;
    right: 0.5rem;
    bottom: 0.5rem;
    width: min(38rem, calc(100vw - 1rem));
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 0.9rem;
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22);
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.7rem 0.8rem 0.62rem;
    border-bottom: 1px solid #dbe3ee;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  }

  .drawer-header h2 {
    margin: 0.05rem 0 0;
    font-size: 0.95rem;
    color: #0f172a;
  }

  .eyebrow {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #475569;
  }

  .header-actions {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
    flex-shrink: 0;
  }

  .reset-btn,
  .close-btn {
    border-radius: 0.65rem;
    padding: 0.36rem 0.65rem;
    font-weight: 600;
    font-size: 0.84rem;
    cursor: pointer;
  }

  .reset-btn {
    background: #fff1f2;
    border: 1px solid #fca5a5;
    color: #b91c1c;
  }

  .close-btn {
    background: #faf5eb;
    border: 1px solid #e7d7b8;
    color: #8a5a00;
  }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .filter-row {
    padding: 0.5rem 0.25rem;
    border-top: 1px solid #eef2f7;
  }

  .filter-row--language-picker {
    flex: 1 1 auto;
    min-height: min(42rem, calc(100vh - 8rem));
    display: flex;
    flex-direction: column;
  }

  .filter-row--language-picker .filter-block {
    flex: 1;
    min-height: 0;
  }

  .filter-row--language-picker :global(.picker-shell) {
    flex: 1;
    min-height: 0;
  }

  .filter-row:first-child {
    border-top: none;
  }

  .filter-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(11rem, 14rem);
    gap: 0.6rem;
    align-items: center;
  }

  .toggle-field {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem;
    align-items: center;
  }

  .toggle-field input {
    margin: 0;
  }

  .filter-block {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .field-copy {
    min-width: 0;
  }

  :global(.filter-name) {
    font-weight: 700;
    color: #0f172a;
    font-size: 0.88rem;
  }

  .field-select {
    width: 100%;
    min-width: 0;
    padding: 0.42rem 0.6rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.6rem;
    background: #fff;
    color: #0f172a;
    font-size: 0.84rem;
  }

  @media (max-width: 960px) {
    .drawer-panel {
      top: auto;
      right: 0.35rem;
      left: 0.35rem;
      bottom: 0.35rem;
      width: auto;
    }

    .drawer-header,
    .filter-field {
      display: flex;
      flex-direction: column;
    }

    .field-select {
      width: 100%;
    }
  }
</style>
