<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import cytoscape from 'cytoscape';
  // @ts-ignore - dagre doesn't have proper TypeScript types
  import dagre from 'cytoscape-dagre';
  // @ts-ignore - plugin has no types
  import nodeEdgeHtmlLabel from 'cytoscape-node-edge-html-label';
  import type {
      GraphData,
      FilteredGraphData,
      KCLanguage,
      NodePosition,
      SelectedEdge
    } from '$lib/types.js';
  import { getEdgeEndpointStyle } from '$lib/data/complexities.js';
  import { renderMathText, escapeHtml } from '$lib/utils/math-text.js';
  import { normalizeEdgePairs, buildSameLayerGroups, type EdgePair } from '$lib/utils/graph-layout.js';

  const NODE_POSITIONS_STORAGE_KEY = 'kcm_graph_positions';

  let pluginsRegistered = false;

  function ensureCytoscapePluginsRegistered() {
    if (pluginsRegistered) return;
    cytoscape.use(dagre);
    nodeEdgeHtmlLabel(cytoscape as any);
    pluginsRegistered = true;
  }

  type StoredNodePositions = Record<string, NodePosition>;

  function loadStoredNodePositions(): StoredNodePositions {
    if (!browser) return {};
    try {
      const raw = localStorage.getItem(NODE_POSITIONS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const result: StoredNodePositions = {};
      for (const [key, value] of Object.entries(parsed as Record<string, any>)) {
        if (!value || typeof value !== 'object') continue;
        const x = typeof (value as any).x === 'number' ? (value as any).x : null;
        const y = typeof (value as any).y === 'number' ? (value as any).y : null;
        if (x === null || y === null) continue;
        result[key] = { x, y };
      }
      return result;
    } catch (error) {
      console.warn('Failed to load stored node positions', error);
      return {};
    }
  }

  function persistNodePositions(nodes: cytoscape.NodeCollection) {
    if (!browser) return;
    try {
      const existing = loadStoredNodePositions();
      nodes.forEach((node) => {
        const pos = node.position();
        existing[node.id()] = { x: pos.x, y: pos.y };
      });
      localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(existing));
    } catch (error) {
      console.warn('Failed to persist node positions', error);
    }
  }

  function persistPositionMap(positions: Map<string, NodePosition>) {
    if (!browser) return;
    try {
      const existing = loadStoredNodePositions();
      for (const [nodeId, pos] of positions) {
        existing[nodeId] = { x: pos.x, y: pos.y };
      }
      localStorage.setItem(NODE_POSITIONS_STORAGE_KEY, JSON.stringify(existing));
    } catch (error) {
      console.warn('Failed to persist node positions', error);
    }
  }

  function getRenderableContent(value: string | null | undefined) {
    const normalized = value ?? '';
    const result = renderMathText(normalized);
    return {
      html: result.html,
      text: normalized
    };
  }

  function buildLabelContainer(
    innerHtml: string,
    classNames: string[] = [],
    markEmpty = false
  ) {
    const trimmed = innerHtml?.trim() ?? '';
    const effectiveHtml = trimmed ? innerHtml : '&nbsp;';
    const classes = classNames.filter(Boolean);
    if (!trimmed && markEmpty) {
      classes.push('edge-label-wrapper--empty');
    }
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<div${classAttr}>${effectiveHtml}</div>`;
  }

  let { graphData, selectedNode = $bindable(), selectedEdge = $bindable() }: {
    graphData: GraphData | FilteredGraphData;
    selectedNode: KCLanguage | null;
    selectedEdge: SelectedEdge | null;
  } = $props();

  let graphContainer: HTMLDivElement;
  let cy: cytoscape.Core;
  let defaultPositions = new Map<string, NodePosition>();
  let autoLayoutPositions = new Map<string, NodePosition>();

  const BASE_NODE_STYLE = {
    'border-color': '#d1d5db',
    'border-width': 2,
    'background-color': '#ffffff'
  } as const;

  /** Reset all node styles to the base state, optionally excluding one node. */
  function resetNodeStyles(excludeId?: string) {
    cy.nodes().forEach(n => {
      if (!excludeId || n.id() !== excludeId) {
        n.style(BASE_NODE_STYLE);
      }
    });
  }

  function resetGraphPositions() {
    if (!browser) return;
    localStorage.removeItem(NODE_POSITIONS_STORAGE_KEY);
    
    // Recreate the graph with default positions
    if (cy) {
      cy.destroy();
      createGraph();
    }
  }

  function applyAutoLayout() {
    if (!cy || autoLayoutPositions.size === 0) return;

    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const position = autoLayoutPositions.get(node.id());
        if (!position) return;
        node.position({ x: position.x, y: position.y });
      });
    });

    persistPositionMap(autoLayoutPositions);
    cy.fit(cy.elements(), 40);
  }

  // Function to create/update graph
  function createGraph() {
    if (!graphContainer) return;

    // Filter languages if this is filtered graph data
    const isFilteredData = 'visibleLanguageIds' in graphData;
    const visibleLanguageIds = isFilteredData ? graphData.visibleLanguageIds : null;
    
    const visibleLanguages = graphData.languages
      .filter(lang => !isFilteredData || visibleLanguageIds!.has(lang.id));
    const configuredDefaultPositions = graphData.defaultNodePositionsByLanguageName ?? {};

    const storedPositions = loadStoredNodePositions();
    
    // Clear default positions map for this rebuild
    defaultPositions.clear();
    autoLayoutPositions.clear();

    const BASE_NODE_WIDTH = 80;
    const BASE_NODE_HEIGHT = 80;
    const GROUP_MEMBER_SPACING = 200; // Horizontal spacing between nodes in same group
    const MIN_LAYER_GAP = 80; // Minimum gap between group footprints on same layer
    const LAYER_KEY_INTERVAL = 10; // Bucketing tolerance for layer alignment

    const edgePairs = normalizeEdgePairs(graphData.adjacencyMatrix);
    const nodeToGroup = buildSameLayerGroups(edgePairs, visibleLanguages);
    
    // Get unique groups and their members
    const groupToMembers = new Map<string, string[]>();
    for (const lang of visibleLanguages) {
      const group = nodeToGroup.get(lang.id)!;
      if (!groupToMembers.has(group)) {
        groupToMembers.set(group, []);
      }
      groupToMembers.get(group)!.push(lang.id);
    }
    
    const groups = Array.from(groupToMembers.keys());
    
    // Create representative nodes for dagre layout (one per group)
    const representativeElements: cytoscape.ElementDefinition[] = groups.map(groupId => {
      const members = groupToMembers.get(groupId)!;
      const firstMember = visibleLanguages.find(l => l.id === members[0])!;
      
      return {
        data: {
          id: `__group_${groupId}`,
          label: members.length > 1 ? `[${members.join(',')}]` : firstMember.name,
          isGroupRep: true,
          groupMembers: members
        }
      };
    });
    
    // Create edges between group representatives (skip bidirectional poly edges)
    const representativeEdges: cytoscape.ElementDefinition[] = [];
    const addedEdges = new Set<string>();
    
    for (const edge of edgePairs) {
      const aVisible = !isFilteredData || visibleLanguageIds!.has(edge.nodeA);
      const bVisible = !isFilteredData || visibleLanguageIds!.has(edge.nodeB);
      
      if (!aVisible || !bVisible) continue;
      
      const groupA = nodeToGroup.get(edge.nodeA)!;
      const groupB = nodeToGroup.get(edge.nodeB)!;
      
      // Skip if same group (these are bidirectional poly edges)
      if (groupA === groupB) continue;
      
      const edgeKey = `${groupA}-${groupB}`;
      if (addedEdges.has(edgeKey)) continue;
      addedEdges.add(edgeKey);
      
      // Only add edge if there's a poly constraint (for layout purposes)
      const aToBPoly = edge.aToB === 'poly';
      const bToAPoly = edge.bToA === 'poly';
      
      if (aToBPoly || bToAPoly) {
        // Determine direction: poly edges point upward (from lower to higher rank)
        const source = aToBPoly ? `__group_${groupA}` : `__group_${groupB}`;
        const target = aToBPoly ? `__group_${groupB}` : `__group_${groupA}`;
        
        representativeEdges.push({
          data: {
            id: `__edge_${edgeKey}`,
            source,
            target
          }
        });
      }
    }
    
    // Run dagre layout on representative nodes
    const tempCy = cytoscape({
      headless: true,
      elements: [...representativeElements, ...representativeEdges],
      layout: {
        name: 'dagre',
        rankDir: 'BT',
        nodeSep: 180,
        rankSep: 220,
        ranker: 'network-simplex'
      } as any
    });

    const groupDimensions = new Map<string, { width: number; height: number }>();
    // Inform dagre about node dimensions based on group size so it can reserve space
    tempCy.nodes().forEach((node: any) => {
      const members: string[] = node.data('groupMembers') || [];
      const memberCount = members.length || 1;
      const width = BASE_NODE_WIDTH + (memberCount - 1) * GROUP_MEMBER_SPACING;
      node.style({
        width,
        height: BASE_NODE_HEIGHT
      });
      const groupId = node.id().replace('__group_', '');
      groupDimensions.set(groupId, { width, height: BASE_NODE_HEIGHT });
    });
    
    const layout = tempCy.layout({
      name: 'dagre',
      rankDir: 'BT',
      nodeSep: 180,
      rankSep: 220,
      ranker: 'network-simplex'
    } as any);
    
    layout.run();
    
    // Extract positions from representative nodes
    const groupPositions = new Map<string, { x: number, y: number }>();
    tempCy.nodes().forEach((node: any) => {
      const groupId = node.id().replace('__group_', '');
      groupPositions.set(groupId, node.position());
    });

    // Ensure group footprints on the same layer do not overlap
    const layerBuckets = new Map<number, Array<{ groupId: string; x: number; y: number; width: number }>>();
    for (const [groupId, pos] of groupPositions) {
      const width = groupDimensions.get(groupId)?.width ?? BASE_NODE_WIDTH;
      const layerKey = Math.round(pos.y / LAYER_KEY_INTERVAL) * LAYER_KEY_INTERVAL;
      if (!layerBuckets.has(layerKey)) {
        layerBuckets.set(layerKey, []);
      }
      layerBuckets.get(layerKey)!.push({ groupId, x: pos.x, y: pos.y, width });
    }

    for (const bucket of layerBuckets.values()) {
      bucket.sort((a, b) => a.x - b.x);
      let currentRightEdge = -Infinity;
      for (const group of bucket) {
        const halfWidth = group.width / 2;
        let leftEdge = group.x - halfWidth;
        if (leftEdge <= currentRightEdge) {
          const shift = currentRightEdge + MIN_LAYER_GAP - leftEdge;
          group.x += shift;
          leftEdge += shift;
        }
        currentRightEdge = group.x + halfWidth;
      }
      for (const group of bucket) {
        groupPositions.set(group.groupId, { x: group.x, y: group.y });
      }
    }
    
    // Now create the actual graph elements with proper positions
    // For groups with multiple members, spread them horizontally at the same Y
    const elements: cytoscape.ElementDefinition[] = [];
    
    for (const [groupId, members] of groupToMembers) {
      const centerPos = groupPositions.get(groupId) || { x: 0, y: 0 };
      const spacing = GROUP_MEMBER_SPACING;
      const startX = centerPos.x - (members.length - 1) * spacing / 2;
      
      members.forEach((nodeId, idx) => {
        const lang = visibleLanguages.find(l => l.id === nodeId)!;
        const computedDefaultPosition = {
          x: startX + idx * spacing,
          y: centerPos.y
        };
        const configuredDefaultPosition = configuredDefaultPositions[lang.name];
        const defaultPosition = configuredDefaultPosition
          ? { x: configuredDefaultPosition.x, y: configuredDefaultPosition.y }
          : { ...computedDefaultPosition };

        // Store default position (clone to prevent later mutation)
        defaultPositions.set(lang.id, { ...defaultPosition });
        autoLayoutPositions.set(lang.id, { ...computedDefaultPosition });

        const storedPosition = storedPositions[lang.id];
        const initialPosition = storedPosition
          ? { x: storedPosition.x, y: storedPosition.y }
          : { ...defaultPosition };

        const labelPrefix = lang.visual?.labelPrefix || '';
        const labelSuffix = lang.visual?.labelSuffix || '';
        const nodeLabel = `${labelPrefix}${lang.name}${labelSuffix}`;
        const labelContent = getRenderableContent(nodeLabel);
        elements.push({
          data: {
            id: lang.id,
            label: nodeLabel,
            labelHtml: labelContent.html,
            labelText: labelContent.text,
            fullName: lang.fullName,
            definition: lang.definition,
            properties: lang.properties,
            bgColor: lang.visual?.backgroundColor,
            borderColor: lang.visual?.borderColor,
            borderWidth: lang.visual?.borderWidth,
            labelPrefix: labelPrefix,
            labelSuffix: labelSuffix
          },
          position: initialPosition
        });
      });
    }

    // Add all edges with proper styling
  for (const edge of edgePairs) {
      const aVisible = !isFilteredData || visibleLanguageIds!.has(edge.nodeA);
      const bVisible = !isFilteredData || visibleLanguageIds!.has(edge.nodeB);
      
      if (aVisible && bVisible) {
        const aToBStyle = getEdgeEndpointStyle(edge.aToB);
        const bToAStyle = getEdgeEndpointStyle(edge.bToA);
        
        elements.push({
          data: {
            id: edge.id,
            source: edge.nodeA,
            target: edge.nodeB,
            aToBStatus: edge.aToB,
            bToAStatus: edge.bToA,
            description: edge.description || '',
            refs: edge.refs,
            width: 2,
            sourceArrow: bToAStyle.arrow,
            sourceDashed: bToAStyle.dashed,
            targetArrow: aToBStyle.arrow,
            targetDashed: aToBStyle.dashed
          }
        });
      }
    }

    const baseStyles: any[] = [
      {
        selector: 'node',
        style: {
          'background-color': (ele: any) => ele.data('bgColor') || '#ffffff',
          'border-color': (ele: any) => ele.data('borderColor') || '#d1d5db',
          'border-width': (ele: any) => ele.data('borderWidth') || 2,
          color: '#1f2937',
          label: '',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': '14px',
          'font-weight': 'bold',
          width: '80px',
          height: '80px',
          shape: 'ellipse',
          'text-wrap': 'wrap',
          'text-max-width': '70px'
        }
      },

      {
        selector: 'node:selected',
        style: {
          'border-color': '#3b82f6',
          'border-width': 4,
          'background-color': '#eff6ff'
        }
      },
      {
        selector: 'edge',
        style: {
          width: (ele: any) => ele.data('width') || 2,
          'line-color': '#6b7280', // Default gray color for all edges
          'line-style': 'solid', // All edges are solid lines per spec
          'target-arrow-color': '#6b7280',
          'target-arrow-shape': (ele: any) => ele.data('targetArrow') || 'none',
          'target-arrow-fill': (ele: any) => {
            // Hollow = dashed arrowhead substitute
            const dashed = ele.data('targetDashed');
            return dashed ? 'hollow' : 'filled';
          },
          'source-arrow-color': '#6b7280',
          'source-arrow-shape': (ele: any) => ele.data('sourceArrow') || 'none',
          'source-arrow-fill': (ele: any) => {
            // Hollow = dashed arrowhead substitute
            const dashed = ele.data('sourceDashed');
            return dashed ? 'hollow' : 'filled';
          },
          'curve-style': 'bezier',
          label: '',
          color: '#374151'
        }
      },
      {
        selector: 'edge.edge-hovered',
        style: {
          'line-color': '#3b82f6',
          'target-arrow-color': '#3b82f6',
          'source-arrow-color': '#3b82f6',
          width: 3
        }
      }
    ];

  // Arrow shapes:
  // 1. Solid direct arrowhead: filled triangle
  // 2. Dashed straight line perpendicular: hollow tee
  // 3. Solid straight line: filled tee
  // 4. Solid straight line and dashed arrowhead: hollow triangle-cross
  // 5. Only dashed arrowhead: hollow triangle-tee
  // 6. Double solid line ||: filled square

    cy = cytoscape({
      container: graphContainer,
      elements,
      style: baseStyles,
      layout: {
        name: 'preset', // Use preset layout since we already have positions
        fit: true,
        padding: 40
      } as any,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      selectionType: 'single'
    });

    const htmlLabelOptions = [
      {
        query: 'node',
        valign: 'center',
        halign: 'center',
        halignBox: 'center',
        valignBox: 'center',
        cssClass: 'cy-node-html-label',
        tpl: (data: any) => {
          const rawHtml = data.labelHtml ?? escapeHtml(data.labelText ?? '');
          return buildLabelContainer(rawHtml);
        }
      },
      {
        query: 'edge',
        cssClass: 'cy-edge-html-label',
        tpl: (data: any) => buildEdgeLabelTemplate(data)
      },
      {
        query: 'edge.edge-hovered',
        cssClass: 'cy-edge-html-label',
        tpl: (data: any) => buildEdgeLabelTemplate(data)

      }
    ];

    // @ts-ignore - provided by plugin
    cy.nodeHtmlLabel(htmlLabelOptions);

    if (browser) {
      persistNodePositions(cy.nodes());
      
      cy.on('free', 'node', (evt) => {
        // After a reset, only persist the positions of nodes that were actually moved
        // to avoid overwriting the empty localStorage with all default positions
        const movedNode = evt.target;
        persistNodePositions(movedNode);
      });
    }

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const id = node.id();
      const language = graphData.languages.find((l) => l.id === id);
      if (language) {
        // Deselect edge if selecting a node
        selectedEdge = null;
        
        resetNodeStyles(id);
        selectedNode = language;
      }
    });

    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      const edgeData = edge.data();
      const sourceNode = graphData.languages.find(l => l.id === edgeData.source);
      const targetNode = graphData.languages.find(l => l.id === edgeData.target);
      
      if (sourceNode && targetNode) {
        // Deselect node if selecting an edge
        selectedNode = null;
        resetNodeStyles();
        
        // Build edge selection data
        const nodeA = edgeData.source < edgeData.target ? edgeData.source : edgeData.target;
        const nodeB = edgeData.source < edgeData.target ? edgeData.target : edgeData.source;
        
        const sourceIndex = graphData.adjacencyMatrix.indexByLanguage[nodeA];
        const targetIndex = graphData.adjacencyMatrix.indexByLanguage[nodeB];
        
        const forwardRelation = sourceIndex !== undefined && targetIndex !== undefined 
          ? graphData.adjacencyMatrix.matrix[sourceIndex]?.[targetIndex] ?? null
          : null;
        const backwardRelation = sourceIndex !== undefined && targetIndex !== undefined
          ? graphData.adjacencyMatrix.matrix[targetIndex]?.[sourceIndex] ?? null
          : null;
        
        selectedEdge = {
          id: edgeData.id,
          source: nodeA,
          target: nodeB,
          sourceName: sourceNode.name,
          targetName: targetNode.name,
          forward: forwardRelation,
          backward: backwardRelation,
          refs: edgeData.refs || []
        };
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        selectedNode = null;
        selectedEdge = null;
        resetNodeStyles();
        cy.elements().unselect();
      }
    });

    // Add hover effects
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      node.style({
        'border-color': '#1e40af',
        'border-width': 3,
        'background-color': '#f8fafc'
      });
    });

    cy.on('mouseout', 'node', (evt) => {
      const node = evt.target;
      // Reset to base style unless selected
      if (!node.selected()) {
        node.style(BASE_NODE_STYLE);
      }
    });

    cy.on('mouseover', 'edge', (evt) => {
      const edge = evt.target;
      edge.addClass('edge-hovered');
      graphContainer.style.cursor = 'pointer';
    });

    cy.on('mouseout', 'edge', (evt) => {
      const edge = evt.target;
      edge.removeClass('edge-hovered');
      graphContainer.style.cursor = 'default';
    });

  }

  function buildEdgeLabelTemplate(data: any): string {
    const backward = data?.backwardLabelHtml ?? (data?.backwardLabel ? escapeHtml(data.backwardLabel) : '');
    const forward = data?.forwardLabelHtml ?? (data?.forwardLabel ? escapeHtml(data.forwardLabel) : '');

    if (!backward && !forward) {
      return buildLabelContainer('', ['edge-label-wrapper'], true);
    }

    const backwardBlock = backward
      ? `<div class="edge-label edge-label--backward">${backward}</div>`
      : '';
    const forwardBlock = forward
      ? `<div class="edge-label edge-label--forward">${forward}</div>`
      : '';

    return buildLabelContainer(
      `${backwardBlock}${forwardBlock}`,
      ['edge-label-wrapper']
    );
  }

  onMount(() => {
    ensureCytoscapePluginsRegistered();
    createGraph();
    
    return () => {
      cy?.destroy();
    };
  });

  // Recreate graph when graphData changes
  let lastGraphData = graphData;
  $effect(() => {
    if (graphData !== lastGraphData && graphContainer) {
      lastGraphData = graphData;
      cy?.destroy();
      createGraph();
    }
  });
</script>

<div class="kcm-graph-container">
  <div bind:this={graphContainer} class="w-full h-full"></div>
  <!-- Y-axis overlay: More succinct (top) to Less succinct (bottom) -->
  <div class="y-axis" aria-hidden="true">
    <div class="axis-label axis-label-top">More succinct</div>
    <div class="axis-line"></div>
    <div class="axis-label axis-label-bottom">Less succinct</div>
  </div>
  
  <div class="layout-controls" aria-label="Graph layout controls">
    <button 
      class="layout-btn"
      onclick={resetGraphPositions}
      type="button"
      title="Use the default saved layout"
    >
      Default
    </button>
    <button 
      class="layout-btn"
      onclick={applyAutoLayout}
      type="button"
      title="Automatically place visible nodes with Dagre"
    >
      Auto
    </button>
  </div>
</div>

<style>
  .kcm-graph-container {
    width: 100%;
    height: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background-color: #ffffff;
    position: relative;
  }

  /* Overlay Y-axis (does not capture events) */
  .y-axis {
    position: absolute;
    left: 8px;
    top: 8px;
    bottom: 8px;
    width: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
    color: #1f2937; /* gray-800 */
    font-size: 10px;
    text-align: center;
  }

  .axis-line {
    flex: 1 1 auto;
    width: 2px;
    background: linear-gradient(#1e3a8a, #93c5fd); /* blue-800 to blue-300 */
    border-radius: 1px;
    margin: 6px 0;
    opacity: 0.6;
  }

  .axis-label {
    writing-mode: vertical-rl;
    line-height: 1;
    background: transparent;
    border: none;
    padding: 0;
    opacity: 0.85;
  }

  .axis-label-top {
    margin-bottom: 6px;
  }

  .axis-label-bottom {
    margin-top: 6px;
  }

  .layout-controls {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 30;
    display: flex;
    gap: 0.45rem;
  }

  .layout-btn {
    padding: 8px 16px;
    background-color: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .layout-btn:hover {
    background-color: #2563eb;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  .layout-btn:active {
    background-color: #1d4ed8;
    transform: translateY(0);
  }

  :global(.cy-node-html-label) {
    pointer-events: none;
    text-align: center;
    font-weight: 700;
    color: #1f2937;
    font-size: 14px;
  }

  :global(.cy-node-html-label .katex-display) {
    margin: 0;
  }

  :global(.cy-edge-html-label) {
    pointer-events: none;
    font-size: 11px;
    color: #374151;
    z-index: 10;
  }

  :global(.edge-label-wrapper) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
  }

  :global(.edge-label-wrapper--empty) {
    display: none;
  }

  :global(.edge-label) {
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 2px 4px;
    line-height: 1.2;
    white-space: nowrap;
  }

  :global(.edge-label--forward) {
    border-color: #2563eb;
  }

  :global(.edge-label--backward) {
    border-color: #059669;
  }
</style>
