// MCPTools - Client-side tool implementations for Claude AI

import { ContextLoader } from './context-loader'
import type {
  ToolResult,
  SearchCodeParams,
  SearchCodeResult,
  ConsoleError
} from './types'

export class MCPTools {
  private consoleErrors: ConsoleError[] = []

  constructor(private contextLoader: ContextLoader) {
    this.setupConsoleTracking()
  }

  // Extract common operator properties to avoid duplication
  private mapOperatorProperties(op: any) {
    return {
      type: op.type,
      name: op.name,
      category: op.category,
      description: op.description
    }
  }

  // Extract common example properties to avoid duplication
  private mapExampleProperties(ex: any) {
    return {
      id: ex.id,
      name: ex.name,
      description: ex.description,
      category: ex.category,
      tags: ex.tags
    }
  }

  // Check if context has been loaded successfully
  hasContext(): boolean {
    return this.contextLoader.getCodeIndex() !== null ||
      this.contextLoader.getOperatorRegistry() !== null ||
      this.contextLoader.getDocsIndex() !== null ||
      this.contextLoader.getExamples() !== null
  }

  // Get deck.gl canvas from global reference
  private getCanvas(): HTMLCanvasElement | null {
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
              symbol: this.findSymbolAtLine(file, idx + 1)
            })
          }
        })
      }

      return {
        success: true,
        data: results
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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
          fullText: fileIndex.lines.slice(startLine - 1, endLine).join('\n')
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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
          error: `Operator type not found: ${params.type}`
        }
      }

      return { success: true, data: schema }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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
        data: operators.map(op => this.mapOperatorProperties(op))
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Search documentation
  async getDocumentation(params: {
    query: string
    section?: 'users' | 'developers'
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
          return topic.title.toLowerCase().includes(query) ||
            topic.content.toLowerCase().includes(query)
        })
        .slice(0, 5); // Limit results

      return { success: true, data: results }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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
        error: error instanceof Error ? error.message : 'Unknown error'
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
        data: results.map(ex => this.mapExampleProperties(ex))
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
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

      const references: any[] = []

      // Search for symbol in all files
      for (const [filePath, file] of Object.entries(codeIndex.files)) {
        const symbol = file.symbols.find((s: any) => s.name === params.name)
        if (symbol) {
          references.push({
            file: filePath,
            line: symbol.line,
            context: file.lines.slice(symbol.line - 1, symbol.endLine).join('\n')
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
          references
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Analyze the current project for issues and suggestions
  async analyzeProject(params: {
    project: any
    analysisType: 'validation' | 'performance' | 'suggestions'
  }): Promise<ToolResult> {
    try {
      const { project, analysisType } = params

      switch (analysisType) {
        case 'validation':
          return this.validateProject(project)
        case 'performance':
          return this.analyzePerformance(project)
        case 'suggestions':
          return this.generateSuggestions(project)
        default:
          return { success: false, error: `Unknown analysis type: ${analysisType}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Visual debugging tools

  // Resize canvas to reduce token usage while maintaining aspect ratio
  private resizeCanvas(sourceCanvas: HTMLCanvasElement, maxDimension: number = 1024): HTMLCanvasElement {
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
          error: 'Canvas not available. Make sure deck.gl is initialized.'
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
          pixelRatio: window.devicePixelRatio
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Screenshot capture failed'
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
      const since = params.since || Date.now() - (5 * 60 * 1000)
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
          level
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve console errors'
      }
    }
  }

  // Get deck.gl rendering statistics
  async getRenderStats(): Promise<ToolResult> {
    try {
      const stats = (window as any).__deckStats

      if (!stats) {
        return {
          success: false,
          error: 'Deck.gl stats not available. Ensure onAfterRender is configured.'
        }
      }

      const memory = (performance as any).memory

      return {
        success: true,
        data: {
          deck: {
            fps: stats.fps,
            lastFrameTime: stats.lastFrameTime,
            layerCount: stats.layerCount,
            drawCalls: stats.drawCalls || 0,
            timestamp: stats.timestamp
          },
          memory: memory ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            usedPercent: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
          } : null
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve render stats'
      }
    }
  }

  // Inspect a specific layer in the visualization
  async inspectLayer(params: { layerId: string }): Promise<ToolResult> {
    try {
      const deckInstance = (window as any).__deckInstance

      if (!deckInstance) {
        return {
          success: false,
          error: 'Deck.gl instance not available'
        }
      }

      const layers = deckInstance.layerManager?.getLayers() || []
      const layer = layers.find((l: any) => l.id === params.layerId)

      if (!layer) {
        return {
          success: false,
          error: `Layer not found: ${params.layerId}`
        }
      }

      const layerInfo = {
        id: layer.id,
        type: layer.constructor.name,
        visible: layer.props.visible,
        opacity: layer.props.opacity,
        pickable: layer.props.pickable,
        dataLength: Array.isArray(layer.props.data) ? layer.props.data.length : 'unknown'
      }

      return {
        success: true,
        data: layerInfo
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to inspect layer'
      }
    }
  }

  // Private helper methods

  private validateProject(project: any): ToolResult {
    const issues: any[] = []
    const registry = this.contextLoader.getOperatorRegistry()

    if (!registry) {
      return { success: false, error: 'Registry not loaded' }
    }

    const connectedNodes = new Set<string>()
      (project.edges || []).forEach((edge: any) => {
        connectedNodes.add(edge.source)
        connectedNodes.add(edge.target)
      })

      (project.nodes || []).forEach((node: any) => {
        if (!connectedNodes.has(node.id) && node.type !== 'OutOp') {
          issues.push({
            type: 'disconnected',
            severity: 'warning',
            nodeId: node.id,
            message: `Node ${node.id} is not connected to the graph`
          })
        }

        const schema = registry.operators[node.type]
        if (!schema) {
          issues.push({
            type: 'unknown-operator',
            severity: 'error',
            nodeId: node.id,
            message: `Unknown operator type: ${node.type}`
          })
        }
      })

    return { success: true, data: { issues } }
  }

  private analyzePerformance(project: any): ToolResult {
    const suggestions: any[] = []

    const dataOps = (project.nodes || []).filter((n: any) =>
      ['FileOp', 'DuckDbOp', 'JSONOp'].includes(n.type)
    )

    if (dataOps.length > 5) {
      suggestions.push({
        type: 'performance',
        severity: 'info',
        message: `Found ${dataOps.length} data operations. Consider consolidating with DuckDbOp.`
      })
    }

    return { success: true, data: { suggestions } }
  }

  private generateSuggestions(project: any): ToolResult {
    const suggestions: any[] = []
    const registry = this.contextLoader.getOperatorRegistry()

    if (!registry) {
      return { success: false, error: 'Registry not loaded' }
    }

    (project.nodes || []).forEach((node: any) => {
      const schema = registry.operators[node.type]
      if (schema?.relatedOperators.length > 0) {
        const usedTypes = new Set((project.nodes || []).map((n: any) => n.type))
        const unusedRelated = schema.relatedOperators.filter(op => !usedTypes.has(op))

        if (unusedRelated.length > 0) {
          suggestions.push({
            type: 'related-operators',
            severity: 'info',
            nodeId: node.id,
            message: `Consider using related operators: ${unusedRelated.join(', ')}`
          })
        }
      }
    })

    return { success: true, data: { suggestions } }
  }

  private findSymbolAtLine(file: any, line: number): string | undefined {
    return file.symbols.find(
      (s: any) => s.line <= line && s.endLine >= line
    )?.name
  }

  private setupConsoleTracking() {
    const originalError = console.error
    console.error = (...args: any[]) => {
      this.consoleErrors.push({
        level: 'error',
        message: args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        stack: new Error().stack,
        timestamp: Date.now()
      })

      if (this.consoleErrors.length > 100) {
        this.consoleErrors = this.consoleErrors.slice(-100)
      }

      originalError.apply(console, args)
    }

    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      this.consoleErrors.push({
        level: 'warn',
        message: args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        stack: new Error().stack,
        timestamp: Date.now()
      })

      if (this.consoleErrors.length > 100) {
        this.consoleErrors = this.consoleErrors.slice(-100)
      }

      originalWarn.apply(console, args)
    }

    window.addEventListener('error', (event) => {
      this.consoleErrors.push({
        level: 'error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: Date.now()
      })
    })

    window.addEventListener('unhandledrejection', (event) => {
      this.consoleErrors.push({
        level: 'error',
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        timestamp: Date.now()
      })
    })
  }
}
