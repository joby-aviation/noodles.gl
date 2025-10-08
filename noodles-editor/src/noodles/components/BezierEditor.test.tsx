import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

import BezierEditor, { type Stop } from './BezierEditor'

expect.extend(matchers)

describe('BezierEditor', () => {
  const mockOnChangeStops = vi.fn()
  const mockOnChangeActiveStop = vi.fn()
  const defaultStops: Stop[] = [
    { id: '1', pos: 0, val: 0 },
    { id: '2', pos: 1, val: 1 },
  ]

  beforeEach(() => {
    mockOnChangeStops.mockClear()
  })

  it('renders an SVG element', () => {
    const { container } = render(
      <BezierEditor
        stops={defaultStops}
        onChangeStops={mockOnChangeStops}
        onChangeActiveStop={mockOnChangeActiveStop}
      />
    )
    const svgElement = container.querySelector('svg')
    expect(svgElement).toBeInTheDocument()
  })

  it('renders initial stops as circles', () => {
    const { container } = render(
      <BezierEditor
        stops={defaultStops}
        onChangeStops={mockOnChangeStops}
        onChangeActiveStop={mockOnChangeActiveStop}
        width={200}
        height={100}
        padding={10}
      />
    )

    expect(container.querySelector('svg')).toBeInTheDocument()

    const circles = container.querySelectorAll('circle.stop-circle')
    expect(circles.length).toBe(defaultStops.length)
  })

  it('calls onChangeStops when a stop is added (simulated by background click)', () => {
    const { container } = render(
      <BezierEditor
        stops={defaultStops}
        onChangeStops={mockOnChangeStops}
        onChangeActiveStop={mockOnChangeActiveStop}
      />
    )
    const backgroundRect = container.querySelector('rect[fill="transparent"]')! // Find the clickable background

    expect(backgroundRect).toBeInTheDocument()

    fireEvent.click(backgroundRect, { clientX: 30, clientY: 10 })
    expect(mockOnChangeStops).toHaveBeenCalled()
    expect(mockOnChangeStops).toHaveBeenCalledWith([
      defaultStops[0],
      { id: expect.any(String), pos: 0.0625, val: 4.5 },
      defaultStops[1],
    ])
  })
})
