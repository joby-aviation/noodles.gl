import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Plot from '@observablehq/plot'
import { analytics } from '../utils/analytics'
import { ChartOp } from './operators'

vi.mock('@observablehq/plot', async importOriginal => {
  const actual = await importOriginal<typeof import('@observablehq/plot')>()
  return {
    ...actual,
    plot: vi.fn(actual.plot),
  }
})

// Mock analytics
vi.mock('../utils/analytics', () => ({
  analytics: {
    captureException: vi.fn(),
    initialize: vi.fn(),
    track: vi.fn(),
  },
}))

describe('ChartOp error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null chart when data is empty', () => {
    const op = new ChartOp('/test')
    const result = op.execute({
      data: [],
      chartType: 'bar',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeNull()
    expect(analytics.captureException).not.toHaveBeenCalled()
  })

  it('should return null chart when xField is empty', () => {
    const op = new ChartOp('/test')
    const result = op.execute({
      data: [{ x: 1, y: 2 }],
      chartType: 'bar',
      xField: '',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeNull()
    expect(analytics.captureException).not.toHaveBeenCalled()
  })

  it('should return null chart when yField is empty for bar chart', () => {
    const op = new ChartOp('/test')
    const result = op.execute({
      data: [{ x: 1, y: 2 }],
      chartType: 'bar',
      xField: 'x',
      yField: '',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeNull()
    expect(analytics.captureException).not.toHaveBeenCalled()
  })

  it('should allow empty yField for histogram', () => {
    const op = new ChartOp('/test')
    const result = op.execute({
      data: [{ x: 1 }, { x: 2 }, { x: 3 }],
      chartType: 'histogram',
      xField: 'x',
      yField: '',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    // Histogram should work with just xField
    expect(result.chart).not.toBeNull()
  })

  it('should generate chart with valid inputs', () => {
    const op = new ChartOp('/test')
    const result = op.execute({
      data: [
        { x: 'A', y: 10 },
        { x: 'B', y: 20 },
      ],
      chartType: 'bar',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: 'Test Chart',
      xLabel: 'X Axis',
      yLabel: 'Y Axis',
    })

    expect(result.chart).not.toBeNull()
    expect(result.chart).toBeInstanceOf(HTMLElement)
    expect(analytics.captureException).not.toHaveBeenCalled()
  })

  it('should capture exception if Observable Plot throws', () => {
    const op = new ChartOp('/test')

    const plotError = new Error('Plot failed')
    vi.mocked(Plot.plot).mockImplementationOnce(() => {
      throw plotError
    })

    const result = op.execute({
      data: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      chartType: 'scatter',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    // Should return null on error
    expect(result.chart).toBeNull()

    // Should capture the exception with context
    expect(analytics.captureException).toHaveBeenCalledWith(
      plotError,
      expect.objectContaining({
        source: 'chart_op',
        chartType: 'scatter',
        hasData: true,
        hasXField: true,
        hasYField: true,
        dataLength: 2,
      })
    )
  })

  it('should handle scatter plot with valid data', () => {
    const op = new ChartOp('/test')
    const result = op.execute({
      data: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      chartType: 'scatter',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).not.toBeNull()
    expect(analytics.captureException).not.toHaveBeenCalled()
  })
})
