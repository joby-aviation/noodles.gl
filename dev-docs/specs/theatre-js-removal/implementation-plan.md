# Implementation Plan

## Overview

This document outlines the phased implementation plan for replacing Theatre.js with a native timeline system. The plan is organized into 6 phases over approximately 4-6 weeks.

## Phase 1: Core Engine (Week 1-2)

### 1.1 Bezier Interpolation Engine

**File:** `/noodles-editor/src/timeline/interpolation.ts`
**Complexity:** Medium-High
**Estimate:** 2-3 days

**Prerequisites:**
- Understanding of cubic bezier mathematics (de Casteljau's algorithm)
- Familiarity with Newton-Raphson root-finding method
- Access to Theatre.js source for reference implementation comparison

**Dependencies:**
- `types.ts` must be completed first (defines KeyframeValue, BezierHandles types)
- No external runtime dependencies (pure math functions)

**Implementation Requirements:**

1. **Cubic Bezier Evaluation** (`evaluateCubicBezier`)
   - Input: t (0-1), four control points (p0, p1, p2, p3)
   - Output: interpolated value at t
   - Must handle values outside 0-1 range for overshoot curves
   - Implementation: `p0*(1-t)³ + 3*p1*t*(1-t)² + 3*p2*t²*(1-t) + p3*t³`

2. **Newton-Raphson Solver** (`findTForX`)
   - Input: target x position (0-1), control point x values (x1, x2)
   - Output: t parameter that produces target x
   - Convergence epsilon: 0.0001 (matches Theatre.js precision)
   - Max iterations: 8 (fallback to binary search if no convergence)
   - Critical: This maps time progression to curve parameter

3. **Type-Specific Interpolation**
   ```typescript
   // Each function must handle the specific data format
   interpolateNumber(v1: number, v2: number, t: number): number
   interpolateColor(c1: RGBA, c2: RGBA, t: number): RGBA  // Per-channel lerp
   interpolateVec2(v1: Vec2, v2: Vec2, t: number): Vec2   // {x, y} format
   interpolateVec3(v1: Vec3, v2: Vec3, t: number): Vec3   // {x, y, z} format
   interpolateCompound(v1: object, v2: object, t: number): object  // Recursive
   ```

4. **Track Evaluation** (`evaluateTrack`)
   - Binary search for O(log n) keyframe lookup
   - Handle edge cases:
     - `time < firstKeyframe.position` → return first keyframe value
     - `time > lastKeyframe.position` → return last keyframe value
     - `time === keyframe.position` → return exact keyframe value
     - Single keyframe → always return that value
   - Apply interpolation based on `keyframe.interpolation` type

**Tasks:**
- [ ] Implement `evaluateCubicBezier(t, p0, p1, p2, p3)` for cubic bezier evaluation
- [ ] Implement `findTForX(x, x1, x2)` using Newton-Raphson method
- [ ] Implement type-specific interpolation functions:
  - `interpolateNumber(v1, v2, t)`
  - `interpolateColor(c1, c2, t)` - RGBA component interpolation
  - `interpolateVec2(v1, v2, t)`
  - `interpolateVec3(v1, v2, t)`
  - `interpolateCompound(v1, v2, t)` - recursive
- [ ] Implement `evaluateTrack(track, time)` with binary search for keyframe lookup
- [ ] Handle edge cases: before first keyframe, after last keyframe, single keyframe
- [ ] Support "hold" interpolation mode (step function)

**Reference:** `BezierCurveField` in `fields.ts:1097-1394` has existing bezier math.

**Test file:** `interpolation.test.ts`
- Test all easing presets against known CSS cubic-bezier values
- Test edge cases (t=0, t=1, overshoot values)
- Test type-specific interpolation
- Verify Newton-Raphson convergence for all standard curves

### 1.2 Timeline Store

**File:** `/noodles-editor/src/timeline/timeline-store.ts`
**Complexity:** Medium
**Estimate:** 3-4 days

**Prerequisites:**
- Familiarity with Zustand store patterns used in existing codebase
- Understanding of three-tier state model (historic, ephemeral, ahistorical)

**Dependencies:**
- `types.ts` - All type definitions
- `interpolation.ts` - For `evaluateTrack` implementation
- `zustand` (already in project dependencies)
- `zustand/middleware` for persist middleware (ahistorical state)

**Implementation Requirements:**

1. **Store Structure**
   ```typescript
   interface TimelineStore {
     // Historic (serialized to project)
     sequence: { length: number; fps: number }
     tracks: Map<string, Track>

     // Ephemeral (session only, reset on load)
     position: number
     playing: boolean
     loop: boolean
     playbackSpeed: number
     selectedKeyframeIds: Set<string>

     // Actions (see full list below)
   }
   ```

2. **Zustand Middleware Stack**
   ```typescript
   // Use immer for immutable updates to nested structures
   // Use subscribeWithSelector for fine-grained subscriptions
   // Use persist for ahistorical state (separate store)
   create<TimelineStore>()(
     subscribeWithSelector(
       immer((set, get) => ({
         // ... state and actions
       }))
     )
   )
   ```

3. **Track Operations**
   - `getOrCreateTrack(fieldPath, defaultValue)` - Idempotent track creation
   - `deleteTrack(trackId)` - Remove track and all keyframes
   - `hasKeyframesForField(fieldPath)` - Check if field is animated
   - Track ID format: use fieldPath directly (e.g., `/maplibre-basemap.viewState.zoom`)

4. **Keyframe Operations**
   - `addKeyframe(trackId, keyframe)` - Insert and maintain sorted order
   - `updateKeyframe(trackId, keyframeId, updates)` - Partial update
   - `deleteKeyframe(trackId, keyframeId)` - Remove single keyframe
   - `moveKeyframe(trackId, keyframeId, newPosition)` - Reposition and re-sort
   - Keyframe IDs: Generate with `kf_${nanoid(8)}`

5. **Serialization Format**
   ```typescript
   toJSON(): { sequence: {...}, tracks: {...} }
   fromJSON(json): void  // Validates and loads

   // Must handle:
   // - Missing fields (use defaults)
   // - Extra fields (ignore, don't error)
   // - Type validation (Zod schema)
   ```

6. **History for Undo/Redo**
   - Capture state snapshots before mutations
   - Limit history stack to 50 entries
   - Clear future on new mutation
   - `pushHistory()` called before each mutation
   - Consider using `zustand-history` or custom implementation

**Tasks:**
- [ ] Define TypeScript interfaces for all state types
- [ ] Create Zustand store with historic, ephemeral, and ahistorical slices
- [ ] Implement sequence actions (setLength, setFps)
- [ ] Implement playback actions (play, pause, setPosition, etc.)
- [ ] Implement track CRUD operations
- [ ] Implement keyframe CRUD operations
- [ ] Implement selection management
- [ ] Implement `evaluateTrack` and `evaluateAllTracks` using interpolation engine
- [ ] Implement `toJSON` and `fromJSON` for serialization
- [ ] Implement undo/redo history stack

**Test file:** `timeline-store.test.ts`
- Test CRUD operations
- Test serialization round-trip
- Test undo/redo
- Test keyframe sorting after move/add
- Test selection state management

### 1.3 Field Bindings

**File:** `/noodles-editor/src/timeline/field-bindings.ts`
**Complexity:** Medium
**Estimate:** 2-3 days

**Prerequisites:**
- Understanding of RxJS subscription patterns (fields are observables)
- Familiarity with existing `theatre-bindings.ts` patterns

**Dependencies:**
- `timeline-store.ts` - Store must be complete
- `types.ts` - Type definitions
- Field classes from `fields.ts` - For type detection
- RxJS (already in project) - For field subscriptions

**Implementation Requirements:**

1. **Field Type Detection**
   ```typescript
   function isAnimatableField(field: Field): boolean {
     // Animatable types (from theatre-bindings.ts analysis):
     return field instanceof NumberField
       || field instanceof BooleanField
       || field instanceof StringField
       || field instanceof StringLiteralField
       || field instanceof ColorField
       || field instanceof DateField
       || field instanceof Vec2Field
       || field instanceof Vec3Field
       || field instanceof Point2DField
       || field instanceof Point3DField
       || field instanceof CompoundPropsField
   }

   // NOT animatable:
   // - CodeField (functions can't be interpolated)
   // - DataField (arbitrary objects)
   // - AccessorField (functions)
   ```

2. **Type Conversions**
   ```typescript
   // Field → Keyframe value
   ColorField: hex string → { r, g, b, a } (0-1 range)
   DateField: Temporal.PlainDateTime → epoch milliseconds (number)
   Vec2Field: [x, y] array → { x, y } object
   Vec3Field: [x, y, z] array → { x, y, z } object
   Point2DField: [lng, lat] → { lng, lat }
   Point3DField: [lng, lat, alt] → { lng, lat, alt }
   CompoundPropsField: recursive conversion

   // Keyframe value → Field (reverse of above)
   ```

3. **Two-Way Binding Pattern**

   Order matters: position subscription → initial evaluation → field subscription.
   The initial evaluation fires before the field subscription is registered, so no
   `updating` guard is strictly needed there, but it's included defensively.

   ```typescript
   function bindFieldToTimeline(op, fieldName, field, store) {
     let updating = false  // CRITICAL: Prevents infinite loops
     let lastKeyframeValue = undefined

     // Timeline → Field (fires on every position change)
     const timelineSub = store.subscribe(
       (state) => state.position,
       () => {
         if (updating || op.locked.value) return
         const value = store.evaluateTrack(fieldPath)
         if (value === undefined) return
         // Skip if value hasn't changed (optimization)
         if (lastKeyframeValue !== undefined &&
             JSON.stringify(value) === JSON.stringify(lastKeyframeValue)) return
         lastKeyframeValue = value
         updating = true
         try { field.setValue(keyframeValueToFieldValue(field, value)) }
         finally { updating = false }
       }
     )

     // Initial evaluation — sync field to current position on bind.
     // Runs before field subscription is set up, so no spurious keyframes are created.
     const initialValue = store.evaluateTrack(fieldPath)
     if (initialValue !== undefined) {
       updating = true
       try {
         const fieldValue = keyframeValueToFieldValue(field, initialValue)
         if (fieldValue !== undefined) {
           field.setValue(fieldValue)
           lastKeyframeValue = initialValue
         }
       } finally { updating = false }
     }

     // Field → Timeline (fires when user edits a value manually)
     const fieldSub = field.subscribe((value) => {
       if (updating || op.locked.value) return
       updating = true
       try {
         const kfValue = fieldValueToKeyframeValue(field, value)
         const existingKf = track?.keyframes.find(kf => Math.abs(kf.position - position) < 0.001)

         if (existingKf) {
           // Update keyframe in place
           store.updateKeyframe(fieldPath, existingKf.id, { value: kfValue })
         } else if (track && track.keyframes.length > 0) {
           // Only insert if value differs from currently interpolated.
           // Prevents redundant keyframes when the user sets the same value the
           // animation already produces at this position.
           const interpolated = store.evaluateTrack(fieldPath)
           if (JSON.stringify(kfValue) !== JSON.stringify(interpolated)) {
             store.addKeyframe(fieldPath, { position, value: kfValue, interpolation: 'bezier' })
           }
         }
         // No keyframes yet: user must click the keyframe indicator to start animating
       } finally { updating = false }
     })

     return () => {
       fieldSub.unsubscribe()
       timelineSub()
     }
   }
   ```

4. **Operator Binding**
   - Iterate all fields in `op.inputs` (parameters)
   - Skip non-animatable fields
   - Skip fields with active edge connections (value comes from upstream)
   - Create fieldPath: `opName / fieldName` (e.g. `my-op / value`)
   - Return combined cleanup function

5. **Edge Cases**
   - Locked operators: Skip all binding updates
   - Missing tracks: Create on first keyframe add (`getOrCreateTrack`)
   - Compound fields: Skipped in field→timeline path to avoid infinite loops
   - Operator deletion: Must call cleanup to prevent memory leaks

**Tasks:**
- [x] Implement `isAnimatableField(field)` detection
- [x] Implement type conversion functions:
  - `fieldValueToKeyframeValue(field, value)`
  - `keyframeValueToFieldValue(field, value)`
- [x] Handle hex ↔ RGBA color conversion
- [x] Handle Temporal.PlainDateTime ↔ epoch milliseconds
- [x] Handle array ↔ object format for vectors/points
- [x] Implement `bindFieldToTimeline(op, fieldName, field, store)`:
  - Subscribe to timeline position → update field value (interpolated)
  - Initial evaluation on bind → sync field to current position immediately
  - Subscribe to field changes → update or create keyframe
  - Only insert keyframe when new value differs from currently interpolated
  - Use `updating` flag to prevent infinite loops
  - Respect `op.locked` state
- [x] Implement `bindOperatorToTimeline(op, store)` for all fields
- [x] Implement cleanup/unbind functions

**Test file:** `field-bindings.test.ts`
- [x] Test type conversions (each field type)
- [x] Test initial evaluation on bind — field set to keyframe value immediately
- [x] Test scrubbing updates field value when keyframes exist
- [x] Test scrubbing does nothing when no keyframes exist
- [x] Test keyframe inserted when value differs from interpolated
- [x] Test no keyframe inserted when value matches interpolated
- [x] Test existing keyframe updated in place (not duplicated)
- [x] Test no keyframe inserted when track has no keyframes

### 1.4 Playback RAF Driver

**File:** `/noodles-editor/src/timeline/playback.ts`
**Complexity:** Low
**Estimate:** 1 day

**Prerequisites:**
- Understanding of `requestAnimationFrame` timing
- Familiarity with Theatre.js RAF driver pattern

**Dependencies:**
- `timeline-store.ts` - For position updates
- No external dependencies

**Implementation Requirements:**

1. **PlaybackDriver Class**
   ```typescript
   class PlaybackDriver {
     private rafId: number | null = null
     private lastTimestamp: number = 0
     private manualMode: boolean = false
     private subscribers = new Set<(deltaMs: number) => void>()

     // Start RAF loop
     start(): void {
       if (this.rafId !== null) return  // Already running
       this.lastTimestamp = performance.now()
       this.tick(this.lastTimestamp)
     }

     // Stop RAF loop
     stop(): void {
       if (this.rafId !== null) {
         cancelAnimationFrame(this.rafId)
         this.rafId = null
       }
     }

     // RAF callback
     private tick(timestamp: number): void {
       const deltaMs = timestamp - this.lastTimestamp
       this.lastTimestamp = timestamp

       // Notify all subscribers
       this.subscribers.forEach(cb => cb(deltaMs))

       // Schedule next frame
       this.rafId = requestAnimationFrame(t => this.tick(t))
     }

     // Subscribe to tick events
     subscribe(callback: (deltaMs: number) => void): () => void {
       this.subscribers.add(callback)
       return () => this.subscribers.delete(callback)
     }

     // Manual mode for video rendering
     setManualMode(enabled: boolean): void {
       this.manualMode = enabled
       if (enabled) this.stop()
     }

     // Force tick at specific time (for video rendering)
     manualTick(timestamp: number): void {
       if (!this.manualMode) return
       const deltaMs = timestamp - this.lastTimestamp
       this.lastTimestamp = timestamp
       this.subscribers.forEach(cb => cb(deltaMs))
     }
   }
   ```

2. **Integration with Timeline Store**
   ```typescript
   // In timeline initialization
   const unsubscribe = playbackDriver.subscribe((deltaMs) => {
     const store = useTimelineStore.getState()
     if (!store.playing) return

     const deltaSec = (deltaMs / 1000) * store.playbackSpeed
     let newPosition = store.position + deltaSec

     // Handle loop
     if (newPosition > store.sequence.length) {
       if (store.loop) {
         newPosition = newPosition % store.sequence.length
       } else {
         newPosition = store.sequence.length
         store.pause()
       }
     }

     store.setPosition(newPosition)
   })
   ```

3. **Video Rendering Integration**
   ```typescript
   // For frame-accurate video capture
   async function renderVideo(fps: number, duration: number) {
     playbackDriver.setManualMode(true)
     const frameCount = Math.ceil(duration * fps)

     for (let frame = 0; frame < frameCount; frame++) {
       const time = frame / fps
       store.setPosition(time)
       playbackDriver.manualTick(time * 1000)

       // Wait for render, capture frame
       await captureFrame()
     }

     playbackDriver.setManualMode(false)
   }
   ```

4. **Singleton Export**
   ```typescript
   export const playbackDriver = new PlaybackDriver()
   ```

**Tasks:**
- [ ] Create `PlaybackDriver` class with RAF loop
- [ ] Implement start/stop control
- [ ] Implement subscriber pattern for tick notifications
- [ ] Implement manual mode for video rendering (frame-by-frame control)
- [ ] Export singleton `playbackDriver` instance

**Test file:** `playback.test.ts`
- Test tick timing accuracy
- Test manual mode frame stepping
- Test subscriber add/remove
- Test start/stop idempotency

## Phase 2: Timeline UI (Week 2-3)

### 2.1 Timeline Panel Container

**File:** `/noodles-editor/src/timeline/components/TimelinePanel.tsx`
**Complexity:** High
**Estimate:** 4-5 days

**Tasks:**
- [ ] Create main container component layout
- [ ] Implement zoom state management (pixels per second)
- [ ] Implement horizontal scroll with virtualization
- [ ] Implement vertical track list scroll
- [ ] Connect to timeline store
- [ ] Handle keyboard shortcuts (global and panel-specific)

**Sub-components to create:**
- [ ] `TimeRuler.tsx` - Time markers based on zoom level
- [ ] `Playhead.tsx` - Draggable position indicator
- [ ] `TrackList.tsx` - Scrollable list container
- [ ] `PlayControls.tsx` - Play/pause/loop/speed controls
- [ ] `TimeDisplay.tsx` - Current time / total duration

### 2.2 Keyframe Track Component

**File:** `/noodles-editor/src/timeline/components/KeyframeTrack.tsx`
**Complexity:** High
**Estimate:** 3-4 days

**Tasks:**
- [ ] Create track row component with label and keyframe area
- [ ] Implement keyframe diamond rendering
- [ ] Implement keyframe selection (single, multi, box select)
- [ ] Implement keyframe dragging (position change)
- [ ] Implement keyframe duplication (Alt+drag)
- [ ] Implement double-click to add keyframe
- [ ] Implement right-click context menu
- [ ] Implement track expand/collapse for compound properties

### 2.3 Bezier Curve Editor

**File:** `/noodles-editor/src/timeline/components/CurveEditor.tsx`
**Complexity:** High
**Estimate:** 4-5 days

**Tasks:**
- [ ] Create modal/panel component
- [ ] Implement canvas/SVG grid background
- [ ] Implement bezier curve path rendering
- [ ] Implement keyframe point rendering
- [ ] Implement handle control points (draggable)
- [ ] Implement handle constraints (type: auto/free/aligned/vector)
- [ ] Implement zoom and pan
- [ ] Implement snap to grid (optional)
- [ ] Create preset library sidebar

**Sub-components:**
- [ ] `CurveCanvas.tsx` - Main curve visualization
- [ ] `HandleControlPoint.tsx` - Draggable bezier handle
- [ ] `PresetLibrary.tsx` - Easing preset picker
- [ ] `PresetThumbnail.tsx` - Visual preview of easing curve

**Reference:** Existing `BezierCurveFieldComponent` in `field-components.tsx`.

### 2.4 Scrubbable Inputs

**File:** `/noodles-editor/src/timeline/components/ScrubbableInput.tsx`
**Complexity:** Medium
**Estimate:** 2-3 days

**Tasks:**
- [ ] Create scrubbable number input component
- [ ] Implement drag-to-change behavior with sensitivity
- [ ] Implement modifier keys (Shift for fine, Alt for coarse)
- [ ] Implement double-click to edit mode
- [ ] Implement keyboard increment (Up/Down arrows)
- [ ] Implement Escape to cancel
- [ ] Add keyframe indicator icon (◇/◆/◈)
- [ ] Implement keyframe indicator click actions

## Phase 3: Integration (Week 3-4)

### 3.1 Remove Theatre.js Imports

**Complexity:** Medium
**Estimate:** 2-3 days

**Files to modify:**

| File | Changes |
|------|---------|
| `noodles.tsx` | Replace `useTheatreJs` hook with `useTimeline`, remove Theatre project/sheet lifecycle |
| `timeline-editor.tsx` | Remove Studio initialization, inject `TimelinePanel` component |
| `operators.ts` (TimeOp) | Subscribe to native timeline position instead of Theatre sequence |
| `renderer.ts` | Use native `playbackDriver` for video rendering |
| `store.tsx` | Remove `sheetObjects` map and related actions |

**Files to delete:**
- `theatre-bindings.ts` (replaced by `field-bindings.ts`)
- `sheet-context.ts` (replaced by `TimelineContext`)

### 3.2 TimeOp Integration

**Complexity:** Low
**Estimate:** 0.5 days

**Tasks:**
- [ ] Update `TimeOp.setTheatreSheet` to `TimeOp.setTimelineStore`
- [ ] Subscribe to `store.position` instead of Theatre sequence pointer
- [ ] Update `TimeOpComponent` to use new store

### 3.3 Migration Script

**File:** `/noodles-editor/src/timeline/migrate-timeline.ts`
**Complexity:** Medium
**Estimate:** 2 days

**Tasks:**
- [ ] Parse Theatre.js timeline format (`sheetsById.Noodles.sequence.tracksByObject`)
- [ ] Convert object names (`"maplibre-basemap / viewState"` → `/maplibre-basemap.viewState`)
- [ ] Convert handle format (`[leftX, leftY, rightX, rightY]` → `{left, right}`)
- [ ] Preserve keyframe IDs where possible
- [ ] Handle `staticOverrides` (non-keyframed values)
- [ ] Add migration to `migrate-schema.ts` chain (version 7 → 8)

**Test file:** `migrate-timeline.test.ts`
- Test with all example project files
- Test edge cases (empty timeline, single keyframe, etc.)

## Phase 4: Polish & Testing (Week 4-5)

### 4.1 Undo/Redo Integration

**Complexity:** Medium
**Estimate:** 1-2 days

**Tasks:**
- [ ] Extend timeline store with history stack
- [ ] Integrate with existing `use-reactflow-undo-redo.ts` pattern
- [ ] Determine undo granularity (per keyframe operation vs batched)
- [ ] Wire up Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z shortcuts

### 4.2 Scrubbable Input Integration

**Complexity:** Medium
**Estimate:** 2 days

**Tasks:**
- [ ] Update `NumberFieldComponent` in `field-components.tsx` to use `ScrubbableInput`
- [ ] Add keyframe indicator to all animatable field types
- [ ] Implement click-to-add-keyframe behavior

### 4.3 Visual Polish

**Complexity:** Medium
**Estimate:** 2-3 days

**Tasks:**
- [ ] Match Theatre.js color scheme and visual style
- [ ] Fine-tune animation timing and easing
- [ ] Add loading states and transitions
- [ ] Implement error states and messages
- [ ] Add tooltips and help text
- [ ] Ensure responsive layout

## Phase 5: Testing (Week 5-6)

### 5.1 Unit Tests

**Estimate:** 3-4 days

| Test File | Coverage |
|-----------|----------|
| `interpolation.test.ts` | Bezier math, all preset curves, edge cases |
| `timeline-store.test.ts` | CRUD operations, serialization, undo/redo |
| `field-bindings.test.ts` | Type conversion, sync behavior |
| `migrate-timeline.test.ts` | Migration correctness for all formats |

### 5.2 Integration Tests

**Estimate:** 2 days

- [ ] Load project with Theatre.js timeline, verify migration
- [ ] Create keyframes, save project, reload, verify persistence
- [ ] Video render with keyframed animation, verify frame output
- [ ] Test with all example projects (world-flights, nyc-taxis, etc.)

### 5.3 Playwright E2E Tests

**Estimate:** 2 days

- [ ] Timeline scrubbing interaction
- [ ] Keyframe creation and manipulation
- [ ] Curve editor handle dragging
- [ ] Play/pause controls

## Phase 6: Documentation & Cleanup (Week 6)

### 6.1 Documentation

**Estimate:** 1-2 days

- [ ] Update AGENTS.md with new timeline architecture
- [ ] Add timeline section to dev-docs/architecture.md
- [ ] Document migration process for users
- [ ] Add inline code comments for complex logic

### 6.2 Cleanup

**Estimate:** 1 day

- [ ] Remove Theatre.js packages from `package.json`
- [ ] Remove unused imports and dead code
- [ ] Run final linting and type checking
- [ ] Verify all tests pass

## Files to Create

```
/noodles-editor/src/timeline/
├── types.ts                    # TypeScript type definitions
├── timeline-store.ts           # Zustand store
├── interpolation.ts            # Bezier math and interpolation
├── field-bindings.ts           # Two-way field sync
├── playback.ts                 # RAF driver
├── migrate-timeline.ts         # Theatre.js migration
├── timeline-context.ts         # React context
├── easing-presets.ts           # Standard easing curves
├── __tests__/
│   ├── interpolation.test.ts
│   ├── timeline-store.test.ts
│   ├── field-bindings.test.ts
│   └── migrate-timeline.test.ts
└── components/
    ├── TimelinePanel.tsx       # Main container
    ├── TimeRuler.tsx           # Time markers
    ├── Playhead.tsx            # Draggable playhead
    ├── TrackList.tsx           # Track container
    ├── KeyframeTrack.tsx       # Track row
    ├── CurveEditor.tsx         # Bezier editor
    ├── CurveCanvas.tsx         # Curve visualization
    ├── HandleControlPoint.tsx  # Bezier handle
    ├── PresetLibrary.tsx       # Easing presets
    ├── PlayControls.tsx        # Play/pause/loop
    ├── TimeDisplay.tsx         # Time readout
    └── ScrubbableInput.tsx     # Drag-to-change input
```

## Files to Modify

| File | Changes |
|------|---------|
| `noodles.tsx` | Remove Theatre.js lifecycle, add timeline store provider |
| `timeline-editor.tsx` | Replace Theatre Studio with native TimelinePanel |
| `operators.ts` (TimeOp) | Use native timeline store |
| `renderer.ts` | Use native playback driver |
| `store.tsx` | Remove sheetObjects |
| `field-components.tsx` | Add keyframe indicators, use ScrubbableInput |
| `migrate-schema.ts` | Add migration 008 for timeline format |
| `package.json` | Remove @theatre/* dependencies |

## Files to Delete

- `theatre-bindings.ts`
- `sheet-context.ts`

## Risk Mitigation

### Feature Flag for Side-by-Side Development

```typescript
// timeline-editor.tsx
const USE_NATIVE_TIMELINE = import.meta.env.VITE_USE_NATIVE_TIMELINE === 'true'

export function TimelineEditor() {
  if (USE_NATIVE_TIMELINE) {
    return <NativeTimelinePanel />
  }
  return <TheatreStudioWrapper />
}
```

This allows:
- Developing native timeline without breaking existing functionality
- A/B testing with users
- Easy rollback if issues are discovered
- Gradual migration path

### Migration Safeguards

1. **Backup original timeline data** before migration
2. **Validate migrated data** against expected schema
3. **Log warnings** for unrecognized formats (don't fail silently)
4. **Preserve original format** in a backup field if migration fails

## Dependencies

```
Timeline Store
     │
     ├──► Interpolation Engine (must be built first)
     │
     └──► Types (must be defined first)

Field Bindings
     │
     └──► Timeline Store (requires store to be complete)

Timeline UI Components
     │
     ├──► Timeline Store
     ├──► Field Bindings
     └──► Interpolation Engine (for curve preview)

Migration Script
     │
     └──► Types (needs new format types)
```

**Build Order:**
1. `types.ts` (no dependencies)
2. `interpolation.ts` (depends on types)
3. `timeline-store.ts` (depends on types, interpolation)
4. `playback.ts` (depends on store)
5. `field-bindings.ts` (depends on store)
6. `easing-presets.ts` (no dependencies)
7. UI components (depend on all above)
8. `migrate-timeline.ts` (depends on types)
9. Integration into existing files
