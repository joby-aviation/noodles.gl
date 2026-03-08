// Float32Array pool to eliminate per-frame allocations during EXR sequence export.
// Buffers are reused across frames to reduce GC pressure.

export class Float32ArrayPool {
  private pools: Map<number, Float32Array[]> = new Map()
  private inUse: Set<Float32Array> = new Set()

  // Acquire a buffer of the given size from the pool, or create a new one
  acquire(size: number): Float32Array {
    const pool = this.pools.get(size)
    if (pool && pool.length > 0) {
      const buffer = pool.pop()!
      this.inUse.add(buffer)
      return buffer
    }
    const buffer = new Float32Array(size)
    this.inUse.add(buffer)
    return buffer
  }

  // Release a buffer back to the pool for reuse
  release(buffer: Float32Array): void {
    if (!this.inUse.has(buffer)) return
    this.inUse.delete(buffer)
    const size = buffer.length
    if (!this.pools.has(size)) {
      this.pools.set(size, [])
    }
    this.pools.get(size)!.push(buffer)
  }

  // Clear all pools (call when render sequence ends)
  clear(): void {
    this.pools.clear()
    this.inUse.clear()
  }

  // Get stats for debugging
  stats(): { pooled: number; inUse: number; totalBytes: number } {
    let pooled = 0
    let totalBytes = 0
    for (const [size, pool] of this.pools) {
      pooled += pool.length
      totalBytes += size * 4 * pool.length
    }
    totalBytes += Array.from(this.inUse).reduce((sum, buf) => sum + buf.byteLength, 0)
    return { pooled, inUse: this.inUse.size, totalBytes }
  }
}
