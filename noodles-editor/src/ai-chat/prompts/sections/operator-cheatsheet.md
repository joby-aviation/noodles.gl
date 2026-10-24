# Operator cheat-sheet

Operator types as `apply_modifications` names them. `get_operator_schema` gives any one's ports and parameters.

| Kind | Operators |
| --- | --- |
| Data | `file` (csv, json, parquet), `geojson`, `sql`, `generate` (N numbered rows) |
| Tables | `filter`, `range`, `sort`, `limit`, `join`, `union`, `aggregate`, `unnest`, `grid`, `time-series` |
| Rows | `attribute` (one column from an expression), `wrangle` (several, as code), `position`, `map-range`, `distance`, `region`, `geo-distance` |
| Color | `color-ramp` (a column to a ramp color), `color` (a shared constant) |
| Layers | `scatter`, `arc`, `path`, `trips`, `polygon`, `column`, `text`, `heatmap`, `hexagon`, `grid-layer`, `mesh`, `scenegraph` |
| Numbers | `number`, `time` (the clock), `math`, `expression`, `extent` (min and max of a column) |
| Output | `deck` (layers, basemap, camera, export settings), `switch` (one of several layers) |

Ports: tables leave by `out` and enter by `in` (`sql` takes `in0`…`in2`, `join` takes `left` and `right`). Layers leave by `out` and enter `deck` by `layers`. Number nodes leave by `out` and drive a parameter by `par:<param>`.

Layer channels are expressions over columns: `scatter` takes `position`, `color`, `radius`; `arc` takes `source`, `target`, `sourceColor`, `targetColor`, `width`; `path` and `trips` take `position` plus `pathId` and `order` columns (and `timestamp` for trips); `polygon` takes `position`, `pathId`, `ringId`, `order`. Style parameters (`radiusScale`, `opacity`, `fillColor`, `blend`) are plain values.

Noodles operators the planner does not replace (`CodeOp`, `BitmapLayerOp`, `Tile3DLayerOp`, views, widgets, effects) run as host operators under their own type names, with their own inputs as params.
