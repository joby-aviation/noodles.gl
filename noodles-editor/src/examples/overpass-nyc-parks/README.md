# Overpass API NYC Parks

_Query real-time OpenStreetMap data using Overpass API_

## Overview
This example demonstrates how to query and visualize parks in New York City using the Overpass API. Unlike pre-processed datasets, Overpass provides real-time access to OpenStreetMap data, reflecting the latest edits and contributions from the OSM community. The query uses Overpass QL (Query Language) with a bounding box to fetch park features.

## Nodes
- **`overpass-query`** (Overpass) runs the Overpass QL query against `endpoint` and converts the OSM result to features. Its `west`, `south`, `east` and `north` params (-74.05, 40.68, -73.9, 40.82) set the bounding box, SW Brooklyn to NE Manhattan
- **`overpass-query-rows`** (GeoJSON) turns those features into rows with a `geom` column
- **`geojson-layer`** (Polygon Layer) fills parks in emerald green (`fillColor: [16, 185, 129]`) with a darker outline (`lineColor: [5, 150, 105]`, `lineWidthScale: 2`) at `opacity: 0.7`
- **`geojson-layer-lines`** (Path Layer) and **`geojson-layer-points`** (Scatterplot Layer) draw any line and point features in the same colors
- **`deck`** (Deck) holds the Carto Positron basemap and the camera over Manhattan

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
- `[out:json]`: Return results as JSON format
- `[timeout:25]`: Query timeout in seconds
- `way["leisure"="park"]`: Ways (polygons/lines) tagged as parks
- `relation["leisure"="park"]`: Relations (complex geometries) tagged as parks
- `({{bbox}})`: Bounding box placeholder
- `out geom;`: Include full geometry in output

**Bounding Box Format:**
`overpass-query` replaces `{{bbox}}` with its bounds params in `south,west,north,east` order.

## Pipeline
```
overpass-query → overpass-query-rows → geojson-layer        → deck
                                     → geojson-layer-lines  → deck
                                     → geojson-layer-points → deck
```

## Customization

### Query Different Features
Edit the `query` param to search for other features:

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
**Note:** Without `{{bbox}}` in the query, the bounds params have no effect.

### Adjust Bounding Box
Change `west`, `south`, `east` and `north` on `overpass-query` to query different areas:
- **San Francisco**: west -122.5, south 37.7, east -122.35, north 37.82
- **London**: west -0.2, south 51.45, east 0.05, north 51.6
- **Paris**: west 2.25, south 48.81, east 2.42, north 48.9

### Style Changes
Change the params on `geojson-layer`:
- **Fill color**: Change `fillColor` (`[16, 185, 129]`, or `#10b981`)
- **Opacity**: Adjust `opacity` (`0.7`) for transparency (0 to 1)
- **Line width**: Change `lineWidthScale` (`2`) for thicker or thinner borders

## Performance Tips
- **Small areas**: Overpass works best for city-block to city-scale queries
- **Timeout**: Increase `[timeout:60]` for large queries
- **Rate limiting**: Avoid rapid-fire queries, since the Overpass API has rate limits
- **Alternative endpoints**: Set `endpoint` on `overpass-query` to a mirror. It uses `https://overpass.openstreetmap.fr/api/interpreter`; another is `https://overpass.kumi.systems/api/interpreter`
- **Test queries**: Use [overpass-turbo.eu](https://overpass-turbo.eu/) to test before implementing

## Data Quality Notes
- **Freshness**: Usually updates within minutes of OSM edits
- **Coverage**: Varies by region; urban areas generally have better data
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
