# Animation and the timeline

Any number parameter can be keyframed: its value at each moment comes from the timeline instead of the document. The camera, a filter threshold, a layer's opacity or a trips layer's `currentTime` all animate the same way.

## Keyframes

- `get_timeline` returns the length, frame rate, playhead, and each keyframed parameter as `target: "node.param"` with its keyframes.
- `set_keyframe` adds or updates one: `{ "target": "dots.opacity", "time": 2, "value": 0.5 }`. Interpolation is `bezier` (smooth, the default), `linear` or `hold` (a step). A keyframe already at that time is updated.
- `delete_keyframe` removes one: `{ "target": "dots.opacity", "time": 2 }` or by `keyframeId`.
- `set_playback_position` moves the playhead to inspect a moment: `{ "position": 1.5 }`.

A fly-over is keyframes on the deck's camera: `deck.longitude`, `deck.latitude`, `deck.zoom`, `deck.pitch`, `deck.bearing`, two or more each.

## Animating data

A `trips` layer draws paths over time: its `timestamp` expression names a column, and `currentTime` is the time drawn, usually wired from a `time` node (`par:currentTime`) or keyframed. Time-sampled positions (where each vehicle is now) come from a `time-series` node over vertex rows, with its `time` wired or keyframed the same way.

A keyframed `currentTime` costs no query while playing; a keyframed SQL parameter re-runs its query each frame, which is slower for large tables.

## Checking

Move the playhead with `set_playback_position` and take a screenshot to see a moment. Export to video from the Export menu.
