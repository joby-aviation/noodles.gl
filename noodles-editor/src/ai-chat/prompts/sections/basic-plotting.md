# Plotting data on a map

A plot is three kinds of node wired left to right: a data node that makes a table, a layer that draws it, and the `deck` node that shows layers over a basemap.

## Points from a CSV

```json
[
  { "type": "add_node", "op": "file", "name": "quakes", "x": 0, "y": 0,
    "params": { "url": "https://example.com/quakes.csv", "format": "csv" } },
  { "type": "add_node", "op": "scatter", "name": "dots", "x": 320, "y": 0,
    "params": { "position": "[longitude, latitude]", "radius": "mag * 2.0", "radiusUnits": "pixels" } },
  { "type": "add_edge", "source": "quakes", "target": "dots", "targetPort": "in" },
  { "type": "add_edge", "source": "dots", "target": "deck", "targetPort": "layers" }
]
```

Before writing `position`, call `get_node_output` on the data node: expressions name columns exactly as the table has them (`longitude`, not `d.longitude`).

## Per-row values are expressions

Every per-row value is an expression in the layer's params: arithmetic, `sqrt`, `clamp`, `mix`, `ramp(t)` for a color from the layer's `ramp` parameter (t in 0–1), `[a, b]` for a vector, `coalesce(a, b)` for a missing value, `hex_color('#ff8800')` for a color column held as text. A value several layers share belongs in an `attribute` node: `{ "op": "attribute", "params": { "name": "size", "expression": "sqrt(pop) / 100.0" } }`, wired between the data and the layers, which then name `size`.

## Colors by value

Put a `color-ramp` node on the table: `{ "input": "mag", "ramp": "viridis", "min": 0, "max": 8, "name": "Cd" }`, then set the layer's `color` to `Cd`. A `map-range` node maps a column to a new range the same way. Constant colors are `[r, g, b]` 0–255 in params such as `fillColor`.

## The basemap and camera

The `deck` node holds the basemap (`mapStyle`, or `basemap: "dark-matter"`) and the camera (`longitude`, `latitude`, `zoom`, `pitch`, `bearing`). Set them with `update_node` on `deck`. Check the result with a screenshot (`find_tools({ query: "screenshot" })`).
