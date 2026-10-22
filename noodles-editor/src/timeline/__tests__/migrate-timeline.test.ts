// Tests for timeline data migration

import { describe, expect, it } from 'vitest'
import {
  bezierHandlesToSerializedHandles,
  exportToTimelineFormat,
  fieldPathToObjectName,
  keyframeToSerializedKeyframe,
  migrateTimelineData,
  objectNameToFieldPath,
  rawValueToKeyframeValue,
  serializedHandlesToBezierHandles,
  serializedKeyframeToKeyframe,
  trackDataToTrack,
  validateTimelineData,
} from '../migrate-timeline'
import type { TimelineData, TimelineKeyframe, TimelineTrackData } from '../types'

describe('Object Name Conversion', () => {
  describe('objectNameToFieldPath', () => {
    it('converts simple object name', () => {
      expect(objectNameToFieldPath('my-operator')).toBe('/my-operator')
    })

    it('converts object name with single property', () => {
      expect(objectNameToFieldPath('my-operator / value')).toBe('/my-operator.par.value')
    })

    it('converts object name with nested properties', () => {
      expect(objectNameToFieldPath('maplibre-basemap / viewState / zoom')).toBe(
        '/maplibre-basemap.par.viewState.zoom'
      )
    })

    it('handles deeply nested paths', () => {
      expect(objectNameToFieldPath('op / a / b / c / d')).toBe('/op.par.a.b.c.d')
    })
  })

  describe('fieldPathToObjectName', () => {
    it('converts simple field path', () => {
      expect(fieldPathToObjectName('/my-operator')).toBe('my-operator')
    })

    it('converts field path with property', () => {
      expect(fieldPathToObjectName('/my-operator.par.value')).toBe('my-operator / value')
    })

    it('converts field path with nested properties', () => {
      expect(fieldPathToObjectName('/maplibre-basemap.par.viewState.zoom')).toBe(
        'maplibre-basemap / viewState / zoom'
      )
    })

    it('handles path without leading slash', () => {
      expect(fieldPathToObjectName('op.par.value')).toBe('op / value')
    })
  })

  describe('round-trip conversion', () => {
    it('preserves data through round-trip', () => {
      const original = 'maplibre-basemap / viewState / zoom'
      const fieldPath = objectNameToFieldPath(original)
      const converted = fieldPathToObjectName(fieldPath)
      expect(converted).toBe(original)
    })
  })
})

describe('Handle Conversion', () => {
  describe('serializedHandlesToBezierHandles', () => {
    it('converts linear handles', () => {
      const handles = serializedHandlesToBezierHandles([0, 0, 1, 1])
      expect(handles.left).toEqual([0, 0])
      expect(handles.right).toEqual([1, 1])
      expect(handles.type).toBe('aligned')
    })

    it('converts ease-in handles', () => {
      const handles = serializedHandlesToBezierHandles([0.42, 0, 1, 1])
      expect(handles.left).toEqual([0.42, 0])
      expect(handles.right).toEqual([1, 1])
    })

    it('converts ease-out handles', () => {
      const handles = serializedHandlesToBezierHandles([0, 0, 0.58, 1])
      expect(handles.left).toEqual([0, 0])
      expect(handles.right).toEqual([0.58, 1])
    })

    it('handles overshoot values', () => {
      const handles = serializedHandlesToBezierHandles([0.36, 0, 0.66, -0.56])
      expect(handles.left).toEqual([0.36, 0])
      expect(handles.right).toEqual([0.66, -0.56])
    })
  })

  describe('bezierHandlesToSerializedHandles', () => {
    it('converts to array format', () => {
      const handles = bezierHandlesToSerializedHandles({
        left: [0.25, 0.1],
        right: [0.25, 1],
        type: 'aligned',
      })
      expect(handles).toEqual([0.25, 0.1, 0.25, 1])
    })
  })

  describe('handle round-trip', () => {
    it('preserves handle values', () => {
      const original: [number, number, number, number] = [0.42, 0, 0.58, 1]
      const bezier = serializedHandlesToBezierHandles(original)
      const converted = bezierHandlesToSerializedHandles(bezier)
      expect(converted).toEqual(original)
    })
  })
})

describe('Value Conversion', () => {
  describe('rawValueToKeyframeValue', () => {
    it('converts number', () => {
      expect(rawValueToKeyframeValue(42)).toBe(42)
    })

    it('converts boolean', () => {
      expect(rawValueToKeyframeValue(true)).toBe(true)
      expect(rawValueToKeyframeValue(false)).toBe(false)
    })

    it('converts string', () => {
      expect(rawValueToKeyframeValue('hello')).toBe('hello')
    })

    it('converts RGBA color', () => {
      const value = rawValueToKeyframeValue({ r: 1, g: 0.5, b: 0, a: 0.8 })
      expect(value).toEqual({ r: 1, g: 0.5, b: 0, a: 0.8 })
    })

    it('converts RGB color with default alpha', () => {
      const value = rawValueToKeyframeValue({ r: 1, g: 0, b: 0 })
      expect(value).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    })

    it('converts Vec2', () => {
      expect(rawValueToKeyframeValue({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    })

    it('converts Vec3', () => {
      expect(rawValueToKeyframeValue({ x: 10, y: 20, z: 30 })).toEqual({ x: 10, y: 20, z: 30 })
    })

    it('converts Point2D', () => {
      expect(rawValueToKeyframeValue({ lng: -122.4, lat: 37.8 })).toEqual({
        lng: -122.4,
        lat: 37.8,
      })
    })

    it('converts Point3D', () => {
      expect(rawValueToKeyframeValue({ lng: -122.4, lat: 37.8, alt: 1000 })).toEqual({
        lng: -122.4,
        lat: 37.8,
        alt: 1000,
      })
    })

    it('converts compound object', () => {
      const value = rawValueToKeyframeValue({
        zoom: 12,
        center: { lng: -122, lat: 37 },
      })
      expect(value).toEqual({
        zoom: 12,
        center: { lng: -122, lat: 37 },
      })
    })

    it('handles null', () => {
      expect(rawValueToKeyframeValue(null)).toBe(0)
    })

    it('handles undefined', () => {
      expect(rawValueToKeyframeValue(undefined)).toBe(0)
    })
  })
})

describe('Keyframe Conversion', () => {
  describe('serializedKeyframeToKeyframe', () => {
    it('converts bezier keyframe', () => {
      const serializedKf: TimelineKeyframe = {
        id: 'kf1',
        position: 1.5,
        connectedRight: true,
        handles: [0.42, 0, 0.58, 1],
        value: 100,
      }

      const kf = serializedKeyframeToKeyframe(serializedKf)

      expect(kf.id).toBe('kf1')
      expect(kf.position).toBe(1.5)
      expect(kf.value).toBe(100)
      expect(kf.interpolation).toBe('bezier')
      expect(kf.handles).toBeDefined()
      expect(kf.handles?.left).toEqual([0.42, 0])
      expect(kf.handles?.right).toEqual([0.58, 1])
    })

    it('detects linear interpolation', () => {
      const serializedKf: TimelineKeyframe = {
        id: 'kf2',
        position: 0,
        connectedRight: true,
        handles: [0, 0, 1, 1],
        value: 0,
      }

      const kf = serializedKeyframeToKeyframe(serializedKf)
      expect(kf.interpolation).toBe('linear')
      expect(kf.handles).toBeUndefined()
    })

    it('detects hold interpolation', () => {
      const serializedKf: TimelineKeyframe = {
        id: 'kf3',
        position: 2,
        connectedRight: false,
        handles: [0, 0, 1, 1],
        value: 50,
      }

      const kf = serializedKeyframeToKeyframe(serializedKf)
      expect(kf.interpolation).toBe('hold')
    })
  })

  describe('keyframeToSerializedKeyframe', () => {
    it('converts native keyframe', () => {
      const kf = {
        id: 'kf1',
        position: 1,
        value: 42,
        interpolation: 'bezier' as const,
        handles: {
          left: [0.25, 0.1] as [number, number],
          right: [0.25, 1] as [number, number],
          type: 'aligned' as const,
        },
      }

      const serializedKf = keyframeToSerializedKeyframe(kf)

      expect(serializedKf.id).toBe('kf1')
      expect(serializedKf.position).toBe(1)
      expect(serializedKf.value).toBe(42)
      expect(serializedKf.connectedRight).toBe(true)
      expect(serializedKf.handles).toEqual([0.25, 0.1, 0.25, 1])
    })

    it('sets connectedRight false for hold', () => {
      const kf = {
        id: 'kf2',
        position: 2,
        value: 0,
        interpolation: 'hold' as const,
      }

      const serializedKf = keyframeToSerializedKeyframe(kf)
      expect(serializedKf.connectedRight).toBe(false)
    })
  })
})

describe('Track Conversion', () => {
  it('converts track data', () => {
    const trackData: TimelineTrackData = {
      type: 'number',
      keyframes: [
        { id: 'kf1', position: 0, connectedRight: true, handles: [0, 0, 1, 1], value: 0 },
        { id: 'kf2', position: 2, connectedRight: true, handles: [0.42, 0, 0.58, 1], value: 100 },
      ],
    }

    const track = trackDataToTrack('my-op', 'value', trackData)

    expect(track.id).toBe('/my-op.par.value')
    expect(track.fieldPath).toBe('/my-op.par.value')
    expect(track.keyframes).toHaveLength(2)
    expect(track.keyframes[0].id).toBe('kf1')
    expect(track.keyframes[1].id).toBe('kf2')
    expect(track.defaultValue).toBe(0)
  })

  it('sorts keyframes by position', () => {
    const trackData: TimelineTrackData = {
      type: 'number',
      keyframes: [
        { id: 'kf2', position: 2, connectedRight: true, handles: [0, 0, 1, 1], value: 200 },
        { id: 'kf1', position: 0, connectedRight: true, handles: [0, 0, 1, 1], value: 0 },
        { id: 'kf3', position: 1, connectedRight: true, handles: [0, 0, 1, 1], value: 100 },
      ],
    }

    const track = trackDataToTrack('op', 'val', trackData)

    expect(track.keyframes[0].position).toBe(0)
    expect(track.keyframes[1].position).toBe(1)
    expect(track.keyframes[2].position).toBe(2)
  })
})

describe('Full Timeline Migration', () => {
  it('migrates complete timeline timeline', () => {
    const timelineData: TimelineData = {
      sheetsById: {
        Noodles: {
          sequence: {
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {
              'my-op': {
                trackIdByPropPath: {
                  value: 'track1',
                },
                trackData: {
                  track1: {
                    type: 'number',
                    keyframes: [
                      {
                        id: 'kf1',
                        position: 0,
                        connectedRight: true,
                        handles: [0, 0, 1, 1],
                        value: 0,
                      },
                      {
                        id: 'kf2',
                        position: 5,
                        connectedRight: true,
                        handles: [0.42, 0, 0.58, 1],
                        value: 100,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    }

    const result = migrateTimelineData(timelineData)

    expect(result.sequence.length).toBe(10)
    expect(result.sequence.fps).toBe(30)
    expect(Object.keys(result.tracks)).toHaveLength(1)
    expect(result.tracks['/my-op.par.value']).toBeDefined()
    expect(result.tracks['/my-op.par.value'].keyframes).toHaveLength(2)
  })

  it('handles empty timeline', () => {
    const timelineData: TimelineData = {
      sheetsById: {
        Noodles: {
          sequence: {
            length: 5,
            subUnitsPerUnit: 24,
            tracksByObject: {},
          },
        },
      },
    }

    const result = migrateTimelineData(timelineData)

    expect(result.sequence.length).toBe(5)
    expect(result.sequence.fps).toBe(24)
    expect(Object.keys(result.tracks)).toHaveLength(0)
  })

  it('handles missing Noodles sheet', () => {
    const timelineData = {
      sheetsById: {},
    } as TimelineData

    const result = migrateTimelineData(timelineData)

    expect(result.sequence.length).toBe(10) // Default
    expect(result.sequence.fps).toBe(30) // Default
    expect(Object.keys(result.tracks)).toHaveLength(0)
  })

  it('handles multiple tracks and objects', () => {
    const timelineData: TimelineData = {
      sheetsById: {
        Noodles: {
          sequence: {
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {
              op1: {
                trackIdByPropPath: { value: 't1' },
                trackData: {
                  t1: {
                    type: 'number',
                    keyframes: [
                      {
                        id: 'k1',
                        position: 0,
                        connectedRight: true,
                        handles: [0, 0, 1, 1],
                        value: 0,
                      },
                    ],
                  },
                },
              },
              'op2 / nested': {
                trackIdByPropPath: { prop: 't2' },
                trackData: {
                  t2: {
                    type: 'number',
                    keyframes: [
                      {
                        id: 'k2',
                        position: 1,
                        connectedRight: true,
                        handles: [0, 0, 1, 1],
                        value: 50,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    }

    const result = migrateTimelineData(timelineData)

    expect(Object.keys(result.tracks)).toHaveLength(2)
    expect(result.tracks['/op1.par.value']).toBeDefined()
    expect(result.tracks['/op2.par.nested.prop']).toBeDefined()
  })
})

describe('Export to Timeline Format', () => {
  it('exports native format to timeline format', () => {
    const nativeData = {
      sequence: { length: 10, fps: 30 },
      tracks: {
        '/my-op.par.value': {
          id: '/my-op.par.value',
          fieldPath: '/my-op.par.value',
          defaultValue: 0,
          keyframes: [
            { id: 'kf1', position: 0, value: 0, interpolation: 'linear' as const },
            {
              id: 'kf2',
              position: 5,
              value: 100,
              interpolation: 'bezier' as const,
              handles: {
                left: [0.42, 0] as [number, number],
                right: [0.58, 1] as [number, number],
                type: 'aligned' as const,
              },
            },
          ],
        },
      },
    }

    const timelineData = exportToTimelineFormat(nativeData)

    expect(timelineData.sheetsById.Noodles.sequence.length).toBe(10)
    expect(timelineData.sheetsById.Noodles.sequence.subUnitsPerUnit).toBe(30)

    const tracksByObject = timelineData.sheetsById.Noodles.sequence.tracksByObject
    expect(tracksByObject['my-op']).toBeDefined()
  })
})

describe('Validation', () => {
  it('validates valid timeline data', () => {
    const timelineData: TimelineData = {
      sheetsById: {
        Noodles: {
          sequence: {
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {},
          },
        },
      },
    }

    const result = validateTimelineData(timelineData)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('reports error for non-object data', () => {
    const result = validateTimelineData(null)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Timeline data must be an object')
  })

  it('reports warning for missing sheetsById', () => {
    const result = validateTimelineData({})
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('No sheetsById found, using empty timeline')
  })

  it('reports warning for invalid sequence length', () => {
    const timelineData = {
      sheetsById: {
        Noodles: {
          sequence: {
            length: -1,
            subUnitsPerUnit: 30,
            tracksByObject: {},
          },
        },
      },
    }

    const result = validateTimelineData(timelineData)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.includes('Invalid sequence length'))).toBe(true)
  })

  it('reports error for keyframe with invalid position', () => {
    const timelineData = {
      sheetsById: {
        Noodles: {
          sequence: {
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {
              op: {
                trackIdByPropPath: { val: 't1' },
                trackData: {
                  t1: {
                    type: 'number',
                    keyframes: [
                      {
                        id: 'k1',
                        position: 'invalid',
                        connectedRight: true,
                        handles: [0, 0, 1, 1],
                        value: 0,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    }

    const result = validateTimelineData(timelineData)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('invalid position'))).toBe(true)
  })
})
