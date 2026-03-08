import { describe, expect, it } from 'vitest'
import { Float32ArrayPool } from './buffer-pool'

describe('Float32ArrayPool', () => {
  it('should acquire new buffers when pool is empty', () => {
    const pool = new Float32ArrayPool()
    const buffer = pool.acquire(100)
    expect(buffer).toBeInstanceOf(Float32Array)
    expect(buffer.length).toBe(100)
  })

  it('should reuse released buffers', () => {
    const pool = new Float32ArrayPool()
    const buffer1 = pool.acquire(100)
    pool.release(buffer1)
    const buffer2 = pool.acquire(100)
    expect(buffer2).toBe(buffer1)
  })

  it('should not reuse buffers of different sizes', () => {
    const pool = new Float32ArrayPool()
    const buffer1 = pool.acquire(100)
    pool.release(buffer1)
    const buffer2 = pool.acquire(200)
    expect(buffer2).not.toBe(buffer1)
    expect(buffer2.length).toBe(200)
  })

  it('should track stats correctly', () => {
    const pool = new Float32ArrayPool()
    expect(pool.stats()).toEqual({ pooled: 0, inUse: 0, totalBytes: 0 })

    const buffer1 = pool.acquire(100)
    expect(pool.stats().inUse).toBe(1)
    expect(pool.stats().pooled).toBe(0)

    pool.release(buffer1)
    expect(pool.stats().inUse).toBe(0)
    expect(pool.stats().pooled).toBe(1)
  })

  it('should clear all buffers', () => {
    const pool = new Float32ArrayPool()
    const buffer1 = pool.acquire(100)
    pool.release(buffer1)
    pool.acquire(200)

    pool.clear()
    expect(pool.stats()).toEqual({ pooled: 0, inUse: 0, totalBytes: 0 })
  })

  it('should ignore releasing unknown buffers', () => {
    const pool = new Float32ArrayPool()
    const unknownBuffer = new Float32Array(100)
    pool.release(unknownBuffer) // Should not throw
    expect(pool.stats().pooled).toBe(0)
  })
})
