import {
  FirstPersonView,
  _GlobeView as GlobeView,
  MapView,
  OrbitView,
  OrthographicView,
} from '@deck.gl/core'
import { describe, expect, it } from 'vitest'
import type { DeckViewDescriptor } from '../types'
import { instantiateDeckView } from './deck-view'

describe('instantiateDeckView', () => {
  it.each([
    ['MapView', MapView],
    ['GlobeView', GlobeView],
    ['FirstPersonView', FirstPersonView],
    ['OrbitView', OrbitView],
    ['OrthographicView', OrthographicView],
  ] as const)('instantiates a %s descriptor', (type, ViewClass) => {
    const descriptor: DeckViewDescriptor = { type, id: 'test-view', width: '50%' }
    const view = instantiateDeckView(descriptor)

    expect(view).toBeInstanceOf(ViewClass)
    expect(view.props).toMatchObject({ id: 'test-view', width: '50%' })
    expect(view.props).not.toHaveProperty('type')
  })

  it('preserves existing View instances from custom operators', () => {
    const existingView = new MapView({ id: 'custom-map-view' })

    expect(instantiateDeckView(existingView)).toBe(existingView)
  })
})
