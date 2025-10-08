import { describe, expect, it } from 'vitest'
import { getTransformScaleFactor } from './transform-scale'

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
