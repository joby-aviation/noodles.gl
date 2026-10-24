# GeoJSON BART Stations

_Adapted from [Deck.gl examples](https://deck.gl/docs/api-reference/layers/path-layer)_

## Overview
This example visualizes the BART transit system from one GeoJSON file that contains multiple geometry types: station points with text labels showing station names, rail route lines colored by their route color (blue, orange, etc.), and polygon features. Each geometry type gets its own layer, all reading the same `geom` column.

## Nodes
- **`data-source`** (GeoJSON) loads `bart.geo.json`
- **`fill-color`** (Color) holds the dark blue fill `[1, 1, 126]`, referenced by the polygon and point layers
- **`line-color`** (Attribute Create) writes `line_color` as `hex_color(coalesce(color, '#000'))`, so each route uses its `color` property
- **`geojson-layer`** (Polygon Layer) fills polygons with `fill-color`, `extruded: true` and `elevationScale: 30`
- **`geojson-layer-lines`** (Path Layer) draws routes in `line_color`
- **`geojson-layer-points`** (Scatterplot Layer) draws stations with `radiusScale: 4` meters
- **`geojson-layer-labels`** (Text Layer) labels stations with `text: "name"` at `size: 32` in black
- **`deck`** (Deck) holds the Carto Positron basemap and the camera

## Data Structure
The GeoJSON file contains features with:
- Geometry types: Point (stations), MultiLineString (rail routes), and Polygon
- Properties:
  - `name`: Station name or route name (e.g., "DUBL-DALY (ROUTE 11/12)")
  - `color`: Hex color for rail routes (e.g., "#00aeef")

## Pipeline
```
data-source → line-color → geojson-layer        → deck
                         → geojson-layer-lines  → deck
                         → geojson-layer-points → deck
                         → geojson-layer-labels → deck
```

## Use Cases
This pattern is useful for:
- Transit system visualization
- Infrastructure mapping
- Any GeoJSON data with mixed geometry types
- Features requiring labels
- Property-driven styling
- Municipal or regional datasets with predefined colors
