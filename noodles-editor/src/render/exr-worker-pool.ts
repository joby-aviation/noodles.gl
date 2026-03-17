// Worker pool for parallel EXR encoding. Manages a pool of workers and
// handles request queuing with backpressure.

import type { ExrEncodeError, ExrEncodeRequest, ExrEncodeResponse } from './exr-worker'
import type { Float32ArrayPool } from './buffer-pool'

interface PendingRequest {
  resolve: (data: Uint8Array) => void
  reject: (error: Error) => void
  rgbaBuffer: Float32Array
  depthBuffer: Float32Array | null
  bufferPool: Float32ArrayPool
}

interface QueuedTask {
  request: ExrEncodeRequest
  pending: PendingRequest
}

export class ExrWorkerPool {
  private workers: Worker[] = []
  private pending: Map<number, PendingRequest> = new Map()
  private nextId = 0
  private idleWorkers: Worker[] = []
  private queue: QueuedTask[] = []

  constructor(poolSize: number = navigator.hardwareConcurrency || 4) {
    console.log(`[ExrWorkerPool] Creating pool with ${poolSize} workers`)
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(new URL('./exr-worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = this.handleResponse.bind(this, worker)
      worker.onerror = this.handleError.bind(this, worker)
      this.workers.push(worker)
      this.idleWorkers.push(worker)
    }
    console.log(`[ExrWorkerPool] Pool created`)
  }

  private handleResponse(
    worker: Worker,
    event: MessageEvent<ExrEncodeResponse | ExrEncodeError>
  ) {
    const data = event.data
    console.log(`[ExrWorkerPool] Received response id=${data.id}`, 'error' in data ? data.error : 'ok')
    const request = this.pending.get(data.id)

    if (request) {
      this.pending.delete(data.id)
      // Return buffers to pool for reuse
      request.bufferPool.release(data.rgbaPixels)
      if (data.depth) request.bufferPool.release(data.depth)

      if ('error' in data && data.error) {
        request.reject(new Error(data.error))
      } else {
        request.resolve((data as ExrEncodeResponse).exrData)
      }
    }

    // Return worker to idle pool and process next queued task
    this.idleWorkers.push(worker)
    this.processQueue()
  }

  private handleError(_worker: Worker, event: ErrorEvent) {
    console.error('[ExrWorkerPool] Worker error:', event.message)
    // In practice, errors should be rare since encoding is deterministic
  }

  private processQueue() {
    while (this.idleWorkers.length > 0 && this.queue.length > 0) {
      const task = this.queue.shift()!
      const worker = this.idleWorkers.pop()!
      this.dispatch(worker, task.request, task.pending)
    }
  }

  private dispatch(worker: Worker, request: ExrEncodeRequest, pending: PendingRequest) {
    this.pending.set(request.id, pending)
    const transfers: Transferable[] = [request.rgbaPixels.buffer]
    if (request.depth) transfers.push(request.depth.buffer)
    console.log(`[ExrWorkerPool] Dispatching id=${request.id} to worker`)
    worker.postMessage(request, transfers)
  }

  // Encode a frame. Buffers are transferred to worker (zero-copy) and returned
  // to the pool after encoding completes.
  encode(
    width: number,
    height: number,
    rgbaPixels: Float32Array,
    depth: Float32Array | null,
    compression: 'none' | 'zip' | 'piz',
    bufferPool: Float32ArrayPool
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const request: ExrEncodeRequest = {
        id,
        width,
        height,
        rgbaPixels,
        depth,
        compression,
      }
      const pending: PendingRequest = {
        resolve,
        reject,
        rgbaBuffer: rgbaPixels,
        depthBuffer: depth,
        bufferPool,
      }

      if (this.idleWorkers.length > 0) {
        const worker = this.idleWorkers.pop()!
        this.dispatch(worker, request, pending)
      } else {
        // Queue for later when a worker becomes available
        this.queue.push({ request, pending })
      }
    })
  }

  // Number of pending + queued encode operations
  pendingCount(): number {
    return this.pending.size + this.queue.length
  }

  terminate(): void {
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.idleWorkers = []
    // Reject any pending requests
    for (const request of this.pending.values()) {
      request.reject(new Error('Worker pool terminated'))
    }
    this.pending.clear()
    for (const task of this.queue) {
      task.pending.reject(new Error('Worker pool terminated'))
    }
    this.queue = []
  }
}
