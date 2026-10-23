import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../../utils/analytics'
import { BrushableHistogramOp, type Operator } from '../../operators'
import { BrushableHistogramDialog } from '../brushable-histogram-op'

vi.mock('../../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

function createOp() {
  const op = new BrushableHistogramOp('/histogram') as Operator<BrushableHistogramOp>
  const data = Array.from({ length: 11 }, (_, i) => ({ value: i * 10 }))
  op.inputs.data.setValue(data)
  op.inputs.field.setValue('value')
  op.inputs.brushMin.setValue(20)
  op.inputs.brushMax.setValue(80)
  const result = op.execute(
    {
      data,
      field: 'value',
      binCount: 10,
      brushMin: 20,
      brushMax: 80,
      brushMode: 'handles',
    },
    op.env
  )
  op.outputs.filteredData.setValue(result.filteredData)
  op.outputs.binData.setValue(result.binData)
  op.outputs.extent.setValue(result.extent)
  return op
}

describe('BrushableHistogramDialog', () => {
  afterEach(() => {
    cleanup()
    vi.mocked(analytics.track).mockClear()
  })

  it('associates each control with its label', () => {
    const op = createOp()
    render(<BrushableHistogramDialog op={op} open onOpenChange={() => {}} />)

    expect(screen.getByLabelText('Mode').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Min')).toHaveProperty('value', '20.00')
    expect(screen.getByLabelText('Max')).toHaveProperty('value', '80.00')

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'offset' } })
    expect(screen.getByLabelText('Center')).toHaveProperty('type', 'range')
    expect(screen.getByLabelText('Width')).toHaveProperty('type', 'range')
  })

  it('titles the chart with the field and brush range', () => {
    const op = createOp()
    render(<BrushableHistogramDialog op={op} open onOpenChange={() => {}} />)

    const title = screen.getByLabelText('Min').ownerDocument.querySelector('svg > title')
    expect(title?.textContent).toBe('Histogram of value, brushed from 20.00 to 80.00')
  })

  it('exposes the brush handles as keyboard-operable sliders', () => {
    const op = createOp()
    render(<BrushableHistogramDialog op={op} open onOpenChange={() => {}} />)

    const minHandle = screen.getByRole('slider', { name: 'Brush minimum' })
    const maxHandle = screen.getByRole('slider', { name: 'Brush maximum' })
    expect(minHandle.getAttribute('aria-valuenow')).toBe('20')
    expect(minHandle.getAttribute('aria-valuemax')).toBe('80')
    expect(maxHandle.getAttribute('aria-valuemin')).toBe('20')
    expect(minHandle.getAttribute('tabindex')).toBe('0')

    // Arrow keys step by 1% of the extent, Shift by 10%
    act(() => {
      fireEvent.keyDown(minHandle, { key: 'ArrowRight' })
    })
    expect(op.inputs.brushMin.value).toBe(21)
    act(() => {
      fireEvent.keyDown(minHandle, { key: 'ArrowLeft', shiftKey: true })
    })
    expect(op.inputs.brushMin.value).toBe(11)

    // The dialog re-renders from the field, not from a stale read
    expect(minHandle.getAttribute('aria-valuenow')).toBe('11')

    // Home/End jump to the extent, but a handle never crosses the other one
    act(() => {
      fireEvent.keyDown(minHandle, { key: 'End' })
    })
    expect(op.inputs.brushMin.value).toBe(80)
    act(() => {
      fireEvent.keyDown(maxHandle, { key: 'End' })
    })
    expect(op.inputs.brushMax.value).toBe(100)
    act(() => {
      fireEvent.keyDown(minHandle, { key: 'Home' })
    })
    expect(op.inputs.brushMin.value).toBe(0)
  })

  it('keeps the brush width when the center moves to an edge', () => {
    const op = createOp()
    op.inputs.brushMode.setValue('offset')
    render(<BrushableHistogramDialog op={op} open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByLabelText('Center'), { target: { value: '85' } })
    expect([op.inputs.brushMin.value, op.inputs.brushMax.value]).toEqual([40, 100])

    fireEvent.change(screen.getByLabelText('Center'), { target: { value: '50' } })
    expect([op.inputs.brushMin.value, op.inputs.brushMax.value]).toEqual([20, 80])
  })

  it('maps a drag to the right value when the chart is scaled down', () => {
    const op = createOp()
    render(<BrushableHistogramDialog op={op} open onOpenChange={() => {}} />)

    // Half the chart's 700-unit width, as on a narrow window
    const title = screen.getByLabelText('Min').ownerDocument.querySelector('svg > title')
    const svg = title?.parentElement as unknown as SVGSVGElement
    svg.style.width = '350px'
    svg.style.height = 'auto'
    const rect = svg.getBoundingClientRect()
    expect(rect.width).toBeLessThan(400)

    const maxHandle = screen.getByRole('slider', { name: 'Brush maximum' })
    fireEvent.mouseDown(maxHandle)
    // 50 sits 365 of 700 viewBox units across (left margin plus half the plot)
    fireEvent.mouseMove(document, { clientX: rect.left + (365 / 700) * rect.width })
    fireEvent.mouseUp(document)

    expect(op.inputs.brushMax.value).toBeCloseTo(50, 0)
  })

  it('tracks opening when the parent sets open', () => {
    const op = createOp()
    const { rerender } = render(
      <BrushableHistogramDialog op={op} open={false} onOpenChange={() => {}} />
    )
    expect(analytics.track).not.toHaveBeenCalled()

    rerender(<BrushableHistogramDialog op={op} open onOpenChange={() => {}} />)
    expect(analytics.track).toHaveBeenCalledWith('brushable_histogram_opened')
  })
})
