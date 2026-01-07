// Integration module for pull-based renderer
// Manages the pull-based execution system initialization

import { PullRenderer } from './pull-renderer'
import { DependencyGraph, type Edge } from './dependency-graph'

// Global pull renderer instance
let pullRenderer: PullRenderer | null = null

// Initialize pull-based execution system
export function initializePullSystem(): void {
  // Create pull renderer
  pullRenderer = new PullRenderer({
    targetFPS: 60,
    enableParallel: true,
    enableProfiling: false,
    batchDelay: 16, // ~1 frame at 60fps
  })

  // Start the renderer
  startPullRenderer()

  // Expose globally for debugging
  if (typeof window !== 'undefined') {
    ;(window as any).__noodlesPullRenderer = pullRenderer
  }
}

// Start the pull renderer
export function startPullRenderer(): void {
  if (!pullRenderer) {
    initializePullSystem()
  }

  if (pullRenderer && !pullRenderer.isRunning) {
    console.log('🚀 Starting pull-based renderer')
    pullRenderer.start()
  }
}

// Stop the pull renderer
export function stopPullRenderer(): void {
  if (pullRenderer && pullRenderer.isRunning) {
    console.log('🛑 Stopping pull-based renderer')
    pullRenderer.stop()
  }
}

// Update dependency graph from edges
// Should be called whenever the graph structure changes
export function updateDependencyGraph(edges: Edge[]): void {
  if (!pullRenderer) {
    initializePullSystem()
  }

  if (pullRenderer) {
    pullRenderer.updateGraph(edges)
  }
}

// Get current pull renderer instance
export function getPullRenderer(): PullRenderer | null {
  return pullRenderer
}

// Force update all operators (mark all dirty)
export function forceUpdate(): void {
  if (pullRenderer) {
    pullRenderer.forceUpdate()
  }
}

// Get performance metrics
export function getPerformanceMetrics() {
  if (pullRenderer) {
    return pullRenderer.getMetrics()
  }
  return null
}

// Performance monitoring hook
export function startPerformanceMonitoring(intervalMs: number = 1000): () => void {
  const interval = setInterval(() => {
    const metrics = getPerformanceMetrics()
    if (metrics && metrics.frameTime > 0) {
      console.log('⚡ Performance:', {
        frameTime: `${metrics.frameTime.toFixed(2)}ms`,
        fps: `${(1000 / Math.max(1, metrics.frameTime)).toFixed(1)}`,
        executions: metrics.executionCount,
        cacheHitRate: `${(
          (metrics.cacheHits / Math.max(1, metrics.cacheHits + metrics.cacheMisses)) *
          100
        ).toFixed(1)}%`,
        dirty: metrics.dirtyCount,
        total: metrics.totalOperators,
      })
    }
  }, intervalMs)

  return () => clearInterval(interval)
}

// Debug helper to visualize execution order
export function getExecutionOrder(): string[] | null {
  if (pullRenderer) {
    return pullRenderer.getExecutionOrder()
  }
  return null
}

// Check if adding an edge would create a cycle
export function wouldCreateCycle(sourceId: string, targetId: string): boolean {
  if (pullRenderer) {
    return pullRenderer.wouldCreateCycle(sourceId, targetId)
  }
  return false
}

// Auto-initialize on module load
if (typeof window !== 'undefined') {
  // Initialize after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePullSystem)
  } else {
    initializePullSystem()
  }
}