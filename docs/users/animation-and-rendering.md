# Animation and rendering

Any number parameter can change over time: keyframe it on the timeline, or drive it with an expression or a Time node. Exports render the timeline frame by frame.

## Keyframe-based animation

Select a node to show its parameters in the [Properties Panel](./properties-panel.md). Click the diamond next to a number parameter to add a keyframe for it at the playhead. The camera, a filter threshold, a layer's opacity and a Trips Layer's Current time can all be keyframed.

<iframe src="https://drive.google.com/file/d/1YyKSAycDOmtWBvuyQYWWQ5b7mLhMxoOV/preview" width="800" height="390" allow="autoplay"></iframe>

Move the playhead and change the value to set the next keyframe. Keyframes show on the timeline as diamonds; drag them there, or edit the curve between them.

### Camera moves

The camera is the deck node's Longitude, Latitude, Zoom, Pitch and Bearing, or those of a **View State** node wired into the deck's `viewState` port. Exports and screenshots always render through it. A camera input also takes a point, such as a Geocoder's location, as the camera's center, or bounds, such as a Fit Bounds', as the camera that fits them. It sets only the fields it has: a Fit Bounds wired into a View State sets its longitude, latitude and zoom, and the View State's own Pitch and Bearing still apply. Keyframing the camera costs no queries while the animation plays.

The map has two cameras, as Blender's viewport does. The switch in its top-left corner shows which one you are looking through, and Numpad 0 toggles them:

- **Viewport**: a view of your own. Panning, zooming and tilting the map take you here and change nothing in the project. A page reload starts back at the project's camera.
- **Camera** (named after the camera node, such as `deck`): the view exports use. Scrubbing or playing the timeline brings you back here.

**Lock** (the padlock) pins the one you are in. A locked viewport stays put when the timeline moves. With the camera view locked, moving the map moves the camera itself:

- A camera parameter without keyframes changes in the project.
- A keyframed one turns orange in Properties with the new value beside the keyed one. Click its keyframe button to key it at the playhead, or **Key** in the map's corner to key every changed camera parameter at once; × drops the changes, as does moving the playhead or exporting.
- A camera that something else drives (an expression, a reference, a wired Fit Bounds) can't be moved, and the map says what drives it.

Nothing moves the camera while the timeline plays.

To cut or fly between shots, make each shot a View State, wire them in order into a **Switch Value**, and wire the Switch Value into the deck's `viewState`. **Index** picks the camera, counting from 0. Keyframe Index to cut between cameras. With **Blend** on, a decimal Index is partway between two, so keyframing it from 0 to 1 flies from the first camera to the second. See the <EditorLink example="camera-switch">Camera Switch example</EditorLink>.

### Animating data

A Trips Layer draws paths over time. Its Timestamp channel names a column, and its **Current time** is the time drawn: keyframe it, or wire a Time node into it. A Time Series node gives each path's position at one time, with its own Time parameter driven the same way. The <EditorLink example="world-flights">World Flights example</EditorLink> does both from one Time node.

### Animating table cells

Cells of a Table node can be keyframed one at a time. Select the table, hover a cell in the parameter pane and click its diamond, then move the playhead and edit the cell for the next key. Numbers ease from key to key; text switches at each key. The timeline names each cell's track by column and row, such as `population (row 1)`.

Tracks follow the row's position in the table: adding or deleting rows above an animated row moves its animation onto whichever row takes that position, and renaming a column leaves its tracks on the old name. A keyframed column's name must be letters, digits and underscores, so an expression can read it.

## Procedural animation

A parameter expression can follow the clock. `T` is seconds on the timeline and `F` the frame (see [Expressions](./expressions.md)). For a camera bearing that swings back and forth:

```
sin(T * 0.5) * 10    // between -10 and 10 degrees
```

Right-click the parameter and choose **Set expression...** to enter it. To keep several parameters in step, wire one **Time** node (seconds times Speed, plus Offset) into each of their ports.

## Rendering output

The deck node's **Export** folder holds the render settings: size, frame rate, codec, bitrate and more. Click **Export** in the top bar and choose **Video (MP4)** to render the timeline, or **Image (PNG)** to save the current frame.

### Preview exports

The deck's **Capture** setting picks how each frame is captured. **Final**, the default, waits for the map and every layer to finish drawing, then for the **Capture delay**, before it records a frame. **Preview** records each frame as soon as it is first drawn, which is faster but can drop or repeat frames while map tiles load. Use it for quick checks and Final for anything you hand off.

### Transparent video

To composite a visualization over other footage, set the deck's Codec to VP9 and check **Transparent video**. The export is then a WebM file with an alpha channel, and the menu item reads **Video (WebM, transparent)**. Anything the scene doesn't draw, such as the space around a globe, stays transparent; a basemap with a solid background stays opaque. Chrome and Edge play these files with transparency, but many desktop players and editors ignore WebM alpha.
