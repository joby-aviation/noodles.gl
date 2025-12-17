# Video Frame Capture Bug - Debug Session Findings

**Date:** 2025-12-17
**Test:** Pure Deck mode with DateTime field filtering layer data

## Bug Confirmed

**Deck.gl's `onAfterRender` callback does NOT fire when only data changes occur**, even though Deck visually re-renders the scene.

## Test Setup

- DateTimeOp with keyframed value
- DateTime connected to data filter
- Filter affects Deck layer data
- Pure Deck mode (no MapLibre basemap)
- Deck IS visually updating correctly

## Debug Session Results

### Frame 0 (Data-only change)
```
[Frame 0] Setting timeline position: 0
redraw null Deck {...}
[Frame 0] Waiting for canvas ready...
[STUCK - no onAfterRender fired]
```

**Result:** Frame capture hangs indefinitely

### Frame 1 (After manual opacity change)
User manually changed layer opacity property (visual prop change):

```
[onAfterRender] FIRED {
  timestamp: 1653774.6000000238,
  deckReady: true,
  layerCount: 5,
  layersLoaded: 5,
  waitForData: true,
  captureDelay: 200
}
[Frame 1] Canvas ready, capturing frame
```

**Result:** Frame captured successfully!

### Frame 2 (Data-only change again)
```
[Frame 2] Setting timeline position: 0.06666666666666667
[Frame 2] Waiting for canvas ready...
[STUCK - no onAfterRender fired]
```

**Result:** Frame capture hangs again

## Root Cause

Deck.gl's internal change detection triggers `onAfterRender` only when it detects visual property changes (opacity, colors, positions, etc.). When only the `data` prop changes but visual properties remain the same, Deck:

1. ✅ DOES re-render the scene visually (user can see changes)
2. ❌ DOES NOT fire the `onAfterRender` callback

This causes video frame capture to hang because the frame loop waits for `onAfterRender` to resolve the `canvasFrameReady()` promise.

## Solution Validated

Our planned solution will fix this:

1. **Force `deck.redraw('frame-capture')`** - Explicitly tell Deck to redraw and fire callbacks, regardless of its internal change detection
2. **Wait for graph settling** - Ensure reactive graph has finished processing datetime → data filter propagation before forcing redraw

## Next Steps

1. Commit these debug changes
2. Create feature branch: `fix/video-frame-capture-with-data-changes`
3. Implement graph settling utility
4. Add forced redraw in draw loop
5. Test with same DateTime scenario to verify fix
