# Test Runbook: Frame Capture with Data-Driven Animations

## Critical Discovery

**Even the most basic Pure Deck example (orbit) didn't work before this PR.**

The bug affected ALL Pure Deck frame captures, not just data-driven animations.

---

## Minimum Reproduction Tests

Test the simplest case first, then build up complexity.

### Test 1: Orbit Example (Most Basic) ⭐

**URL:** https://noodles.gl/app/examples/orbit

**Setup:**
- Pure Deck mode (no basemap)
- Static layer (spinning cube)
- No data changes

**Steps:**
1. Open orbit example
2. Set timeline to 5 seconds
3. Click "Render Video"

**Before PR:** ❌ **Hung at frame 0-1** (even though nothing changes!)

**After PR:** ✅ Completes 150 frames

**Why it failed:** Pure Deck mode had broken frame capture entirely. Deck.gl's `onAfterRender` wasn't being triggered reliably.

---

### Test 2: Static Data with Keyframe

**Setup:**
- Pure Deck mode
- Deck layer with static data (e.g., 10 points)
- Keyframe a visual property (opacity 0→1 over 5 seconds)

**Steps:**
1. Connect keyframed NumberOp to layer opacity
2. Render 5 seconds

**Before PR:** ❌ Likely hung

**After PR:** ✅ Completes 150 frames

---

### Test 3: Data Filter Animation (Original Bug Report)

**Setup:**
- Pure Deck mode
- Deck layer with array data
- DateTime keyframed (0→5 seconds)
- CodeOp filters data:
  ```javascript
  const time = op('/datetime').par.value
  return data.filter(d => d.timestamp <= time)
  ```

**Steps:**
1. Connect CodeOp to layer data
2. Render 5 seconds

**Before PR:** ❌ Hung (this is what user reported)

**After PR:** ✅ Completes 150 frames, shows data changing

---

## Quick Smoke Test

**Just render orbit example for 5 seconds.**

If that works, the fix is working.

---

## Root Cause

**The bug was in Pure Deck mode's frame capture coordination:**

1. Deck.gl's `onAfterRender` only fires when it detects changes
2. For Pure Deck, nothing was calling `deck.redraw()` to trigger renders
3. Even static scenes hung because no renders were happening

**The fix:**
- Explicitly call `deck.redraw('frame-capture')` for each frame
- Wait for operator graph to settle before requesting frame
- Coordinate promise resolution to prevent race conditions

---

## Unit Tests

```bash
yarn test src/render/graph-settling.test.ts
```

Expected: 6 tests passing

---

## Build Checks

```bash
yarn tsc --noEmit
yarn lint
yarn build
```

All should pass without new errors.

---

## Success Criteria

**Critical:**
- ✅ Orbit example (Test 1) renders 5 seconds successfully
- ✅ Data filter animation (Test 3) works
- ✅ Unit tests pass
- ✅ Build succeeds

**Nice to have:**
- ✅ No console errors during capture
- ✅ Video shows correct visual changes
- ✅ MapLibre overlay mode still works (regression test)

---

## Console Pattern (Correct)

When it's working:
```
[Frame 0] Setting timeline position: 0
[Frame 0] Graph settled
[Frame 0] Requesting frame capture...
[useDeckDrawLoop] Calling deck.redraw()      ← KEY: Force redraw
[onAfterRender] Resolving frame capture after delay
[Frame 0] Canvas ready, capturing frame
got frame VideoFrame {format: 'BGRA', ...}
[Frame 1] Setting timeline position: 0.033...
...
```

When it was broken:
```
[Frame 0] Setting timeline position: 0
[Frame 0] Waiting for canvas ready...
(hangs forever)
```

---

## Files Changed

- `src/render/graph-settling.ts` - NEW: Wait for operators to finish
- `src/render/graph-settling.test.ts` - NEW: Unit tests
- `src/render/draw-loop.ts` - Expose `requestFrame()`, call `deck.redraw()`
- `src/render/renderer.ts` - Integrate graph settling and frame requests
- `src/timeline-editor.tsx` - Frame capture coordination with flags

**Stats:** 5 files, 408 additions, 51 deletions, 23 commits

---

## Known Limitations

1. **Pure Deck mode only** - MapLibre overlay mode wasn't broken (uses `mapProps.onIdle`)
2. **captureDelay=200ms needed** - Waits for browser rendering pipeline (GPU→paint)
3. **Verbose logging** - Helpful for debugging production issues

---

## Rollback Plan

If critical issues:
```bash
git revert --no-edit main..fix/video-frame-capture-with-data-changes
```

---

## Additional Resources

- `PR_DESCRIPTION.md` - Full technical writeup
- `FRAME_CAPTURE_CLEANUP_PLAN.md` - Architecture and future work
- Orbit example: https://noodles.gl/app/examples/orbit
