# Animation and rendering

A common use case when exporting videos is to add animation to highlight a map area or transition between values.

## Keyframe-based animation

Clicking a node with animatable properties will surface its properties in the right panel on screen. Clicking the diamond next to a property will add a keyframe for that property to the timeline.

<iframe src="https://drive.google.com/file/d/1YyKSAycDOmtWBvuyQYWWQ5b7mLhMxoOV/preview" width="800" height="390" allow="autoplay"></iframe>

You can scrub the timeline further ahead and change any value to set a new keyframe. You should now see a new keyframe added to the timeline as a diamond icon. You can move and adjust these values using the timeline editor, or edit the curve between the values.

### Animating table cells

Cells in a TableEditor can be keyframed one at a time. Hover a cell and click its diamond to add a keyframe, then scrub ahead and edit the cell to add the next one. Numbers, colors, and points interpolate; text and booleans switch at the midpoint. Each cell gets its own track, named `table / data / <row> / <column>`.

Tracks follow the row's position in the table. Adding or deleting rows above an animated row moves its animation onto whichever row takes that position, and renaming a column leaves its tracks on the old name.

## Rendering output

On the lefthand node tree, find the "render" sheet object under the current project (typically the project name, the bottom-most one with the most sheet objects).

You can adjust parameters like framerate, codec and resolution before exporting. Clicking the `startRender` button will open a dialog asking where to save your video file. The app will progress through your timeline and render to the file as a video.

### Preview exports

The Out node's **Capture** setting picks how each frame is captured. **Final**, the default, waits for the map and every layer to finish drawing, then for the **Delay**, before it records a frame. **Preview** records each frame as soon as it is first drawn, which makes exports faster. It can drop or repeat frames, though, for instance while map tiles are still loading, so use it for quick checks and switch back to Final for anything you hand off or compare against.

### Transparent video

To composite a visualization over other footage, pick the VP9 codec in the Out node's render settings and check **Transparent background**. The export is then a WebM file with an alpha channel instead of an MP4. Anything the scene doesn't draw, such as a transparent deck.gl clear color or the space around a globe, stays transparent; a basemap with a solid background stays opaque. Chrome and Edge play these files with their transparency, but many desktop players and editors ignore WebM alpha.

## Procedural animation
All values are reactive and can be driven by any other property.

Combining a TimeOp with an ExpressionOp using `Math.sin()` is a good way to create a simple animation, say an oscillating camera move based on the current time:

```javascript
// In an ExpressionOp connected to TimeOp output
Math.sin(d * 0.001) * 10  // Oscillate between -10 and 10
```
