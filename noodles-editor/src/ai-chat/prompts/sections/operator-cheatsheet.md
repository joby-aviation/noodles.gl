# Operator and layer cheat-sheet: which node or layer type to use

Read this to choose which layer or node type to use for a job — points, routes, arcs, paths, polygons, density, text — or to recall an operator's input names and handles.

A shortlist of the operators that cover most requests. It is not the full registry — call `list_operators` for that, or `get_operator_schema` for one operator's exact inputs and outputs. Handle names come straight from those: every field in `inputs` is `par.{fieldName}` and every field in `outputs` is `out.{fieldName}`.

## By role

- **Data in**: `FileOp` (JSON, CSV, GeoJSON), `JSONOp` (inline literal), `DuckDbOp` (SQL), `NetworkOp` (HTTP), `GeocoderOp` (address → coordinates), `DirectionsOp` (routing).
- **Transform**: `CodeOp` (multi-line JS — the default choice), `ExpressionOp` (one-liner), `AccessorOp` (per-row accessor for a layer), `MapRangeOp`, `FilterOp`, `SortOp`, `SliceOp`, `MergeOp`, `ConcatOp`.
- **Layers**: `ScatterplotLayerOp`, `ArcLayerOp`, `GreatCircleLayerOp`, `PathLayerOp`, `TripsLayerOp`, `GeoJsonLayerOp`, `PolygonLayerOp`, `HexagonLayerOp`, `H3HexagonLayerOp`, `HeatmapLayerOp`, `ColumnLayerOp`, `IconLayerOp`, `TextLayerOp`.
- **Colour**: `ColorOp` (one colour), `ColorRampOp` (continuous scale), `CategoricalColorRampOp` (per-category), `HSLOp`.
- **Out**: `MaplibreBasemapOp`, `DeckRendererOp`, `OutOp`.

## Inputs worth knowing

- `ColorOp`: `color` — a hex string such as `"#ff0000"`.
- `NumberOp`: `value`.
- `StringOp`: `value`.
- `AccessorOp`: `expression` — a JS string evaluated per row, with `d` as the row and `data` as the whole array. Example: `[d.longitude, d.latitude]`.
- `CodeOp`: `code` — multi-line JS ending in a `return`. Globals: `d3`, `turf`, `deck`, `Plot`, `Temporal`, `utils`.
- `FileOp`: `url` (use the `@/` prefix for the project's data directory) and `format`.
- `DuckDbOp`: `sql`.
- Layers, directly settable: `opacity`, `visible`, `pickable`, `radiusScale`, `lineWidthScale`, `stroked`, `filled`.
- Layers, normally edge-fed: everything starting with `get` — `getPosition`, `getFillColor`, `getRadius`, `getWeight`, `getPath`, `getSourcePosition`, `getTargetPosition`.

## Paths

Operator IDs are Unix-style paths. `/loader` is at the root, `/analysis/filter` is inside the `analysis` container. In expressions and SQL references, `./sibling` resolves within the current container and `../other` goes up one level.

## Utility functions

`CodeOp`, `ExpressionOp`, and `AccessorOp` all expose a `utils` object: `utils.getArc()` for 3D arc paths, `utils.hexToColor()` and `utils.colorToHex()` for colour conversion, `utils.interpolate([inMin, inMax], [outMin, outMax])` for range mapping, `utils.mulberry32(seed)` for deterministic randomness, plus distance constants and basemap style URLs. Search the source with `search_code` for the full set.
