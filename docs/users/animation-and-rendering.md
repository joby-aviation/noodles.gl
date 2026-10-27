# Animation and rendering

A common use case when exporting videos is to add animation to highlight a map area or transition between values.

## Keyframe-based animation

Select a node to show its parameters in the Properties Panel. Clicking the diamond next to a number parameter adds a keyframe for it at the playhead. Any number parameter can be keyframed: the camera, a filter threshold, a layer's opacity, a Trips Layer's Current time.

<iframe src="https://drive.google.com/file/d/1YyKSAycDOmtWBvuyQYWWQ5b7mLhMxoOV/preview" width="800" height="390" allow="autoplay"></iframe>

Scrub the timeline further ahead and change the value to set a new keyframe. It appears on the timeline as a diamond. You can move and adjust keyframes in the timeline editor, or edit the curve between them.

### Camera moves

The camera is the deck node's Longitude, Latitude, Zoom, Pitch and Bearing, or those of a View State node wired into the deck's view state. Exports and screenshots always render through it. Keyframing the camera costs no queries while the animation plays.

The map has two cameras, as Blender's viewport does. The switch in its top-left corner shows which one you are looking through:

- **Viewport**: a view of your own to look around in. Panning, zooming and tilting the map take you here, and change nothing in the project. The editor remembers it per project, in this browser.
- **Camera** (named after the camera node, such as `deck`): the map looks through the active camera, as exports do. Scrubbing or playing the timeline brings you back here. Press Numpad 0 to switch between the two.
- **Lock** (the padlock) pins the one you are in. A locked viewport stays put when the timeline moves. A locked camera view stays when you move the map, and moving the map moves the camera itself; a keyframed camera parameter gets a keyframe at the playhead. A camera that another node, an expression, a reference or a wire drives, such as a Fit Bounds wired into the deck, can't be moved, so a locked camera view holds still and says what drives it. Nothing moves the camera while the timeline plays.

### Animating data

A Trips Layer draws paths over time. Its Timestamp channel names a column, and its **Current time** is the time drawn: keyframe it, or wire a Time node into its `currentTime` port. A Time Series node gives each path's position at one time, with its own Time parameter driven the same way.

### Animating table cells

Cells in a Table node can be keyframed one at a time. Select the table, hover a cell in the parameter pane and click its diamond to add a keyframe at the playhead, then move the playhead and edit the cell to add the next one. Numbers ease from key to key; text switches at each key. The timeline shows each cell's track by its column and row, such as `population (row 1)`.

Tracks follow the row's position in the table. Adding or deleting rows above an animated row moves its animation onto whichever row takes that position, and renaming a column leaves its tracks on the old name. A keyframed column needs a name an expression can read: letters, digits and underscores.

## Rendering output

The deck node holds the export settings, in its Export folder: size, frame rate, codec, bitrate and more. Adjust them, then click **Export** in the top bar and choose **Video (MP4)** to render the timeline, or **Image (PNG)** to save the current frame. Noodles steps through your timeline and writes each frame to the video.

### Preview exports

The deck's **Capture** setting picks how each frame is captured. **Final**, the default, waits for the map and every layer to finish drawing, then for the **Capture delay**, before it records a frame. **Preview** records each frame as soon as it is first drawn, which makes exports faster. It can drop or repeat frames, though, for instance while map tiles are still loading, so use it for quick checks and switch back to Final for anything you hand off or compare against.

### Transparent video

To composite a visualization over other footage, pick the VP9 codec in the deck's Export settings and check **Transparent video**. The export is then a WebM file with an alpha channel instead of an MP4. Anything the scene doesn't draw, such as a transparent deck.gl clear color or the space around a globe, stays transparent; a basemap with a solid background stays opaque. Chrome and Edge play these files with their transparency, but many desktop players and editors ignore WebM alpha.

## Procedural animation

Any number parameter can follow the clock or another parameter. A parameter expression with `sin(T)` is a simple way to make an oscillating move, say a camera bearing that swings back and forth:

```
sin(T * 0.5) * 10    // oscillate between -10 and 10 degrees
```

Right-click the parameter and choose **Set expression...** to enter it. `T` is seconds on the timeline and `F` the frame; see [Expressions](./expressions.md). For more than one parameter, a Time node (seconds times a speed, plus an offset) wired into each parameter's port keeps them in step.
