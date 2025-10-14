# Animation and rendering

A common use case when exporting videos is to add animation to highlight a map area or transition between values.

## Keyframe-based animation

Clicking a node with animatable properties will surface its properties in the right panel on screen. Clicking the diamond next to a property will add a keyframe for that property to the timeline.

<video controls autoplay="true" muted="true" width="100%" style={{maxWidth: '800px'}}>
  <source src="/img/rendering-tutorial.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

You can scrub the timeline further ahead and change any value to set a new keyframe. You should now see a new keyframe added to the timeline as a diamond icon. You can move and adjust these values using the timeline editor, or edit the curve between the values.

## Rendering output

On the lefthand node tree, find the "render" sheet object under the current project (typically the project name, the bottom-most one with the most sheet objects).

You can adjust parameters like framerate, codec and resolution before exporting. Clicking the `startRender` button will open a dialog asking where to save your video file. The app will progress through your timeline and render to the file as a video.

## Procedural animation
All values are reactive and can be driven by any other property.

Combining a Time operator with a Sine op is a good way to create a simple animation, say an oscillating camera move based on the current time.
