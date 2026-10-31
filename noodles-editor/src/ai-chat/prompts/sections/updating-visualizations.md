# Updating a visualization

Most requests change something already drawn: a color, a size, a filter, the camera. Find the node first, then change only what the request names.

1. `list_nodes` shows every node's name, operator and parameters, and the wires between them.
2. `get_node_info` on the node you will change shows every parameter with its kind, default and current value, which are wired (`par:<param>` from a number node) and which are keyframed.
3. `apply_modifications` with `update_node` merges `params`: `{ "type": "update_node", "id": "dots", "params": { "radiusScale": 4 } }`. Send `null` to put a parameter back to its default.

## Where a value comes from

The map shows a run's changes as it makes them; the user then accepts or rejects them.

A layer's `color` or `radius` is often an expression naming a column another node writes. If `color` is `Cd`, the color comes from the `color-ramp` node that writes `Cd`: change its `ramp`, `min` or `max` there rather than the layer. A parameter wired from a number node takes that node's value: change the number node, or delete the wire to set the parameter directly. A shared color can come from a `color` node referenced as `{ "ref": "accent/color" }`.

## Keyframed parameters

A keyframed parameter's value comes from the timeline. `update_node` with an explicit value replaces its keyframes; to change the animation instead, use `set_keyframe` (see the animation walkthrough).

## Checking

After an edit, `get_node_info` shows the node's errors, if any, and how many rows it drew. A layer with errors draws nothing; the message says why (a column that does not exist, an input not connected). Fix and send the whole batch again: a batch that fails applies nothing.
