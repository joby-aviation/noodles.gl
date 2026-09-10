# Basic plotting: load a CSV or GeoJSON file and plot it on a map

Read this to create a new visualization from scratch: loading a CSV, JSON, or GeoJSON file, plotting points, drawing routes or arcs, adding a layer, or showing data on a map for the first time.

Pipeline: **data source → accessor (position) → layer → renderer**.

1. Load the data (`FileOp` for JSON/CSV/GeoJSON, `DuckDbOp` for SQL, `JSONOp` for inline literals).
2. **Verify it before building anything on top**: call `get_node_output` on the data source and look at the actual field names. Guessing `lat`/`lng` when the file says `latitude`/`longitude` produces an empty map with no error.
3. Add an `AccessorOp` for position: `[d.longitude, d.latitude]`, using the field names you just confirmed.
4. Pick the layer by data shape: `ScatterplotLayerOp` (points), `ArcLayerOp` / `GreatCircleLayerOp` (origin-destination routes), `PathLayerOp` (lines), `GeoJsonLayerOp` (polygons and mixed features), `HexagonLayerOp` / `H3HexagonLayerOp` (aggregated density), `HeatmapLayerOp` (continuous density), `TripsLayerOp` (animated movement).
5. Connect the layer to `DeckRendererOp`.
6. Add `MaplibreBasemapOp` — geographic data with no basemap reads as floating dots.

Only call `capture_visualization` when the user explicitly asks to see the result.

## Layout

Arrange left → right in pipeline order: data sources, then transforms and accessors, then layers, then the renderer. Increment X by 300-400 per stage and keep related nodes on a shared Y.

## Worked example: a ScatterplotLayer

Nodes:

```json
{ "id": "/data", "type": "FileOp", "position": { "x": 100, "y": 100 } }
{ "id": "/position", "type": "AccessorOp", "position": { "x": 500, "y": 100 } }
{ "id": "/layer", "type": "ScatterplotLayerOp", "position": { "x": 900, "y": 100 } }
{ "id": "/deck", "type": "DeckRendererOp", "position": { "x": 1300, "y": 100 } }
```

Edges — note the `out.` / `par.` handle prefixes:

```json
{
  "source": "/data",
  "target": "/layer",
  "sourceHandle": "out.data",
  "targetHandle": "par.data"
},
{
  "source": "/position",
  "target": "/layer",
  "sourceHandle": "out.accessor",
  "targetHandle": "par.getPosition"
},
{
  "source": "/layer",
  "target": "/deck",
  "sourceHandle": "out.layer",
  "targetHandle": "par.layers"
}
```

A layer with `data` but no `getPosition` renders nothing, and a layer that never reaches `DeckRendererOp` renders nothing. Both are silent — check the edges when a new visualization is blank.
