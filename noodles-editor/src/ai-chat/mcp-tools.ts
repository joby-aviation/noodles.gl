// MCPTools - Client-side tool implementations for Claude AI

import type { z } from 'zod'
import type { Operator } from '../noodles/operators'
import { getOpStore } from '../noodles/store'
import { safeStringify } from '../noodles/utils/serialization'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline/timeline-store'
import type { Keyframe, KeyframeValue, Track } from '../timeline/types'
import {
  type GrepFilesParams,
  grepFiles,
  type ListFilesParams,
  listFiles,
  type ReadFileParams,
  readFile,
  type WriteFileParams,
  writeFile,
} from './agent-files'
import type { ContextLoader } from './context-loader'
import { searchDocumentation } from './docs-search'
import {
  type ExportStatusParams,
  type ExportVideoParams,
  exportVideo,
  getExportStatus,
} from './export-video'
import {
  checkFields,
  customInputNames,
  qualifyHandle,
  resolveOperatorType,
} from './modification-fields'
import { type RunCodeParams, runCode } from './run-code'
import {
  type ConsoleError,
  type FileIndex,
  type NoodlesProject,
  type OperatorRegistry,
  type ProjectModification,
  ProjectModificationSchema,
  type SearchCodeParams,
  type SearchCodeResult,
  type ToolResult,
} from './types'

// Longest string input value list_nodes reports in full. CodeOp.code and
// DuckDbOp.sql are routinely kilobytes each, which dominated the payload when
// every node in the project reported every input verbatim.
const INPUT_PREVIEW_CHARS = 200

// Clips long string inputs for the project-wide listing. get_node_info still
// returns inputs verbatim, so the full value is always one call away.
function previewInputs(inputs: unknown): Record<string, unknown> {
  if (typeof inputs !== 'object' || inputs === null) return {}

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputs as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > INPUT_PREVIEW_CHARS) {
      out[key] = {
        preview: value.slice(0, INPUT_PREVIEW_CHARS),
        length: value.length,
        hint: 'clipped — call get_node_info for the full value',
      }
    } else {
      out[key] = value
    }
  }
  return out
}

// How many ids a "node not found" error lists
const NOT_FOUND_SUGGESTIONS = 15

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function absoluteId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null
  const trimmed = id.trim().replace(/^\.\//, '')
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

// Zod's messages name the schema, not the fix. The common small-model mistakes get
// a sentence saying what to send instead.
function describeIssue(issue: z.core.$ZodIssue, exampleId: string): string {
  const path = issue.path.join('.')
  if (path === 'data.id') {
    return `data.id is required — the id of the node or edge, e.g. ${exampleId}`
  }
  if (path === 'type') {
    return 'type must be one of add_node, update_node, delete_node, add_edge, delete_edge'
  }
  if (path === 'data') return 'data is required and must be an object'
  return `${path || 'modification'}: ${issue.message}`
}

type TargetCheck = {
  existing: Set<string>
  known: string[]
  edgeIds: Set<string>
  addedSoFar: Set<string>
}

// null when the modification can apply, otherwise the reason it cannot
function checkTarget(
  mod: ProjectModification,
  ids: TargetCheck,
  notFound: (id: string) => string
): string | null {
  const missing = (id: string) => (ids.known.includes(id) ? null : notFound(id))
  switch (mod.type) {
    case 'add_node':
      // Even when the batch deletes it first: the editor's delete settles after
      // its add, and takes a replacement with the same id down with it
      if (ids.existing.has(mod.data.id) || ids.addedSoFar.has(mod.data.id)) {
        return `${mod.data.id} already exists; use update_node to change it or pick a new id`
      }
      return null
    case 'update_node': {
      if (!ids.known.includes(mod.data.id)) return notFound(mod.data.id)
      const { id: _id, ...changes } = mod.data
      if (Object.keys(changes).length === 0) {
        return `update_node for ${mod.data.id} changes nothing. Input values go under data.data.inputs: {"type":"update_node","data":{"id":"${mod.data.id}","data":{"inputs":{"<input name>":<value>}}}}`
      }
      return null
    }
    case 'delete_node':
      return missing(mod.data.id)
    case 'add_edge':
      return missing(mod.data.source) ?? missing(mod.data.target)
    case 'delete_edge':
      return ids.edgeIds.has(mod.data.id)
        ? null
        : `Edge not found: ${mod.data.id}. Edge ids look like /source.out.data->/target.par.data; list_nodes shows each node's connections`
  }
}

// Custom inputs a modification gives a node before its operator exists: an
// add_node's own, or an update_node's when the node is new this run. An update
// to a node that already exists does not rebuild its inputs, so it adds none.
function declaredInputs(
  mod: ProjectModification,
  isNew: (id: string) => boolean
): Array<[string, string[]]> {
  if (mod.type === 'add_node') return [[mod.data.id, customInputNames(mod.data.data)]]
  if (mod.type === 'update_node' && isNew(mod.data.id)) {
    const names = customInputNames(mod.data.data as Record<string, unknown> | undefined)
    return names.length > 0 ? [[mod.data.id, names]] : []
  }
  return []
}

// Fields the live operator has, including user-defined custom inputs the class
// does not declare. Empty for a node that exists only in this run's queue.
function liveFieldNames(nodeId: string, side: 'inputs' | 'outputs'): string[] {
  const op = getOpStore().getOp(nodeId)
  return op ? Object.keys(op[side] ?? {}) : []
}

export class MCPTools {
  private consoleErrors: ConsoleError[] = []
  private project: NoodlesProject | null = null
  // Accepted by apply_modifications but not yet in the project. The chat applies
  // edits when the run ends, so a later call in the same run has to see them.
  // Node id -> operator type, so edges and updates aimed at them can be checked
  private queuedNodes = new Map<string, string>()
  private queuedEdges = new Set<string>()
  // Custom inputs a queued add_node declared, which an edge may target before
  // the node exists
  private queuedCustomInputs = new Map<string, string[]>()

  constructor(private contextLoader?: ContextLoader) {
    this.setupConsoleTracking()
  }

  // Set current project for MCP tools to access
  setProject(project: NoodlesProject) {
    this.project = project
    // The project can change mid-run for unrelated reasons, so only what has
    // landed stops being queued
    for (const node of project.nodes ?? []) {
      this.queuedNodes.delete(node.id)
      this.queuedCustomInputs.delete(node.id)
    }
    for (const edge of project.edges ?? []) this.queuedEdges.delete(edge.id)
  }

  // Called when a run starts. Whatever the last run queued has landed or never
  // will (the request failed, or the editor rejected the batch), and an id left
  // here would block the retry as "already exists".
  clearQueuedModifications() {
    this.queuedNodes.clear()
    this.queuedEdges.clear()
    this.queuedCustomInputs.clear()
  }

  getProject(): NoodlesProject | null {
    return this.project
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
    if (!this.contextLoader) return false
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
      const codeIndex = this.contextLoader?.getCodeIndex()

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
      const codeIndex = this.contextLoader?.getCodeIndex()
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
      const registry = this.contextLoader?.getOperatorRegistry()
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
      const registry = this.contextLoader?.getOperatorRegistry()
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

  // Search documentation, or fetch one topic in full by id
  async getDocumentation(params: {
    query?: string
    id?: string
    section?: 'users' | 'developers' | 'ai-assistant' | 'examples'
  }): Promise<ToolResult> {
    try {
      const docsIndex = this.contextLoader?.getDocsIndex()

      if (!docsIndex) {
        return { success: false, error: 'Docs index not loaded' }
      }

      // An id is an exact fetch: the caller already knows which topic it wants
      // and needs the whole thing rather than an excerpt.
      if (params.id) {
        const topic = docsIndex.topics[params.id]
        if (!topic) {
          return {
            success: false,
            error: `No documentation topic with id "${params.id}". Search by query to find valid ids.`,
          }
        }
        return { success: true, data: topic }
      }

      const query = params.query?.trim()
      if (!query) {
        return { success: false, error: 'get_documentation requires either a query or an id' }
      }

      const scored = searchDocumentation(docsIndex, query, params.section)

      if (scored.length === 0) {
        return {
          success: true,
          data: {
            query,
            results: [],
            message: 'No documentation matched. Try fewer or more general terms.',
          },
        }
      }

      // Excerpts rather than whole pages: a docs page runs to tens of thousands
      // of characters, so returning five in full would overrun the result budget
      // and be clipped at an arbitrary point. The id pulls one in full.
      return {
        success: true,
        data: {
          query,
          results: scored,
          hint: 'Call get_documentation with an id to read that topic in full.',
        },
      }
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
      // Use runtime loader to lazily load the full example
      const { getExample } = await import('./runtime-examples-loader')
      const example = await getExample(params.id)

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
      const examples = this.contextLoader?.getExamples()
      if (!examples) {
        return { success: false, error: 'Examples not loaded' }
      }

      let results = Object.values(examples.examples)

      if (params.category) {
        results = results.filter(ex => ex.category === params.category)
      }

      if (params.tag) {
        const tag = params.tag
        results = results.filter(ex => ex.tags.includes(tag))
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
      const codeIndex = this.contextLoader?.getCodeIndex()
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
      // A hidden tab stops drawing: the map never loads, or the canvas still shows the
      // frame from before the last edit. Either way the screenshot would mislead.
      if (document.visibilityState === 'hidden') {
        return {
          success: false,
          error:
            'The Noodles tab is hidden, so the browser has paused drawing. Bring the tab to the front (macOS: open -a "Google Chrome") and try again.',
        }
      }
      const canvas = this.getCanvas()
      if (!canvas) {
        return {
          success: false,
          error:
            'Canvas not available. The map has not finished loading; wait a few seconds and try again.',
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
        // Deck.gl layers have a static layerName property that is minification-safe
        type: layer.constructor.layerName || 'Unknown',
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

  // Validate modifications against the project before the editor sees them. The
  // chat applies them only after the run, once the user accepts them, so this
  // result is the model's only chance to learn an edit was malformed or aimed at
  // a node that does not exist.
  // Every problem in the batch is reported at once and nothing is queued.
  async applyModifications(params: { modifications: unknown[] }): Promise<ToolResult> {
    const modifications = params.modifications
    if (!Array.isArray(modifications) || modifications.length === 0) {
      return {
        success: false,
        error: 'modifications must be a non-empty array',
      }
    }

    const existing = new Set([
      ...(this.project?.nodes ?? []).map(n => n.id),
      ...this.queuedNodes.keys(),
    ])
    const edgeIds = new Set([...(this.project?.edges ?? []).map(e => e.id), ...this.queuedEdges])
    // Nodes added anywhere in the batch count, since the editor adds nodes before edges
    const added = modifications
      .filter(isRecord)
      .filter(mod => mod.type === 'add_node' && isRecord(mod.data))
      .map(mod => absoluteId((mod.data as Record<string, unknown>).id))
      .filter((id): id is string => id !== null)
    const known = [...existing, ...added]
    const exampleId = known[0] ?? '/my-node'
    const registry = this.contextLoader?.getOperatorRegistry() ?? null
    const types = new Map<string, string>([
      ...(this.project?.nodes ?? []).map(n => [n.id, n.type] as [string, string]),
      ...this.queuedNodes,
    ])

    const errors: string[] = []
    const accepted: Array<{ label: string; mod: ProjectModification }> = []
    const addedSoFar = new Set<string>()
    // A node this run creates: the editor merges updates into it before it builds
    // the operator, so custom inputs an update declares become real fields
    const isNew = (id: string) => addedSoFar.has(id) || this.queuedNodes.has(id)
    for (const [index, raw] of modifications.entries()) {
      const label = `modifications[${index}]${isRecord(raw) && typeof raw.type === 'string' ? ` (${raw.type})` : ''}`
      const parsed = ProjectModificationSchema.safeParse(
        this.resolveModificationIds(raw, known, registry)
      )
      if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => describeIssue(issue, exampleId))
        errors.push(`${label}: ${issues.join('; ')}`)
        continue
      }
      const mod = parsed.data
      const problem = this.project
        ? checkTarget(mod, { existing, known, edgeIds, addedSoFar }, id => this.nodeNotFound(id))
        : null
      if (problem) {
        errors.push(`${label}: ${problem}`)
        continue
      }
      if (mod.type === 'add_node') {
        addedSoFar.add(mod.data.id)
        types.set(mod.data.id, mod.data.type)
      }
      // The editor adds a batch's edges before deleting any, so a later
      // delete_edge may cancel one this batch adds
      if (mod.type === 'add_edge') edgeIds.add(mod.data.id)
      accepted.push({ label, mod })
    }

    // Types and handles second, once every add_node in the batch has a type an
    // edge can be checked against, wherever in the batch the edge sits
    if (registry) {
      const declared = new Map(this.queuedCustomInputs)
      for (const { mod } of accepted) {
        for (const [id, names] of declaredInputs(mod, isNew)) {
          declared.set(id, [...(declared.get(id) ?? []), ...names])
        }
      }
      const liveFields = (nodeId: string, side: 'inputs' | 'outputs') => [
        ...liveFieldNames(nodeId, side),
        ...(side === 'inputs' ? (declared.get(nodeId) ?? []) : []),
      ]
      const context = { registry, types, liveFields }
      for (const { label, mod } of accepted) {
        for (const problem of checkFields(mod, context)) errors.push(`${label}: ${problem}`)
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: `Nothing was applied. Fix these and send the whole batch again:\n${errors.join('\n')}`,
      }
    }

    const mods = accepted.map(entry => entry.mod)
    for (const mod of mods) {
      if (mod.type === 'add_node') this.queuedNodes.set(mod.data.id, mod.data.type)
      for (const [id, names] of declaredInputs(mod, isNew)) {
        this.queuedCustomInputs.set(id, [...(this.queuedCustomInputs.get(id) ?? []), ...names])
      }
      if (mod.type === 'add_edge') this.queuedEdges.add(mod.data.id)
    }

    // Returned rather than applied: the panel shows them to the user, who accepts or rejects them
    return {
      success: true,
      data: {
        modificationsCount: mods.length,
        modifications: mods,
        message: `${mods.length} modification(s) proposed. They apply when the user accepts them.`,
      },
    }
  }

  // Small models drop the leading slash or the container path ("map-range" for
  // "/map-range"). Resolves an id that names exactly one node; null otherwise.
  private resolveNodeId(raw: unknown, candidates?: string[]): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null
    const ids = candidates ?? (this.project?.nodes ?? []).map(n => n.id)
    const id = raw.trim()
    if (ids.includes(id)) return id
    const bare = id.replace(/^\.?\//, '')
    if (ids.includes(`/${bare}`)) return `/${bare}`
    const byName = ids.filter(candidate => candidate.split('/').pop() === bare)
    return byName.length === 1 ? byName[0] : null
  }

  // Names the ids that do exist, so the next call can be right rather than a guess
  private nodeNotFound(raw: unknown): string {
    const ids = (this.project?.nodes ?? []).map(n => n.id)
    const shown = String(raw)
    if (ids.length === 0) return `Node not found: ${shown}. The project has no nodes yet.`
    const token = shown.replace(/^\.?\//, '').toLowerCase()
    const similar = token ? ids.filter(id => id.toLowerCase().includes(token)) : []
    const list = (similar.length > 0 ? similar : ids).slice(0, NOT_FOUND_SUGGESTIONS)
    const more = (similar.length > 0 ? similar : ids).length - list.length
    return `Node not found: ${shown}. ${similar.length > 0 ? 'Did you mean' : 'Nodes in this project'}: ${list.join(', ')}${more > 0 ? ` (+${more} more)` : ''}. Node ids are absolute paths like ${ids[0]}.`
  }

  private resolveModificationIds(
    raw: unknown,
    known: string[],
    registry: OperatorRegistry | null
  ): unknown {
    if (!isRecord(raw) || !isRecord(raw.data)) return raw
    const data = { ...raw.data }
    const resolve = (value: unknown) => this.resolveNodeId(value, known) ?? value
    // get_node_info takes nodeId, and a small model carries the name over to
    // the edit (Qwen3.5-4B did on every failed T2 run)
    if (data.id === undefined && typeof data.nodeId === 'string') {
      data.id = data.nodeId
      delete data.nodeId
    }
    // Small models put inputs one level up, beside the id. The schema would
    // strip them silently, so move them to where the editor reads them.
    if ((raw.type === 'add_node' || raw.type === 'update_node') && isRecord(data.inputs)) {
      const nodeData = isRecord(data.data) ? data.data : {}
      const inputs = isRecord(nodeData.inputs) ? nodeData.inputs : {}
      data.data = { ...nodeData, inputs: { ...data.inputs, ...inputs } }
      delete data.inputs
    }
    switch (raw.type) {
      case 'add_node':
        data.id = absoluteId(data.id) ?? data.id
        // "File" for FileOp: the display name get_operator_schema shows beside the type
        if (registry && typeof data.type === 'string') {
          data.type = resolveOperatorType(data.type, registry)
        }
        break
      case 'update_node':
      case 'delete_node':
        data.id = resolve(data.id)
        break
      case 'add_edge': {
        const source = resolve(data.source)
        const target = resolve(data.target)
        const sourceHandle = qualifyHandle(data.sourceHandle, 'source')
        const targetHandle = qualifyHandle(data.targetHandle, 'target')
        const moved =
          source !== data.source ||
          target !== data.target ||
          sourceHandle !== data.sourceHandle ||
          targetHandle !== data.targetHandle
        Object.assign(data, { source, target, sourceHandle, targetHandle })
        // The id is derived from the endpoints, so it follows them
        if (
          (moved || data.id === undefined) &&
          typeof data.sourceHandle === 'string' &&
          typeof data.targetHandle === 'string'
        ) {
          data.id = `${source}.${data.sourceHandle}->${target}.${data.targetHandle}`
        }
        break
      }
    }
    return { ...raw, data }
  }

  // Evaluate JavaScript in CodeOp's sandbox. The implementation lives in run-code.ts
  // because it needs nothing from this class — it is here so the tool definitions and
  // WebMCP keep reaching every tool through one surface.
  async runCode(params: RunCodeParams): Promise<ToolResult> {
    return runCode(params)
  }

  // Video export. The job and the file output live in export-video.ts; the renderer
  // is reached through the exporter the editor registers in render/video-export.ts.
  async exportVideo(params: ExportVideoParams): Promise<ToolResult> {
    return exportVideo(params)
  }

  async getExportStatus(params: ExportStatusParams): Promise<ToolResult> {
    return getExportStatus(params)
  }

  // The project data directory. Same arrangement as runCode: the path guard and the
  // storage calls live in agent-files.ts, these are forwarders so every tool is
  // reachable through one surface.
  async listFiles(params: ListFilesParams): Promise<ToolResult> {
    return listFiles(params)
  }

  async readFile(params: ReadFileParams): Promise<ToolResult> {
    return readFile(params)
  }

  async writeFile(params: WriteFileParams): Promise<ToolResult> {
    return writeFile(params)
  }

  async grepFiles(params: GrepFilesParams): Promise<ToolResult> {
    return grepFiles(params)
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
      const nodeId = this.resolveNodeId(params.nodeId) ?? params.nodeId
      const operator = getOpStore().getOp(nodeId)

      if (!operator) {
        return {
          success: false,
          error: this.project
            ? this.nodeNotFound(params.nodeId)
            : `Operator not found: ${params.nodeId}. Make sure the node exists and has been executed.`,
        }
      }

      // Get the output data from the operator
      const outputData: Record<string, unknown> = {}
      // biome-ignore lint/suspicious/noExplicitAny: dynamic operator outputs object
      const outputs = (operator as any).outputs || {}
      const { displayName } = operator.constructor as typeof Operator

      for (const [key, field] of Object.entries(outputs) as [string, unknown][]) {
        const value =
          field && typeof field === 'object' && 'value' in field
            ? (field as Record<string, unknown>).value
            : undefined
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
        } else if (data && typeof data === 'object' && 'features' in data) {
          // GeoJSON
          const geoJsonData = data as { features: unknown[] }
          totalRows = geoJsonData.features.length
          sample = {
            ...data,
            features: geoJsonData.features.slice(0, maxRows),
          }
        }

        return {
          success: true,
          data: {
            nodeId,
            operatorType: displayName,
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
          nodeId,
          operatorType: displayName,
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

        // Position is omitted deliberately: it is layout-only noise for the
        // model, and get_node_info still reports it when actually needed
        return {
          id: node.id,
          type: node.type,
          inputs: previewInputs(node.data?.inputs),
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

      // Role groupings carry ids only. They used to re-serialize the whole node
      // objects, duplicating the bulk of the payload for no extra information.
      return {
        success: true,
        data: {
          nodes,
          totalCount: nodes.length,
          byType,
          dataNodeIds: nodes
            .filter(n => ['FileOp', 'JSONOp', 'DuckDbOp', 'CSVOp'].includes(n.type))
            .map(n => n.id),
          layerNodeIds: nodes.filter(n => n.type.includes('Layer')).map(n => n.id),
          rendererNodeIds: nodes
            .filter(n => ['DeckRendererOp', 'OutOp'].includes(n.type))
            .map(n => n.id),
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

      const nodeId = this.resolveNodeId(params.nodeId)
      const node = (this.project.nodes || []).find(n => n.id === nodeId)
      if (!node) {
        return {
          success: false,
          error: this.nodeNotFound(params.nodeId),
        }
      }

      const operator = getOpStore().getOp(node.id)
      const edges = this.project.edges || []

      // Find incoming and outgoing edges
      const incomingEdges = edges.filter(e => e.target === node.id)
      const outgoingEdges = edges.filter(e => e.source === node.id)

      // Get execution state
      // biome-ignore lint/suspicious/noExplicitAny: executionState is a dynamic operator property not in type definitions
      const executionState = operator ? (operator as any).executionState?.value : null

      // Get available inputs and outputs from operator schema
      const registry = this.contextLoader?.getOperatorRegistry()
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

  // Get the current timeline state
  getTimeline(): ToolResult {
    try {
      const store = getTimelineStore()
      const tracks: Record<
        string,
        {
          keyframes: Array<{ id: string; position: number; value: unknown; interpolation: string }>
        }
      > = {}

      for (const [trackId, track] of store.tracks) {
        tracks[trackId] = {
          keyframes: track.keyframes.map((kf: Keyframe) => ({
            id: kf.id,
            position: kf.position,
            value: kf.value,
            interpolation: kf.interpolation,
          })),
        }
      }

      return {
        success: true,
        data: {
          sequence: {
            length: store.sequence.length,
            fps: store.sequence.fps,
            inPoint: store.sequence.inPoint,
            outPoint: store.sequence.outPoint,
          },
          position: store.position,
          playing: store.playing,
          trackCount: store.tracks.size,
          tracks,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get timeline state',
      }
    }
  }

  // Add or update a keyframe on an animated field.
  // Writes directly to useTimelineStore.setState so that both track creation
  // and keyframe insertion land in a single undo entry (addKeyframe() fires
  // its own internal history entry after track creation, leaving a ghost track
  // on undo — bypassing it here fixes that).
  setKeyframe(params: {
    trackId: string
    position: number
    value: unknown
    interpolation?: 'bezier' | 'hold'
  }): ToolResult {
    try {
      const { trackId, position, value, interpolation = 'bezier' } = params
      const kfValue = value as KeyframeValue
      const store = getTimelineStore()
      const frameDuration = 1 / store.sequence.fps

      // Capture before ANY mutation so undo covers the full operation
      const before = captureTimelineState()

      const existingTrack = store.tracks.get(trackId)
      const nearbyKf = existingTrack?.keyframes.find(
        (kf: Keyframe) => Math.abs(kf.position - position) < frameDuration
      )

      if (nearbyKf) {
        // Update in place — updateKeyframe has no internal history, so we fire it
        store.updateKeyframe(trackId, nearbyKf.id, { value: kfValue, interpolation })
        fireTimelineMutation('Update keyframe via AI', before)
        return {
          success: true,
          data: { keyframeId: nearbyKf.id, action: 'updated', trackId, position, value },
        }
      }

      // Add new keyframe — write directly so track creation + insertion share one undo entry
      const keyframeId = `kf_${Math.random().toString(36).slice(2, 10)}`
      const newKf: Keyframe = { id: keyframeId, position, value: kfValue, interpolation }

      useTimelineStore.setState(state => {
        const newTracks = new Map(state.tracks)
        const track = newTracks.get(trackId)
        if (track) {
          const keyframes = [...track.keyframes, newKf].sort(
            (a: Keyframe, b: Keyframe) => a.position - b.position
          )
          newTracks.set(trackId, { ...track, keyframes })
        } else {
          const newTrack: Track = {
            id: trackId,
            fieldPath: trackId,
            keyframes: [newKf],
            defaultValue: kfValue,
          }
          newTracks.set(trackId, newTrack)
        }
        return { tracks: newTracks }
      })

      fireTimelineMutation('Add keyframe via AI', before)
      return { success: true, data: { keyframeId, action: 'added', trackId, position, value } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set keyframe',
      }
    }
  }

  // Delete a keyframe by ID
  deleteKeyframe(params: { trackId: string; keyframeId: string }): ToolResult {
    try {
      const { trackId, keyframeId } = params
      const store = getTimelineStore()
      const track = store.tracks.get(trackId)

      if (!track) {
        return { success: false, error: `Track not found: ${trackId}` }
      }

      const exists = track.keyframes.some((kf: Keyframe) => kf.id === keyframeId)
      if (!exists) {
        return { success: false, error: `Keyframe not found: ${keyframeId}` }
      }

      store.deleteKeyframe(trackId, keyframeId)
      return { success: true, data: { deleted: keyframeId, trackId } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete keyframe',
      }
    }
  }

  // Set the current playback position (scrub to a time)
  setPlaybackPosition(params: { position: number; play?: boolean }): ToolResult {
    try {
      const store = getTimelineStore()
      const clamped = Math.max(0, Math.min(params.position, store.sequence.length))
      store.setPosition(clamped)
      if (params.play === true) store.play()
      else if (params.play === false) store.pause()
      // Re-read store after mutations — the snapshot in `store` is stale
      return { success: true, data: { position: clamped, playing: getTimelineStore().playing } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set playback position',
      }
    }
  }

  // Private helper methods

  private validateProject(project: NoodlesProject): ToolResult {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic issue structure
    const issues: any[] = []
    const registry = this.contextLoader?.getOperatorRegistry()

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
