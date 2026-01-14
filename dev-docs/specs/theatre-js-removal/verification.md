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

## 5. Performance Benchmarks

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

## 6. Unit Tests

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

## 7. Integration Tests

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

## 8. Manual Testing Protocol

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

## 9. Rollback Plan

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
