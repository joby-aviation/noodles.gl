import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { up, down } from './013-add-time-markers'

describe('013-add-time-markers migration', () => {
  describe('up', () => {
    it('adds empty markers array to existing timeline sequence', async () => {
      const project: NoodlesProjectJSON = {
        version: 12,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {
          sheetsById: {
            Noodles: {
              sequence: {
                length: 10,
                subUnitsPerUnit: 30,
                tracksByObject: {},
              },
              staticOverrides: { byObject: {} },
            },
          },
        },
      }

      const result = await up(project)

      const sequence = (result.timeline as any).sheetsById.Noodles.sequence
      expect(sequence.markers).toEqual([])
      expect(sequence.length).toBe(10)
      expect(sequence.subUnitsPerUnit).toBe(30)
    })

    it('preserves existing markers if present', async () => {
      const existingMarkers = [
        { id: 'tm_123', position: 2.5, connections: [] },
        { id: 'tm_456', position: 5.0, connections: [{ keyframeId: 'kf_abc', trackPath: 'op / prop', offset: 0.5 }] },
      ]

      const project: NoodlesProjectJSON = {
        version: 12,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {
          sheetsById: {
            Noodles: {
              sequence: {
                length: 10,
                subUnitsPerUnit: 30,
                tracksByObject: {},
                markers: existingMarkers,
              },
              staticOverrides: { byObject: {} },
            },
          },
        },
      }

      const result = await up(project)

      const sequence = (result.timeline as any).sheetsById.Noodles.sequence
      expect(sequence.markers).toEqual(existingMarkers)
    })

    it('handles project with no timeline', async () => {
      const project: NoodlesProjectJSON = {
        version: 12,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {},
      }

      const result = await up(project)
      expect(result).toEqual(project)
    })

    it('handles project with no sequence', async () => {
      const project: NoodlesProjectJSON = {
        version: 12,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {
          sheetsById: {
            Noodles: {
              staticOverrides: { byObject: {} },
            },
          },
        },
      }

      const result = await up(project)
      expect(result).toEqual(project)
    })
  })

  describe('down', () => {
    it('removes markers array from timeline sequence', async () => {
      const project: NoodlesProjectJSON = {
        version: 13,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {
          sheetsById: {
            Noodles: {
              sequence: {
                length: 10,
                subUnitsPerUnit: 30,
                tracksByObject: {},
                markers: [{ id: 'tm_123', position: 2.5, connections: [] }],
              },
              staticOverrides: { byObject: {} },
            },
          },
        },
      }

      const result = await down(project)

      const sequence = (result.timeline as any).sheetsById.Noodles.sequence
      expect(sequence.markers).toBeUndefined()
      expect(sequence.length).toBe(10)
      expect(sequence.subUnitsPerUnit).toBe(30)
    })

    it('handles project with no markers', async () => {
      const project: NoodlesProjectJSON = {
        version: 13,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {
          sheetsById: {
            Noodles: {
              sequence: {
                length: 10,
                subUnitsPerUnit: 30,
                tracksByObject: {},
              },
              staticOverrides: { byObject: {} },
            },
          },
        },
      }

      const result = await down(project)
      expect(result).toEqual(project)
    })

    it('handles project with no timeline', async () => {
      const project: NoodlesProjectJSON = {
        version: 13,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        timeline: {},
      }

      const result = await down(project)
      expect(result).toEqual(project)
    })
  })

  describe('round-trip', () => {
    it('preserves timeline data through up and down migrations', async () => {
      const project: NoodlesProjectJSON = {
        version: 12,
        nodes: [{ id: '/test', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        viewport: { x: 100, y: 200, zoom: 1.5 },
        timeline: {
          sheetsById: {
            Noodles: {
              sequence: {
                length: 15,
                subUnitsPerUnit: 60,
                tracksByObject: {
                  'test': {
                    trackIdByPropPath: { value: 'track_1' },
                    trackData: {
                      track_1: {
                        type: 'BasicKeyframedTrack',
                        keyframes: [
                          { id: 'kf_1', position: 0, connectedRight: true, handles: [0, 0, 1, 1], value: 0 },
                          { id: 'kf_2', position: 5, connectedRight: false, handles: [0, 0, 1, 1], value: 100 },
                        ],
                      },
                    },
                  },
                },
              },
              staticOverrides: { byObject: {} },
            },
          },
        },
      }

      const afterUp = await up(project)
      const afterDown = await down(afterUp)

      // Should be identical to original (markers field removed)
      expect(afterDown).toEqual(project)
    })
  })
})
