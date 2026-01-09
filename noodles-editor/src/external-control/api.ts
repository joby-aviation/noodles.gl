// External Control API
// High-level API for external tools to control Noodles

import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import type { ConsoleError } from '../ai-chat/types'
import type { PipelineHandle, PipelineSpec, TestResult, ValidationResult } from './pipeline-tools'
import { toolRegistry } from './tool-adapter'
import {
  cleanup as bridgeCleanup,
  connect as bridgeConnect,
  disconnect as bridgeDisconnect,
  off as bridgeOff,
  on as bridgeOn,
  initializeWorkerBridge,
} from './worker-bridge'

export interface ExternalControlConfig {
  host?: string
  port?: number
  autoConnect?: boolean
  debug?: boolean
}

export interface Point {
  x: number
  y: number
}

export interface ExecutionResult {
  success: boolean
  result?: unknown
  error?: Error
  executionTime: number
}

export interface RenderStats {
  fps: number
  frameTime: number
  layerCount: number
  [key: string]: unknown
}

export interface NodeState {
  id: string
  type: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  status: 'idle' | 'running' | 'error'
  [key: string]: unknown
}

export interface DebugInfo {
  errors: ConsoleError[]
  warnings: ConsoleError[]
  stats: RenderStats
  nodeStates: Record<string, NodeState>
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface ProjectState {
  nodes: ReactFlowNode<Record<string, unknown>>[]
  edges: ReactFlowEdge[]
  viewport: ViewportState
  editorSettings?: Record<string, unknown>
}

export interface NodeHandle {
  id: string
  type: string
  position: Point
}

export interface Screenshot {
  data: string // base64 encoded image
  format: 'png' | 'jpeg'
  width: number
  height: number
}

// Main external control API class
export class ExternalControl {
  private config: ExternalControlConfig
  private isConnected = false
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>()

  constructor(config: ExternalControlConfig = {}) {
    this.config = {
      host: 'localhost',
      port: 8765,
      autoConnect: false,
      debug: false,
      ...config,
    }
  }

  // Initialize and optionally connect
  async initialize(): Promise<void> {
    try {
      // Initialize the worker bridge
      await initializeWorkerBridge()

      // Set up event handlers
      bridgeOn('status', this.handleStatusChange.bind(this))
      bridgeOn('error', this.handleError.bind(this))
      bridgeOn('stateChange', this.handleStateChange.bind(this))

      if (this.config.autoConnect) {
        await this.connect()
      }
    } catch (error) {
      this.log('error', 'Failed to initialize external control:', error)
      throw error
    }
  }

  // Connect to external control server
  async connect(host?: string, port?: number): Promise<void> {
    const connectHost = host || this.config.host
    const connectPort = port || this.config.port

    this.log('info', `Connecting to ${connectHost}:${connectPort}`)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridgeOff('status', statusHandler)
        reject(new Error('Connection timeout'))
      }, 10000)

      const statusHandler = (data: unknown) => {
        const statusData = data as { connected: boolean }
        if (statusData.connected) {
          clearTimeout(timeout)
          bridgeOff('status', statusHandler)
          this.isConnected = true
          this.log('info', 'Connected successfully')
          resolve()
        }
      }

      bridgeOn('status', statusHandler)
      bridgeConnect(connectHost, connectPort)
    })
  }

  // Disconnect from external control server
  async disconnect(): Promise<void> {
    this.log('info', 'Disconnecting')
    bridgeDisconnect()
    this.isConnected = false
  }

  // ==================== Pipeline Operations ====================

  // Create a data pipeline from specification
  async createPipeline(spec: PipelineSpec): Promise<string> {
    this.ensureConnected()

    const result = await this.executeTool('createPipeline', {
      spec,
      options: {
        validateFirst: true,
      },
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to create pipeline')
    }

    const handle = result.result as PipelineHandle
    return handle.id
  }

  // Run a pipeline
  async runPipeline(id: string): Promise<ExecutionResult> {
    this.ensureConnected()

    // Trigger pipeline execution by getting its output
    const result = await this.executeTool('getNodeOutput', {
      nodeId: id,
      outputName: 'result',
    })

    return {
      success: result.success,
      result: result.result,
      error: result.error ? new Error(result.error.message) : undefined,
      executionTime: result.executionTime,
    }
  }

  // Test a pipeline with sample data
  async testPipeline(id: string, testData: unknown[]): Promise<TestResult> {
    this.ensureConnected()

    const result = await this.executeTool('testPipeline', {
      pipelineId: id,
      testData,
      options: {
        timeout: 30000,
        captureIntermediateResults: true,
      },
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to test pipeline')
    }

    return result.result as TestResult
  }

  // Validate a pipeline
  async validatePipeline(id: string): Promise<ValidationResult> {
    this.ensureConnected()

    const result = await this.executeTool('validatePipeline', {
      pipelineId: id,
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to validate pipeline')
    }

    return result.result as ValidationResult
  }

  // Debug a pipeline
  async debugPipeline(id: string): Promise<DebugInfo> {
    this.ensureConnected()

    const [errors, stats, pipeline] = await Promise.all([
      this.executeTool('getConsoleErrors', { limit: 20 }),
      this.executeTool('getRenderStats', {}),
      this.executeTool('getPipelineInfo', { pipelineId: id }),
    ])

    const nodeStates: Record<string, NodeState> = {}

    if (pipeline.success && pipeline.result) {
      const handle = pipeline.result as PipelineHandle
      for (const nodeId of handle.nodes) {
        const nodeInfo = await this.executeTool('getNodeInfo', { nodeId })
        if (nodeInfo.success) {
          nodeStates[nodeId] = nodeInfo.result as NodeState
        }
      }
    }

    return {
      errors: (errors.result as ConsoleError[]) || [],
      warnings: [],
      stats: (stats.result as RenderStats) || { fps: 0, frameTime: 0, layerCount: 0 },
      nodeStates,
    }
  }

  // ==================== Node Operations ====================

  // Add a node to the project
  async addNode(type: string, position: Point, config?: Record<string, unknown>): Promise<string> {
    this.ensureConnected()

    const result = await this.executeTool('createNode', {
      type,
      position,
      inputs: config || {},
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to add node')
    }

    const nodeResult = result.result as { nodeId: string }
    return nodeResult.nodeId
  }

  // Connect two nodes
  async connectNodes(
    source: string,
    target: string,
    sourceField = 'out.result',
    targetField = 'par.data'
  ): Promise<void> {
    this.ensureConnected()

    const result = await this.executeTool('connectNodes', {
      sourceId: source,
      targetId: target,
      sourceField,
      targetField,
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to connect nodes')
    }
  }

  // Delete a node
  async deleteNode(id: string): Promise<void> {
    this.ensureConnected()

    const result = await this.executeTool('deleteNode', {
      nodeId: id,
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to delete node')
    }
  }

  // ==================== Data Operations ====================

  // Upload a data file
  async uploadDataFile(
    filename: string,
    content: string | ArrayBuffer,
    mimeType = 'text/csv'
  ): Promise<string> {
    this.ensureConnected()

    const result = await this.executeTool('uploadDataFile', {
      filename,
      content: typeof content === 'string' ? content : this.arrayBufferToBase64(content),
      mimeType,
      encoding: typeof content === 'string' ? 'utf-8' : 'base64',
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to upload data file')
    }

    const uploadResult = result.result as { url: string }
    return uploadResult.url
  }

  // ==================== State Operations ====================

  // Get current project state
  async getProjectState(): Promise<ProjectState> {
    this.ensureConnected()

    const result = await this.executeTool('getCurrentProject', {})

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get project state')
    }

    return result.result as ProjectState
  }

  // Get node outputs
  async getNodeOutputs(nodeId: string): Promise<unknown> {
    this.ensureConnected()

    const result = await this.executeTool('getNodeOutput', {
      nodeId,
      outputName: 'result',
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get node outputs')
    }

    return result.result
  }

  // List available operator types
  async listAvailableOperators(): Promise<
    Record<string, { name: string; displayName: string; description: string }>
  > {
    this.ensureConnected()

    const result = await this.executeTool('listOperatorTypes', {})

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to list operators')
    }

    return result.result as Record<
      string,
      { name: string; displayName: string; description: string }
    >
  }

  // Capture a screenshot of the visualization
  async captureVisualization(format: 'png' | 'jpeg' = 'png', quality = 0.9): Promise<Screenshot> {
    this.ensureConnected()

    const result = await this.executeTool('captureVisualization', {
      format,
      quality,
    })

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to capture visualization')
    }

    return result.result as Screenshot
  }

  // ==================== Event Handling ====================

  // Subscribe to state changes
  onStateChange(callback: (state: ProjectState) => void): void {
    this.on('stateChange', (data: unknown) => {
      callback(data as ProjectState)
    })
  }

  // Subscribe to errors
  onError(callback: (error: Error) => void): void {
    this.on('error', (data: unknown) => {
      const errorData = data as { message?: string }
      callback(new Error(errorData.message || 'Unknown error'))
    })
  }

  // Subscribe to connection status changes
  onStatusChange(callback: (connected: boolean) => void): void {
    this.on('status', (data: unknown) => {
      const statusData = data as { connected: boolean }
      callback(statusData.connected)
    })
  }

  // ==================== Private Methods ====================

  // Execute a tool
  private async executeTool(
    tool: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean
    result?: unknown
    error?: { message: string; code?: string; details?: unknown }
    executionTime: number
  }> {
    return toolRegistry.execute(tool, args)
  }

  // Ensure connected
  private ensureConnected(): void {
    if (!this.isConnected) {
      throw new Error('Not connected to external control server')
    }
  }

  // Handle status change
  private handleStatusChange(data: unknown): void {
    const statusData = data as { connected: boolean }
    this.isConnected = statusData.connected
    this.emit('status', data)
  }

  // Handle error
  private handleError(data: unknown): void {
    this.log('error', 'Error received:', data)
    this.emit('error', data)
  }

  // Handle state change
  private handleStateChange(data: unknown): void {
    this.emit('stateChange', data)
  }

  // Subscribe to events
  private on(event: string, handler: (data: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  // Emit event
  private emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => {
        handler(data)
      })
    }
  }

  // Log message
  private log(level: 'info' | 'error' | 'debug', ...args: unknown[]): void {
    if (this.config.debug || level === 'error') {
      console[level]('[ExternalControl]', ...args)
    }
  }

  // Convert ArrayBuffer to base64
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  // Clean up resources
  dispose(): void {
    this.disconnect()
    bridgeCleanup()
    this.eventHandlers.clear()
  }
}

// Export default instance
export const externalControl = new ExternalControl()
