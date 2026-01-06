# Fix video frame capture with data-driven animations

## Problem

Video frame capture would hang when animating data-driven properties (e.g., DateTime field filtering layer data) because Deck.gl's `onAfterRender` callback only fires when it detects **visual property changes**, not data-only changes.

**Before:**
- ✅ Frame capture worked when animating visual properties (opacity, colors, etc.)
- ❌ Frame capture hung indefinitely when only data changed (filtered layers, updated datasets)
- ❌ Even basic Pure Deck examples (like orbit) hung at frame 0-1

**Root causes identified:**
1. Deck.gl doesn't fire `onAfterRender` for data-only changes (by design)
2. React re-renders during capture triggered spurious `onAfterRender` calls
3. Multiple `setTimeout` callbacks scheduled per frame raced with each other
4. Effects tried to wrap callbacks but React overwrote them with new props

## Solution

Implemented a robust frame capture coordination system with three key components:

### 1. Graph Settling Detection (`graph-settling.ts`)

Waits for all RxJS operators to finish executing before attempting to capture:

```typescript
await waitForGraphSettled({ timeout: 5000 })
```

Polls operator `executionState` until all are idle, ensuring the reactive data flow has completed.

### 2. Forced Deck.gl Redraw

Explicitly calls `deck.redraw('frame-capture')` to trigger rendering even when only data changes:

```typescript
expectingRedrawRef.current = true  // Set flag
deck.redraw('frame-capture')       // Force render
```

### 3. Three-Flag Coordination System

Prevents race conditions from React re-renders and spurious callbacks:

- **`frameResolverRef`**: Holds promise resolver for current frame
- **`expectingRedrawRef`**: Set immediately before `deck.redraw()`, filters spurious `onAfterRender` calls
- **`timeoutScheduledRef`**: Prevents multiple `setTimeout` callbacks per frame

**Why these flags are needed:**

React re-renders (from node dimension changes) trigger multiple `onAfterRender` calls per frame. Without coordination:
- Old `onAfterRender` fires before we call `deck.redraw()` → resolves wrong promise
- Multiple `setTimeout` callbacks scheduled → fire during future frames
- Flags cleared too early → race conditions with fast captures

## Architecture

### Frame Capture Flow (Pure Deck Mode)

```
1. Renderer: Set timeline position
2. Renderer: await waitForGraphSettled() ← NEW: Wait for operators
3. Renderer: Call requestDeckFrameRef.current() [non-blocking]
4. Draw Loop: Set expectingRedrawRef=true, call deck.redraw()
5. Deck.gl: Renders with new data
6. onAfterRender: Fires, checks flags, schedules setTimeout(captureDelay)
7. Browser: GPU flush → canvas paint → pixels ready
8. setTimeout: Fires, clears flags, resolves promise
9. Draw Loop: Calls captureFrame()
10. Renderer: Captures VideoFrame from canvas
```

### Key Design Decisions

**Frame capture logic in `deckProps.onAfterRender`:**
- Integrated directly into `deckProps` (via `useMemo`) prevents React from overwriting it
- Has access to all state via refs (`frameResolverRef`, `rendererRef`, etc.)
- Survives React re-renders during frame capture

**Clear `timeoutScheduledRef` at frame start:**
- Prevents race condition with `captureDelay=0`
- Keeps flag true throughout React re-render window
- Cleared when next frame begins, not in `setTimeout` callback

**`captureDelay` still required (default 200ms):**
- NOT a hack - waits for browser's async rendering pipeline
- After `onAfterRender`: GPU flush → canvas paint → pixels ready for capture
- With 0ms: `MediaStreamTrackProcessor` hangs waiting for pixels that haven't painted yet
- Explained in code comments

## Files Changed

### New Files
- `src/render/graph-settling.ts` - Graph settling detection utility
- `src/render/graph-settling.test.ts` - Unit tests (6 tests, all passing)
- `FRAME_CAPTURE_CLEANUP_PLAN.md` - Documentation and future cleanup tasks

### Modified Files
- `src/render/draw-loop.ts` - Exposes `requestFrame()` via callback pattern
- `src/render/renderer.ts` - Integrates graph settling and frame requests
- `src/timeline-editor.tsx` - Frame capture coordination in `deckProps`

### Statistics
```
5 files changed, 408 insertions(+), 51 deletions(-)
23 commits
```

## Testing

✅ **Tested with:**
- DateTime operator with keyframed values filtering deck layer data
- Pure Deck.gl mode (no basemap)
- Multiple frame captures (270+ frames successfully captured)
- User interactions during capture (zooming Theatre timeline)
- Different `captureDelay` values (0ms, 200ms, 500ms)

✅ **Verified:**
- Frames no longer hang on data-only changes
- Visual updates correctly show filtered data per frame
- No spurious `onAfterRender` resolution
- No multiple `setTimeout` callbacks per frame
- Preview mode still works (layers update when editing graph)
- MapLibre overlay mode unaffected (uses separate `onIdle` callback)

## Breaking Changes

None. This is a bug fix that makes existing functionality work correctly.

## Future Work

See `FRAME_CAPTURE_CLEANUP_PLAN.md` for:
- Remove unused `isDeckReady` helper (duplicated)
- Consider extracting frame capture to custom hook
- Conditionalize debug logging
- Test removing visualization props refs (may not be needed)

## Related Issues

Fixes the bug where video rendering hangs indefinitely when animating data-driven properties.

---

**PR Size:** Large (23 commits, 408 additions) but most commits are incremental bug fixes discovered during development. The final architecture is clean and well-documented.

**Review Focus:**
1. Graph settling logic (`graph-settling.ts`)
2. Three-flag coordination system (`timeline-editor.tsx` lines 213-298)
3. Frame request callback pattern (`draw-loop.ts`)
4. Test coverage (unit tests for graph settling)
