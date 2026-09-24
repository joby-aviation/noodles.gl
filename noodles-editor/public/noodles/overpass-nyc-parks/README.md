# Overpass API NYC Parks

_Query real-time OpenStreetMap data using Overpass API_

## Overview
This example demonstrates how to query and visualize parks in New York City using the Overpass API. Unlike pre-processed datasets, Overpass provides real-time access to OpenStreetMap data, reflecting the latest edits and contributions from the OSM community. The query uses Overpass QL (Query Language) with a dynamic bounding box to fetch park features.

## Key Techniques
- **Bounding box**: `BoundsOp` defines the geographic area (SW Brooklyn to NE Manhattan)
- **Overpass query**: `OverpassOp` fetches live OSM data with Overpass QL syntax
- **Template replacement**: `{{bbox}}` automatically replaced with coordinates
- **Automatic conversion**: OSM JSON converted to GeoJSON by the operator
- **GeoJSON layer**: `GeoJsonLayerOp` renders parks with emerald green styling
- **Basemap**: `MaplibreBasemapOp` with positron style

## Data Source
[Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) provides:
- **Real-time Data**: Latest OSM edits (updates within minutes)
- **Flexible Queries**: Custom filtering with Overpass QL
- **Rich Metadata**: Full OSM tags and attributes
- **Community Data**: Reflects global OSM contributor knowledge

## Overpass QL Query Breakdown
```
[out:json][timeout:25];
(
  way["leisure"="park"]({{bbox}});
  relation["leisure"="park"]({{bbox}});
);
out geom;
```

**Query Components:**
- `[out:json]` - Return results as JSON format
- `[timeout:25]` - Query timeout in seconds
- `way["leisure"="park"]` - Ways (polygons/lines) tagged as parks
- `relation["leisure"="park"]` - Relations (complex geometries) tagged as parks
- `({{bbox}})` - Bounding box template replaced with coordinates
- `out geom;` - Include full geometry in output

**Bounding Box Format:**
The `{{bbox}}` template is replaced with `(south,west,north,east)` format automatically by the OverpassOp when connected to a BoundsOp.

## Node Graph Flow
```
[BoundsOp] → [OverpassOp] → [GeoJsonLayerOp] → [DeckRendererOp] → [OutOp]
  Define        Query OSM      Render Parks        Compose         Display
  NYC Area      Real-time      (Green Fill)        Layers
                   ↓
            [MaplibreBasemapOp]
                (Basemap)
```

## Customization

### Query Different Features
Modify the Overpass QL query to search for other features:

**Restaurants and Cafes:**
```
[out:json][timeout:25];
(
  node["amenity"="restaurant"]({{bbox}});
  node["amenity"="cafe"]({{bbox}});
);
out;
```

**Bike Lanes:**
```
[out:json][timeout:25];
(
  way["highway"="cycleway"]({{bbox}});
  way["cycleway"]({{bbox}});
);
out geom;
```

**Historic Buildings:**
```
[out:json][timeout:25];
(
  way["historic"]({{bbox}});
  relation["historic"]({{bbox}});
);
out geom;
```

**Playgrounds:**
```
[out:json][timeout:25];
(
  node["leisure"="playground"]({{bbox}});
  way["leisure"="playground"]({{bbox}});
);
out geom;
```

### Query Without Bounding Box
For specific named features, you can query without a bbox:
```
[out:json][timeout:25];
(
  node["name"="Central Park"];
  way["name"="Central Park"];
  relation["name"="Central Park"];
);
out geom;
```
**Note:** Remove the bbox connection from the BoundsOp when using queries without `{{bbox}}`.

### Adjust Bounding Box
Modify `BoundsOp` inputs to query different areas:
- **San Francisco**: `[-122.5, 37.7]` to `[-122.35, 37.82]`
- **London**: `[-0.2, 51.45]` to `[0.05, 51.6]`
- **Paris**: `[2.25, 48.81]` to `[2.42, 48.9]`

### Style Changes
Modify `GeoJsonLayerOp` inputs:
- **Fill color**: Change `#10b981` to any hex color
- **Opacity**: Adjust `0.7` for transparency (0-1)
- **Line width**: Change `2` for thicker/thinner borders

## Performance Tips
- **Small areas**: Overpass works best for city-block to city-scale queries
- **Timeout**: Increase `[timeout:60]` for large queries
- **Rate limiting**: Avoid rapid-fire queries - Overpass API has rate limits
- **Alternative endpoints**: Use mirrors if needed:
  - `https://overpass.kumi.systems/api/interpreter`
  - `https://overpass.openstreetmap.fr/api/interpreter`
- **Test queries**: Use [overpass-turbo.eu](https://overpass-turbo.eu/) to test before implementing

## Data Quality Notes
- **Freshness**: Usually updates within minutes of OSM edits
- **Coverage**: Varies by region - urban areas generally have better data
- **Tags**: Check [OSM Wiki](https://wiki.openstreetmap.org/wiki/Map_features) for tag definitions
- **Completeness**: Not all parks may be tagged consistently

## Overpass vs Overture
| Feature | Overpass API (OSM) | Overture Maps |
|---------|-------------------|---------------|
| **Data Source** | Live OpenStreetMap | Pre-processed datasets |
| **Freshness** | Real-time (minutes) | Monthly releases |
| **Query Language** | Overpass QL | SQL (via DuckDB) |
| **Scale** | City/region | Global |
| **Performance** | Rate limited | Large queries OK |
| **Use Case** | Current data, small areas | Analytics, bulk data |

## Use Cases
This pattern is useful for:
- Current infrastructure mapping
- Real-time OSM data visualization
- Community mapping projects
- Location-based apps needing latest data
- Urban planning with up-to-date info
- Validation of OSM contributions

## Related Examples
- **Overture NYC Parks**: Large-scale data via DuckDB
- **GeoJSON BART Stations**: Transit system visualization
- **SF Street Trees**: City-scale point data
