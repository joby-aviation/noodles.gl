// MCPTools - Client-side tool implementations for Claude AI

import { OPERATOR_INDEX } from '@noodles.gl/planner'
import { currentEngine, errorsOf } from '../editor/doc-engine'
import { docStore } from '../editor/doc-store'
import { safeStringify } from '../noodles/utils/serialization'
import { getTimelineStore } from '../timeline/timeline-store'
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
import type { DocToolContext } from './doc-tools'
import * as docTools from './doc-tools'
import {
  type ExportStatusParams,
  type ExportVideoParams,
  exportVideo,
  getExportStatus,
} from './export-video'
import { type RunCodeParams, runCode } from './run-code'
import type {
  ConsoleError,
  FileIndex,
  NoodlesProject,
  SearchCodeParams,
  SearchCodeResult,
  ToolResult,
} from './types'

const MAX_DOC_RESULTS = 5
const DOC_EXCERPT_CHARS = 600

// Words too common in a docs query to discriminate between topics
const DOC_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'in',
  'on',
  'and',
  'or',
  'is',
  'it',
  'how',
  'do',
  'does',
  'can',
  'my',
  'me',
  'with',
  'what',
  'when',
  'why',
  'use',
  'using',
  'noodles',
  'should',
  'would',
  'could',
  'want',
  'need',
  'get',
  'set',
  'make',
  'best',
  'any',
  'some',
  'this',
  'that',
])

function docTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 1 && !DOC_STOP_WORDS.has(term))
}

// Per-term scoring, rather than matching the whole query as one substring: a
// natural question like "how do I animate opacity over time" shares no literal
// substring with any page, so whole-query matching found nothing. matchIndex is
// where to centre the excerpt.
function scoreTopic(
  topic: { title: string; content: string; headings: Array<{ text: string }> },
  query: string
): { score: number; matchIndex: number } {
  const terms = docTerms(query)
  if (terms.length === 0) return { score: 0, matchIndex: 0 }

  const title = topic.title.toLowerCase()
  const content = topic.content.toLowerCase()
  const headings = topic.headings.map(h => h.text.toLowerCase())

  let score = 0
  let matchIndex = -1

  for (const term of terms) {
    if (title.includes(term)) score += 8
    if (headings.some(heading => heading.includes(term))) score += 3

    // Presence only, not occurrence count. Counting repeats let the longest
    // pages (the changelog above all) outrank the topic actually about the
    // subject, purely by mentioning every word somewhere.
    const found = content.indexOf(term)
    if (found !== -1) {
      score += 1
      if (matchIndex === -1 || found < matchIndex) matchIndex = found
    }
  }

  // Every term present is a much stronger signal than the same score spread
  // across a subset of them
  const allTermsPresent = terms.every(
    term => title.includes(term) || content.includes(term) || headings.some(h => h.includes(term))
  )
  if (allTermsPresent && terms.length > 1) score += 4

  return { score, matchIndex: Math.max(0, matchIndex) }
}

// A window of content centred on the match, snapped outward to line boundaries
// so the excerpt does not start or end mid-word
function excerptAround(content: string, matchIndex: number): string {
  if (content.length <= DOC_EXCERPT_CHARS) return content

  const half = Math.floor(DOC_EXCERPT_CHARS / 2)
  let start = Math.max(0, matchIndex - half)
  let end = Math.min(content.length, start + DOC_EXCERPT_CHARS)

  const lineStart = content.lastIndexOf('\n', start)
  if (lineStart !== -1 && start - lineStart < 120) start = lineStart + 1

  const lineEnd = content.indexOf('\n', end)
  if (lineEnd !== -1 && lineEnd - end < 120) end = lineEnd

  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  return `${prefix}${content.slice(start, end)}${suffix}`
}

/** The editor's document, engine and playhead: what the tools act on in the app. */
export function editorDocContext(): DocToolContext {
  return {
    store: docStore(),
    engine: currentEngine,
    playhead: {
      position: () => getTimelineStore().position,
      playing: () => getTimelineStore().playing,
      seek: seconds => getTimelineStore().setPosition(seconds),
      play: () => getTimelineStore().play(),
      pause: () => getTimelineStore().pause(),
    },
  }
}

export class MCPTools {
  private consoleErrors: ConsoleError[] = []
  private project: NoodlesProject | null = null
  private doc: DocToolContext

  constructor(
    private contextLoader?: ContextLoader,
    doc?: DocToolContext
  ) {
    this.doc = doc ?? editorDocContext()
    this.setupConsoleTracking()
  }

  // The graph tools read the editor's document, not a project passed in. Kept for the chat
  // and WebMCP callers that still hand one over.
  setProject(project: NoodlesProject) {
    this.project = project
  }

  // Edits apply as they are made, so a run has nothing queued to forget.
  clearQueuedModifications() {}

  getProject(): NoodlesProject | null {
    return this.project
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

  // --- graph tools, on the document (doc-tools.ts) ---------------------------------

  async listNodes(): Promise<ToolResult> {
    return docTools.listNodes(this.doc)
  }

  async getNodeInfo(params: { nodeId: string }): Promise<ToolResult> {
    return docTools.getNodeInfo(this.doc, params)
  }

  async getNodeOutput(params: { nodeId: string; maxRows?: number }): Promise<ToolResult> {
    return docTools.getNodeOutput(this.doc, params)
  }

  async getCurrentProject(): Promise<ToolResult> {
    return docTools.getCurrentProject(this.doc)
  }

  async applyModifications(params: { modifications: unknown[] }): Promise<ToolResult> {
    return docTools.applyModifications(this.doc, params)
  }

  async listOperators(params: { category?: string }): Promise<ToolResult> {
    return docTools.listOperators(params)
  }

  async getOperatorSchema(params: { type: string }): Promise<ToolResult> {
    return docTools.getOperatorSchema(params)
  }

  // Problems the engine found: nodes that lowered to nothing, failed queries, host errors,
  // and nodes nothing reads.
  async analyzeProject(_params?: unknown): Promise<ToolResult> {
    const { doc } = this.doc.store.get()
    const issues: { nodeId: string; severity: 'error' | 'warning'; message: string }[] = []
    const e = this.doc.engine()
    for (const err of e ? errorsOf(e) : []) {
      issues.push({ nodeId: err.nodeId, severity: 'error', message: err.message })
    }
    const read = new Set(doc.edges.map(edge => edge.source))
    for (const n of doc.nodes) {
      const op = OPERATOR_INDEX.get(n.op)
      if (!op) issues.push({ nodeId: n.id, severity: 'error', message: `Unknown operator ${n.op}` })
      else if (op.outputs.length && !read.has(n.id) && n.op !== 'deck') {
        issues.push({
          nodeId: n.id,
          severity: 'warning',
          message: `${n.name ?? n.id}: nothing reads its output`,
        })
      }
    }
    return { success: true, data: { issues } }
  }

  getTimeline(): ToolResult {
    return docTools.getTimeline(this.doc)
  }

  setKeyframe(params: Parameters<typeof docTools.setKeyframe>[1]): ToolResult {
    return docTools.setKeyframe(this.doc, params)
  }

  deleteKeyframe(params: Parameters<typeof docTools.deleteKeyframe>[1]): ToolResult {
    return docTools.deleteKeyframe(this.doc, params)
  }

  setPlaybackPosition(params: { position: number; play?: boolean }): ToolResult {
    return docTools.setPlaybackPosition(this.doc, params)
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

  // Private helper methods

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
