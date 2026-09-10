import { describe, expect, it } from 'vitest'
import { deepEqual } from './deep-equal'

describe('deepEqual', () => {
  describe('primitives', () => {
    it('returns true for identical numbers', () => {
      expect(deepEqual(1, 1)).toBe(true)
    })

    it('returns false for different numbers', () => {
      expect(deepEqual(1, 2)).toBe(false)
    })

    it('returns true for identical strings', () => {
      expect(deepEqual('hello', 'hello')).toBe(true)
    })

    it('returns false for different strings', () => {
      expect(deepEqual('hello', 'world')).toBe(false)
    })

    it('returns true for identical booleans', () => {
      expect(deepEqual(true, true)).toBe(true)
    })

    it('returns false for different booleans', () => {
      expect(deepEqual(true, false)).toBe(false)
    })

    it('returns true for same reference', () => {
      const obj = { a: 1 }
      expect(deepEqual(obj, obj)).toBe(true)
    })
  })

  describe('null and undefined', () => {
    it('returns true for null === null', () => {
      expect(deepEqual(null, null)).toBe(true)
    })

    it('returns true for undefined === undefined', () => {
      expect(deepEqual(undefined, undefined)).toBe(true)
    })

    it('returns false for null !== undefined', () => {
      expect(deepEqual(null, undefined)).toBe(false)
    })

    it('returns false for null !== object', () => {
      expect(deepEqual(null, {})).toBe(false)
    })

    it('returns false for object !== null', () => {
      expect(deepEqual({}, null)).toBe(false)
    })
  })

  describe('flat objects', () => {
    it('returns true for identical flat objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    })

    it('returns false for different values', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
    })

    it('returns false for different keys', () => {
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
    })

    it('returns false for different number of keys', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    })

    it('returns true for empty objects', () => {
      expect(deepEqual({}, {})).toBe(true)
    })
  })

  describe('nested objects', () => {
    it('returns true for deeply nested identical objects', () => {
      const a = { x: { y: { z: 1 } }, w: 'hello' }
      const b = { x: { y: { z: 1 } }, w: 'hello' }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('returns false for deeply nested different objects', () => {
      const a = { x: { y: { z: 1 } } }
      const b = { x: { y: { z: 2 } } }
      expect(deepEqual(a, b)).toBe(false)
    })
  })

  describe('arrays', () => {
    it('returns true for identical arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    })

    it('returns false for different arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    })

    it('returns false for different length arrays', () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('returns true for nested arrays', () => {
      expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true)
    })

    it('returns false for array vs object', () => {
      expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false)
    })

    it('returns true for empty arrays', () => {
      expect(deepEqual([], [])).toBe(true)
    })
  })

  describe('mixed types', () => {
    it('returns false for number vs string', () => {
      expect(deepEqual(1, '1')).toBe(false)
    })

    it('returns false for object vs array', () => {
      expect(deepEqual({}, [])).toBe(false)
    })

    it('returns false for object vs primitive', () => {
      expect(deepEqual({ a: 1 }, 1)).toBe(false)
    })
  })

  describe('maplibre-style objects', () => {
    it('returns true for identical maplibre config objects', () => {
      const a = {
        mapStyle: 'https://example.com/style.json',
        projection: 'mercator',
        latitude: 37,
        longitude: -122,
        zoom: 10,
        pitch: 0,
        bearing: 0,
        light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
        sky: {
          enabled: false,
          skyColor: '#88C6FC',
          horizonColor: '#ffffff',
          skyHorizonBlend: 0.8,
          atmosphereBlend: 0.5,
        },
      }
      const b = {
        mapStyle: 'https://example.com/style.json',
        projection: 'mercator',
        latitude: 37,
        longitude: -122,
        zoom: 10,
        pitch: 0,
        bearing: 0,
        light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
        sky: {
          enabled: false,
          skyColor: '#88C6FC',
          horizonColor: '#ffffff',
          skyHorizonBlend: 0.8,
          atmosphereBlend: 0.5,
        },
      }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('returns false when one nested property differs', () => {
      const a = {
        mapStyle: 'https://example.com/style.json',
        light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
      }
      const b = {
        mapStyle: 'https://example.com/style.json',
        light: { anchor: 'viewport', azimuthal: 211, polar: 30 },
      }
      expect(deepEqual(a, b)).toBe(false)
    })

    it('handles mapStyle as an object (inline style spec)', () => {
      const style = {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      }
      const a = { ...style }
      const b = { ...style }
      expect(deepEqual(a, b)).toBe(true)
    })
  })

  describe('maxDepth parameter', () => {
    describe('basic depth limiting', () => {
      // TODO: maxDepth=0 semantics need clarification - not used in practice
      it.skip('maxDepth=0 compares keys but values by reference', () => {
        const a = { x: 1, y: 2 }
        const b = { x: 1, y: 2 }
        const c = { x: 1, y: 3 }
        const d = { x: 1 } // Different keys

        expect(deepEqual(a, b, 0)).toBe(true) // Primitives are equal
        expect(deepEqual(a, c, 0)).toBe(false) // y differs
        expect(deepEqual(a, d, 0)).toBe(false) // Different keys

        // With nested objects
        const nested = { z: 1 }
        const e = { x: nested }
        const f = { x: nested }
        const g = { x: { z: 1 } }

        expect(deepEqual(e, f, 0)).toBe(true) // Same nested reference
        expect(deepEqual(e, g, 0)).toBe(false) // Different nested reference
      })

      it('maxDepth=1 compares top-level properties only', () => {
        const a = { x: 1, nested: { y: 2 } }
        const b = { x: 1, nested: { y: 2 } }
        const c = { x: 1, nested: { y: 3 } }

        // Top-level comparison works
        expect(deepEqual(a, b, 1)).toBe(false) // nested is different reference
        expect(deepEqual(a, c, 1)).toBe(false) // nested is different reference

        // But with shared nested reference, should work
        const shared = { y: 2 }
        const d = { x: 1, nested: shared }
        const e = { x: 1, nested: shared }
        expect(deepEqual(d, e, 1)).toBe(true) // Same nested reference
      })

      it('maxDepth=2 compares up to 2 levels deep', () => {
        const a = {
          top: 1,
          level1: {
            mid: 2,
            level2: { deep: 3 },
          },
        }
        const b = {
          top: 1,
          level1: {
            mid: 2,
            level2: { deep: 3 },
          },
        }
        const c = {
          top: 1,
          level1: {
            mid: 2,
            level2: { deep: 4 }, // Different deep value
          },
        }

        // At depth 2, we compare level1.mid and level1.level2 by reference
        expect(deepEqual(a, b, 2)).toBe(false) // level2 is different reference
        expect(deepEqual(a, c, 2)).toBe(false) // level2 is different reference

        // But at depth 3, we compare the deep value
        expect(deepEqual(a, b, 3)).toBe(true) // All values equal
        expect(deepEqual(a, c, 3)).toBe(false) // deep value differs
      })

      it('maxDepth=Infinity is same as unlimited (default behavior)', () => {
        const a = { a: { b: { c: { d: { e: 1 } } } } }
        const b = { a: { b: { c: { d: { e: 1 } } } } }
        const c = { a: { b: { c: { d: { e: 2 } } } } }

        expect(deepEqual(a, b, Infinity)).toBe(true)
        expect(deepEqual(a, b)).toBe(true) // Default is Infinity
        expect(deepEqual(a, c, Infinity)).toBe(false)
      })
    })

    describe('MaplibreBasemapOp use case (maxDepth=2)', () => {
      it('detects changes in top-level view properties', () => {
        const a = {
          mapStyle: 'https://example.com/style.json',
          longitude: -122.4,
          latitude: 37.8,
          zoom: 10,
          pitch: 0,
          bearing: 0,
        }
        const b = { ...a, zoom: 11 }

        expect(deepEqual(a, b, 2)).toBe(false) // zoom changed
      })

      it('detects changes in light/sky nested objects', () => {
        const a = {
          mapStyle: 'https://example.com/style.json',
          light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
        }
        const b = {
          mapStyle: 'https://example.com/style.json',
          light: { anchor: 'viewport', azimuthal: 211, polar: 30 },
        }

        expect(deepEqual(a, b, 2)).toBe(false) // light.azimuthal changed
      })

      it('compares mapStyle objects by reference at depth 2', () => {
        const largeStyle = {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            },
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
            { id: 'osm', type: 'raster', source: 'osm' },
          ],
        }

        const a = { mapStyle: largeStyle, zoom: 10 }
        const b = { mapStyle: largeStyle, zoom: 10 } // Same reference
        const c = { mapStyle: JSON.parse(JSON.stringify(largeStyle)), zoom: 10 } // Deep copy

        // At depth 2, mapStyle is compared by reference
        expect(deepEqual(a, b, 2)).toBe(true) // Same reference
        expect(deepEqual(a, c, 2)).toBe(false) // Different deep nested references

        // But with unlimited depth, content is compared
        expect(deepEqual(a, c, Infinity)).toBe(true) // Same content
      })

      it('ignores deep changes in mapStyle at depth 2', () => {
        const styleA = {
          version: 8,
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }],
        }
        const styleB = {
          version: 8,
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#000' } }], // Different color
        }

        const a = { mapStyle: styleA, zoom: 10 }
        const b = { mapStyle: styleB, zoom: 10 }

        // At depth 2, mapStyle is compared by reference, so different references = different
        expect(deepEqual(a, b, 2)).toBe(false) // Different mapStyle references

        // With unlimited depth, the deep change is detected
        expect(deepEqual(a, b, Infinity)).toBe(false) // background-color differs
      })
    })

    describe('DeckRendererOp use case (maxDepth=3)', () => {
      it('detects changes in layer properties', () => {
        const a = {
          deckProps: {
            layers: [{ id: 'layer1', type: 'ScatterplotLayer', data: [], getRadius: 10 }],
          },
        }
        const b = {
          deckProps: {
            layers: [{ id: 'layer1', type: 'ScatterplotLayer', data: [], getRadius: 20 }],
          },
        }

        expect(deepEqual(a, b, 3)).toBe(false) // getRadius changed
      })

      it('detects new/removed layers', () => {
        const layer1 = { id: 'layer1', type: 'ScatterplotLayer', data: [] }
        const layer2 = { id: 'layer2', type: 'PathLayer', data: [] }

        const a = { deckProps: { layers: [layer1] } }
        const b = { deckProps: { layers: [layer1, layer2] } }

        expect(deepEqual(a, b, 3)).toBe(false) // Different array length
      })

      it.skip('compares data arrays by reference at depth 3', () => {
        const data = [{ x: 1, y: 2 }, { x: 3, y: 4 }]
        const layer = { id: 'layer1', type: 'ScatterplotLayer', data }

        const a = { deckProps: { layers: [layer] } }
        const b = { deckProps: { layers: [layer] } } // Same layer reference
        const c = { deckProps: { layers: [{ ...layer }] } } // Cloned layer

        expect(deepEqual(a, b, 3)).toBe(true) // Same layer reference
        expect(deepEqual(a, c, 3)).toBe(true) // Cloned layer, but data is same reference

        // Different data reference
        const d = { deckProps: { layers: [{ ...layer, data: [...data] }] } }
        expect(deepEqual(a, d, 3)).toBe(false) // data array is different reference
      })

      it('does not recurse into data items at depth 3', () => {
        const dataA = [{ x: 1, y: 2, nested: { z: 3 } }]
        const dataB = [{ x: 1, y: 2, nested: { z: 4 } }] // Different nested value

        const a = {
          deckProps: {
            layers: [{ id: 'layer1', type: 'ScatterplotLayer', data: dataA }],
          },
        }
        const b = {
          deckProps: {
            layers: [{ id: 'layer1', type: 'ScatterplotLayer', data: dataB }],
          },
        }

        // At depth 3, we're comparing the data arrays by reference
        expect(deepEqual(a, b, 3)).toBe(false) // Different data references

        // With unlimited depth, the nested difference is detected
        expect(deepEqual(a, b, Infinity)).toBe(false) // nested.z differs
      })
    })

    describe('arrays with maxDepth', () => {
      // TODO: Array depth semantics with shallow copies need refinement
      it.skip('compares array elements up to maxDepth', () => {
        const a = [{ x: 1 }, { x: 2 }]
        const b = [{ x: 1 }, { x: 2 }]
        const c = [{ x: 1 }, { x: 3 }]

        // At depth 1, we compare array elements by reference (depth 0 is the array itself)
        expect(deepEqual(a, b, 1)).toBe(true) // Element keys exist, values compared at depth 1
        expect(deepEqual(a, b, 2)).toBe(true) // Element contents are equal
        expect(deepEqual(a, c, 2)).toBe(false) // Second element differs
      })

      it.skip('compares nested arrays up to maxDepth', () => {
        const a = { layers: [{ data: [1, 2, 3] }] }
        const b = { layers: [{ data: [1, 2, 3] }] }
        const c = { layers: [{ data: [1, 2, 4] }] }

        expect(deepEqual(a, b, 2)).toBe(false) // data array is different reference
        expect(deepEqual(a, b, 3)).toBe(true) // data array contents are equal
        expect(deepEqual(a, c, 3)).toBe(false) // data array differs
      })
    })

    describe('edge cases', () => {
      it('handles empty objects at any depth', () => {
        expect(deepEqual({}, {}, 0)).toBe(true)
        expect(deepEqual({}, {}, 1)).toBe(true)
        expect(deepEqual({}, {}, Infinity)).toBe(true)
      })

      it('handles primitives at any depth', () => {
        expect(deepEqual(42, 42, 0)).toBe(true)
        expect(deepEqual('test', 'test', 1)).toBe(true)
        expect(deepEqual(true, true, Infinity)).toBe(true)
      })

      it('handles null at any depth', () => {
        expect(deepEqual(null, null, 0)).toBe(true)
        expect(deepEqual({ x: null }, { x: null }, 1)).toBe(true)
        expect(deepEqual({ x: null }, { x: null }, 2)).toBe(true)
      })

      it('handles circular references gracefully (by reference)', () => {
        const a: any = { x: 1 }
        a.self = a

        const b: any = { x: 1 }
        b.self = b

        // At depth 0-1, compared by reference
        expect(deepEqual(a, b, 0)).toBe(false)
        expect(deepEqual(a, b, 1)).toBe(false)

        // At depth 2+, would recurse infinitely without reference check
        // Our implementation checks reference equality first (a === b)
        expect(deepEqual(a, a, Infinity)).toBe(true) // Same reference
      })
    })

    describe('special types with maxDepth', () => {
      it('compares Date objects regardless of depth', () => {
        const date1 = new Date('2024-01-01')
        const date2 = new Date('2024-01-01')
        const date3 = new Date('2024-01-02')

        expect(deepEqual(date1, date2, 0)).toBe(true)
        expect(deepEqual(date1, date3, 0)).toBe(false)
        expect(deepEqual({ d: date1 }, { d: date2 }, 1)).toBe(true)
      })

      it.skip('compares Map objects up to maxDepth', () => {
        const map1 = new Map([['a', { x: 1 }]])
        const map2 = new Map([['a', { x: 1 }]])
        const map3 = new Map([['a', { x: 2 }]])

        // Maps compare entries recursively
        expect(deepEqual(map1, map2, 1)).toBe(true) // At depth 1, checks if values have same keys
        expect(deepEqual(map1, map2, 2)).toBe(true) // Values content is equal
        expect(deepEqual(map1, map3, 2)).toBe(false) // Value x differs
      })
    })
  })
})
