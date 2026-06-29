<script lang="ts">
  import type { KCReference } from '$lib/types.js';
  import { getGlobalRefNumber } from '$lib/data/references.js';

  let {
    references,
    anchorElement = $bindable<HTMLElement | null>(null)
  }: {
    references: KCReference[];
    anchorElement?: HTMLElement | null;
  } = $props();

  let copiedRefId: string | null = $state(null);

  async function copyBibtex(bibtex: string, refId: string) {
    try {
      await navigator.clipboard.writeText(bibtex);
      copiedRefId = refId;
      setTimeout(() => {
        copiedRefId = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy BibTeX:', err);
    }
  }
</script>

<div class="mt-4 pt-4 border-t border-gray-200" bind:this={anchorElement}>
  {#if references.length > 0}
    <h6 class="text-sm font-semibold text-gray-900 mb-2">
      References
      <a class="text-xs font-medium text-blue-600 hover:text-blue-800 underline" href="/bibliography">
        (full bibliography)
      </a>
    </h6>
    <ol class="space-y-2">
      {#each references as ref}
        <li class="text-xs text-gray-700">
          <div class="flex items-start gap-1.5">
            <span class="font-semibold text-gray-900" title={`Reference ${getGlobalRefNumber(ref.id) ?? '?'}`}>[bib]</span>
            <div class="flex-1 min-w-0">
              <a class="underline text-blue-600 hover:text-blue-800 break-words" href={ref.href} target="_blank" rel="noreferrer noopener">{ref.title}</a>
              <button
                class="font-medium cursor-pointer ml-2 transition-colors"
                class:text-green-600={copiedRefId !== ref.id}
                class:hover:text-green-800={copiedRefId !== ref.id}
                class:text-green-700={copiedRefId === ref.id}
                onclick={() => copyBibtex(ref.bibtex, ref.id)}
                title="Copy BibTeX citation"
              >
                {copiedRefId === ref.id ? '[✓ copied]' : '[copy bibtex]'}
              </button>
            </div>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>
