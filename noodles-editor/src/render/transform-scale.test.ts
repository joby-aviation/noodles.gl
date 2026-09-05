import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateFitScale, getTransformScaleFactor, TransformScale } from './transform-scale'

describe('calculateFitScale', () => {
  it('fits within the panel content box with 8px on each side', () => {
    expect(calculateFitScale(1000, 600, 1920, 1080)).toBeCloseTo(984 / 1920)
    expect(calculateFitScale(500, 1000, 1920, 1080)).toBeCloseTo(484 / 1920)
  })

  it('never enlarges the fixed-resolution surface', () => {
    expect(calculateFitScale(2000, 1200, 800, 600)).toBe(1)
  })
})

describe('getTransformScaleFactor', () => {
  it('returns {x: 1, y: 1} for elements with no transform', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    expect(getTransformScaleFactor(element)).toEqual({ x: 1, y: 1 })
  })

  it('extracts scale correctly from transform: scale(2)', () => {
    const element = document.createElement('div')
    element.style.transform = 'scale(2)'
    document.body.appendChild(element)
    expect(getTransformScaleFactor(element)).toEqual({ x: 2, y: 2 })
  })

  it('extracts scale correctly from transform: scale(0.5, 1.5)', () => {
    const element = document.createElement('div')
    element.style.transform = 'scale(0.5, 1.5)'
    document.body.appendChild(element)
    expect(getTransformScaleFactor(element)).toEqual({ x: 0.5, y: 1.5 })
  })

  it('handles scale when multiple transforms are present', () => {
    const element = document.createElement('div')
    element.style.transform = 'scaleX(1.5) scaleY(2)'
    document.body.appendChild(element)
    expect(getTransformScaleFactor(element)).toEqual({ x: 1.5, y: 2 })
  })
})

describe('TransformScale', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('observes the panel and untransformed surface and recomputes Fit scale', () => {
    const callbacks: ResizeObserverCallback[] = []
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    const { container } = render(
      createElement(
        'div',
        { style: { position: 'relative', width: 1000, height: 600 } },
        createElement(
          TransformScale,
          { scale: 0.3, scaleMode: 'fit' },
          createElement('div', { style: { width: 1920, height: 1080 } })
        )
      )
    )

    const stage = container.querySelector<HTMLElement>('.transform-scale-stage')!
    const surface = container.querySelector<HTMLElement>('.transform-scale')!
    let panelWidth = 1000
    Object.defineProperties(stage, {
      clientWidth: { get: () => panelWidth },
      clientHeight: { get: () => 600 },
    })
    Object.defineProperties(surface, {
      offsetWidth: { get: () => 1920 },
      offsetHeight: { get: () => 1080 },
    })
    act(() => callbacks[0]([], {} as ResizeObserver))
    expect(surface.style.transform).toBe(`scale(${984 / 1920})`)

    panelWidth = 500
    act(() => callbacks[0]([], {} as ResizeObserver))
    expect(Number(surface.style.transform.match(/scale\(([^)]+)\)/)?.[1])).toBeCloseTo(484 / 1920)
    expect(stage.dataset.scaleMode).toBe('fit')
    expect(surface.style.transformOrigin).toBe('center center')
  })

  it('uses the saved manual scale without fitting', () => {
    const { container } = render(
      createElement(
        'div',
        { style: { position: 'relative', width: 1000, height: 600 } },
        createElement(
          TransformScale,
          { scale: 0.65, scaleMode: 'manual' },
          createElement('div', { style: { width: 1920, height: 1080 } })
        )
      )
    )

    const surface = container.querySelector<HTMLElement>('.transform-scale')!
    expect(surface.style.transform).toBe('scale(0.65)')
    expect(surface.style.transformOrigin).toBe('left top')
  })
})
