# Verification Plan

## Overview

This document specifies how we will verify the native timeline system matches Theatre.js in functionality, visual polish, and performance. The verification strategy uses side-by-side comparison during development and comprehensive testing before Theatre.js removal.

## 1. Side-by-Side Development Strategy

### Feature Flag Implementation

```typescript
// timeline-editor.tsx
// Read from URL query param: ?use_theatre=true to use Theatre.js (default: false = native)
function useTimelineFlag(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('use_theatre') === 'true'
}

export function TimelineEditor() {
  const useTheatre = useTimelineFlag()

  if (useTheatre) {
    return <TheatreStudioWrapper />
  }
  return <NativeTimelinePanel />
}
```

### Development Workflow

1. Create feature flag (`USE_NATIVE_TIMELINE`) to toggle implementations
2. Develop native components alongside Theatre.js
3. Compare visually and behaviorally for each feature
4. Only remove Theatre.js after achieving verified parity

## 2. Visual Comparison Checklists

### Curve Editor Visual Parity

- [ ] Curve line thickness and anti-aliasing matches
- [ ] Handle control points same size and color
- [ ] Grid density and color matches
- [ ] Keyframe diamond size and shape matches
- [ ] Selection highlight color and style matches
- [ ] Curve overshoot visualization matches
- [ ] Zoom behavior feels identical
- [ ] Background color and contrast matches
- [ ] Font styles for labels match

### Timeline Panel Visual Parity

- [ ] Track row height matches
- [ ] Playhead color and width matches
- [ ] Time ruler tick mark density matches
- [ ] Keyframe diamond alignment matches
- [ ] Scroll behavior smoothness matches
- [ ] Zoom center-on-cursor behavior matches
- [ ] Track label typography matches
- [ ] Expand/collapse arrow styling matches
- [ ] Overall spacing and padding matches

### Scrubbable Input Visual Parity

- [ ] Input field dimensions match
- [ ] Drag cursor matches (`ew-resize`)
- [ ] Value display precision matches
- [ ] Keyframe indicator size and position matches
- [ ] Focus/hover states match
- [ ] Disabled state styling matches
- [ ] Error state styling matches

## 3. Behavioral Comparison Checklists

### Curve Editor Behavior

- [ ] Handle drag speed feels identical
- [ ] Handle constraints work the same (auto/free/aligned/vector)
- [ ] Snap-to-grid behavior matches
- [ ] Multi-select feels identical
- [ ] Undo/redo granularity matches
- [ ] Preset application matches
- [ ] Zoom range matches
- [ ] Pan behavior matches

### Timeline Panel Behavior

- [ ] Playhead scrub responsiveness matches
- [ ] Keyframe drag latency matches
- [ ] Zoom speed matches
- [ ] Pan smoothness matches
- [ ] Keyboard shortcut response matches
- [ ] Track selection behavior matches
- [ ] Context menu timing matches
- [ ] Double-click behavior matches

### Scrubbable Input Behavior

- [ ] Drag sensitivity feels identical at all modifier key combinations
- [ ] Value update latency matches
- [ ] Double-click-to-type responsiveness matches
- [ ] Escape cancel behavior matches
- [ ] Tab navigation matches
- [ ] Arrow key increment matches
- [ ] Value clamping (min/max) matches

## 4. Interpolation Accuracy Verification

### Test Harness

```typescript
// interpolation.test.ts
import { evaluateTheatre, evaluateNative } from './test-utils'

const TEST_CURVES = [
  // Standard presets
  { name: 'linear', handles: [[0.33, 0.33], [0.67, 0.67]] },
  { name: 'ease-in', handles: [[0.42, 0], [1, 1]] },
  { name: 'ease-out', handles: [[0, 0], [0.58, 1]] },
  { name: 'ease-in-out', handles: [[0.42, 0], [0.58, 1]] },

  // Power-based
  { name: 'quad-in', handles: [[0.55, 0.085], [0.68, 0.53]] },
  { name: 'quad-out', handles: [[0.25, 0.46], [0.45, 0.94]] },
  { name: 'cubic-in', handles: [[0.55, 0.055], [0.675, 0.19]] },
  { name: 'cubic-out', handles: [[0.215, 0.61], [0.355, 1]] },
  { name: 'quart-in', handles: [[0.895, 0.03], [0.685, 0.22]] },
  { name: 'quart-out', handles: [[0.165, 0.84], [0.44, 1]] },
  { name: 'quint-in', handles: [[0.755, 0.05], [0.855, 0.06]] },
  { name: 'quint-out', handles: [[0.23, 1], [0.32, 1]] },
  { name: 'expo-in', handles: [[0.95, 0.05], [0.795, 0.035]] },
  { name: 'expo-out', handles: [[0.19, 1], [0.22, 1]] },

  // Overshoot
  { name: 'back-in', handles: [[0.6, -0.28], [0.735, 0.045]] },
  { name: 'back-out', handles: [[0.175, 0.885], [0.32, 1.275]] },
]

const TIME_SAMPLES = [0, 0.1, 0.2, 0.25, 0.333, 0.5, 0.667, 0.75, 0.8, 0.9, 1.0]

describe('Interpolation accuracy', () => {
  TEST_CURVES.forEach(curve => {
    describe(curve.name, () => {
      TIME_SAMPLES.forEach(t => {
        test(`at t=${t} matches Theatre.js`, () => {
          const theatreValue = evaluateTheatre(curve.handles, t)
          const nativeValue = evaluateNative(curve.handles, t)
          expect(nativeValue).toBeCloseTo(theatreValue, 6) // 6 decimal places
        })
      })
    })
  })
})
```

### Acceptance Criteria

- All standard easing presets match Theatre.js output within 6 decimal places
- Edge cases (t=0, t=1) return exact start/end values
- Overshoot curves correctly exceed 0-1 range
- Hold/step interpolation returns exact previous keyframe value

## 5. Theatre.js-Derived Test Cases

These test cases are derived from analyzing Theatre.js's implementation to ensure our native system handles the same edge cases correctly.

### 5.1 UnitBezier Solver Tests

Theatre.js uses the `timing-function` library's UnitBezier class. Our implementation must match its behavior.

```typescript
// unit-bezier.test.ts
describe('UnitBezier solver', () => {
  // Core algorithm: Newton-Raphson with 8 iterations, fallback to binary search
  const EPSILON = 1e-6

  describe('Newton-Raphson convergence', () => {
    test('converges within 8 iterations for standard curves', () => {
      // ease-in-out: should converge quickly
      const bezier = new UnitBezier(0.42, 0, 0.58, 1)
      const iterationCount = countIterations(bezier, 0.5)
      expect(iterationCount).toBeLessThanOrEqual(8)
    })

    test('falls back to binary search for difficult curves', () => {
      // Very steep curve that may not converge via Newton-Raphson
      const bezier = new UnitBezier(0.99, 0.01, 0.01, 0.99)
      expect(() => bezier.solve(0.5, EPSILON)).not.toThrow()
    })

    test('handles curves with near-zero derivative', () => {
      // Curve where derivative approaches zero (causes Newton-Raphson issues)
      const bezier = new UnitBezier(0.5, 0, 0.5, 1)
      expect(bezier.solve(0.5, EPSILON)).toBeCloseTo(0.5, 5)
    })
  })

  describe('boundary conditions', () => {
    test('solve(0) returns exactly 0', () => {
      const bezier = new UnitBezier(0.42, 0, 0.58, 1)
      expect(bezier.solve(0, EPSILON)).toBe(0)
    })

    test('solve(1) returns exactly 1', () => {
      const bezier = new UnitBezier(0.42, 0, 0.58, 1)
      expect(bezier.solve(1, EPSILON)).toBe(1)
    })

    test('clamps x < 0 to 0', () => {
      const bezier = new UnitBezier(0.42, 0, 0.58, 1)
      expect(bezier.solve(-0.1, EPSILON)).toBe(0)
    })

    test('clamps x > 1 to 1', () => {
      const bezier = new UnitBezier(0.42, 0, 0.58, 1)
      expect(bezier.solve(1.1, EPSILON)).toBe(1)
    })
  })

  describe('precision', () => {
    test('matches Theatre.js epsilon of 1e-6', () => {
      const bezier = new UnitBezier(0.25, 0.1, 0.25, 1)
      const result = bezier.solve(0.5, 1e-6)
      // Re-evaluate to verify precision
      const x = bezier.sampleCurveX(bezier.solveCurveX(0.5, 1e-6))
      expect(Math.abs(x - 0.5)).toBeLessThan(1e-6)
    })
  })
})
```

### 5.2 Keyframe State Machine Tests

Theatre.js uses a state machine for keyframe interpolation. Test all state transitions.

```typescript
// keyframe-states.test.ts
describe('Keyframe state machine', () => {
  describe('beforeFirstKeyframe state', () => {
    test('time < first keyframe returns first keyframe value', () => {
      const track = createTrack([
        { position: 1.0, value: 100 },
        { position: 2.0, value: 200 },
      ])
      expect(evaluateTrack(track, 0)).toBe(100)
      expect(evaluateTrack(track, 0.5)).toBe(100)
      expect(evaluateTrack(track, 0.999)).toBe(100)
    })

    test('validity range is (-Infinity, firstKeyframe.position)', () => {
      const track = createTrack([{ position: 1.0, value: 100 }])
      const state = getTrackState(track, 0)
      expect(state.validFrom).toBe(-Infinity)
      expect(state.validTo).toBe(1.0)
    })
  })

  describe('lastKeyframe state', () => {
    test('time > last keyframe returns last keyframe value', () => {
      const track = createTrack([
        { position: 1.0, value: 100 },
        { position: 2.0, value: 200 },
      ])
      expect(evaluateTrack(track, 2.0)).toBe(200)
      expect(evaluateTrack(track, 2.5)).toBe(200)
      expect(evaluateTrack(track, 100)).toBe(200)
    })

    test('validity range is (lastKeyframe.position, Infinity)', () => {
      const track = createTrack([{ position: 2.0, value: 200 }])
      const state = getTrackState(track, 3.0)
      expect(state.validFrom).toBe(2.0)
      expect(state.validTo).toBe(Infinity)
    })
  })

  describe('between keyframes state', () => {
    test('exact keyframe position returns keyframe value', () => {
      const track = createTrack([
        { position: 1.0, value: 100 },
        { position: 2.0, value: 200 },
      ])
      expect(evaluateTrack(track, 1.0)).toBe(100)
      expect(evaluateTrack(track, 2.0)).toBe(200)
    })

    test('validity range is bounded by surrounding keyframes', () => {
      const track = createTrack([
        { position: 1.0, value: 100 },
        { position: 2.0, value: 200 },
        { position: 3.0, value: 300 },
      ])
      const state = getTrackState(track, 1.5)
      expect(state.validFrom).toBe(1.0)
      expect(state.validTo).toBe(2.0)
    })
  })

  describe('empty track', () => {
    test('returns undefined for empty track', () => {
      const track = createTrack([])
      expect(evaluateTrack(track, 0)).toBeUndefined()
      expect(evaluateTrack(track, 1)).toBeUndefined()
    })

    test('validity range is (-Infinity, Infinity)', () => {
      const track = createTrack([])
      const state = getTrackState(track, 0)
      expect(state.validFrom).toBe(-Infinity)
      expect(state.validTo).toBe(Infinity)
    })
  })

  describe('single keyframe', () => {
    test('always returns single keyframe value', () => {
      const track = createTrack([{ position: 1.0, value: 100 }])
      expect(evaluateTrack(track, 0)).toBe(100)
      expect(evaluateTrack(track, 1.0)).toBe(100)
      expect(evaluateTrack(track, 2.0)).toBe(100)
    })
  })
})
```

### 5.3 Hold/Disconnected Keyframe Tests

Theatre.js supports "hold" interpolation where values step rather than interpolate.

```typescript
// hold-interpolation.test.ts
describe('Hold interpolation', () => {
  test('connectedRight=false causes step behavior', () => {
    const track = createTrack([
      { position: 0, value: 0, connectedRight: false },
      { position: 1, value: 100 },
    ])
    // Should hold at 0 until exactly position 1
    expect(evaluateTrack(track, 0)).toBe(0)
    expect(evaluateTrack(track, 0.5)).toBe(0)
    expect(evaluateTrack(track, 0.99)).toBe(0)
    expect(evaluateTrack(track, 1.0)).toBe(100)
  })

  test('type="hold" uses floor function', () => {
    const track = createTrack([
      { position: 0, value: 0, type: 'hold' },
      { position: 1, value: 100 },
    ])
    // Theatre.js uses Math.floor(progression) for hold type
    expect(evaluateTrack(track, 0)).toBe(0)
    expect(evaluateTrack(track, 0.999)).toBe(0)
    expect(evaluateTrack(track, 1.0)).toBe(100)
  })

  test('mixed hold and bezier keyframes', () => {
    const track = createTrack([
      { position: 0, value: 0, type: 'bezier', connectedRight: true },
      { position: 1, value: 100, type: 'hold', connectedRight: false },
      { position: 2, value: 200 },
    ])
    // First segment: bezier interpolation
    expect(evaluateTrack(track, 0.5)).toBeGreaterThan(0)
    expect(evaluateTrack(track, 0.5)).toBeLessThan(100)
    // Second segment: hold at 100
    expect(evaluateTrack(track, 1.5)).toBe(100)
  })
})
```

### 5.4 Bezier Handle Format Tests

Theatre.js stores handles as `[leftX, leftY, rightX, rightY]` and uses right handle of left keyframe + left handle of right keyframe.

```typescript
// bezier-handles.test.ts
describe('Bezier handle format', () => {
  test('handles array format [leftX, leftY, rightX, rightY]', () => {
    const keyframe = {
      position: 0,
      value: 0,
      handles: [0.5, 1, 0.5, 0], // Theatre.js format
      connectedRight: true,
    }
    // Parse handles correctly
    const parsed = parseHandles(keyframe.handles)
    expect(parsed.left).toEqual([0.5, 1])
    expect(parsed.right).toEqual([0.5, 0])
  })

  test('bezier uses right handle of left kf + left handle of right kf', () => {
    // This is how Theatre.js constructs the bezier:
    // new UnitBezier(left.handles[2], left.handles[3], right.handles[0], right.handles[1])
    const leftKf = { handles: [0.5, 1, 0.42, 0] }
    const rightKf = { handles: [0.58, 1, 0.5, 0] }

    // The bezier is constructed from:
    // p1x = leftKf.handles[2] = 0.42
    // p1y = leftKf.handles[3] = 0
    // p2x = rightKf.handles[0] = 0.58
    // p2y = rightKf.handles[1] = 1
    const bezier = constructBezierBetween(leftKf, rightKf)
    expect(bezier.p1x).toBe(0.42)
    expect(bezier.p1y).toBe(0)
    expect(bezier.p2x).toBe(0.58)
    expect(bezier.p2y).toBe(1)
  })
})
```

### 5.5 Color Interpolation Tests (OKLAB)

Theatre.js interpolates colors in OKLAB color space for perceptual uniformity.

```typescript
// color-interpolation.test.ts
describe('Color interpolation (OKLAB)', () => {
  test('interpolates in OKLAB space, not RGB', () => {
    const red = { r: 1, g: 0, b: 0, a: 1 }
    const blue = { r: 0, g: 0, b: 1, a: 1 }

    const midpoint = interpolateColor(red, blue, 0.5)

    // OKLAB interpolation produces different results than RGB lerp
    // RGB lerp would give { r: 0.5, g: 0, b: 0.5 } (purple)
    // OKLAB produces a more perceptually uniform result
    expect(midpoint.r).not.toBe(0.5)
    expect(midpoint.b).not.toBe(0.5)
  })

  test('preserves exact values at t=0 and t=1', () => {
    const c1 = { r: 0.2, g: 0.4, b: 0.6, a: 0.8 }
    const c2 = { r: 0.8, g: 0.6, b: 0.4, a: 1.0 }

    expect(interpolateColor(c1, c2, 0)).toEqual(c1)
    expect(interpolateColor(c1, c2, 1)).toEqual(c2)
  })

  test('alpha channel interpolates linearly', () => {
    const c1 = { r: 1, g: 0, b: 0, a: 0 }
    const c2 = { r: 1, g: 0, b: 0, a: 1 }

    const mid = interpolateColor(c1, c2, 0.5)
    expect(mid.a).toBeCloseTo(0.5, 5)
  })

  test('clamps output to 0-1 range', () => {
    const c1 = { r: 0, g: 0, b: 0, a: 1 }
    const c2 = { r: 1, g: 1, b: 1, a: 1 }

    for (let t = 0; t <= 1; t += 0.1) {
      const result = interpolateColor(c1, c2, t)
      expect(result.r).toBeGreaterThanOrEqual(0)
      expect(result.r).toBeLessThanOrEqual(1)
      expect(result.g).toBeGreaterThanOrEqual(0)
      expect(result.g).toBeLessThanOrEqual(1)
      expect(result.b).toBeGreaterThanOrEqual(0)
      expect(result.b).toBeLessThanOrEqual(1)
    }
  })
})
```

### 5.6 Number Deserialization Tests

Theatre.js sanitizes number inputs with range clamping and NaN/Infinity handling.

```typescript
// number-validation.test.ts
describe('Number validation', () => {
  test('clamps to range if specified', () => {
    const config = { range: [0, 100] as [number, number] }
    expect(deserializeNumber(-10, config)).toBe(0)
    expect(deserializeNumber(150, config)).toBe(100)
    expect(deserializeNumber(50, config)).toBe(50)
  })

  test('rejects NaN', () => {
    expect(deserializeNumber(NaN)).toBeUndefined()
  })

  test('rejects Infinity', () => {
    expect(deserializeNumber(Infinity)).toBeUndefined()
    expect(deserializeNumber(-Infinity)).toBeUndefined()
  })

  test('accepts valid numbers without range', () => {
    expect(deserializeNumber(0)).toBe(0)
    expect(deserializeNumber(-1000)).toBe(-1000)
    expect(deserializeNumber(1000)).toBe(1000)
  })
})
```

### 5.7 Progression Calculation Tests

Theatre.js calculates local progression between keyframes.

```typescript
// progression.test.ts
describe('Progression calculation', () => {
  test('calculates local progression correctly', () => {
    // globalProgressionToLocalProgression formula:
    // (globalProgression - left.position) / (right.position - left.position)
    const left = { position: 2.0 }
    const right = { position: 4.0 }

    expect(calculateLocalProgression(2.0, left, right)).toBe(0)
    expect(calculateLocalProgression(3.0, left, right)).toBe(0.5)
    expect(calculateLocalProgression(4.0, left, right)).toBe(1)
  })

  test('handles keyframes at same position', () => {
    const left = { position: 1.0 }
    const right = { position: 1.0 }

    // Avoid division by zero
    expect(() => calculateLocalProgression(1.0, left, right)).not.toThrow()
  })
})
```

### 5.8 Field Binding Edge Cases (from existing Noodles tests)

These patterns are already tested in `theatre-bindings.test.ts` and must be preserved.

```typescript
// field-bindings.test.ts - Edge cases to preserve
describe('Field binding edge cases', () => {
  test('skips /out operator binding', () => {
    // /out is special and should never be bound to timeline
  })

  test('skips already bound operators', () => {
    // Prevent duplicate bindings
  })

  test('handles nested CompoundPropsField', () => {
    // Recursive binding for viewState.latitude, etc.
  })

  test('no cold prism warnings during rapid updates', () => {
    // Theatre.js Dataverse can warn about cold prisms
    // Our implementation should not produce similar warnings
  })

  test('DateField converts to/from epoch milliseconds', () => {
    // Temporal.PlainDateTime ↔ number
  })

  test('ColorField converts hex to RGBA and back', () => {
    // #RRGGBB ↔ { r, g, b, a }
  })

  test('Vec2Field converts array to object and back', () => {
    // [x, y] ↔ { x, y }
  })
})
```

## 6. Performance Benchmarks

### Target Metrics

| Metric | Theatre.js Baseline | Target | Method |
|--------|---------------------|--------|--------|
| Playhead scrub FPS | 60fps | 60fps | Chrome DevTools FPS meter |
| Curve rendering FPS | 60fps | 60fps | requestAnimationFrame timing |
| Keyframe drag latency | <16ms | <16ms | Performance.now() measurement |
| Timeline zoom latency | <16ms | <16ms | Performance.now() measurement |
| Store update propagation | <8ms | <8ms | Zustand devtools timing |

### Stress Test Scenarios

```typescript
// performance.test.ts

describe('Performance', () => {
  test('handles 100+ keyframes on single track', async () => {
    const track = createTrackWithKeyframes(100)
    const start = performance.now()

    for (let i = 0; i < 1000; i++) {
      evaluateTrack(track, Math.random() * track.length)
    }

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(100) // 1000 evaluations in <100ms
  })

  test('handles 50+ animated tracks visible', async () => {
    const tracks = Array.from({ length: 50 }, (_, i) =>
      createTrackWithKeyframes(10)
    )
    const start = performance.now()

    for (let frame = 0; frame < 60; frame++) {
      tracks.forEach(track => evaluateTrack(track, frame / 30))
    }

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(16.67 * 60) // 60 frames at 60fps
  })

  test('rapid playhead scrubbing', async () => {
    // Simulate 1000 position changes in rapid succession
    const positions = Array.from({ length: 1000 }, () => Math.random() * 10)
    const start = performance.now()

    positions.forEach(pos => {
      store.setPosition(pos)
    })

    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1000) // All updates in <1 second
  })
})
```

### Performance Profiling Checklist

- [ ] No memory leaks during extended scrubbing (30+ minutes)
- [ ] No dropped frames during continuous playback
- [ ] Garbage collection pauses < 5ms
- [ ] DOM node count stable during timeline operations
- [ ] Canvas/WebGL memory usage reasonable (<100MB)

## 7. Unit Tests

### Interpolation Tests (`interpolation.test.ts`)

- [ ] Cubic bezier evaluation at various t values
- [ ] Newton-Raphson solver convergence
- [ ] Number interpolation (basic lerp)
- [ ] Color interpolation (RGBA channels)
- [ ] Vec2/Vec3 interpolation (per-component)
- [ ] Compound object interpolation (recursive)
- [ ] Hold/step interpolation
- [ ] Edge cases: t < 0, t > 1
- [ ] Edge cases: single keyframe
- [ ] Edge cases: keyframes at same position

### Timeline Store Tests (`timeline-store.test.ts`)

- [ ] Create/read/update/delete tracks
- [ ] Create/read/update/delete keyframes
- [ ] Keyframe sorting by position
- [ ] Selection management (single, multi, clear)
- [ ] Playback state (play, pause, position, speed)
- [ ] Sequence state (length, fps)
- [ ] Serialization (toJSON)
- [ ] Deserialization (fromJSON)
- [ ] Round-trip serialization (toJSON → fromJSON → toJSON)
- [ ] Undo/redo operations
- [ ] History stack limits

### Field Bindings Tests (`field-bindings.test.ts`)

- [ ] Field type detection (isAnimatableField)
- [ ] NumberField conversion (direct)
- [ ] ColorField conversion (hex ↔ RGBA)
- [ ] DateField conversion (Temporal ↔ epoch ms)
- [ ] Vec2Field conversion (array ↔ object)
- [ ] Vec3Field conversion (array ↔ object)
- [ ] Point2D/Point3D conversion
- [ ] CompoundPropsField conversion (recursive)
- [ ] Two-way sync: field change updates timeline
- [ ] Two-way sync: timeline change updates field
- [ ] Infinite loop prevention (updating flag)
- [ ] Locked operator handling

### Migration Tests (`migrate-timeline.test.ts`)

- [ ] Empty timeline migration
- [ ] Single track migration
- [ ] Multiple tracks migration
- [ ] Complex keyframe data migration
- [ ] Handle format conversion
- [ ] Object name conversion
- [ ] Static overrides handling
- [ ] Malformed data handling
- [ ] All example projects migrate successfully

## 8. Integration Tests

### Project Lifecycle Tests

- [ ] Load project with Theatre.js timeline → verify migration
- [ ] Create keyframes → save → reload → verify persistence
- [ ] Modify keyframes → save → reload → verify changes
- [ ] Delete all keyframes → save → reload → verify empty timeline

### Animation Playback Tests

- [ ] Playback at 1x speed matches expected timing
- [ ] Playback at 0.5x speed matches expected timing
- [ ] Playback at 2x speed matches expected timing
- [ ] Loop playback restarts at sequence start
- [ ] Step forward/backward moves by exactly one frame
- [ ] Go to start/end jumps to correct position

### Video Rendering Tests

- [ ] Render with keyframed animation produces expected frames
- [ ] Frame timing is accurate at all FPS settings
- [ ] Rendered video matches Theatre.js output (visual diff)
- [ ] Long sequences render without memory issues

### Example Project Tests

Test each example project individually:

- [ ] `world-flights` - loads, animates, renders correctly
- [ ] `nyc-taxis` - loads, animates, renders correctly
- [ ] `us-airports` - loads, animates, renders correctly
- [ ] All other example projects in `/public/examples/`

## 9. Manual Testing Protocol

### Pre-Release Checklist

Before removing Theatre.js, manually verify:

1. **Basic Operations**
   - [ ] Create a new keyframe by double-clicking timeline
   - [ ] Delete a keyframe via context menu
   - [ ] Move a keyframe by dragging
   - [ ] Edit keyframe value via property panel
   - [ ] Change easing by opening curve editor

2. **Curve Editor**
   - [ ] Open curve editor for a keyframed property
   - [ ] Drag bezier handles
   - [ ] Apply easing preset
   - [ ] See curve update in real-time
   - [ ] Close editor and verify changes persist

3. **Playback**
   - [ ] Press Space to play/pause
   - [ ] Drag playhead and see visualization update
   - [ ] Use step forward/backward buttons
   - [ ] Enable loop and verify looping behavior
   - [ ] Change playback speed

4. **Property Panel**
   - [ ] See keyframe indicator on animated properties
   - [ ] Click indicator to add keyframe at current time
   - [ ] Click indicator to remove keyframe at current time
   - [ ] Scrub number values by dragging
   - [ ] Use Shift+drag for fine control

5. **Video Rendering**
   - [ ] Render a short animation to video
   - [ ] Verify all keyframed properties animate correctly
   - [ ] Compare output with Theatre.js render

### User Testing Protocol

Before full rollout:

1. Internal team uses native timeline for 1 week
2. Document any UX friction points in issues
3. A/B test with select external users (feature flag)
4. Gather feedback on specific interactions
5. Iterate until parity achieved

## 10. Rollback Plan

If critical issues are discovered after Theatre.js removal:

1. **Immediate rollback**: Revert commit that removed Theatre.js
2. **Data recovery**: Migration script is reversible (preserve original timeline data in backup field)
3. **Feature flag**: Re-enable feature flag to route to Theatre.js implementation
4. **Communication**: Notify users of temporary regression

### Monitoring After Release

- Track error rates in timeline operations
- Monitor performance metrics (FPS, latency)
- Watch for user-reported issues
- Keep Theatre.js as optional dependency for 30 days post-release
