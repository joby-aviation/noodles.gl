# Animating fields on the timeline

Any animatable field can be keyframed. Values interpolate between keyframes, so an animation is just two or more keyframes on the same track.

1. `get_timeline` — returns the existing tracks and keyframes plus the sequence length and FPS. Read this first; keyframe positions are in seconds and only make sense against the sequence length.
2. `set_keyframe` — adds or updates one keyframe on one field.
3. `set_playback_position` — scrubs to a given time so you can inspect or screenshot that frame.

## Track IDs

A track ID is `"operator-name / fieldName"` — the operator's name, a space-slash-space, then the field. For example `"my-layer / opacity"` or `"threshold / value"`. Note it uses the bare operator name, not the leading-slash path.

## Interpolation

- `"bezier"` — smooth easing between keyframes. The default, and what you want for most motion.
- `"hold"` — steps to the new value and stays there until the next keyframe. Use it for discrete changes such as toggling `visible` or switching a category.

## Example: fade a layer in over two seconds

Two keyframes on one track:

- t = 0, value = 0
- t = 2, value = 1

with `bezier` interpolation, on track `"my-layer / opacity"`.

## Practical notes

- Animating a value that drives a `DuckDbOp` mustache reference re-runs the query every frame. Correct, but expensive on a large table — prefer animating presentation properties (`opacity`, radius, color, camera) over query parameters.
- Animating a camera means keyframing the view state operator's fields (longitude, latitude, zoom, pitch, bearing), not the layer.
- Keyframes past the sequence length never play. If a requested time exceeds it, extend the sequence or place the keyframe inside the existing range and say so.
- A field with exactly one keyframe is pinned to that value for the whole sequence rather than animated. Two keyframes are the minimum for motion.
