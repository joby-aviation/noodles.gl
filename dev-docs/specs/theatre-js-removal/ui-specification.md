# UI Specification

## Overview

This document specifies the detailed UI requirements for the native timeline system. The goal is to match or exceed Theatre.js Studio's visual polish and interaction quality.

## 1. Curve Editor (Critical Component)

The curve editor is the heart of the animation system. It provides visual editing of bezier curves between keyframes.

### 1.1 Bezier Handle System

#### Handle Data Structure

```typescript
interface BezierHandles {
  left: [x: number, y: number]   // Incoming tangent control point
  right: [x: number, y: number]  // Outgoing tangent control point
  type: HandleType
}

type HandleType =
  | 'auto'      // Handles auto-calculated for smooth curve
  | 'free'      // Left and right handles move independently
  | 'aligned'   // Handles maintain same angle but can have different lengths
  | 'vector'    // Handles point directly at adjacent keyframes
```

#### Handle Behaviors

| Type | Behavior | Use Case |
|------|----------|----------|
| **Auto** | System calculates optimal handle positions for smooth transitions | Default for new keyframes |
| **Free** | Each handle moves independently | Sharp direction changes |
| **Aligned** | Handles stay 180° opposite, but lengths vary independently | Smooth curves with asymmetric ease |
| **Vector** | Handles point at previous/next keyframe | Linear segments with smooth transitions |

#### Handle Coordinate System

- **X-axis**: 0-1 representing time between keyframes
- **Y-axis**: 0-1 representing value progression (can exceed for overshoot)
- **Origin**: At the keyframe position
- **Overshoot**: Handles can extend beyond 0-1 Y range for bounce/elastic effects

#### Handle Constraints

- Left handle X must be ≤ 0 (extends backward in time)
- Right handle X must be ≥ 0 (extends forward in time)
- Handles cannot cross each other in X (prevents curve folding)
- When `type: 'aligned'`, moving one handle mirrors the other

### 1.2 Curve Visualization

#### Rendering Requirements

- **SVG-based** rendering for curve paths (vector scalability)
- **Canvas** for grid/background (performance)
- **Smooth anti-aliased** curves at all zoom levels
- **Minimum 12px** hit areas for control point handles

#### Visual Elements

```
┌──────────────────────────────────────────────────────────┐
│  1.2 ─┼─────────────────────────────────────────────────│  ← Y axis (value)
│       │                    ●────○                        │
│  1.0 ─┼─────────────────●─╱      ╲───────────────────────│  ← Curve peak
│       │                ╱            ╲                    │
│  0.8 ─┼──────────────╱                ╲                  │
│       │            ╱                    ╲                │
│  0.6 ─┼──────────╱                        ╲──────────────│
│       │        ╱                            ╲            │
│  0.4 ─┼──────╱                                ╲──────────│
│       │    ╱                                    ╲        │
│  0.2 ─┼──╱                                        ╲──────│
│       │╱                                            ╲    │
│  0.0 ─●─────┼─────┼─────┼─────┼─────┼─────┼─────┼────●───│
│       0    0.1   0.2   0.3   0.4   0.5   0.6   0.8   1.0 │  ← X axis (time)
└──────────────────────────────────────────────────────────┘

Legend:
  ● = Keyframe
  ○ = Handle control point
  ─── = Handle line
```

#### Interactive Features

- Drag keyframes vertically to change value
- Drag handles to adjust curve shape
- Click on curve to split and add new keyframe
- Zoom in/out on both axes independently
- Pan by middle-click drag or space+drag
- Snap to grid (optional, toggleable)

### 1.3 Easing Presets Library

#### Standard Presets (Must Match Theatre.js)

| Preset | Handles | Description |
|--------|---------|-------------|
| **Linear** | `[0.33, 0.33], [0.67, 0.67]` | Constant velocity |
| **Ease In** | `[0.42, 0], [1, 1]` | Slow start, fast end |
| **Ease Out** | `[0, 0], [0.58, 1]` | Fast start, slow end |
| **Ease In-Out** | `[0.42, 0], [0.58, 1]` | Slow start and end |
| **Ease Out-In** | `[0, 0.42], [1, 0.58]` | Fast start and end |

#### Extended Presets (Power-based)

| Preset | CSS Equivalent | Character |
|--------|----------------|-----------|
| **Quad In** | `cubic-bezier(0.55, 0.085, 0.68, 0.53)` | Gentle acceleration |
| **Quad Out** | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Gentle deceleration |
| **Cubic In** | `cubic-bezier(0.55, 0.055, 0.675, 0.19)` | Moderate acceleration |
| **Cubic Out** | `cubic-bezier(0.215, 0.61, 0.355, 1)` | Moderate deceleration |
| **Quart In** | `cubic-bezier(0.895, 0.03, 0.685, 0.22)` | Strong acceleration |
| **Quart Out** | `cubic-bezier(0.165, 0.84, 0.44, 1)` | Strong deceleration |
| **Quint In** | `cubic-bezier(0.755, 0.05, 0.855, 0.06)` | Very strong acceleration |
| **Quint Out** | `cubic-bezier(0.23, 1, 0.32, 1)` | Very strong deceleration |
| **Expo In** | `cubic-bezier(0.95, 0.05, 0.795, 0.035)` | Exponential acceleration |
| **Expo Out** | `cubic-bezier(0.19, 1, 0.22, 1)` | Exponential deceleration |

#### Overshoot Presets

| Preset | Character |
|--------|-----------|
| **Back In** | Pulls back before accelerating forward |
| **Back Out** | Overshoots target, then settles |
| **Back In-Out** | Pulls back, overshoots, settles |
| **Elastic Out** | Bouncy overshoot with dampening |
| **Bounce Out** | Multiple bounces before settling |

#### Preset UI Requirements

- Visual thumbnail preview of each curve
- Search/filter by name
- Favorites/recently used section
- Click to apply, double-click to preview
- Custom presets (save current curve as preset)

### 1.4 Multi-Keyframe Editing

#### Selection Modes

- **Click**: Select single keyframe
- **Shift+Click**: Add to selection
- **Ctrl/Cmd+Click**: Toggle selection
- **Box select**: Drag rectangle to select multiple
- **Select all**: Ctrl/Cmd+A

#### Multi-Selection Operations

- Move all selected keyframes together (maintain relative positions)
- Scale selection (proportional time adjustment)
- Apply easing preset to all selected
- Delete all selected
- Copy/paste selection

## 2. Scrubbable Number Inputs

Theatre.js's scrubbable inputs are a key UX feature that makes adjusting values feel fluid.

### 2.1 Drag Behavior

#### Sensitivity System

```typescript
interface ScrubConfig {
  sensitivity: number      // Base pixels per unit change (default: 1)
  nudgeMultiplier: number  // From field.step (e.g., 0.1 for fine, 10 for coarse)
  magnitude: number        // Modifier key multiplier
}

// Value calculation
newValue = oldValue + (deltaX * sensitivity * nudgeMultiplier * magnitude)
```

#### Modifier Keys

| Key | Magnitude | Effect |
|-----|-----------|--------|
| None | 1.0 | Normal sensitivity |
| Shift | 0.1 | Fine control (10x slower) |
| Alt/Option | 10.0 | Coarse control (10x faster) |
| Shift+Alt | 0.01 | Ultra-fine (100x slower) |

#### Drag Feedback

- Cursor changes to `ew-resize` on hover
- Visual highlight during active drag
- Value updates in real-time (not on release)
- Escape key cancels drag, reverts value

### 2.2 Input States

```
┌─────────────────────────────────────────┐
│ Normal State                            │
│ ┌───────────────────────────────────┐   │
│ │ 12.50                         ◇   │   │  ◇ = No keyframe at playhead
│ └───────────────────────────────────┘   │
├─────────────────────────────────────────┤
│ Keyframed State                         │
│ ┌───────────────────────────────────┐   │
│ │ 12.50                         ◆   │   │  ◆ = Keyframe exists at playhead
│ └───────────────────────────────────┘   │
├─────────────────────────────────────────┤
│ Animated State (between keyframes)      │
│ ┌───────────────────────────────────┐   │
│ │ 12.50                         ◈   │   │  ◈ = Animated (has keyframes, not at one)
│ └───────────────────────────────────┘   │
├─────────────────────────────────────────┤
│ Editing State (typing value)            │
│ ┌───────────────────────────────────┐   │
│ │ 12.5█                             │   │  Blue border, text cursor
│ └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### Keyframe Indicator Interactions

- Click empty diamond (◇): Add keyframe at current time
- Click filled diamond (◆): Delete keyframe at current time
- Right-click: Context menu (add/delete keyframe, go to keyframe, etc.)

### 2.3 Value Editing Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Scrub** | Click + drag | Drag left/right to change value |
| **Type** | Double-click OR single-click on focused | Text input mode |
| **Increment** | Up/Down arrow keys | Step by nudgeMultiplier |
| **Page** | Page Up/Down | Step by nudgeMultiplier × 10 |

#### Type Mode Features

- Select all on focus
- Tab to next field, Shift+Tab to previous
- Enter to confirm and exit
- Escape to cancel and revert
- Math expressions: `12.5 * 2` evaluates to `25`

### 2.4 Theatre.js Drag Math Implementation

Theatre.js implements a sophisticated drag-to-change system that feels natural and precise. Understanding this implementation is critical for achieving feature parity.

#### Core Drag Algorithm

```typescript
// Theatre.js uses a scrub session pattern
interface ScrubSession {
  startValue: number          // Value when drag started
  startX: number              // Mouse X when drag started
  accumulatedDelta: number    // Total pixel movement
  lastCommittedValue: number  // Value before current uncommitted change
}

// On drag start
function onDragStart(e: PointerEvent, currentValue: number) {
  session = {
    startValue: currentValue,
    startX: e.clientX,
    accumulatedDelta: 0,
    lastCommittedValue: currentValue,
  }
  // Capture pointer for drag outside element bounds
  element.setPointerCapture(e.pointerId)
}

// On drag move
function onDragMove(e: PointerEvent) {
  const deltaX = e.clientX - session.startX
  session.accumulatedDelta = deltaX

  // Calculate new value with all modifiers applied
  const scaledDelta = applyScaling(deltaX, e)
  const newValue = session.startValue + scaledDelta

  // Clamp to field range if specified
  const clampedValue = clamp(newValue, field.min, field.max)

  // Update value (without committing to history yet)
  scrub.capture(({ set }) => {
    set(pointer, clampedValue)
  })
}

// On drag end
function onDragEnd() {
  // Commit all changes as single undo operation
  scrub.commit()
  element.releasePointerCapture(e.pointerId)
}
```

#### Delta Scaling Formula

The core formula for converting pixel movement to value change:

```typescript
function applyScaling(deltaPixels: number, event: PointerEvent): number {
  // Base sensitivity: pixels needed to change value by 1 unit
  const baseSensitivity = 1.0  // 1 pixel = 1 unit at default scale

  // nudgeMultiplier comes from field definition (e.g., step: 0.1)
  const nudgeMultiplier = field.nudgeMultiplier ?? 1.0

  // Modifier key magnitudes
  let magnitude = 1.0
  if (event.shiftKey && event.altKey) {
    magnitude = 0.01   // Ultra-fine: 100x slower
  } else if (event.shiftKey) {
    magnitude = 0.1    // Fine: 10x slower
  } else if (event.altKey) {
    magnitude = 10.0   // Coarse: 10x faster
  }

  // Final calculation
  return deltaPixels * baseSensitivity * nudgeMultiplier * magnitude
}
```

#### Practical Examples

| Field Config | Shift | Alt | 100px drag result |
|--------------|-------|-----|-------------------|
| `step: 1` | No | No | +100 |
| `step: 1` | Yes | No | +10 |
| `step: 1` | No | Yes | +1000 |
| `step: 0.1` | No | No | +10 |
| `step: 0.1` | Yes | No | +1 |
| `step: 0.01` | No | No | +1 |
| `step: 0.01` | Yes | No | +0.1 |

#### Scrub Transaction System

Theatre.js batches all drag updates into a single undo operation using a "scrub" transaction:

```typescript
// studio.scrub() creates a scrub session
const scrub = studio.scrub()

// During drag, capture() queues changes without creating history entries
scrub.capture(({ set }) => {
  set(object.props.x, newValue)
})

// At drag end:
// - commit() creates ONE history entry for all captures
// - discard() reverts all changes
// - reset() clears without committing

// This is why dragging creates a single undo level,
// not hundreds of tiny changes
```

#### Pointer Lock for Infinite Drag

Theatre.js implements "infinite drag" - the cursor can move beyond viewport bounds:

```typescript
function enableInfiniteDrag(e: PointerEvent) {
  // Capture pointer events even outside element
  element.setPointerCapture(e.pointerId)

  // Track total movement, not absolute position
  let totalDeltaX = 0

  const onMove = (moveEvent: PointerEvent) => {
    // movementX gives delta since last event, works with pointer lock
    totalDeltaX += moveEvent.movementX
    updateValue(totalDeltaX)
  }

  // Optional: Request pointer lock for truly infinite drag
  // (Theatre.js doesn't use this, relies on pointer capture)
  // element.requestPointerLock()
}
```

#### Value Display During Drag

Theatre.js shows a live-updating value with appropriate precision:

```typescript
function formatDragValue(value: number, field: Field): string {
  // Match precision to nudgeMultiplier
  const step = field.nudgeMultiplier ?? 1
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))

  return value.toFixed(decimals)
}

// Examples:
// step: 1     → "123"
// step: 0.1   → "123.4"
// step: 0.01  → "123.45"
// step: 0.001 → "123.456"
```

#### Edge Cases to Handle

1. **Very small ranges**: For fields with `min: 0, max: 0.001`, ensure drag still feels responsive by auto-adjusting sensitivity

2. **Large values**: For values like `1000000`, dragging should be proportionally scaled so small movements don't jump by millions

3. **Negative values**: Ensure drag direction is intuitive (right = increase, always)

4. **Integer-only fields**: Round to nearest integer during drag, not just on release

5. **Escape key handling**: Must revert to `startValue`, not `lastCommittedValue`

6. **Tab while dragging**: Should commit current value, then focus next field

#### Implementation Requirements

For native implementation, we need:

1. **PointerCapture API** - For drag outside element bounds
2. **movementX/Y** - For accurate delta calculation
3. **Transaction batching** - Single undo level per drag
4. **Real-time preview** - Value updates during drag, not on release
5. **Modifier key detection** - Shift/Alt/Cmd state during drag
6. **Cursor styling** - `ew-resize` during drag
7. **Focus management** - Proper blur/focus on drag start/end

## 3. Timeline Panel

### 3.1 Time Ruler

#### Visual Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 0:00   0:01   0:02   0:03   0:04   0:05   0:06   0:07   0:08   0:09   0:10 │
│ │      │      │      │      │      │      │      │      │      │      │   │
│ ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤   │
│ ▼                                                                          │
│ ┃ (playhead)                                                               │
└────────────────────────────────────────────────────────────────────────────┘
```

#### Time Display Formats

| Zoom Level | Format | Example |
|------------|--------|---------|
| Far out | Minutes:Seconds | `1:30` |
| Normal | Seconds.Frames | `3.15` |
| Zoomed in | Frames | `f90` |

#### Ruler Interactions

- Click on ruler: Jump playhead to clicked position
- Drag on ruler: Scrub playhead position
- Double-click: Start playback from clicked position
- Mousewheel on ruler: Zoom in/out

### 3.2 Track Rows

#### Track Row Anatomy

```
┌─────────────────┬────────────────────────────────────────────────────────────┐
│ ▼ MapView       │ ◆───────────────────────────────◆────────────────────◆     │
│   └ zoom        │     ◆───────────────◆                                      │
│   └ bearing     │ ◆                                           ◆              │
│   └ pitch       │         ◆───────────────────────────◆                      │
├─────────────────┼────────────────────────────────────────────────────────────┤
│ ▶ ScatterLayer  │ (collapsed - shows summary bar)                            │
└─────────────────┴────────────────────────────────────────────────────────────┘
```

#### Track Row Interactions

- Click track label: Select track for curve editor
- Click expand/collapse arrow: Toggle child tracks
- Double-click empty area: Add keyframe at current time
- Drag keyframe: Move in time
- Shift+drag: Constrain to time axis only
- Alt+drag: Duplicate keyframe

#### Keyframe Diamond States

| State | Visual | Meaning |
|-------|--------|---------|
| Normal | ◇ (outline) | Keyframe exists |
| Selected | ◆ (filled) | Keyframe is selected |
| At playhead | 🔷 (blue) | Playhead is on this keyframe |
| Interpolating | ━ (line) | Shows connection to next keyframe |

### 3.3 Zoom and Pan

#### Zoom Behavior

- Mousewheel: Zoom centered on cursor position
- Ctrl+Mousewheel: Zoom Y axis (value) only
- Shift+Mousewheel: Zoom X axis (time) only
- Pinch gesture: Zoom (trackpad support)
- Zoom to fit: Double-click on ruler background

#### Zoom Levels

| Level | Time Resolution | Track Height |
|-------|-----------------|--------------|
| Min | Show full sequence | 24px per track |
| Default | ~10 seconds visible | 32px per track |
| Max | ~1 frame visible | 64px per track |

#### Pan Behavior

- Middle-click drag: Pan both axes
- Space+drag: Pan both axes
- Shift+scroll: Horizontal pan
- Scroll: Vertical pan (track list)

## 4. Play Controls

### Control Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ [⏮] [⏪] [▶/⏸] [⏩] [⏭]  │  00:03.15 / 00:10.00  │  [🔁] [1x▼] │
└──────────────────────────────────────────────────────────────────┘
  │     │     │      │    │        │                    │     │
  │     │     │      │    │        └─ Current/Total     │     └─ Speed selector
  │     │     │      │    └─ Go to end                  └─ Loop toggle
  │     │     │      └─ Step forward one frame
  │     │     └─ Play/Pause toggle
  │     └─ Step backward one frame
  └─ Go to start
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| ← / → | Step backward/forward one frame |
| Shift+← / → | Step backward/forward 10 frames |
| Home / End | Go to start/end |
| L | Toggle loop |
| J / K | Decrease/increase playback speed |
| , / . | Step backward/forward one frame (alternative) |

### Playback Speeds

`0.1x, 0.25x, 0.5x, 1x, 1.5x, 2x, 4x`

## 5. Property Panel Integration

### Field-to-Timeline Relationship

```typescript
interface AnimatableFieldUI {
  // Visual indicators
  hasKeyframes: boolean           // Any keyframes exist for this field
  isAtKeyframe: boolean           // Playhead is exactly on a keyframe
  isAnimated: boolean             // Field value is currently interpolating

  // Actions
  addKeyframe(): void             // Add keyframe at current time with current value
  deleteKeyframe(): void          // Delete keyframe at current time
  goToNextKeyframe(): void        // Jump playhead to next keyframe
  goToPrevKeyframe(): void        // Jump playhead to previous keyframe

  // Visual states
  inputBorderColor: string        // Changes based on animation state
  keyframeIndicatorIcon: Icon     // ◇, ◆, ◈ based on state
}
```

### Compound Field Display

```
┌─────────────────────────────────────────────────────────────────┐
│ ▼ viewState                                              [◆]   │
│   ├─ zoom      │ 12.50                               │  [◆]   │
│   ├─ bearing   │ 45.00                               │  [◇]   │
│   ├─ pitch     │ 60.00                               │  [◆]   │
│   └─ center    │                                          │   │
│       ├─ lng   │ -122.4194                           │  [◇]   │
│       └─ lat   │ 37.7749                             │  [◇]   │
└─────────────────────────────────────────────────────────────────┘
```

### Aggregate Keyframe Indicator

Parent compound fields show aggregate state:
- ◇ if no children have keyframes
- ◆ if all children have keyframes at current time
- ◈ if some children have keyframes

## 6. Enhancement Opportunities (Post-Parity)

Features to exceed Theatre.js after achieving parity:

### Curve Editor Enhancements

| Feature | Theatre.js | Native Opportunity |
|---------|------------|-------------------|
| **Curve comparison** | Single curve view | Overlay multiple tracks for comparison |
| **Value annotations** | No | Show actual values on curve hover |
| **Time markers** | Basic | Add custom markers/labels at specific times |
| **Loop preview** | No | Preview loop point transitions |
| **Audio waveform** | No | Display audio waveform for sync |
| **Curve templates** | Presets only | Save/load custom curve templates per project |

### Timeline Panel Enhancements

| Feature | Theatre.js | Native Opportunity |
|---------|------------|-------------------|
| **Track grouping** | By object only | Custom user-defined groups |
| **Track colors** | Auto | User-customizable track colors |
| **Minimap** | No | Overview minimap for long sequences |
| **Markers/regions** | No | Named time markers and regions |
| **Track solo/mute** | No | Solo or mute individual tracks |
| **Onion skinning** | No | Preview previous/next frame values |

### Workflow Enhancements

| Feature | Theatre.js | Native Opportunity |
|---------|------------|-------------------|
| **Expression-based animation** | No | `sin(t * 2 * PI)` style expressions |
| **Procedural curves** | No | Noise, spring physics simulation |
| **Copy curve shape** | Basic | Copy/paste curve shapes between properties |
| **Batch keyframe ops** | Limited | Select all keyframes of type X, offset by Y |
| **Import/export** | JSON only | Import from After Effects, export to CSS |

### Priority Order for Enhancements

1. Track colors (low effort, high visibility)
2. Time markers (frequently requested)
3. Value annotations on hover (improves precision work)
4. Minimap (helps with long animations)
5. Expression-based animation (power user feature)
