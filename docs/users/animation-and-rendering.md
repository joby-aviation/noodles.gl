# Animation and rendering

A common use case when exporting videos is to add animation to highlight a map area or transition between values.

## Keyframe-based animation

Clicking a node with animatable properties will surface its properties in the right panel on screen. Clicking the diamond next to a property will add a keyframe for that property to the timeline.

<iframe src="https://drive.google.com/file/d/1YyKSAycDOmtWBvuyQYWWQ5b7mLhMxoOV/preview" width="800" height="390" allow="autoplay"></iframe>

You can scrub the timeline further ahead and change any value to set a new keyframe. You should now see a new keyframe added to the timeline as a diamond icon. You can move and adjust these values using the timeline editor, or edit the curve between the values.

## Rendering output

On the lefthand node tree, find the "render" sheet object under the current project (typically the project name, the bottom-most one with the most sheet objects).

You can adjust parameters like framerate, codec and resolution before exporting. Clicking the `startRender` button will open a dialog asking where to save your video file. The app will progress through your timeline and render to the file as a video.

### Resolution, LOD, and map zoom

These controls affect different parts of a map render:

- **Resolution** establishes the base width and height.
- **LOD** multiplies both dimensions and increases sharpness. For example, 1920 × 1080 at 2× LOD creates an effective 3840 × 2160 canvas.
- **Camera zoom** controls geographic framing and which basemap style layers are visible.

Web Mercator scale is `2^zoom`. After multiplying LOD by `n`, add `log2(n)` to the camera zoom to preserve the original geographic bounds. For example, 2× LOD needs `+1` camera zoom and 4× LOD needs `+2`.

This compensation can activate additional style layers, including minor roads. LOD is therefore not a map-detail control: if a map has too much semantic detail, use a simpler basemap or customize the basemap style.

See [Voyager LOD evidence](../../dev-docs/render-lod-evidence.md) for a reproducible comparison of dimensions, bounds, active road layers, and screenshots.

## Procedural animation
All values are reactive and can be driven by any other property.

Combining a TimeOp with an ExpressionOp using `Math.sin()` is a good way to create a simple animation, say an oscillating camera move based on the current time:

```javascript
// In an ExpressionOp connected to TimeOp output
Math.sin(d * 0.001) * 10  // Oscillate between -10 and 10
```
