<script lang="ts">
  import MathText from './MathText.svelte';
  import type { FilteredGraphData, GraphData } from '$lib/types.js';
  import { formatAssumptionForMathText } from '$lib/utils/math-text.js';

  let {
    value = '',
    graphData,
    label = 'Assumption',
    onCommit
  }: {
    value?: string;
    graphData: GraphData | FilteredGraphData;
    label?: string;
    onCommit: (value: string) => void;
  } = $props();

  let open = $state(false);
  let search = $state(value ?? '');
  let modalOpen = $state(false);
  let newAssumption = $state('');
  let previewNewAssumption = $state(false);

  $effect(() => {
    if (!open) {
      search = value ?? '';
    }
  });

  const assumptions = $derived.by<string[]>(() => {
    const seen = new Set<string>();
    const add = (assumption?: string) => {
      const trimmed = assumption?.trim();
      if (trimmed) seen.add(trimmed);
    };

    for (const row of graphData.adjacencyMatrix.matrix) {
      for (const relation of row) {
        add(relation?.assumption);
      }
    }

    for (const language of graphData.languages) {
      for (const support of Object.values(language.properties.queries ?? {})) {
        add(support.assumption);
      }
      for (const support of Object.values(language.properties.transformations ?? {})) {
        add(support.assumption);
      }
    }

    for (const batch of graphData.batchClaims ?? []) {
      add(batch.assumption);
    }

    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  const filteredAssumptions = $derived.by<string[]>(() => {
    const needle = normalize(search);
    return assumptions
      .map((assumption) => ({ assumption, score: scoreAssumption(assumption, needle) }))
      .filter(({ score }) => score < Number.POSITIVE_INFINITY)
      .sort((a, b) => a.score - b.score || a.assumption.localeCompare(b.assumption))
      .slice(0, 8)
      .map(({ assumption }) => assumption);
  });

  function normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/\$/g, '')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreAssumption(assumption: string, needle: string) {
    if (!needle) return 0;
    const normalized = normalize(assumption);
    if (normalized === needle) return 0;
    if (normalized.startsWith(needle)) return 1;
    if (normalized.includes(needle)) return 2;
    return Number.POSITIVE_INFINITY;
  }

  function selectAssumption(assumption: string) {
    search = assumption;
    open = false;
    onCommit(assumption);
  }

  function clearAssumption() {
    search = '';
    open = false;
    onCommit('');
  }

  function addMathDelimiters() {
    const trimmed = newAssumption.trim();
    newAssumption = trimmed ? `$${trimmed.replace(/^\$|\$$/g, '')}$` : '$$';
  }

  function openAddModal() {
    newAssumption = search.trim();
    previewNewAssumption = false;
    modalOpen = true;
  }

  function closeAddModal() {
    modalOpen = false;
    previewNewAssumption = false;
  }

  function commitNewAssumption() {
    const trimmed = newAssumption.trim();
    if (!trimmed) return;
    search = trimmed;
    modalOpen = false;
    previewNewAssumption = false;
    open = false;
    onCommit(trimmed);
  }
</script>

<div class="assumption-picker">
  <label class="assumption-label" for="assumption-search">{label}</label>
  <button type="button" class="assumption-preview" onclick={() => open = true}>
    {#if value?.trim()}
      <MathText text={formatAssumptionForMathText(value)} className="inline" />
    {:else}
      <span>No assumption</span>
    {/if}
  </button>

  {#if open}
    <div class="assumption-popover">
      <input
        id="assumption-search"
        class="assumption-input"
        bind:value={search}
        placeholder="Search assumptions"
        onfocus={() => open = true}
      />
      <div class="assumption-results">
        <button type="button" class="assumption-row" onmousedown={(event) => event.preventDefault()} onclick={clearAssumption}>
          <span>No assumption</span>
        </button>
        {#each filteredAssumptions as assumption}
          <button type="button" class="assumption-row" onmousedown={(event) => event.preventDefault()} onclick={() => selectAssumption(assumption)}>
            <MathText text={formatAssumptionForMathText(assumption)} className="inline" />
          </button>
        {/each}
        <button type="button" class="assumption-row add-row" onmousedown={(event) => event.preventDefault()} onclick={openAddModal}>
          Add new assumption
        </button>
      </div>
    </div>
  {/if}
</div>

{#if modalOpen}
  <div class="assumption-modal-backdrop" role="presentation" onclick={closeAddModal}>
    <div
      class="assumption-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-assumption-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <header>
        <h4 id="new-assumption-title">New Assumption</h4>
      </header>
      <div class="modal-toolbar">
        <button type="button" onclick={addMathDelimiters}>$</button>
        <button type="button" onclick={() => previewNewAssumption = true}>Preview</button>
      </div>
      {#if previewNewAssumption}
        <button type="button" class="assumption-rendered" onclick={() => previewNewAssumption = false}>
          {#if newAssumption.trim()}
            <MathText text={formatAssumptionForMathText(newAssumption)} className="inline" />
          {:else}
            <span>Click to edit.</span>
          {/if}
        </button>
      {:else}
        <textarea
          class="assumption-textarea"
          bind:value={newAssumption}
          placeholder="P \\neq NP"
          rows="5"
        ></textarea>
      {/if}
      <footer>
        <button type="button" class="secondary" onclick={closeAddModal}>Cancel</button>
        <button type="button" class="primary" onclick={commitNewAssumption}>Add Assumption</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .assumption-picker {
    position: relative;
    display: grid;
    gap: 0.25rem;
    margin-top: 0.45rem;
  }

  .assumption-label {
    color: #334155;
    font-size: 0.72rem;
    font-weight: 750;
  }

  .assumption-preview {
    width: 100%;
    border: 1px solid #cbd5e1;
    border-radius: 0.35rem;
    background: #fff;
    padding: 0.4rem 0.5rem;
    color: #0f172a;
    text-align: left;
    cursor: pointer;
  }

  .assumption-preview span {
    color: #64748b;
  }

  .assumption-popover {
    position: absolute;
    z-index: 30;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    display: grid;
    gap: 0.3rem;
    border: 1px solid #bfdbfe;
    border-radius: 0.4rem;
    background: white;
    padding: 0.35rem;
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
  }

  .assumption-input,
  .assumption-textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    padding: 0.4rem 0.45rem;
    color: #0f172a;
    font-size: 0.8rem;
  }

  .assumption-results {
    display: grid;
    gap: 0.18rem;
    max-height: 10rem;
    overflow: auto;
  }

  .assumption-row {
    width: 100%;
    border: 1px solid #e2e8f0;
    border-radius: 0.3rem;
    background: #f8fafc;
    padding: 0.28rem 0.38rem;
    color: #0f172a;
    text-align: left;
    cursor: pointer;
    font-size: 0.76rem;
    line-height: 1.2;
  }

  .assumption-row:hover {
    border-color: #93c5fd;
    background: #eff6ff;
  }

  .add-row {
    position: sticky;
    bottom: 0;
    border-color: #2563eb;
    color: #1d4ed8;
    font-weight: 750;
  }

  .assumption-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(15, 23, 42, 0.45);
  }

  .assumption-modal {
    width: min(28rem, 100%);
    display: grid;
    gap: 0.65rem;
    border: 1px solid #bfdbfe;
    border-radius: 0.5rem;
    background: #fff;
    padding: 1rem;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  }

  .assumption-modal h4 {
    margin: 0;
    color: #1e3a8a;
    font-size: 0.95rem;
    font-weight: 800;
  }

  .modal-toolbar,
  .assumption-modal footer {
    display: flex;
    gap: 0.4rem;
  }

  .modal-toolbar button,
  .assumption-modal footer button {
    border: 1px solid #cbd5e1;
    border-radius: 0.3rem;
    background: white;
    padding: 0.35rem 0.55rem;
    color: #0f172a;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }

  .assumption-modal footer {
    justify-content: flex-end;
  }

  .assumption-modal footer .primary {
    border-color: #2563eb;
    background: #2563eb;
    color: #fff;
  }

  .assumption-rendered {
    min-height: 5rem;
    border: 1px solid #cbd5e1;
    border-radius: 0.35rem;
    background: #fff;
    padding: 0.55rem;
    text-align: left;
  }
</style>
