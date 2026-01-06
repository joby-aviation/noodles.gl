# Frame Capture Implementation - Cleanup Plan

## Status: Working Solution ✅
Frame capture now works end-to-end with data-driven animations (DateTime filtering layers).

## Current Architecture

### Key Components:

1. **graph-settling.ts** - NEW: Waits for all RxJS operators to finish executing
2. **draw-loop.ts** - Modified: Exposes `requestFrame()` function via callback
3. **renderer.ts** - Modified: Waits for graph settling, calls `requestFrame()`
4. **timeline-editor.tsx** - Modified: Frame capture logic integrated into `deckProps.onAfterRender`

### Frame Capture Flow (Pure Deck Mode):

```
1. Renderer: Set timeline position
2. Renderer: Wait for graph settling (operators finish)
3. Renderer: Call requestDeckFrameRef.current() [non-blocking]
4. Draw Loop: Set up promise, set expectingRedrawRef=true, call deck.redraw()
5. Deck.gl: Renders with new data
6. onAfterRender: Fires (in deckProps)
7. onAfterRender: Checks flags, schedules setTimeout(captureDelay)
8. setTimeout: Clears flags, resolves promise
9. Draw Loop: Continues, calls captureFrame()
10. Renderer: Waits for canvasFrameReady()
11. Renderer: Captures VideoFrame from canvas
```

### Key Coordination Mechanisms:

**Three Flags (all React refs):**
- `frameResolverRef`: Holds promise resolver for current frame
- `expectingRedrawRef`: Set immediately before deck.redraw(), cleared after capture
- `timeoutScheduledRef`: Prevents multiple setTimeout callbacks per frame

**Why Each Flag is Needed:**
- `expectingRedrawRef`: Filters spurious `onAfterRender` from React re-renders before we call deck.redraw()
- `timeoutScheduledRef`: Prevents multiple setTimeout callbacks when onAfterRender fires multiple times per frame (due to React re-renders from node dimension changes)
- Cleared at **frame start** (not in setTimeout) to prevent race with captureDelay=0

**captureDelay (default 200ms):**
- NOT a hack - waits for browser's async rendering pipeline
- After onAfterRender: GPU flush → canvas paint → pixels ready
- With 0ms: MediaStreamTrackProcessor hangs waiting for pixels
- User-configurable: 0-2000ms range

## Proposed Cleanups

### Priority 1: Remove Dead Code

#### Cleanup #1: Remove unused useDeckDrawLoop call in DeckGLOverlay
**File:** `timeline-editor.tsx` lines 124-129
**Why:** MapLibre overlay mode uses `mapProps.onIdle` for frame capture, not useDeckDrawLoop
**Code to remove:**
```typescript
useDeckDrawLoop({
  deck: deckgl,
  isRendering,
  rendererConfig: renderer,
  props,
})
```
**Impact:** None - this call does nothing (missing frame capture params)
**TS Error Fix:** Yes - removes usage of unused parameters

#### Cleanup #2: Remove unused parameters from UseDeckDrawLoopProps
**File:** `draw-loop.ts` interface at line 9
**Why:** `rendererConfig` and `props` are defined but never used in the function body
**Code to remove:**
```typescript
rendererConfig: RendererConfig  // UNUSED
props?: Partial<DeckProps>      // UNUSED
```
**Impact:** None - these were only passed by the MapLibre call we're removing
**Dependencies:** Do after Cleanup #1

#### Cleanup #3: Remove isDeckReady from draw-loop.ts
**File:** `draw-loop.ts` line 27-28
**Why:** Defined but never used in this file (it's duplicated in timeline-editor.tsx)
**Code to remove:**
```typescript
const isDeckReady = (deck: Deck | null) =>
  !deck || deck.props.layers.every(layer => !layer || (!Array.isArray(layer) && layer.isLoaded))
```
**Impact:** None - identical function exists in timeline-editor.tsx where it's actually used

### Priority 2: Consider Extracting Frame Capture Logic

#### Cleanup #4: Extract frame capture to custom hook (Optional)
**Current state:** Frame capture logic is embedded in `timeline-editor.tsx`:
- 3 refs declared at top (frameResolverRef, expectingRedrawRef, timeoutScheduledRef)
- Logic in `deckProps.onAfterRender` callback (lines 268-298)
- Refs passed to useDeckDrawLoop

**Proposed:** Create `useFrameCapture` hook:
```typescript
// New file: render/use-frame-capture.ts
export function useFrameCapture({
  isRendering,
  waitForData,
  captureDelay,
  deckRef,
}) {
  const frameResolverRef = useRef(...)
  const expectingRedrawRef = useRef(...)
  const timeoutScheduledRef = useRef(...)

  const onAfterRender = useCallback(() => {
    // Frame capture logic here
  }, [...])

  return {
    onAfterRender,
    frameResolverRef,
    expectingRedrawRef,
    timeoutScheduledRef,
  }
}
```

**Benefits:**
- Separates concerns (frame capture vs UI)
- Makes timeline-editor.tsx more readable
- Easier to test frame capture logic in isolation

**Risks:**
- More files to maintain
- May not be worth it if we don't reuse it

**Recommendation:** Keep as-is unless we need to support MapLibre frame capture differently

### Priority 3: Debug Logging

#### Cleanup #5: Remove or conditionalize debug console.log statements
**Files:** All three (draw-loop.ts, renderer.ts, timeline-editor.tsx)
**Count:** ~15 console.log/warn statements
**Options:**
1. Remove entirely
2. Convert to conditional: `if (DEBUG_FRAME_CAPTURE) console.log(...)`
3. Keep for now (helpful for debugging production issues)

**Recommendation:** Keep for now - this was a complex bug, logging helps diagnose production issues

### Priority 4: Simplification Opportunities

#### Cleanup #6: Remove refs for visualization props (Maybe)
**Current:** `visualizationDeckPropsRef` and `rendererRef` store latest values
**Why added:** To avoid recreating deckProps on every render
**Current deckProps dependencies:** `[visualization.deckProps, redraw, isRendering]`
**Question:** Do we still need the refs or can we read directly from closure?

**Test:** Check if removing refs breaks anything:
```typescript
// Instead of: visualizationDeckPropsRef.current
// Use: visualization.deckProps
```

**Recommendation:** Test this carefully - may cause subtle timing issues

## Testing Checklist

After each cleanup:
- [ ] Pure Deck mode: Frame capture works end-to-end
- [ ] MapLibre mode: Frame capture works with basemap
- [ ] No TypeScript errors
- [ ] No React warnings in console
- [ ] Frames don't hang at random points
- [ ] Visual updates correctly (layers show data changes)

## Files Modified (vs main)

```
noodles-editor/src/render/draw-loop.ts           | 92 ++++++++-----
noodles-editor/src/render/graph-settling.test.ts | 166 +++++++++++++++++++++
noodles-editor/src/render/graph-settling.ts      | 78 ++++++++++
noodles-editor/src/render/renderer.ts            | 33 ++++-
noodles-editor/src/timeline-editor.tsx           | 87 ++++++++++--
5 files changed, 405 insertions(+), 51 deletions(-)
```

## Commits on Branch (Latest to Oldest)

1. `8ce047d` docs: Clarify captureDelay purpose - browser rendering pipeline timing
2. `cbb5a5d` fix: Clear timeoutScheduledRef at frame start to support captureDelay=0
3. `28043ca` fix: Allow deckProps to update so Deck.gl receives new layer data
4. `e743ed9` fix: Prevent multiple setTimeout callbacks per frame
5. `897bb86` fix: Clear expectingRedrawRef before resolving promise
6. `11cbd9a` fix: Set expectingRedrawRef immediately before deck.redraw()
7. `c61b7f2` fix: Stabilize deckProps to prevent spurious deck.setProps during rendering
8. `7c1c893` fix: Add expectingRedraw flag to prevent spurious onAfterRender resolution
9. `72cb7b4` fix: Integrate frame capture into deckProps to prevent React overwrites
10. `4d9eeb3` fix: Stabilize onFrameRequestReady callback with useCallback
11. `eece775` fix: Remove props/rendererConfig from effect dependencies
12. `d24e996` fix: Don't await requestDeckFrameRef - let it run async
13. `062c7e5` fix: Move requestDeckFrameRef declaration before use
14. `485f1f9` fix: Implement callback pattern for synchronized frame capture
15. `d64d12a` fix: Remove renderer redraw() call - now handled by draw loop
16. `e7b6c97` fix: Call deck.redraw() from draw loop after setProps
17. `266f805` fix: Apply onAfterRender wrapper on every props change
18. `a122d1f` fix: Fix draw loop race condition causing frame hangs
19. `3910807` feat: Integrate graph settling and forced redraw for frame capture
20. `0b74cf7` feat: Add graph settling detection utility

## Key Learnings

### What Didn't Work:

1. **Autonomous draw loop**: Running requestAnimationFrame loop independently caused spurious redraws
2. **Wrapping onAfterRender in useEffect**: React kept overwriting it with new deckProps
3. **Freezing deckProps during rendering**: Prevented Deck.gl from receiving new layer data
4. **Clearing flags in setTimeout**: Race condition with captureDelay=0
5. **Multiple setTimeout per frame**: React re-renders scheduled multiple timers

### What Worked:

1. **Graph settling detection**: Poll executionState until all operators idle
2. **Forced deck.redraw()**: Ensures onAfterRender fires even with data-only changes
3. **Integrating capture logic in deckProps**: Prevents React from overwriting
4. **Three-flag coordination**: Filters spurious callbacks and prevents multiple timers
5. **Clearing timeoutScheduledRef at frame start**: Prevents race with fast captures

### Architecture Decision:

**Why frame capture logic is in timeline-editor.tsx, not draw-loop.ts:**

The frame capture coordination requires access to:
- `deckRef` (for layer checking)
- `rendererRef` (for waitForData, captureDelay)
- `isRendering` (to enable/disable logic)
- `deckProps.onAfterRender` (needs to be stable with deckProps)

These are all React/component concerns. Putting the logic in `deckProps.onAfterRender` ensures:
1. It's not overwritten by React re-renders
2. It has access to all necessary state via refs
3. The callback is stable (useMemo dependencies control when it recreates)

`draw-loop.ts` is now minimal - just exposes `requestFrame()` and manages the promise/redraw.

## Next Steps

1. Execute cleanups #1-#3 (remove dead code)
2. Test thoroughly after each
3. Consider cleanup #4 (extract hook) if needed
4. Decide on cleanup #5 (debug logging)
5. Create PR with test runbook
