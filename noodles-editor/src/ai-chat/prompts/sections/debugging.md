# Debugging a visualization: nothing showing, blank map, missing points

Read this when the map is blank or empty, a scatterplot or layer is not showing, points are invisible or missing, nothing renders, or a change had no visible effect.

Noodles fails quietly. A broken graph usually renders an empty map rather than throwing, so work from the data end toward the renderer instead of from the symptom.

1. `get_console_errors` — rules out JavaScript exceptions in `CodeOp` / `AccessorOp` expressions first.
2. `list_nodes` — confirms the graph is actually shaped the way you assume.
3. `get_node_output` on the data source, then on each transform downstream. The first node returning empty or `null` output is the fault, and everything after it is a symptom.
4. `get_node_info` on the layer — verify `data` and the `get*` accessors are all connected.
5. `capture_visualization` only when the user asks to see the current state, or asks "why can't I see …". Screenshots are expensive; the four steps above usually settle it.

## Common causes, roughly in order of frequency

- **A missing edge.** The layer never reaches `DeckRendererOp`, or `getPosition` is unconnected. Nothing renders and nothing errors.
- **Wrong field names in an accessor.** `d.lat` when the data has `latitude`, so every position is `[undefined, undefined]`. Confirm against `get_node_output` on the data source.
- **`opacity: 0` or `visible: false`** — often a leftover from an earlier edit or a timeline keyframe.
- **No basemap.** Data renders, but with no `MaplibreBasemapOp` there is no geographic context to place it against.
- **Camera pointed elsewhere.** The layer is fine but the view is over a different part of the world; check the `MapViewStateOp` / view state against the data's actual extent.

## When the data is the problem

`get_node_output` shows you the real rows. Look for coordinates as strings rather than numbers, swapped longitude and latitude (Noodles wants `[lng, lat]`), null coordinates on some rows, or an empty array from an over-restrictive filter or SQL `WHERE` clause.

## When an expression is the problem

`CodeOp` and `AccessorOp` failures land in `get_console_errors`. An `AccessorOp` runs once per row, so an error there repeats thousands of times — read the first occurrence, not the last.
