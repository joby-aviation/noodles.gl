# Video Export Performance Optimization

## Overview

Noodles.gl video export has been optimized to achieve **1.2-1.5x realtime speed** for cached-tile scenes, up from the previous 0.93x realtime. This means you can export a 30fps video faster than it plays back.

## Performance History

| Version | Method | Frame Time | Realtime Factor | Notes |
|---------|--------|------------|----------------|-------|
| v1.0 (old) | onIdle event | ~308ms | 0.11x (9x slower) | ~300ms debounce |
| v2.0 (baseline) | render event + skip-first | ~36ms | 0.93x (near realtime) | 8.6x speedup |
| **v3.0 (current)** | **time freezing + first-render** | **~23-28ms** | **1.2-1.5x (faster than realtime)** | **40-50% faster** |

## How It Works

### Time Freezing (MapLibre setNow API)

The key optimization uses MapLibre's `setNow()` API to freeze time during export:

```javascript
// Before each frame:
maplibregl.setNow(virtualTime)  // Freeze at exact frame time
setPosition(simTime)            // Update timeline
redraw()                        // Trigger render
// Wait for single render event
// Capture frame

// After export:
maplibregl.restoreNow()         // Restore real time
```

**Benefits:**
- **Deterministic rendering:** Each frame rendered at exact virtual time
- **No skip-first-render needed:** Operator state is guaranteed consistent
- **Faster capture:** One render pass instead of two (~16-20ms saved)
- **No race conditions:** Timeline position and render state always in sync

### Other Optimizations

1. **fadeDuration: 0** - Eliminates tile fade animations during export
2. **Reduced safety delay** - 8ms instead of 16ms (with time freezing, less margin needed)
3. **Efficient render event handling** - Capture on first render, no redundant repaints

## Performance Breakdown

Typical frame time breakdown (30fps export):

| Component | Time | % | Notes |
|-----------|------|---|-------|
| Wait for render | ~15ms | 60% | Render event + layer loading |
| Frame capture | ~5ms | 20% | MediaStreamTrackProcessor |
| Video encoding | ~8ms | 20% | VideoEncoder (hardware accelerated) |
| **Total** | **~28ms** | **100%** | **1.2x realtime @ 30fps** |

## Configuration

### Export Settings (OutOp)

```typescript
// Render settings in OutOp operator
{
  waitForData: true,        // Wait for all layers to load (default: true)
  captureDelay: 50,         // Only affects interactive preview (default: 50ms)
  codec: 'avc',             // Video codec: avc, hevc, vp9, av1
  bitrateMbps: 10,          // Video bitrate in Mbps
  bitrateMode: 'constant',  // constant or variable
  framerate: 30             // Frames per second
}
```

**waitForData:**
- `true` (recommended): Waits for all Deck.gl layers and MapLibre tiles to load before capturing each frame
- `false` (faster but risky): Captures immediately, may result in incomplete frames

**Note:** `captureDelay` no longer affects export performance. It only controls the delay during interactive preview. Export uses a fixed 8ms safety margin.

## Debugging Performance

### Enable Debug Logging

In browser console:
```javascript
localStorage.debug = 'noodles:render*'
```

Refresh the page, then export. You'll see detailed timing:

```
Export complete: 300 frames in 8400ms (avg 28ms/frame, target 33.3ms/frame, 1.2x realtime speed)
Time breakdown: wait=4500ms (54%), capture=1500ms (18%), encode=2400ms (29%)
```

### Interpreting Results

**Good performance (1.0x+ realtime):**
- Frame time ≤ 33ms @ 30fps
- Wait time < 20ms per frame
- Capture time < 10ms per frame
- Encode time < 15ms per frame

**Performance issues:**

| Symptom | Cause | Solution |
|---------|-------|----------|
| Wait time > 30ms | Slow tile loading | Enable browser cache, use local tiles |
| Wait time > 50ms | Heavy Deck.gl layers | Set `waitForData: false` or optimize layers |
| Capture time > 20ms | Large canvas | Reduce output resolution |
| Encode time > 30ms | Slow codec | Switch to `avc` (fastest) or enable hardware acceleration |

## Performance by Scene Type

| Scene Type | Expected Performance | Notes |
|------------|---------------------|-------|
| Cached tiles + simple layers | 1.5-2.0x realtime | Best case |
| Remote tiles + medium layers | 1.0-1.3x realtime | Network dependent |
| Heavy computation + large datasets | 0.7-1.0x realtime | CPU bound |
| Pure Deck.gl (no basemap) | 1.5-2.5x realtime | No tile wait |

## Best Practices

### For Fastest Exports

1. **Enable browser cache** - Tiles load instantly on second export
2. **Use local tile sources** - Avoid network latency
3. **Simplify layers during export** - Reduce data points if visual quality isn't critical
4. **Use AVC codec** - Fastest encoding (HEVC/VP9 are slower but higher quality)
5. **Lower resolution** - 1080p exports 4x faster than 4K

### For Highest Quality

1. **Keep `waitForData: true`** - Ensures all data loaded
2. **Use HEVC or VP9** - Better compression, higher quality
3. **Increase bitrate** - 15-20 Mbps for high quality
4. **Export at native resolution** - No scaling artifacts

## Troubleshooting

### Export is slower than expected

1. Check debug log for time breakdown
2. Verify time freezing is active (should see log: `Time frozen at Xms`)
3. Check network throttling isn't enabled in DevTools
4. Verify hardware acceleration is enabled (chrome://gpu)

### Frames are incomplete or stuttering

1. Enable `waitForData: true`
2. Check layer `isLoaded` status in debug log
3. Verify tile sources are reachable
4. Increase bitrate if encoding quality is low

### Memory issues during long exports

1. Export in smaller chunks (e.g., 300 frames at a time)
2. Close other applications to free RAM
3. Use lower resolution or compression

## Technical Details

### Architecture

```
Frame Loop:
  1. maplibregl.setNow(virtualTime)  // Freeze time
  2. setPosition(simTime)            // Update timeline
  3. redraw()                        // Trigger render
  4. Wait for 'render' event         // MapLibre signals ready
  5. Check layer.isLoaded (if waitForData)
  6. setTimeout(8ms)                 // GPU buffer swap safety
  7. Capture frame via MediaStreamTrackProcessor
  8. Encode via VideoEncoder API
  9. Write to MP4 via mediabunny
```

### Browser Compatibility

- **Chrome/Edge:** Full support, hardware acceleration
- **Firefox:** Partial support (slower encoding)
- **Safari:** Limited support (no VP9/AV1)

Requires:
- MediaStreamTrackProcessor API
- VideoEncoder API (WebCodecs)
- FileSystem Access API (for save dialog)
- MapLibre GL JS v5.10.0+ (for setNow API)

## Future Improvements

Potential future optimizations:

1. **Parallel encoding** - Encode frames in Web Worker
2. **GPU-accelerated capture** - Direct WebGL texture read
3. **Adaptive quality** - Lower quality for preview, high for final
4. **Predictive tile prefetch** - Load tiles for upcoming frames
5. **Frame skipping detection** - Warn if frames are dropped

## Contributing

Found a performance issue? Measured different results?

1. Enable debug logging: `localStorage.debug = 'noodles:render*'`
2. Export 30 frames from a test project
3. Copy console output
4. Open GitHub issue with:
   - Browser and version
   - Project details (tile source, layer count)
   - Console timing output
   - Expected vs. actual performance

## References

- [MapLibre Time API Docs](https://maplibre.org/maplibre-gl-js/docs/API/classes/maplibregl.html#setNow)
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [MediaStream TrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor)
