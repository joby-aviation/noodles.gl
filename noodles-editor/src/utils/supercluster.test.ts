import * as turf from '@turf/turf'
import { describe, expect, it } from 'vitest'
import { supercluster } from './supercluster'

// Two groups about 1 km across, about 4,000 km apart, plus a line to ignore
const groups = turf.featureCollection<GeoJSON.Geometry>([
  turf.point([-74.0, 40.7], { name: 'a1' }),
  turf.point([-74.01, 40.71], { name: 'a2' }),
  turf.point([-74.02, 40.7], { name: 'a3' }),
  turf.point([-118.24, 34.05], { name: 'b1' }),
  turf.point([-118.25, 34.06], { name: 'b2' }),
  turf.lineString([
    [0, 0],
    [1, 1],
  ]),
])
const options = { radius: 40, maxZoom: 16, minPoints: 2 }

describe('supercluster', () => {
  it('merges nearby points into clusters at low zoom', () => {
    const { features } = supercluster(groups, { ...options, zoom: 3 })

    expect(features.map(f => f.properties?.point_count).sort()).toEqual([2, 3])
    for (const feature of features) {
      expect(feature.properties).toMatchObject({ cluster: true })
      expect(feature.properties?.expansion_zoom).toBeGreaterThan(3)
    }
  })

  it('returns the original points above maxZoom, ignoring other geometry', () => {
    const { features } = supercluster(groups, { ...options, zoom: 17 })

    expect(features.map(f => f.properties?.name).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2'])
  })

  it('keeps a point whose own properties have cluster keys', () => {
    const labeled = turf.featureCollection([
      turf.point([0, 0], { cluster: true, cluster_id: 7, point_count: 3 }),
    ])
    const { features } = supercluster(labeled, { ...options, zoom: 0 })

    expect(features).toEqual(labeled.features)
  })

  it('returns an empty collection for empty input', () => {
    const { features } = supercluster(turf.featureCollection([]), { ...options, zoom: 3 })
    expect(features).toEqual([])
  })
})
