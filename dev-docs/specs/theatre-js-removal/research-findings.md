# Research Findings

## Overview

This document captures the detailed findings from analyzing Theatre.js integration in Noodles.gl. This research informs the replacement implementation strategy.

## 1. Theatre.js Packages and Versions

**Package versions in use:**

```json
{
  "@theatre/core": "0.7.2",
  "@theatre/react": "0.7.2",
  "@theatre/studio": "0.7.2"
}
```

**Import locations:**

| File | Imports |
|------|---------|
| `timeline-editor.tsx` | `studio` from `@theatre/studio`, `useVal` from `@theatre/react` |
| `noodles.tsx` | `getProject`, `IProjectConfig` from `@theatre/core` |
| `theatre-bindings.ts` | `ISheet`, `onChange`, `types` from `@theatre/core`, `Pointer` from `@theatre/dataverse`, `studio` from `@theatre/studio` |
| `operators.ts` | `onChange` from `@theatre/core` |
| `visualizations.ts` | `IProject`, `ISheet` from `@theatre/core` |
| `render/renderer.ts` | `createRafDriver`, `IProject`, `ISequence` from `@theatre/core`, `useVal` from `@theatre/react` |
| `sheet-context.ts` | `ISheet` from `@theatre/core` |
| `store.tsx` | `ISheetObject` from `@theatre/core` |

## 2. Theatre.js APIs Used

### Core APIs

| API | Location | Purpose |
|-----|----------|---------|
| `getProject(name, config)` | noodles.tsx:141 | Create Theatre project |
| `project.sheet(id)` | noodles.tsx:143 | Create/access Theatre sheet |
| `project.ready` | noodles.tsx:145 | Wait for project initialization |
| `sheet.object(name, props)` | theatre-bindings.ts:181 | Create keyframeable object |
| `sheet.detachObject(name)` | theatre-bindings.ts:271 | Remove object from sheet |
| `onChange(pointer, callback)` | theatre-bindings.ts:201, operators.ts:1415 | Subscribe to value changes |

### Studio APIs

| API | Location | Purpose |
|-----|----------|---------|
| `studio.initialize(opts)` | timeline-editor.tsx:22 | Configure Theatre Studio |
| `studio.transaction(api => {})` | theatre-bindings.ts:231, noodles.tsx:151 | Batch updates |
| `studio.createContentOfSaveFile(name)` | noodles.tsx:168 | Export timeline JSON |
| `api.__experimental_forgetSheet(sheet)` | noodles.tsx:153 | Unload sheet from UI |

### Type APIs

| API | Location | Purpose |
|-----|----------|---------|
| `types.number(value, opts)` | theatre-bindings.ts:50 | Number prop config |
| `types.boolean(value)` | theatre-bindings.ts:56 | Boolean prop config |
| `types.string(value)` | theatre-bindings.ts:58 | String prop config |
| `types.rgba(value)` | theatre-bindings.ts:74 | Color prop config |
| `types.compound({...})` | theatre-bindings.ts:86+ | Nested prop structure |
| `types.stringLiteral(value, choices)` | theatre-bindings.ts:60 | Enum prop config |

### React APIs

| API | Location | Purpose |
|-----|----------|---------|
| `useVal(pointer)` | timeline-editor.tsx:141, renderer.ts:31 | Read reactive value |

### RAF Driver

| API | Location | Purpose |
|-----|----------|---------|
| `createRafDriver({ name })` | timeline-editor.tsx:13 | Custom animation driver |

## 3. Integration Architecture

### Project/Sheet Lifecycle

```typescript
// noodles.tsx - Theatre project creation
function useTheatreJs(projectName: string | null) {
  const _projectCounterRef = useRef(1)
  const name = `${projectName || UNSAVED_PROJECT_NAME}-${_projectCounterRef.current}`

  // Create new project for each Noodles project (with unique counter)
  const theatreProject = useMemo(() => {
    return getProject(name, config)
  }, [theatreState])

  // Single sheet per project
  const theatreSheet = useMemo(() =>
    theatreProject.sheet('Noodles'), [theatreProject]
  )

  // Wait for Theatre.js initialization
  useEffect(() => {
    theatreProject?.ready.then(() => setTheatreReady(true))
  }, [theatreProject])
}
```

**Key patterns:**
- New Theatre project created per Noodles project load (with incrementing counter for uniqueness)
- Sheet ID is always `'Noodles'` across projects
- Theatre project names are NOT stored in project files (dynamic per session)
- `project.ready` promise must resolve before binding operators

### Studio Initialization

```typescript
// timeline-editor.tsx
const rafDriver = createRafDriver({ name: 'WorldView' })

studio.initialize({
  __experimental_rafDriver: rafDriver,  // Custom RAF prevents default playback
  usePersistentStorage: false,          // Disable Theatre.js localStorage
})

// CSS injection into Theatre's shadow DOM
const injectTheatreStyles = () => {
  const theatreRoot = document.querySelector('#theatrejs-studio-root')
  if (theatreRoot?.shadowRoot) {
    const style = document.createElement('style')
    style.textContent = `
      /* Hide non-essential panels */
      .sc-dPZUQH:not([data-testid="DetailPanel-Object"]) {
        display: none !important;
      }
    `
    theatreRoot.shadowRoot.appendChild(style)
  }
}
```

**Key patterns:**
- Custom RAF driver gives Noodles control over timeline playback
- Studio persistence disabled (Noodles handles save/load)
- CSS injection required to customize Theatre UI (fragile, relies on generated class names)

### Two-Way Binding System

```typescript
// theatre-bindings.ts - Core binding function
export function bindOperatorToTheatre(
  op: Operator<IOperator>,
  sheet: ISheet
): (() => void) | undefined {
  // Skip non-bindable operators
  if (op.id === '/out') return undefined
  if (store.hasSheetObject(op.id)) return undefined

  // Convert operator fields to Theatre props
  const propConfig = fieldsToTheatreProps(fields)

  // Create Theatre sheet object
  const theatreObjectName = opIdToTheatreObjectName(op.id)
  const sheetObj = sheet.object(theatreObjectName, propConfig)
  store.setSheetObject(op.id, sheetObj)

  // Set up two-way bindings
  for (const [key, field] of fields) {
    let updating = false  // Prevent infinite loops

    // Theatre → Field binding
    const theatreSub = onChange(pointer, (value_: any) => {
      if (op.locked.value || updating) return
      updating = true
      // Type conversion (RGBA→hex, epoch→Temporal, etc.)
      field.setValue(convertedValue)
      updating = false
    })

    // Field → Theatre binding
    const fieldSub = field.subscribe((value_: any) => {
      if (op.locked.value || updating) return
      updating = true
      studio.transaction(({ set }) => {
        // Type conversion (hex→RGBA, Temporal→epoch, etc.)
        set(pointer, convertedValue)
      })
      updating = false
    })
  }

  return () => {
    sheet.detachObject(theatreObjectName)
    store.deleteSheetObject(op.id)
  }
}
```

**Key patterns:**
- `updating` flag prevents infinite loops during sync
- Type conversions applied bidirectionally
- `studio.transaction` wraps Theatre updates for undo/redo
- Cleanup function returned for operator removal

### Field Type Conversion Matrix

| Field Type | Theatre Type | To Theatre | From Theatre |
|------------|--------------|------------|--------------|
| NumberField | `types.number()` | Direct | Direct |
| BooleanField | `types.boolean()` | Direct | Direct |
| StringField | `types.string()` | Direct | Direct |
| StringLiteralField | `types.stringLiteral()` | Direct | Direct |
| ColorField | `types.rgba()` | `hexToRgba(value)` | `rgbaToHex(value)` |
| DateField | `types.number()` | `temporal.epochMilliseconds` | `Temporal.Instant.fromEpochMilliseconds` |
| Vec2Field | `types.compound({x,y})` | `{x: v[0], y: v[1]}` | `[v.x, v.y]` |
| Vec3Field | `types.compound({x,y,z})` | `{x, y, z}` | `[x, y, z]` |
| Point2DField | `types.compound({lng,lat})` | `{lng, lat}` | `[lng, lat]` |
| Point3DField | `types.compound({lng,lat,alt})` | `{lng, lat, alt}` | Array |
| CompoundPropsField | `types.compound()` | Recursive | Recursive |

### TimeOp Integration

```typescript
// operators.ts - TimeOp subscribes to Theatre sequence position
class TimeOp extends Operator<TimeOp> {
  private timeState$ = new BehaviorSubject({
    now: Date.now(),
    tick: 0,
    sequenceTime: 0
  })

  setTheatreSheet(sheet: { sequence: { pointer: { position: unknown } } }) {
    this.theatreUnsub?.()
    this.theatreUnsub = onChange(sheet.sequence.pointer.position, (pos: number) => {
      const current = this.timeState$.value
      this.timeState$.next({ ...current, sequenceTime: pos })
    })
  }
}
```

**Key patterns:**
- TimeOp uses RxJS BehaviorSubject for outputs
- `onChange` subscribes to Theatre sequence position
- `sequenceTime` output drives time-based animations

### Video Rendering Integration

```typescript
// renderer.ts - Frame-by-frame control for video capture
for (; i < endFrame + 1; i++) {
  const simTime = i / fps
  sequence.position = simTime  // Direct position control
  rafDriver.tick(performance.now())  // Force Theatre update
  redraw()  // Render frame
  // ... capture frame ...
}
```

**Key patterns:**
- Direct `sequence.position` assignment for precise frame timing
- Custom RAF driver tick forces Theatre to evaluate at exact time
- Synchronous frame capture after position set

## 4. Theatre.js State Model

### Historic State (Persisted)

```typescript
type SheetState_Historic = {
  staticOverrides: {
    byObject: Record<string, unknown>  // Non-keyframed values
  }
  sequence?: HistoricPositionalSequence  // Keyframe data
}

type HistoricPositionalSequence = {
  type: 'PositionalSequence'
  length: number
  subUnitsPerUnit: number  // Frames per second for snapping
  tracksByObject: Record<string, {
    trackIdByPropPath: Record<string, string>
    trackData: Record<string, BasicKeyframedTrack>
  }>
}

type BasicKeyframedTrack = {
  type: 'BasicKeyframedTrack'
  keyframes: Keyframe[]
}

type Keyframe = {
  id: string
  position: number
  value: unknown
  handles: [leftX, leftY, rightX, rightY]
  connectedRight: boolean
  type?: 'bezier' | 'hold'
}
```

### Ephemeral State (Session Only)

Managed by Dataverse Atoms and Prisms:
- Playhead position
- Playing/paused state
- UI selections
- Panel visibility

### Ahistorical State (localStorage)

Stored in `theatrejs:0.4` localStorage key:
- Studio UI layout
- Timeline zoom level
- Panel positions

## 5. Keyframe Data Format (Theatre.js)

Example from `world-flights` project:

```json
{
  "timeline": {
    "sheetsById": {
      "Noodles": {
        "sequence": {
          "subUnitsPerUnit": 30,
          "length": 3.04,
          "type": "PositionalSequence",
          "tracksByObject": {
            "time": {
              "trackData": {
                "g0xHT4Xo4p": {
                  "type": "BasicKeyframedTrack",
                  "__debugName": "time:[\"val\"]",
                  "keyframes": [
                    {
                      "id": "xHJJWLB41a",
                      "position": 0,
                      "connectedRight": true,
                      "handles": [0.5, 1, 0.5, 0],
                      "type": "bezier",
                      "value": 1567555200
                    },
                    {
                      "id": "0XrkIwvDZr",
                      "position": 2.967,
                      "connectedRight": true,
                      "handles": [0.5, 1, 0.5, 0],
                      "type": "bezier",
                      "value": 1567561720
                    }
                  ]
                }
              },
              "trackIdByPropPath": {
                "[\"val\"]": "g0xHT4Xo4p"
              }
            }
          }
        },
        "staticOverrides": {
          "byObject": {}
        }
      }
    },
    "definitionVersion": "0.4.0",
    "revisionHistory": []
  }
}
```

**Format notes:**
- Object keys use Theatre's naming convention (`"time"` not `"/time"`)
- Prop paths are JSON-encoded arrays (`"[\"val\"]"`)
- Handles are flat array `[leftX, leftY, rightX, rightY]`
- `connectedRight` determines handle linking
- `subUnitsPerUnit` is FPS for frame snapping

## 6. Dataverse Reactive System

Theatre.js uses `@theatre/dataverse` for reactivity:

### Core Concepts

```typescript
// Atom - mutable state container
const atom = new Atom({ a: { b: 1 } })
atom.set({ a: { b: 2 } })

// Pointer - type-safe path to nested value
const pointer = atom.pointer.a.b
const value = atom.getByPointer(pointer)

// Prism - reactive computation (like React hooks)
const pr = prism(() => {
  const val = val(pointer.a) + val(pointer.b)
  return val
})
pr.getValue()  // Re-evaluates when dependencies change
```

### Prism Hooks

```typescript
prism.state(key, initialValue)    // State management
prism.effect(key, callback, deps) // Side effects
prism.memo(key, fn, deps)         // Memoization
prism.ref(key, initialValue)      // References
prism.source(subscribe, getValue) // External source subscription
```

### Pull-Based Evaluation

- Prisms only compute when values are requested
- Dependencies auto-tracked during execution
- Changes trigger stale notifications, not automatic re-computation
- Ticker batches updates per animation frame

## 7. Studio UI Implementation Notes

### Shadow DOM Structure

Theatre.js Studio renders in a shadow DOM root:
- Root element: `#theatrejs-studio-root`
- All UI components inside shadow DOM
- Styled-components generate `.sc-*` class names (unstable between versions)

### Key UI Components

Based on data-testid attributes:
- `DetailPanel-Object` - Property panel for selected object
- `SequenceEditorPanel-tree` - Left sidebar tree

### Scrubbing Mechanics

```typescript
interface IScrubApi {
  set<T>(pointer: Pointer<T>, value: T): void
}

interface IScrub {
  capture(fn: (api: IScrubApi) => void): void
  commit(): void   // Single undo level for all captures
  reset(): void    // Clear without committing
  discard(): void  // Destroy scrub
}

// Usage during drag operations
const scrub = studio.scrub()
scrub.capture(({ set }) => {
  set(object.props.x, newValue)  // Updates without creating undo entries
})
// ... more captures during drag ...
scrub.commit()  // Single undo level when drag ends
```

### Sensitivity Configuration

```typescript
interface PropTypeConfig_Number {
  range?: [min: number, max: number]
  nudgeMultiplier: number  // Controls drag sensitivity
}

// In theatre-bindings.ts
types.number(field.value, {
  range: [field.min, field.max],
  nudgeMultiplier: field.step,  // Uses Field's step value
})
```

## 8. Migration History

Previous migrations related to Theatre.js:

### Migration 006: Sheet Rename

Changed Theatre sheet name from `"Nodes"` to `"Noodles"`:

```typescript
// Legacy format
timeline.sheetsById['Nodes']

// Current format
timeline.sheetsById['Noodles']
```

### Migration 009: Editor Settings

Moved editor settings from Theatre staticOverrides to project-level:

```typescript
// Before (in Theatre data)
timeline.sheetsById.Noodles.staticOverrides.byObject.editor

// After (project-level)
project.editorSettings
```

## 9. Current Integration Files

| File | Lines | Purpose |
|------|-------|---------|
| `/noodles-editor/src/noodles/theatre-bindings.ts` | ~315 | Two-way field sync |
| `/noodles-editor/src/timeline-editor.tsx` | ~410 | Studio initialization |
| `/noodles-editor/src/noodles/noodles.tsx` | ~200 | Project/sheet lifecycle |
| `/noodles-editor/src/render/renderer.ts` | ~50 | Video rendering |
| `/noodles-editor/src/noodles/operators.ts` (TimeOp) | ~75 | Sequence position |
| `/noodles-editor/src/noodles/store.tsx` | ~40 | Sheet object storage |
| `/noodles-editor/src/utils/sheet-context.ts` | ~8 | React context |

**Total Theatre.js integration code: ~1,100 lines**

## 10. Test Coverage

Existing Theatre.js tests in `/noodles-editor/src/noodles/__tests__/theatre-bindings.test.ts`:

```typescript
describe('theatre-bindings', () => {
  // Tests binding with Theatre-compatible fields
  it('should bind operator with theatre-compatible fields')

  // Tests color field hex ↔ RGBA conversion
  it('should handle color field conversions')

  // Tests date field Temporal ↔ epoch conversion
  it('should convert DateField to epoch milliseconds')

  // Tests vector and point field compound conversion
  it('should handle vector and point fields')
})
```

## 11. Known Issues and Pain Points

### CSS Injection Fragility

```typescript
// These class names are generated and unstable
style.textContent = `
  .sc-dPZUQH:not([data-testid="DetailPanel-Object"]) {
    display: none !important;
  }
`
```

Theatre.js version updates may break CSS selectors.

### Shadow DOM Limitations

- Cannot use global CSS
- Cannot easily extend UI components
- Difficult to integrate with Noodles styling

### Debugging Complexity

- Dataverse prisms are hard to inspect
- State changes flow through multiple abstractions
- Stack traces obscured by Theatre internals

### Type Conversion Overhead

Every field update requires conversion:
- hex ↔ RGBA for colors
- Temporal ↔ epoch for dates
- Array ↔ object for vectors

### Project Naming Complexity

Theatre requires unique project names, leading to counter-based naming:
```typescript
const name = `${projectName}-${counter++}`
```
