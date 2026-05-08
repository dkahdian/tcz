<script lang="ts">
  import { onMount } from 'svelte';
  import cytoscape from 'cytoscape';
  import type { GraphData, FilteredGraphData, SelectedEdge, KCLanguage, ViewMode } from '../types.js';
  import { QUERIES, TRANSFORMATIONS, resolveLanguageProperties } from '../data/operations.js';
  import MathText from './MathText.svelte';
  import {
    getOperationTractabilityDisplay,
    getOrderedOperationTractabilityDisplays,
    type OperationTractabilityId
  } from '$lib/utils/operation-tractability.js';

  let {
    graphData,
    selectedNode = null,
    selectedEdge = null,
    viewMode = 'graph' as ViewMode
  }: {
    graphData: GraphData | FilteredGraphData;
    selectedNode?: KCLanguage | null;
    selectedEdge?: SelectedEdge | null;
    viewMode?: ViewMode;
  } = $props();
  
  // Ensure we have a FilteredGraphData type by adding missing properties if needed
  const filteredData = $derived.by(() => {
    if ('visibleLanguageIds' in graphData) {
      return graphData as FilteredGraphData;
    }
    // Convert GraphData to FilteredGraphData by adding all nodes/edges as visible
    const allLanguageIds = new Set(graphData.languages.map(l => l.id));
    const allEdgeIds = new Set<string>();
    const { matrix, languageIds } = graphData.adjacencyMatrix;
    for (let i = 0; i < languageIds.length; i++) {
      for (let j = 0; j < languageIds.length; j++) {
        if (matrix[i][j]) {
          allEdgeIds.add(`${languageIds[i]}->${languageIds[j]}`);
        }
      }
    }
    return {
      ...graphData,
      visibleLanguageIds: allLanguageIds,
      visibleEdgeIds: allEdgeIds,
      visibleQueryIds: new Set(Object.keys(QUERIES)),
      visibleTransformationIds: new Set(Object.keys(TRANSFORMATIONS))
    } as FilteredGraphData;
  });

  type EdgeType = {
    arrow: string;
    filled: boolean;
    description: string;
    status: string;
  };
  
  const allEdgeTypes: EdgeType[] = [
    {
      arrow: 'triangle',
      filled: true,
      description: 'polynomial time.',
      status: 'poly'
    },
    {
      arrow: 'square',
      filled: true,
      description: 'exponential time.',
      status: 'no-quasi'
    },
    {
      arrow: 'tee',
      filled: true,
      description: 'quasipolynomial time.',
      status: 'no-poly-quasi'
    },
    {
      arrow: 'square',
      filled: true,
      description: 'not polynomial time.',
      status: 'not-poly'
    },
    {
      arrow: 'tee',
      filled: false,
      description: 'quasi (?). Not poly.',
      status: 'no-poly-unknown-quasi'
    },
    {
      arrow: 'triangle-cross',
      filled: false,
      description: 'quasi. Poly (?).',
      status: 'unknown-poly-quasi'
    },
    {
      arrow: 'square',
      filled: false,
      description: 'unknown.',
      status: 'unknown-both'
    },
    {
      arrow: 'square',
      filled: false,
      description: 'unknown.',
      status: 'unknown'
    }
  ];

  // Determine which edge types are actually visible
  const visibleEdgeTypes = $derived.by(() => {
    const statusesInGraph = new Set<string>();
    
    // Collect statuses from adjacency matrix (only for visible edges)
    const { matrix, languageIds } = filteredData.adjacencyMatrix;
    for (let i = 0; i < languageIds.length; i++) {
      for (let j = 0; j < languageIds.length; j++) {
        const relation = matrix[i][j];
        if (relation) {
          // Check if this edge is actually visible (respects edge filters)
          const edgeId = `${languageIds[i]}->${languageIds[j]}`;
          if (filteredData.visibleEdgeIds.has(edgeId)) {
            statusesInGraph.add(relation.status);
          }
        }
      }
    }
    
    // Return only edge types that appear in the visible graph
    return allEdgeTypes.filter(et => statusesInGraph.has(et.status));
  });

  const hasVisibleConditionalSuccinctness = $derived.by(() => {
    const { matrix, languageIds } = filteredData.adjacencyMatrix;
    for (let i = 0; i < languageIds.length; i++) {
      for (let j = 0; j < languageIds.length; j++) {
        const relation = matrix[i][j];
        if (!relation?.assumption) continue;
        const edgeId = `${languageIds[i]}->${languageIds[j]}`;
        if (filteredData.visibleEdgeIds.has(edgeId)) return true;
      }
    }
    return false;
  });

  // Determine which operation tractability symbols are visible on graph nodes
  // Only show when operation filters are active (nodes have labelSuffix)
  const visibleOperationDisplays = $derived.by(() => {
    // In succinctness view, never show operation complexities on the legend
    if (viewMode === 'succinctness') return [];
    
    // In queries/transforms view, show all tractability categories that appear in studied cells.
    // Blank cells are intentionally excluded: they mean "not studied yet", not unknown.
    if (viewMode === 'queries' || viewMode === 'transforms') {
      const idsInUse = new Set<OperationTractabilityId>();
      const isQueries = viewMode === 'queries';
      const visibleOperationIds = isQueries
        ? filteredData.visibleQueryIds
        : filteredData.visibleTransformationIds;
      
      for (const lang of filteredData.languages) {
        const supportMap = isQueries 
          ? lang.properties.queries 
          : lang.properties.transformations;
        if (!supportMap) continue;
        
        for (const [opId, support] of Object.entries(supportMap)) {
          if (!visibleOperationIds.has(opId)) continue;
          idsInUse.add(getOperationTractabilityDisplay(support, isQueries ? 'query' : 'transformation').id);
        }
      }
      
      return getOrderedOperationTractabilityDisplays(idsInUse).map((display) =>
        display.id === 'intractable'
          ? getOperationTractabilityDisplay(
              { complexity: 'not-poly' },
              isQueries ? 'query' : 'transformation'
            )
          : display
      );
    }
    
    // Graph view: only show when operation filters are active
    const idsInUse = new Set<OperationTractabilityId>();
    
    // Only collect from nodes that have visual labelSuffix (meaning an operation filter is active)
    for (const lang of filteredData.languages) {
      if (!lang.visual?.labelSuffix) continue;
      
      // Parse the labelSuffix to find which operations are being displayed.
      // The format is "\n{symbol} {opCode}" for each operation.
      const suffix = lang.visual.labelSuffix;
      
      // Resolve properties so we can recover the displayed operation entry.
      // Missing operations should not have a suffix, so they do not appear here.
      const resolved = resolveLanguageProperties(
        lang.properties.queries,
        lang.properties.transformations
      );
      
      // Check queries
      for (const op of resolved.queries) {
        if (suffix.includes(op.code)) {
          idsInUse.add(getOperationTractabilityDisplay(op, 'query').id);
        }
      }
      // Check transformations
      for (const op of resolved.transformations) {
        if (suffix.includes(op.code)) {
          idsInUse.add(getOperationTractabilityDisplay(op, 'transformation').id);
        }
      }
    }
    
    return getOrderedOperationTractabilityDisplays(idsInUse);
  });

  const operationLegendTitle = $derived.by(() => {
    if (viewMode === 'queries') return 'Queries';
    if (viewMode === 'transforms') return 'Transformations';
    return 'Queries/Transformations';
  });

  let containerRefs = $state<{ [status: string]: HTMLDivElement | null }>({});

  onMount(() => {
    setTimeout(() => {
      renderAllGraphs();
    }, 100);
  });

  function renderAllGraphs() {
    visibleEdgeTypes.forEach((edge) => {
      const container = containerRefs[edge.status];
      if (!container) {
        return;
      }

      // Clear existing instance
      container.innerHTML = '';

      const cy = cytoscape({
        container,
        elements: [
          { data: { id: 'a', label: 'A' }, position: { x: 20, y: 15 } },
          { data: { id: 'b', label: 'B' }, position: { x: 80, y: 15 } },
          { data: { id: 'edge', source: 'a', target: 'b' } }
        ],
        style: [
          {
            selector: 'node',
            style: {
              'width': 22,
              'height': 22,
              'background-color': '#ffffff',
              'border-width': 2,
              'border-color': '#6b7280',
              'label': 'data(label)',
              'color': '#1f2937',
              'font-size': '11px',
              'font-weight': 'bold',
              'text-valign': 'center',
              'text-halign': 'center'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#6b7280',
              'target-arrow-shape': edge.arrow as any,
              'target-arrow-color': '#6b7280',
              'target-arrow-fill': edge.filled ? 'filled' : 'hollow',
              'curve-style': 'straight'
            }
          }
        ],
        layout: {
          name: 'preset'
        } as any,
        userZoomingEnabled: false,
        userPanningEnabled: false,
        boxSelectionEnabled: false,
        autoungrabify: true,
        autounselectify: true,
        minZoom: 1,
        maxZoom: 1
      });

      cy.center();
    });
  }

  // Re-render when visible edge types change
  $effect(() => {
    // Access visibleEdgeTypes to create dependency
    const types = visibleEdgeTypes;
    if (Object.keys(containerRefs).length > 0 && viewMode === 'graph') {
      setTimeout(() => {
        renderAllGraphs();
      }, 50);
    }
  });
</script>

<div class="legends-container">
  {#if visibleEdgeTypes.length > 0 && (viewMode === 'graph' || viewMode === 'succinctness')}
    <div class="legend">
      <h3 class="text-lg font-semibold text-gray-700 mb-2">Succinctness</h3>
      
      {#if viewMode === 'graph'}
        <!-- Graph view: show arrowhead examples -->
        <p class="text-gray-600 text-sm mb-4">
          A compiles to B in _______
        </p>
        <div class="legend-items">
          {#each visibleEdgeTypes as edge (edge.status)}
            <div class="legend-row">
              <div class="edge-example">
                <div class="cyto-container" bind:this={containerRefs[edge.status]}></div>
              </div>
              <p class="description">{edge.description}</p>
            </div>
          {/each}
        </div>
      {:else}
        <!-- Matrix view: show LaTeX notation with descriptions -->
        <p class="text-gray-600 text-sm mb-4">
          For (Row A, Col B), A ___ B implies ________ from language B to A:
        </p>
        <div class="legend-items matrix-legend">
          {#each visibleEdgeTypes as edge (edge.status)}
            {@const complexity = filteredData.complexities[edge.status]}
            {#if complexity}
              <div class="legend-row matrix-row">
                <span class="matrix-notation" style="color: {complexity.color}">
                  <MathText text={complexity.notation} className="inline" />
                </span>
                <span class="matrix-description">{complexity.description}</span>
              </div>
            {/if}
          {/each}
          {#if hasVisibleConditionalSuccinctness}
            <div class="legend-row matrix-row assumption-row">
              <span class="matrix-notation assumption-marker">*</span>
              <span class="matrix-description">conditional result (assuming the listed condition)</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  
  {#if visibleOperationDisplays.length > 0}
    <div class="legend-section">
      <h5>{operationLegendTitle}</h5>
      {#each visibleOperationDisplays as display}
        <div class="legend-row">
          <span class={`operation-symbol ${display.cssClass}`}>{display.symbol}</span>
          <span title={display.description}>{display.label}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .legends-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .legend {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
  }

  h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
  }

  .legend-items {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .edge-example {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 100px;
  }

  .cyto-container {
    width: 100px;
    height: 35px;
    flex-shrink: 0;
  }

  .description {
    flex: 1;
    margin: 0;
    font-size: 0.875rem;
    color: #4b5563;
    line-height: 1.5;
  }

  .legend-section {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 1.25rem;
  }

  .legend-section h5 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
  }

  .legend-section .legend-row {
    padding: 0.25rem 0;
    font-size: 0.875rem;
    color: #4b5563;
  }

  .operation-symbol {
    display: inline-grid;
    width: 1.65rem;
    height: 1.35rem;
    place-items: center;
    border-radius: 0.2rem;
    text-align: center;
    font-family: KaTeX_Main, "Times New Roman", serif;
    font-size: 1rem;
    font-weight: 700;
  }

  /* Matrix view legend styles */
  .matrix-legend {
    gap: 0.5rem;
  }

  .matrix-row {
    gap: 0.75rem;
  }

  .matrix-notation {
    display: inline-block;
    min-width: 6rem;
    text-align: left;
    font-size: 0.875rem;
  }

  .matrix-description {
    font-size: 0.875rem;
    color: #4b5563;
  }

  .assumption-row {
    margin-top: 0.25rem;
  }

  .assumption-marker {
    font-weight: 700;
    color: #1f2937;
  }
</style>
