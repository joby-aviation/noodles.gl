/**
 * Project Generator Agent
 *
 * Generates complete Noodles.gl projects from natural language descriptions.
 * Can be invoked from the AI chat to create new visualizations.
 */

import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import {
  BASEMAP_STYLES,
  calculatePosition,
  createEdgeId,
  generateNodeId,
  OPERATOR_CONFIGS,
  VIZ_TYPE_TO_LAYER,
} from './project-templates'

export interface GenerateProjectParams {
  /** Natural language description of the visualization */
  description: string
  /** Data source URL or path (optional, will use placeholder if not provided) */
  dataSource?: string
  /** Visualization type hint (optional, will infer from description) */
  visualizationType?: string
  /** Whether to include a basemap */
  includeBasemap?: boolean
}

export interface GeneratedProject {
  nodes: ReactFlowNode[]
  edges: ReactFlowEdge[]
  viewport: { x: number; y: number; zoom: number }
}

export class ProjectGeneratorAgent {
  /**
   * Generate a complete project from a description
   */
  async generateProject(params: GenerateProjectParams): Promise<GeneratedProject> {
    const {
      description,
      dataSource = '@/data.csv',
      visualizationType,
      includeBasemap = true,
    } = params

    // Analyze description to determine visualization type
    const vizType = visualizationType || this.inferVisualizationType(description)
    const layerType = VIZ_TYPE_TO_LAYER[vizType] || 'ScatterplotLayerOp'

    // Track existing node IDs to avoid conflicts
    const existingIds = new Set<string>()

    // Build the project nodes
    const nodes: ReactFlowNode[] = []
    const edges: ReactFlowEdge[] = []

    // 1. Data source node
    const dataNodeId = generateNodeId('data', existingIds)
    existingIds.add(dataNodeId)
    nodes.push({
      id: dataNodeId,
      type: 'FileOp',
      position: calculatePosition(0, 0, 0),
      data: {
        inputs: {
          url: dataSource,
          format: this.inferDataFormat(dataSource),
        },
      },
    })

    // 2. Layer node
    const layerNodeId = generateNodeId(layerType.replace(/Op$/, ''), existingIds)
    existingIds.add(layerNodeId)
    const layerConfig = this.getLayerConfig(layerType, description)
    nodes.push({
      id: layerNodeId,
      type: layerType,
      position: calculatePosition(0, 1, 0),
      data: {
        inputs: layerConfig,
      },
    })

    // Connect data to layer
    edges.push({
      id: createEdgeId(dataNodeId, 'out.data', layerNodeId, 'par.data'),
      source: dataNodeId,
      target: layerNodeId,
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    })

    // Add accessors if needed
    const accessors = this.generateAccessors(layerType, description)
    let lastAccessorColumn = 1

    for (const [accessorType, accessorCode] of Object.entries(accessors)) {
      const accessorNodeId = generateNodeId(`${accessorType}Accessor`, existingIds)
      existingIds.add(accessorNodeId)

      nodes.push({
        id: accessorNodeId,
        type: 'AccessorOp',
        position: calculatePosition(0, lastAccessorColumn, 1),
        data: {
          inputs: {
            code: accessorCode,
          },
        },
      })

      // Connect data to accessor
      edges.push({
        id: createEdgeId(dataNodeId, 'out.data', accessorNodeId, 'par.data'),
        source: dataNodeId,
        target: accessorNodeId,
        sourceHandle: 'out.data',
        targetHandle: 'par.data',
      })

      // Connect accessor to layer
      const layerInputField = this.getLayerAccessorField(layerType, accessorType)
      if (layerInputField) {
        edges.push({
          id: createEdgeId(accessorNodeId, 'out.accessor', layerNodeId, layerInputField),
          source: accessorNodeId,
          target: layerNodeId,
          sourceHandle: 'out.accessor',
          targetHandle: layerInputField,
        })
      }

      lastAccessorColumn++
    }

    // 3. Renderer node
    const rendererNodeId = generateNodeId('renderer', existingIds)
    existingIds.add(rendererNodeId)
    nodes.push({
      id: rendererNodeId,
      type: 'DeckRendererOp',
      position: calculatePosition(0, 2, 0),
      data: {
        inputs: {},
      },
    })

    // Connect layer to renderer
    edges.push({
      id: createEdgeId(layerNodeId, 'out.layer', rendererNodeId, 'par.layers'),
      source: layerNodeId,
      target: rendererNodeId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    })

    // 4. Basemap (optional)
    if (includeBasemap) {
      const basemapNodeId = generateNodeId('basemap', existingIds)
      existingIds.add(basemapNodeId)
      nodes.push({
        id: basemapNodeId,
        type: 'MaplibreBasemapOp',
        position: calculatePosition(0, 2, 1),
        data: {
          inputs: {
            style: BASEMAP_STYLES.darkNoLabels,
          },
        },
      })

      // Connect basemap to viewer (will be created next)
      edges.push({
        id: createEdgeId(basemapNodeId, 'out.basemap', '/viewer', 'par.basemap'),
        source: basemapNodeId,
        target: '/viewer',
        sourceHandle: 'out.basemap',
        targetHandle: 'par.basemap',
      })
    }

    // 5. Viewer node
    const viewerNodeId = '/viewer'
    existingIds.add(viewerNodeId)
    nodes.push({
      id: viewerNodeId,
      type: 'ViewerOp',
      position: calculatePosition(0, 3, 0),
      data: {
        inputs: {},
      },
    })

    // Connect renderer to viewer
    edges.push({
      id: createEdgeId(rendererNodeId, 'out.deckProps', viewerNodeId, 'par.deckProps'),
      source: rendererNodeId,
      target: viewerNodeId,
      sourceHandle: 'out.deckProps',
      targetHandle: 'par.deckProps',
    })

    return {
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    }
  }

  /**
   * Infer visualization type from description
   */
  private inferVisualizationType(description: string): string {
    const lower = description.toLowerCase()

    // Check for explicit viz type mentions
    for (const [keyword, _layerType] of Object.entries(VIZ_TYPE_TO_LAYER)) {
      if (lower.includes(keyword)) {
        return keyword
      }
    }

    // Default patterns
    if (lower.includes('map') || lower.includes('geographic')) {
      return 'scatter'
    }
    if (lower.includes('connect') || lower.includes('route') || lower.includes('flight')) {
      return 'arc'
    }
    if (lower.includes('trail') || lower.includes('track')) {
      return 'path'
    }

    // Default to scatterplot
    return 'scatter'
  }

  /**
   * Infer data format from file extension
   */
  private inferDataFormat(url: string): string {
    if (url.endsWith('.csv')) return 'csv'
    if (url.endsWith('.json')) return 'json'
    if (url.endsWith('.geojson')) return 'geojson'
    if (url.endsWith('.parquet')) return 'parquet'
    return 'csv' // default
  }

  /**
   * Get layer-specific configuration
   */
  private getLayerConfig(layerType: string, _description: string): Record<string, any> {
    const baseConfig = OPERATOR_CONFIGS.layers[layerType as keyof typeof OPERATOR_CONFIGS.layers]
    if (baseConfig) {
      return { ...baseConfig.inputs }
    }
    return {}
  }

  /**
   * Generate accessor functions based on layer type
   */
  private generateAccessors(layerType: string, description: string): Record<string, string> {
    const accessors: Record<string, string> = {}

    // All layers need position accessor
    if (this.needsPositionAccessor(layerType)) {
      accessors.position = this.inferPositionAccessor(description)
    }

    // Arc layers need source and target positions
    if (layerType === 'ArcLayerOp') {
      accessors.sourcePosition = '[d.source_lng, d.source_lat]'
      accessors.targetPosition = '[d.target_lng, d.target_lat]'
    }

    // Path layers need path accessor
    if (layerType === 'PathLayerOp' || layerType === 'TripsLayerOp') {
      accessors.path = 'd.path'
    }

    return accessors
  }

  /**
   * Check if layer needs position accessor
   */
  private needsPositionAccessor(layerType: string): boolean {
    return [
      'ScatterplotLayerOp',
      'IconLayerOp',
      'TextLayerOp',
      'ColumnLayerOp',
      'HexagonLayerOp',
    ].includes(layerType)
  }

  /**
   * Infer position accessor from description
   */
  private inferPositionAccessor(description: string): string {
    const lower = description.toLowerCase()

    // Check for common field name patterns
    if (lower.includes('lng') || lower.includes('long')) {
      if (lower.includes('latitude') || lower.includes('lat')) {
        return '[d.lng, d.lat]'
      }
      return '[d.longitude, d.latitude]'
    }

    if (lower.includes('x') && lower.includes('y')) {
      return '[d.x, d.y]'
    }

    // Default to common convention
    return '[d.longitude, d.latitude]'
  }

  /**
   * Get the layer input field name for an accessor type
   */
  private getLayerAccessorField(layerType: string, accessorType: string): string | null {
    const mapping: Record<string, Record<string, string>> = {
      ScatterplotLayerOp: {
        position: 'par.getPosition',
        color: 'par.getFillColor',
        size: 'par.getRadius',
      },
      ArcLayerOp: {
        sourcePosition: 'par.getSourcePosition',
        targetPosition: 'par.getTargetPosition',
        color: 'par.getSourceColor',
        width: 'par.getWidth',
      },
      PathLayerOp: {
        path: 'par.getPath',
        color: 'par.getColor',
        width: 'par.getWidth',
      },
      IconLayerOp: {
        position: 'par.getPosition',
        icon: 'par.getIcon',
        size: 'par.getSize',
      },
      TextLayerOp: {
        position: 'par.getPosition',
        text: 'par.getText',
        color: 'par.getColor',
      },
      ColumnLayerOp: {
        position: 'par.getPosition',
        color: 'par.getFillColor',
        elevation: 'par.getElevation',
      },
      HeatmapLayerOp: {
        position: 'par.getPosition',
        weight: 'par.getWeight',
      },
    }

    return mapping[layerType]?.[accessorType] || null
  }

  /**
   * Validate generated project structure
   */
  validateProject(project: GeneratedProject): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check for required nodes
    const hasViewer = project.nodes.some(n => n.type === 'ViewerOp')
    if (!hasViewer) {
      errors.push('Missing ViewerOp node')
    }

    const hasRenderer = project.nodes.some(n => n.type === 'DeckRendererOp')
    if (!hasRenderer) {
      errors.push('Missing DeckRendererOp node')
    }

    // Check for edge validity
    const nodeIds = new Set(project.nodes.map(n => n.id))
    for (const edge of project.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge references non-existent source: ${edge.source}`)
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge references non-existent target: ${edge.target}`)
      }
    }

    // Check for disconnected nodes (except viewer as final output)
    const connectedNodes = new Set<string>()
    for (const edge of project.edges) {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    }
    for (const node of project.nodes) {
      if (node.id !== '/viewer' && !connectedNodes.has(node.id)) {
        errors.push(`Disconnected node: ${node.id}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}
