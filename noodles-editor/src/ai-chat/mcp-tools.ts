// MCPTools - Client-side tool implementations for Claude AI

import { getOpStore } from '../noodles/store'
import { safeStringify } from '../noodles/utils/serialization'
import type { ContextLoader } from './context-loader'
import type {
  ConsoleError,
  FileIndex,
  NoodlesProject,
  SearchCodeParams,
  SearchCodeResult,
  ToolResult,
} from './types'

export class MCPTools {
  private consoleErrors: ConsoleError[] = []
  private project: NoodlesProject | null = null

  constructor(private contextLoader: ContextLoader) {
    this.setupConsoleTracking()
  }

  // Set current project for MCP tools to access
  setProject(project: NoodlesProject) {
    this.project = project
  }

  // Extract common operator properties to avoid duplication
  private mapOperatorProperties(op: {
    type: string
    name: string
    category: string
    description: string
  }) {
    return {
      type: op.type,
      name: op.name,
      category: op.category,
      description: op.description,
    }
  }

  // Extract common example properties to avoid duplication
  private mapExampleProperties(ex: {
    id: string
    name: string
    description: string
    category: string
    tags: string[]
  }) {
    return {
      id: ex.id,
      name: ex.name,
      description: ex.description,
      category: ex.category,
      tags: ex.tags,
    }
  }

  // Check if context has been loaded successfully
  hasContext(): boolean {
    return (
      this.contextLoader.getCodeIndex() !== null ||
      this.contextLoader.getOperatorRegistry() !== null ||
      this.contextLoader.getDocsIndex() !== null ||
      this.contextLoader.getExamples() !== null
    )
  }

  // Get deck.gl canvas from global reference
  private getCanvas(): HTMLCanvasElement | null {
    // biome-ignore lint/suspicious/noExplicitAny: accessing global window property
    return (window as any).__deckCanvas || null
  }

  // Search source code using regex or text matching
  async searchCode(params: SearchCodeParams): Promise<ToolResult> {
    try {
      const codeIndex = this.contextLoader.getCodeIndex()

      if (!codeIndex) {
        return { success: false, error: 'Code index not loaded' }
      }

      const results: SearchCodeResult[] = []
      const contextLines = params.contextLines ?? 3
      const maxResults = params.maxResults ?? 20
      const regex = new RegExp(params.pattern, 'gi')

      for (const [filePath, file] of Object.entries(codeIndex.files)) {
        if (params.path && !filePath.includes(params.path)) continue

        file.lines.forEach((line, idx) => {
          if (regex.test(line) && results.length < maxResults) {
            const startLine = Math.max(0, idx - contextLines)
            const endLine = Math.min(file.lines.length - 1, idx + contextLines)

            results.push({
              file: filePath,
              line: idx + 1, // 1-indexed
              context: file.lines.slice(startLine, endLine + 1),
              symbol: this.findSymbolAtLine(file, idx + 1),
            })
          }
        })
      }

      return {
        success: true,
        data: results,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Get source code for a specific file and line range
  async getSourceCode(params: {
    file: string
    startLine?: number
    endLine?: number
  }): Promise<ToolResult> {
    try {
      const codeIndex = this.contextLoader.getCodeIndex()
      if (!codeIndex) {
        return { success: false, error: 'Code index not loaded' }
      }

      const fileIndex = codeIndex.files[params.file]
      if (!fileIndex) {
        return { success: false, error: `File not found: ${params.file}` }
      }

      const startLine = params.startLine ?? 1
      const endLine = params.endLine ?? fileIndex.lines.length

      return {
        success: true,
        data: {
          file: params.file,
          startLine,
          endLine,
          lines: fileIndex.lines.slice(startLine - 1, endLine),
          fullText: fileIndex.lines.slice(startLine - 1, endLine).join('\n'),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Get schema for a specific operator type
  async getOperatorSchema(params: { type: string }): Promise<ToolResult> {
    try {
      const registry = this.contextLoader.getOperatorRegistry()
      if (!registry) {
        return { success: false, error: 'Operator registry not loaded' }
      }

      const schema = registry.operators[params.type]
      if (!schema) {
        return {
          success: false,
          error: `Operator type not found: ${params.type}`,
        }
      }

      return { success: true, data: schema }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // List all available operators, optionally filtered by category
  async listOperators(params: { category?: string }): Promise<ToolResult> {
    try {
      const registry = this.contextLoader.getOperatorRegistry()
      if (!registry) {
        return { success: false, error: 'Operator registry not loaded' }
      }

      let operators = Object.values(registry.operators)

      if (params.category) {
        operators = operators.filter(op => op.category === params.category)
      }

      return {
        success: true,
        data: operators.map(op => this.mapOperatorProperties(op)),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Search documentation
  async getDocumentation(params: {
    query: string
    section?: 'users' | 'developers' | 'ai-assistant' | 'examples'
  }): Promise<ToolResult> {
    try {
      const docsIndex = this.contextLoader.getDocsIndex()

      if (!docsIndex) {
        return { success: false, error: 'Docs index not loaded' }
      }

      // Simple text search across all topics
      const query = params.query.toLowerCase()
      const results = Object.values(docsIndex.topics)
        .filter(topic => {
          if (params.section && topic.section !== params.section) return false
          return (
            topic.title.toLowerCase().includes(query) || topic.content.toLowerCase().includes(query)
          )
        })
        .slice(0, 5) // Limit results

      return { success: true, data: results }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Get an example project by ID
  async getExample(params: { id: string }): Promise<ToolResult> {
    try {
      const examples = this.contextLoader.getExamples()
      if (!examples) {
        return { success: false, error: 'Examples not loaded' }
      }

      const example = examples.examples[params.id]
      if (!example) {
        return { success: false, error: `Example not found: ${params.id}` }
      }

      return { success: true, data: example }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // List all available examples
  async listExamples(params: { category?: string; tag?: string }): Promise<ToolResult> {
    try {
      const examples = this.contextLoader.getExamples()
      if (!examples) {
        return { success: false, error: 'Examples not loaded' }
      }

      let results = Object.values(examples.examples)

      if (params.category) {
        results = results.filter(ex => ex.category === params.category)
      }

      if (params.tag) {
        results = results.filter(ex => ex.tags.includes(params.tag))
      }

      return {
        success: true,
        data: results.map(ex => this.mapExampleProperties(ex)),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Find a symbol (class, function, type) by name
  async findSymbol(params: { name: string }): Promise<ToolResult> {
    try {
      const codeIndex = this.contextLoader.getCodeIndex()
      if (!codeIndex) {
        return { success: false, error: 'Code index not loaded' }
      }

      // biome-ignore lint/suspicious/noExplicitAny: dynamic code index structure
      const references: any[] = []

      // Search for symbol in all files
      for (const [filePath, file] of Object.entries(codeIndex.files)) {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic symbol structure
        const symbol = file.symbols.find((s: any) => s.name === params.name)
        if (symbol) {
          references.push({
            file: filePath,
            line: symbol.line,
            context: file.lines.slice(symbol.line - 1, symbol.endLine).join('\n'),
          })
        }
      }

      if (references.length === 0) {
        return { success: false, error: `Symbol not found: ${params.name}` }
      }

      return {
        success: true,
        data: {
          symbol: references[0],
          references,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Analyze the current project for issues and suggestions
  async analyzeProject(params: {
    project: NoodlesProject
    analysisType: 'validation' | 'performance' | 'suggestions'
  }): Promise<ToolResult> {
    try {
      const { project, analysisType } = params

      switch (analysisType) {
        case 'validation':
          return this.validateProject(project)
        case 'performance':
          return this.analyzePerformance(project)
        default:
          return { success: false, error: `Unknown analysis type: ${analysisType}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Visual debugging tools

  // Resize canvas to reduce token usage while maintaining aspect ratio
  private resizeCanvas(sourceCanvas: HTMLCanvasElement, maxDimension = 1024): HTMLCanvasElement {
    const { width, height } = sourceCanvas

    // If already small enough, return original
    if (width <= maxDimension && height <= maxDimension) {
      return sourceCanvas
    }

    // Calculate new dimensions maintaining aspect ratio
    let newWidth = width
    let newHeight = height

    if (width > height) {
      newWidth = maxDimension
      newHeight = Math.round((height / width) * maxDimension)
    } else {
      newHeight = maxDimension
      newWidth = Math.round((width / height) * maxDimension)
    }

    // Create resized canvas
    const resizedCanvas = document.createElement('canvas')
    resizedCanvas.width = newWidth
    resizedCanvas.height = newHeight

    const ctx = resizedCanvas.getContext('2d')
    if (!ctx) {
      return sourceCanvas
    }

    // Use high-quality image smoothing
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // Draw resized image
    ctx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight)

    return resizedCanvas
  }

  // Capture screenshot of the current visualization
  async captureVisualization(params: {
    includeUI?: boolean
    format?: 'png' | 'jpeg'
    quality?: number
  }): Promise<ToolResult> {
    try {
      const canvas = this.getCanvas()
      if (!canvas) {
        return {
          success: false,
          error: 'Canvas not available. Make sure deck.gl is initialized.',
        }
      }

      const format = params.format || 'jpeg'
      const quality = params.quality || 0.5

      // Resize to max 1024px on longest side to reduce token usage
      // This typically reduces a 1920x1080 screenshot from ~500KB to ~50KB
      const resizedCanvas = this.resizeCanvas(canvas, 1024)

      // Capture resized canvas
      const dataUrl = resizedCanvas.toDataURL(`image/${format}`, quality)
      const base64 = dataUrl.split(',')[1]

      return {
        success: true,
        data: {
          screenshot: base64,
          format,
          width: resizedCanvas.width,
          height: resizedCanvas.height,
          originalWidth: canvas.width,
          originalHeight: canvas.height,
          timestamp: Date.now(),
          pixelRatio: window.devicePixelRatio,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Screenshot capture failed',
      }
    }
  }

  // Get recent console errors and warnings
  async getConsoleErrors(params: {
    since?: number
    level?: 'error' | 'warn' | 'all'
    maxResults?: number
  }): Promise<ToolResult> {
    try {
      const since = params.since || Date.now() - 5 * 60 * 1000
      const level = params.level || 'all'
      const maxResults = params.maxResults || 50

      let filtered = this.consoleErrors.filter(err => err.timestamp >= since)

      if (level !== 'all') {
        filtered = filtered.filter(err => err.level === level)
      }

      filtered.sort((a, b) => b.timestamp - a.timestamp)

      return {
        success: true,
        data: {
          errors: filtered.slice(0, maxResults),
          totalCount: filtered.length,
          since,
          level,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve console errors',
      }
    }
  }

  // Get deck.gl rendering statistics
  async getRenderStats(): Promise<ToolResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: accessing global window property
      const stats = (window as any).__deckStats

      if (!stats) {
        return {
          success: false,
          error: 'Deck.gl stats not available. Ensure onAfterRender is configured.',
        }
      }

      // biome-ignore lint/suspicious/noExplicitAny: accessing Chrome-specific performance API
      const memory = (performance as any).memory

      return {
        success: true,
        data: {
          deck: {
            fps: stats.fps,
            lastFrameTime: stats.lastFrameTime,
            layerCount: stats.layerCount,
            drawCalls: stats.drawCalls || 0,
            timestamp: stats.timestamp,
          },
          memory: memory
            ? {
                usedJSHeapSize: memory.usedJSHeapSize,
                totalJSHeapSize: memory.totalJSHeapSize,
                jsHeapSizeLimit: memory.jsHeapSizeLimit,
                usedPercent: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100),
              }
            : null,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve render stats',
      }
    }
  }

  // Inspect a specific layer in the visualization
  async inspectLayer(params: { layerId: string }): Promise<ToolResult> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: accessing global window property
      const deckInstance = (window as any).__deckInstance

      if (!deckInstance) {
        return {
          success: false,
          error: 'Deck.gl instance not available',
        }
      }

      const layers = deckInstance.layerManager?.getLayers() || []
      // biome-ignore lint/suspicious/noExplicitAny: dynamic Deck.gl layer structure
      const layer = layers.find((l: any) => l.id === params.layerId)

      if (!layer) {
        return {
          success: false,
          error: `Layer not found: ${params.layerId}`,
        }
      }

      const layerInfo = {
        id: layer.id,
        type: layer.constructor.name,
        visible: layer.props.visible,
        opacity: layer.props.opacity,
        pickable: layer.props.pickable,
        dataLength: Array.isArray(layer.props.data) ? layer.props.data.length : 'unknown',
      }

      return {
        success: true,
        data: layerInfo,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to inspect layer',
      }
    }
  }

  // Project state manipulation tools

  // Apply modifications to the project
  // biome-ignore lint/suspicious/noExplicitAny: dynamic modification structure from Claude
  async applyModifications(params: { modifications: any[] }): Promise<ToolResult> {
    try {
      const modifications = params.modifications
      if (!Array.isArray(modifications) || modifications.length === 0) {
        return {
          success: false,
          error: 'modifications must be a non-empty array',
        }
      }

      // Validate each modification
      for (const mod of modifications) {
        if (!mod.type || !mod.data) {
          return {
            success: false,
            error: 'Each modification must have "type" and "data" fields',
          }
        }
        const validTypes = ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge']
        if (!validTypes.includes(mod.type)) {
          return {
            success: false,
            error: `Invalid modification type: ${mod.type}. Must be one of: ${validTypes.join(', ')}`,
          }
        }
      }

      // Return the modifications - they will be applied by the tool result handler
      return {
        success: true,
        data: {
          modificationsCount: modifications.length,
          modifications,
          message: `${modifications.length} modification(s) will be applied to the project`,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to validate modifications',
      }
    }
  }

  // Get current project state (nodes and edges)
  async getCurrentProject(): Promise<ToolResult> {
    try {
      if (!this.project) {
        return {
          success: false,
          error: 'No project loaded',
        }
      }

      return {
        success: true,
        data: {
          nodeCount: (this.project.nodes || []).length,
          edgeCount: (this.project.edges || []).length,
          nodes: (this.project.nodes || []).map(n => ({
            id: n.id,
            type: n.type,
            position: n.position,
            inputs: n.data?.inputs || {},
          })),
          edges: (this.project.edges || []).map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get project state',
      }
    }
  }

  // Read operator output data
  async getNodeOutput(params: { nodeId: string; maxRows?: number }): Promise<ToolResult> {
    try {
      const operator = getOpStore().getOp(params.nodeId)

      if (!operator) {
        return {
          success: false,
          error: `Operator not found: ${params.nodeId}. Make sure the node exists and has been executed.`,
        }
      }

      // Get the output data from the operator
      // biome-ignore lint/suspicious/noExplicitAny: dynamic operator output structure
      const outputData: any = {}
      // biome-ignore lint/suspicious/noExplicitAny: dynamic operator outputs object
      const outputs = (operator as any).outputs || {}

      for (const [key, field] of Object.entries(outputs)) {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic field value access
        const value = (field as any).value
        outputData[key] = value
      }

      // If there's a 'data' output, try to sample it
      if (outputData.data) {
        const data = outputData.data
        const maxRows = params.maxRows || 10

        // Sample the data for inspection
        let sample = data
        let totalRows = 0

        if (Array.isArray(data)) {
          totalRows = data.length
          sample = data.slice(0, maxRows)
        } else if (data && typeof data === 'object' && data.features) {
          // GeoJSON
          totalRows = data.features.length
          sample = {
            ...data,
            features: data.features.slice(0, maxRows),
          }
        }

        return {
          success: true,
          data: {
            nodeId: params.nodeId,
            operatorType:
              // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic operator constructor
              (operator as any).constructor.displayName || (operator as any).constructor.name,
            outputs: Object.keys(outputs),
            dataSample: sample,
            totalRows,
            sampleRows: Math.min(maxRows, totalRows),
            // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic operator state
            executionState: (operator as any).executionState?.value || null,
          },
        }
      }

      // If no data output, return all outputs
      return {
        success: true,
        data: {
          nodeId: params.nodeId,
          operatorType:
            // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic operator constructor
            (operator as any).constructor.displayName || (operator as any).constructor.name,
          outputs: Object.keys(outputs),
          outputData,
          // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic operator state
          executionState: (operator as any).executionState?.value || null,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read operator output',
      }
    }
  }

  // List all nodes in the project with their current state
  async listNodes(): Promise<ToolResult> {
    try {
      if (!this.project) {
        return {
          success: false,
          error: 'No project loaded',
        }
      }

      const { getOp } = getOpStore()

      const nodes = (this.project.nodes || []).map(node => {
        const operator = getOp(node.id)
        // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic operator state
        const executionState = operator ? (operator as any).executionState?.value : null

        return {
          id: node.id,
          type: node.type,
          position: node.position,
          inputs: node.data?.inputs || {},
          locked: node.data?.locked || false,
          executionState: executionState
            ? {
                status: executionState.status,
                lastExecuted: executionState.lastExecuted,
                executionTime: executionState.executionTime,
                error: executionState.error,
              }
            : null,
        }
      })

      // Group by type for easier analysis
      const byType: Record<string, number> = {}
      nodes.forEach(n => {
        byType[n.type] = (byType[n.type] || 0) + 1
      })

      return {
        success: true,
        data: {
          nodes,
          totalCount: nodes.length,
          byType,
          dataNodes: nodes.filter(n => ['FileOp', 'JSONOp', 'DuckDbOp', 'CSVOp'].includes(n.type)),
          layerNodes: nodes.filter(n => n.type.includes('Layer')),
          rendererNodes: nodes.filter(n => ['DeckRendererOp', 'OutOp'].includes(n.type)),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list nodes',
      }
    }
  }

  // Get detailed information about a specific node
  async getNodeInfo(params: { nodeId: string }): Promise<ToolResult> {
    try {
      if (!this.project) {
        return {
          success: false,
          error: 'No project loaded',
        }
      }

      const node = (this.project.nodes || []).find(n => n.id === params.nodeId)
      if (!node) {
        return {
          success: false,
          error: `Node not found: ${params.nodeId}`,
        }
      }

      const operator = getOpStore().getOp(params.nodeId)
      const edges = this.project.edges || []

      // Find incoming and outgoing edges
      const incomingEdges = edges.filter(e => e.target === params.nodeId)
      const outgoingEdges = edges.filter(e => e.source === params.nodeId)

      // Get execution state
      // biome-ignore lint/suspicious/noExplicitAny: executionState is a dynamic operator property not in type definitions
      const executionState = operator ? (operator as any).executionState?.value : null

      // Get available inputs and outputs from operator schema
      const registry = this.contextLoader.getOperatorRegistry()
      const schema = registry?.operators[node.type]

      return {
        success: true,
        data: {
          id: node.id,
          type: node.type,
          position: node.position,
          inputs: node.data?.inputs || {},
          locked: node.data?.locked || false,
          executionState: executionState
            ? {
                status: executionState.status,
                lastExecuted: executionState.lastExecuted,
                executionTime: executionState.executionTime,
                error: executionState.error,
              }
            : null,
          connections: {
            incoming: incomingEdges.map(e => ({
              from: e.source,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            })),
            outgoing: outgoingEdges.map(e => ({
              to: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            })),
          },
          schema: schema
            ? {
                description: schema.description,
                category: schema.category,
                inputs: schema.inputs,
                outputs: schema.outputs,
              }
            : null,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get node info',
      }
    }
  }

  // Private helper methods

  private validateProject(project: NoodlesProject): ToolResult {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic issue structure
    const issues: any[] = []
    const registry = this.contextLoader.getOperatorRegistry()

    if (!registry) {
      return { success: false, error: 'Registry not loaded' }
    }

    const connectedNodes = new Set<string>()
    ;(project.edges || []).forEach(edge => {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    })
    ;(project.nodes || []).forEach(node => {
      if (!connectedNodes.has(node.id) && node.type !== 'OutOp') {
        issues.push({
          type: 'disconnected',
          severity: 'warning',
          nodeId: node.id,
          message: `Node ${node.id} is not connected to the graph`,
        })
      }

      const schema = registry.operators[node.type]
      if (!schema) {
        issues.push({
          type: 'unknown-operator',
          severity: 'error',
          nodeId: node.id,
          message: `Unknown operator type: ${node.type}`,
        })
      }
    })

    return { success: true, data: { issues } }
  }

  private analyzePerformance(project: NoodlesProject): ToolResult {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic suggestion structure
    const suggestions: any[] = []

    const dataOps = (project.nodes || []).filter(n =>
      ['FileOp', 'DuckDbOp', 'JSONOp'].includes(n.type)
    )

    if (dataOps.length > 5) {
      suggestions.push({
        type: 'performance',
        severity: 'info',
        message: `Found ${dataOps.length} data operations. Consider consolidating with DuckDbOp.`,
      })
    }

    return { success: true, data: { suggestions } }
  }

  private findSymbolAtLine(file: FileIndex, line: number): string | undefined {
    return file.symbols.find(s => s.line <= line && s.endLine >= line)?.name
  }

  private setupConsoleTracking() {
    const originalError = console.error
    // biome-ignore lint/suspicious/noExplicitAny: console.error accepts any arguments
    console.error = (...args: any[]) => {
      this.consoleErrors.push({
        level: 'error',
        message: args
          .map(arg => {
            if (typeof arg === 'object' && arg !== null) {
              try {
                return safeStringify(arg)
              } catch {
                return '[Object]'
              }
            }
            return String(arg)
          })
          .join(' '),
        stack: new Error().stack,
        timestamp: Date.now(),
      })

      if (this.consoleErrors.length > 100) {
        this.consoleErrors = this.consoleErrors.slice(-100)
      }

      originalError.apply(console, args)
    }

    const originalWarn = console.warn
    // biome-ignore lint/suspicious/noExplicitAny: console.warn accepts any arguments
    console.warn = (...args: any[]) => {
      this.consoleErrors.push({
        level: 'warn',
        message: args
          .map(arg => {
            if (typeof arg === 'object' && arg !== null) {
              try {
                return safeStringify(arg)
              } catch {
                return '[Object]'
              }
            }
            return String(arg)
          })
          .join(' '),
        stack: new Error().stack,
        timestamp: Date.now(),
      })

      if (this.consoleErrors.length > 100) {
        this.consoleErrors = this.consoleErrors.slice(-100)
      }

      originalWarn.apply(console, args)
    }

    window.addEventListener('error', event => {
      this.consoleErrors.push({
        level: 'error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: Date.now(),
      })
    })

    window.addEventListener('unhandledrejection', event => {
      this.consoleErrors.push({
        level: 'error',
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        timestamp: Date.now(),
      })
    })
  }
}
