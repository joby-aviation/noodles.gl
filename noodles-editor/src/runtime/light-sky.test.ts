// The deck's Sky and Light, as the map's light and sky (#884)
import type { DocNode } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { lightAndSky } from './engine'

const deck = (params: DocNode['params']): DocNode => ({
  id: 'deck',
  op: 'deck',
  x: 0,
  y: 0,
  params,
})

describe('lightAndSky', () => {
  it('sets neither when both are off, so the style keeps its own', () => {
    expect(lightAndSky(deck({}))).toEqual({})
    expect(lightAndSky(deck({ skyColor: [1, 2, 3], lightPolar: 10 }))).toEqual({})
  })

  it('makes a sky from the deck, with defaults for what it leaves out', () => {
    expect(lightAndSky(deck({ sky: true, skyColor: [255, 0, 0] })).sky).toEqual({
      enabled: true,
      skyColor: 'rgb(255, 0, 0)',
      horizonColor: 'rgb(255, 255, 255)',
      skyHorizonBlend: 0.8,
      atmosphereBlend: 0.5,
    })
  })

  it('makes a light from the deck', () => {
    expect(lightAndSky(deck({ light: true, lightAnchor: 'map', lightPolar: 60 })).light).toEqual({
      anchor: 'map',
      azimuthal: 210,
      polar: 60,
    })
  })
})
