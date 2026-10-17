import { beforeEach, describe, expect, it } from 'vitest'
import { BrushableHistogramOp } from './operators'

// Mock d3 for tests
const mockBin = (domain: [number, number], thresholds: number) => {
  return (data: unknown[]) => {
    const [min, max] = domain
    const binWidth = (max - min) / thresholds
    const bins: Array<{
      x0: number
      x1: number
      length: number
      values: unknown[]
    }> = []

    for (let i = 0; i < thresholds; i++) {
      bins.push({
        x0: min + i * binWidth,
        x1: min + (i + 1) * binWidth,
        length: 0,
        values: [],
      })
    }

    // Assign data to bins
    data.forEach(d => {
      const value = typeof d === 'object' && d !== null ? (d as Record<string, number>).value : 0
      const binIndex = Math.min(
        Math.floor(((value - min) / (max - min)) * thresholds),
        thresholds - 1
      )
      if (binIndex >= 0 && binIndex < thresholds) {
        bins[binIndex].values.push(d)
        bins[binIndex].length++
      }
    })

    return bins
  }
}

const mockD3 = {
  extent: (data: unknown[], accessor: (d: unknown) => number | null) => {
    const values = data.map(accessor).filter((v): v is number => v !== null)
    if (values.length === 0) return [undefined, undefined]
    return [Math.min(...values), Math.max(...values)]
  },
  bin: () => ({
    domain: (d: [number, number]) => ({
      thresholds: (t: number) => ({
        value: (_accessor: (d: unknown) => number | null) => mockBin(d, t),
      }),
    }),
  }),
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).d3 = mockD3
})

describe('BrushableHistogramOp', () => {
  describe('empty data handling', () => {
    it('should return empty results for empty data array', () => {
      const op = new BrushableHistogramOp('/test')
      const result = op.execute({
        data: [],
        field: 'value',
        binCount: 20,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result.filteredData).toEqual([])
      expect(result.binData).toEqual([])
      expect(result.extent).toEqual([0, 0])
    })

    it('should return empty results when field is not provided', () => {
      const op = new BrushableHistogramOp('/test')
      const result = op.execute({
        data: [{ value: 10 }, { value: 20 }],
        field: '',
        binCount: 20,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result.filteredData).toEqual([])
      expect(result.binData).toEqual([])
      expect(result.extent).toEqual([0, 0])
    })
  })

  describe('histogram calculation', () => {
    it('should calculate histogram bins correctly', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }, { value: 50 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 5,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result.extent).toEqual([10, 50])
      expect(result.binData).toHaveLength(5)
      expect(result.binData.every(bin => typeof bin.count === 'number')).toBe(true)
      expect(result.binData.every(bin => typeof bin.x0 === 'number')).toBe(true)
      expect(result.binData.every(bin => typeof bin.x1 === 'number')).toBe(true)
    })

    it('should handle single value data', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 42 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result.extent).toEqual([42, 42])
      expect(result.filteredData).toHaveLength(1)
    })

    it('should handle negative values', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: -50 }, { value: -25 }, { value: 0 }, { value: 25 }, { value: 50 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: -100,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result.extent).toEqual([-50, 50])
      expect(result.filteredData).toHaveLength(5)
    })
  })

  describe('brush filtering', () => {
    it('should filter data within brush range', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 3, value: 30 },
        { id: 4, value: 40 },
        { id: 5, value: 50 },
      ]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 20,
        brushMax: 40,
        brushMode: 'handles',
      })

      expect(result.filteredData).toHaveLength(3)
      expect(result.filteredData).toEqual([
        { id: 2, value: 20 },
        { id: 3, value: 30 },
        { id: 4, value: 40 },
      ])
    })

    it('should include boundary values', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { value: 20 }, { value: 30 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 20,
        brushMax: 30,
        brushMode: 'handles',
      })

      expect(result.filteredData).toHaveLength(2)
    })

    it('should return empty array when brush range excludes all data', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { value: 20 }, { value: 30 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 50,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result.filteredData).toEqual([])
    })

    it('should handle brushMode parameter (UI-only, does not affect filtering)', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { value: 20 }, { value: 30 }]

      const resultHandles = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 15,
        brushMax: 25,
        brushMode: 'handles',
      })

      const resultOffset = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 15,
        brushMax: 25,
        brushMode: 'offset',
      })

      // Both modes should produce identical results
      expect(resultHandles.filteredData).toEqual(resultOffset.filteredData)
      expect(resultHandles.binData).toEqual(resultOffset.binData)
    })
  })

  describe('edge cases', () => {
    it('should handle data with missing field values', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { other: 20 }, { value: 30 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      // Should only include items with the field
      expect(result.filteredData.length).toBeLessThanOrEqual(2)
    })

    it('should handle NaN values gracefully', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { value: Number.NaN }, { value: 30 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      // Should filter out NaN values
      expect(result.filteredData.every(d => !Number.isNaN((d as { value: number }).value))).toBe(
        true
      )
    })

    it('should handle very large bin counts', () => {
      const op = new BrushableHistogramOp('/test')
      const data = Array.from({ length: 1000 }, (_, i) => ({ value: i }))

      const result = op.execute({
        data,
        field: 'value',
        binCount: 100,
        brushMin: 0,
        brushMax: 1000,
        brushMode: 'handles',
      })

      expect(result.binData).toHaveLength(100)
      expect(result.filteredData).toHaveLength(1000)
    })

    it('should handle inverted brush range (min > max)', () => {
      const op = new BrushableHistogramOp('/test')
      const data = [{ value: 10 }, { value: 20 }, { value: 30 }]

      const result = op.execute({
        data,
        field: 'value',
        binCount: 10,
        brushMin: 30,
        brushMax: 10,
        brushMode: 'handles',
      })

      // Should return empty when range is inverted
      expect(result.filteredData).toEqual([])
    })
  })

  describe('data reactivity', () => {
    it('should recalculate when data changes', () => {
      const op = new BrushableHistogramOp('/test')

      const data1 = [{ value: 10 }, { value: 20 }]
      const result1 = op.execute({
        data: data1,
        field: 'value',
        binCount: 10,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      const data2 = [{ value: 30 }, { value: 40 }, { value: 50 }]
      const result2 = op.execute({
        data: data2,
        field: 'value',
        binCount: 10,
        brushMin: 0,
        brushMax: 100,
        brushMode: 'handles',
      })

      expect(result1.extent).toEqual([10, 20])
      expect(result2.extent).toEqual([30, 50])
      expect(result1.filteredData).toHaveLength(2)
      expect(result2.filteredData).toHaveLength(3)
    })
  })
})
