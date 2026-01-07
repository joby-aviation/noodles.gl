// Pull-based renderer for Noodles.gl
// Manages RAF-based pull loop and coordinates operator execution

import type { IOperator, Operator } from './operators'
import { DependencyGraph, type Edge } from './dependency-graph'
import { getAllOps, getOp } from './store'
import type { OpId } from './utils/id-utils'

export interface PullRendererOptions {
  // Target frame rate (default 60)
  targetFPS?: number
  // Enable parallel execution of independent operators
  enableParallel?: boolean
  // Enable performance monitoring
  enableProfiling?: boolean
  // Batch delay for dirty marking (ms)
  batchDelay?: number
}

export interface PerformanceMetrics {
  frameTime: number
  executionCount: number
  cacheHits: number
  cacheMisses: number
  dirtyCount: number
  totalOperators: number
}

// PullRenderer manages the pull-based execution model
// It runs a RAF loop that pulls from root operators on each frame
export class PullRenderer {
  private graph: DependencyGraph
  private rafId: number | null = null
  private isPulling: boolean = false
  private options: Required<PullRendererOptions>

  // Performance tracking
  private metrics: PerformanceMetrics = {
    frameTime: 0,
    executionCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    dirtyCount: 0,
    totalOperators: 0,
  }

  // Batch dirty marking
  private dirtyQueue: Set<Operator<IOperator>> = new Set()
  private batchTimeout: number | null = null

  // Frame timing
  private lastFrameTime: number = 0
  private frameInterval: number

  constructor(options: PullRendererOptions = {}) {
    this.graph = new DependencyGraph()
    this.options = {
      targetFPS: options.targetFPS ?? 60,
      enableParallel: options.enableParallel ?? true,
      enableProfiling: options.enableProfiling ?? false,
      batchDelay: options.batchDelay ?? 16, // ~1 frame at 60fps
    }
    this.frameInterval = 1000 / this.options.targetFPS
  }

  // Start the pull-based rendering loop
  start(): void {
    if (this.rafId !== null) {
      return // Already running
    }

    this.lastFrameTime = performance.now()
    this.pullLoop()
  }

  // Stop the rendering loop
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
  }

  // Main pull loop - runs on animation frame
  private pullLoop = (): void => {
    const currentTime = performance.now()
    const deltaTime = currentTime - this.lastFrameTime

    // Throttle to target FPS
    if (deltaTime >= this.frameInterval) {
      this.lastFrameTime = currentTime - (deltaTime % this.frameInterval)

      if (!this.isPulling) {
        this.isPulling = true
        this.pullFrame().finally(() => {
          this.isPulling = false
        })
      }
    }

    this.rafId = requestAnimationFrame(this.pullLoop)
  }

  // Pull a single frame - executes all necessary operators
  async pullFrame(): Promise<void> {
    const frameStart = performance.now()

    try {
      // Reset frame metrics
      if (this.options.enableProfiling) {
        this.metrics.executionCount = 0
        this.metrics.cacheHits = 0
        this.metrics.cacheMisses = 0
        this.metrics.dirtyCount = 0
      }

      // Find root operators to pull from
      const roots = this.findRootOperators()

      if (this.options.enableParallel) {
        // Pull roots in parallel
        await Promise.all(roots.map(op => this.pullOperator(op)))
      } else {
        // Pull roots sequentially
        for (const op of roots) {
          await this.pullOperator(op)
        }
      }

      // Update frame time metric
      if (this.options.enableProfiling) {
        this.metrics.frameTime = performance.now() - frameStart
        this.metrics.totalOperators = getAllOps().length
      }
    } catch (error) {
      console.error('Frame pull error:', error)
    }
  }

  // Pull a single operator and track metrics
  private async pullOperator(op: Operator<IOperator>): Promise<unknown> {
    if (this.options.enableProfiling) {
      const wasDirty = op.pullExecutionStatus === 'dirty'

      const result = await op.pull()

      if (wasDirty) {
        this.metrics.executionCount++
        this.metrics.cacheMisses++
      } else {
        this.metrics.cacheHits++
      }

      return result
    } else {
      return op.pull()
    }
  }

  // Find root operators to pull from
  // These are typically DeckRendererOp, OutOp, or operators with no downstream dependents
  private findRootOperators(): Operator<IOperator>[] {
    const roots: Operator<IOperator>[] = []
    const ops = getAllOps()

    for (const op of ops) {
      const opType = (op.constructor as any).displayName

      // Check for specific root operator types
      if (
        opType === 'DeckRenderer' ||
        opType === 'Out' ||
        opType === 'Viewer' ||
        opType === 'ConsoleOp'
      ) {
        roots.push(op)
      } else {
        // Also include operators with no downstream dependents
        const downstream = this.graph.getDownstream(op.id)
        if (downstream.size === 0) {
          // But only if they have upstream dependencies (not isolated)
          const upstream = this.graph.getUpstream(op.id)
          if (upstream.size > 0) {
            roots.push(op)
          }
        }
      }
    }

    return roots
  }

  // Mark an operator as dirty with optional batching
  markDirty(opId: OpId): void {
    const op = getOp(opId)
    if (!op) return

    if (this.options.batchDelay > 0) {
      // Add to batch queue
      this.dirtyQueue.add(op)

      if (this.batchTimeout === null) {
        this.batchTimeout = window.setTimeout(() => this.flushDirtyQueue(), this.options.batchDelay)
      }
    } else {
      // Mark immediately
      op.markDirty()
      if (this.options.enableProfiling) {
        this.metrics.dirtyCount++
      }
    }
  }

  // Flush the dirty queue - mark all queued operators as dirty
  private flushDirtyQueue(): void {
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }

    for (const op of this.dirtyQueue) {
      op.markDirty()
      if (this.options.enableProfiling) {
        this.metrics.dirtyCount++
      }
    }

    this.dirtyQueue.clear()
  }

  // Update the dependency graph from edges
  updateGraph(edges: Edge[]): void {
    this.graph.buildFromEdges(edges)
  }

  // Get current performance metrics
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }

  // Get dependency graph statistics
  getGraphStatistics() {
    return this.graph.getStatistics()
  }

  // Check if renderer is running
  get isRunning(): boolean {
    return this.rafId !== null
  }

  // Force a pull on next frame (mark all operators dirty)
  forceUpdate(): void {
    const ops = getAllOps()
    for (const op of ops) {
      op.markDirty()
    }
  }

  // Get the dependency graph (for debugging)
  getGraph(): DependencyGraph {
    return this.graph
  }

  // Execute operators in parallel levels for optimal performance
  async executeParallelLevels(): Promise<void> {
    const levels = this.graph.getParallelExecutionLevels()

    for (const level of levels) {
      const operators = level
        .map(id => getOp(id))
        .filter((op): op is Operator<IOperator> => op !== null)

      // Execute all operators in this level in parallel
      await Promise.all(operators.map(op => this.pullOperator(op)))
    }
  }

  // Get execution order for debugging
  getExecutionOrder(): OpId[] {
    return this.graph.getTopologicalOrder()
  }

  // Check if adding an edge would create a cycle
  wouldCreateCycle(sourceId: OpId, targetId: OpId): boolean {
    return this.graph.wouldCreateCycle(sourceId, targetId)
  }
}