import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTimelineStore } from '../timeline-store'
import { DEFAULT_SEQUENCE_STATE } from '../types'
import type { TheatreTimelineData } from '../types'

describe('TimelineStore', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  describe('sequence', () => {
    it('has default sequence state', () => {
      const { sequence } = useTimelineStore.getState()
      expect(sequence.length).toBe(10)
      expect(sequence.fps).toBe(30)
    })

    it('setLength updates sequence length', () => {
      useTimelineStore.getState().setLength(20)
      expect(useTimelineStore.getState().sequence.length).toBe(20)
    })

    it('setLength clamps to minimum 0.1', () => {
      useTimelineStore.getState().setLength(-5)
      expect(useTimelineStore.getState().sequence.length).toBe(0.1)
    })

    it('setLength clamps position if needed', () => {
      useTimelineStore.getState().setPosition(8)
      useTimelineStore.getState().setLength(5)
      expect(useTimelineStore.getState().position).toBe(5)
    })

    it('setFps updates sequence fps', () => {
      useTimelineStore.getState().setFps(60)
      expect(useTimelineStore.getState().sequence.fps).toBe(60)
    })

    it('setFps clamps to minimum 1', () => {
      useTimelineStore.getState().setFps(0)
      expect(useTimelineStore.getState().sequence.fps).toBe(1)
    })
  })

  describe('playback', () => {
    it('has default playback state', () => {
      const state = useTimelineStore.getState()
      expect(state.position).toBe(0)
      expect(state.playing).toBe(false)
      expect(state.loop).toBe(true)
      expect(state.playbackSpeed).toBe(1)
    })

    it('setPosition updates position', () => {
      useTimelineStore.getState().setPosition(5)
      expect(useTimelineStore.getState().position).toBe(5)
    })

    it('setPosition clamps to sequence bounds', () => {
      useTimelineStore.getState().setPosition(-5)
      expect(useTimelineStore.getState().position).toBe(0)

      useTimelineStore.getState().setPosition(100)
      expect(useTimelineStore.getState().position).toBe(10) // default length
    })

    it('play/pause toggle playing state', () => {
      useTimelineStore.getState().play()
      expect(useTimelineStore.getState().playing).toBe(true)

      useTimelineStore.getState().pause()
      expect(useTimelineStore.getState().playing).toBe(false)
    })

    it('togglePlay toggles playing state', () => {
      useTimelineStore.getState().togglePlay()
      expect(useTimelineStore.getState().playing).toBe(true)

      useTimelineStore.getState().togglePlay()
      expect(useTimelineStore.getState().playing).toBe(false)
    })

    it('toggleLoop toggles loop state', () => {
      expect(useTimelineStore.getState().loop).toBe(true)
      useTimelineStore.getState().toggleLoop()
      expect(useTimelineStore.getState().loop).toBe(false)
    })

    it('setPlaybackSpeed updates speed', () => {
      useTimelineStore.getState().setPlaybackSpeed(2)
      expect(useTimelineStore.getState().playbackSpeed).toBe(2)
    })

    it('setPlaybackSpeed clamps to bounds', () => {
      useTimelineStore.getState().setPlaybackSpeed(0.01)
      expect(useTimelineStore.getState().playbackSpeed).toBe(0.1)

      useTimelineStore.getState().setPlaybackSpeed(100)
      expect(useTimelineStore.getState().playbackSpeed).toBe(10)
    })

    it('stepForward advances by frame', () => {
      useTimelineStore.getState().setFps(30)
      useTimelineStore.getState().stepForward()
      expect(useTimelineStore.getState().position).toBeCloseTo(1 / 30, 5)
    })

    it('stepBackward goes back by frame', () => {
      useTimelineStore.getState().setPosition(1)
      useTimelineStore.getState().setFps(30)
      useTimelineStore.getState().stepBackward()
      expect(useTimelineStore.getState().position).toBeCloseTo(1 - 1 / 30, 5)
    })

    it('goToStart sets position to 0', () => {
      useTimelineStore.getState().setPosition(5)
      useTimelineStore.getState().goToStart()
      expect(useTimelineStore.getState().position).toBe(0)
    })

    it('goToEnd sets position to sequence length', () => {
      useTimelineStore.getState().goToEnd()
      expect(useTimelineStore.getState().position).toBe(10)
    })
  })

  describe('tracks', () => {
    it('getOrCreateTrack creates a new track', () => {
      const track = useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      expect(track).toBeDefined()
      expect(track.fieldPath).toBe('test / value')
      expect(track.defaultValue).toBe(0)
      expect(track.keyframes).toEqual([])
    })

    it('getOrCreateTrack returns existing track', () => {
      const track1 = useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      const track2 = useTimelineStore.getState().getOrCreateTrack('test / value', 100)
      expect(track1.id).toBe(track2.id)
      expect(track2.defaultValue).toBe(0) // keeps original default
    })

    it('getTrack returns undefined for non-existent track', () => {
      expect(useTimelineStore.getState().getTrack('nonexistent')).toBeUndefined()
    })

    it('deleteTrack removes a track', () => {
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      useTimelineStore.getState().deleteTrack('test / value')
      expect(useTimelineStore.getState().getTrack('test / value')).toBeUndefined()
    })

    it('hasKeyframesForField returns false for empty track', () => {
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      expect(useTimelineStore.getState().hasKeyframesForField('test / value')).toBe(false)
    })

    it('hasKeyframesForField returns true for track with keyframes', () => {
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 10,
        interpolation: 'linear',
      })
      expect(useTimelineStore.getState().hasKeyframesForField('test / value')).toBe(true)
    })
  })

  describe('keyframes', () => {
    beforeEach(() => {
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
    })

    it('addKeyframe adds a keyframe', () => {
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })
      expect(id).toBeTruthy()

      const track = useTimelineStore.getState().getTrack('test / value')
      expect(track?.keyframes).toHaveLength(1)
      expect(track?.keyframes[0].value).toBe(10)
    })

    it('addKeyframe sorts keyframes by position', () => {
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 2,
        value: 20,
        interpolation: 'linear',
      })
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      const track = useTimelineStore.getState().getTrack('test / value')
      expect(track?.keyframes.map(kf => kf.position)).toEqual([0, 1, 2])
    })

    it('updateKeyframe updates keyframe properties', () => {
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().updateKeyframe('test / value', id, {
        value: 20,
        interpolation: 'bezier',
      })

      const track = useTimelineStore.getState().getTrack('test / value')
      expect(track?.keyframes[0].value).toBe(20)
      expect(track?.keyframes[0].interpolation).toBe('bezier')
    })

    it('deleteKeyframe removes a keyframe', () => {
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().deleteKeyframe('test / value', id)

      const track = useTimelineStore.getState().getTrack('test / value')
      expect(track?.keyframes).toHaveLength(0)
    })

    it('deleteKeyframe removes from selection', () => {
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })
      useTimelineStore.getState().selectKeyframe(id)
      expect(useTimelineStore.getState().selectedKeyframeIds.has(id)).toBe(true)

      useTimelineStore.getState().deleteKeyframe('test / value', id)
      expect(useTimelineStore.getState().selectedKeyframeIds.has(id)).toBe(false)
    })

    it('moveKeyframe updates position and re-sorts', () => {
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 2,
        value: 20,
        interpolation: 'linear',
      })

      // Move middle keyframe to the end
      useTimelineStore.getState().moveKeyframe('test / value', id, 3)

      const track = useTimelineStore.getState().getTrack('test / value')
      expect(track?.keyframes[2].id).toBe(id)
      expect(track?.keyframes[2].position).toBe(3)
    })
  })

  describe('selection', () => {
    beforeEach(() => {
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
    })

    it('selectKeyframe selects a single keyframe', () => {
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })

      useTimelineStore.getState().selectKeyframe(id)
      expect(useTimelineStore.getState().selectedKeyframeIds.has(id)).toBe(true)
    })

    it('selectKeyframe replaces selection by default', () => {
      const id1 = useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      const id2 = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().selectKeyframe(id1)
      useTimelineStore.getState().selectKeyframe(id2)

      expect(useTimelineStore.getState().selectedKeyframeIds.size).toBe(1)
      expect(useTimelineStore.getState().selectedKeyframeIds.has(id2)).toBe(true)
    })

    it('selectKeyframe adds to selection with addToSelection=true', () => {
      const id1 = useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      const id2 = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().selectKeyframe(id1)
      useTimelineStore.getState().selectKeyframe(id2, true)

      expect(useTimelineStore.getState().selectedKeyframeIds.size).toBe(2)
    })

    it('deselectKeyframe removes from selection', () => {
      const id = useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })

      useTimelineStore.getState().selectKeyframe(id)
      useTimelineStore.getState().deselectKeyframe(id)

      expect(useTimelineStore.getState().selectedKeyframeIds.has(id)).toBe(false)
    })

    it('clearSelection clears all selections', () => {
      const id1 = useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      const id2 = useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().selectKeyframe(id1, true)
      useTimelineStore.getState().selectKeyframe(id2, true)
      useTimelineStore.getState().clearSelection()

      expect(useTimelineStore.getState().selectedKeyframeIds.size).toBe(0)
    })

    it('selectAllInTrack selects all keyframes in track', () => {
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().selectAllInTrack('test / value')

      expect(useTimelineStore.getState().selectedKeyframeIds.size).toBe(2)
    })
  })

  describe('evaluation', () => {
    beforeEach(() => {
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 0,
        interpolation: 'linear',
      })
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 2,
        value: 20,
        interpolation: 'linear',
      })
    })

    it('evaluateTrack returns interpolated value at current position', () => {
      useTimelineStore.getState().setPosition(1)
      const value = useTimelineStore.getState().evaluateTrack('test / value')
      expect(value).toBe(10)
    })

    it('evaluateTrack accepts explicit time parameter', () => {
      const value = useTimelineStore.getState().evaluateTrack('test / value', 1)
      expect(value).toBe(10)
    })

    it('evaluateAllTracks returns all track values', () => {
      useTimelineStore.getState().getOrCreateTrack('test / other', 100)
      useTimelineStore.getState().addKeyframe('test / other', {
        position: 0,
        value: 100,
        interpolation: 'linear',
      })

      useTimelineStore.getState().setPosition(0)
      const values = useTimelineStore.getState().evaluateAllTracks()

      expect(values.get('test / value')).toBe(0)
      expect(values.get('test / other')).toBe(100)
    })
  })

  describe('serialization', () => {
    it('toTheatreJSON produces Theatre.js compatible format', () => {
      useTimelineStore.getState().setLength(5)
      useTimelineStore.getState().setFps(24)
      useTimelineStore.getState().getOrCreateTrack('myop / zoom', 1)
      useTimelineStore.getState().addKeyframe('myop / zoom', {
        id: 'kf1',
        position: 0,
        value: 1,
        interpolation: 'bezier',
        handles: { left: [0.25, 0], right: [0.75, 1], type: 'aligned' },
      })
      useTimelineStore.getState().addKeyframe('myop / zoom', {
        id: 'kf2',
        position: 2,
        value: 5,
        interpolation: 'hold',
      })

      const json = useTimelineStore.getState().toTheatreJSON()

      expect(json.sheetsById.Noodles.sequence.length).toBe(5)
      expect(json.sheetsById.Noodles.sequence.subUnitsPerUnit).toBe(24)
      expect(json.sheetsById.Noodles.sequence.tracksByObject['myop']).toBeDefined()
    })

    it('fromTheatreJSON restores state from Theatre.js format', () => {
      const theatreData: TheatreTimelineData = {
        sheetsById: {
          Noodles: {
            sequence: {
              length: 8,
              subUnitsPerUnit: 60,
              tracksByObject: {
                myop: {
                  trackIdByPropPath: {
                    zoom: 'track1',
                  },
                  trackData: {
                    track1: {
                      type: 'BasicKeyframedTrack',
                      keyframes: [
                        {
                          id: 'kf1',
                          position: 0,
                          connectedRight: true,
                          handles: [0.25, 0, 0.75, 1],
                          value: 1,
                        },
                        {
                          id: 'kf2',
                          position: 4,
                          connectedRight: false,
                          handles: [0, 0, 1, 1],
                          value: 10,
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

      useTimelineStore.getState().fromTheatreJSON(theatreData)

      const state = useTimelineStore.getState()
      expect(state.sequence.length).toBe(8)
      expect(state.sequence.fps).toBe(60)

      const track = state.tracks.get('myop / zoom')
      expect(track).toBeDefined()
      expect(track?.keyframes).toHaveLength(2)
      expect(track?.keyframes[0].id).toBe('kf1')
      expect(track?.keyframes[1].interpolation).toBe('hold')
    })

    it('round-trips through Theatre.js format', () => {
      useTimelineStore.getState().setLength(12)
      useTimelineStore.getState().setFps(30)
      useTimelineStore.getState().getOrCreateTrack('op / value', 0)
      useTimelineStore.getState().addKeyframe('op / value', {
        position: 0,
        value: 0,
        interpolation: 'bezier',
      })
      useTimelineStore.getState().addKeyframe('op / value', {
        position: 6,
        value: 100,
        interpolation: 'linear',
      })

      const exported = useTimelineStore.getState().toTheatreJSON()
      useTimelineStore.getState().reset()
      useTimelineStore.getState().fromTheatreJSON(exported)

      const state = useTimelineStore.getState()
      expect(state.sequence.length).toBe(12)
      expect(state.sequence.fps).toBe(30)

      const track = state.tracks.get('op / value')
      expect(track?.keyframes).toHaveLength(2)
    })

    it('treats a sheet without sequence as an empty timeline', () => {
      useTimelineStore.getState().setLength(20)
      useTimelineStore.getState().getOrCreateTrack('op / value', 0)
      useTimelineStore.getState().addKeyframe('op / value', {
        position: 1,
        value: 10,
        interpolation: 'linear',
      })

      const theatreData = {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                editor: {
                  layoutMode: 'noodles-on-top',
                },
              },
            },
          },
        },
        definitionVersion: '0.4.0',
        revisionHistory: [],
      } as unknown as TheatreTimelineData

      expect(() => useTimelineStore.getState().fromTheatreJSON(theatreData)).not.toThrow()

      const state = useTimelineStore.getState()
      expect(state.sequence.length).toBe(DEFAULT_SEQUENCE_STATE.length)
      expect(state.sequence.fps).toBe(DEFAULT_SEQUENCE_STATE.fps)
      expect(state.tracks.size).toBe(0)
      expect(state.position).toBe(0)
      expect(state.playing).toBe(false)
    })
  })

  describe('reset', () => {
    it('resets all state to defaults', () => {
      useTimelineStore.getState().setLength(20)
      useTimelineStore.getState().setPosition(5)
      useTimelineStore.getState().play()
      useTimelineStore.getState().getOrCreateTrack('test / value', 0)
      useTimelineStore.getState().addKeyframe('test / value', {
        position: 0,
        value: 10,
        interpolation: 'linear',
      })

      useTimelineStore.getState().reset()

      const state = useTimelineStore.getState()
      expect(state.sequence.length).toBe(10)
      expect(state.position).toBe(0)
      expect(state.playing).toBe(false)
      expect(state.tracks.size).toBe(0)
    })
  })
})
