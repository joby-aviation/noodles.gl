# Querying OpenStreetMap with Overpass API

Learn how to query real-time OpenStreetMap data using the Overpass API for dynamic, up-to-date visualizations.

## What is Overpass API?

The Overpass API is a read-only API that serves OpenStreetMap (OSM) data. Unlike Overture Maps (which provides pre-processed datasets), Overpass queries the live OSM database, giving you:

- **Real-time data**: Latest OSM edits and contributions
- **Flexible queries**: Custom filtering with Overpass QL (query language)
- **Smaller areas**: Best for city-scale queries (not global datasets)
- **Rich metadata**: Full OSM tags and attributes

## Using the Overpass Operator

The `OverpassOp` operator makes it easy to query OpenStreetMap data. It automatically handles:

- Fetching data from the Overpass API
- Template replacement for bounding boxes (`{{bbox}}`)
- Converting OSM JSON to GeoJSON format

### Operator Inputs

- **query**: Overpass QL query string (CodeField with syntax highlighting)
  - Default query searches for "Central Park" by name (works without bbox)
  - Use `{{bbox}}` template for bounding box queries
- **bbox**: Optional bounding box from `BoundsOp` (array of two points: `[[west, south], [east, north]]`)
  - Only connect if your query uses `{{bbox}}`
  - Template will be replaced with `(south,west,north,east)` format
- **endpoint**: Overpass API endpoint (default: `https://overpass-api.de/api/interpreter`)
- **pulse**: Manual refresh trigger (increment to re-run query)

### Operator Outputs

- **data**: GeoJSON FeatureCollection with all features from the query

## Example: NYC Parks with Overpass

Query all parks in New York City using an interactive bounding box.

### Step 1: Create Bounding Box

Add a `BoundsOp` with NYC coordinates:

- **point1**: `[-74.05, 40.68]` (southwest - Brooklyn)
- **point2**: `[-73.90, 40.82]` (northeast - Upper Manhattan)

### Step 2: Add Overpass Query

Add an `OverpassOp` node with this query (replace the default):

```
[out:json][timeout:25];
(
  way["leisure"="park"]({{bbox}});
  relation["leisure"="park"]({{bbox}});
);
out geom;
```

**Important:** Connect the `BoundsOp` output to the `OverpassOp` bbox input. The `{{bbox}}` template will only be replaced when a valid bounding box is connected. Without a bbox connection, queries using `{{bbox}}` will fail.

#### Understanding Overpass QL

- **`[out:json]`**: Return results as JSON
- **`[timeout:25]`**: Query timeout in seconds
- **`way["leisure"="park"]`**: Ways (areas/lines) tagged as parks
- **`relation["leisure"="park"]`**: Relations (complex geometries) tagged as parks
- **`({{bbox}})`**: Bounding box placeholder - automatically replaced with coordinates
- **`out geom;`**: Include full geometry in output

### Step 3: Visualize with GeoJsonLayer

Add a `GeoJsonLayerOp` and configure:

- **data**: Connect to `OverpassOp` data output
- **filled**: `true`
- **getFillColor**: `#10b981` (green for parks)
- **opacity**: `0.7`
- **stroked**: `true`
- **getLineColor**: `#059669` (darker green border)
- **getLineWidth**: `2`

### Step 4: Display on Map

Add a `ViewerOp` and connect the `GeoJsonLayerOp` layer output.

### Complete Node Graph

```
[BoundsOp] → [OverpassOp] → [GeoJsonLayerOp] → [ViewerOp]
  point1:      query: (Overpass QL)  data: connected     layers: connected
  [-74.05,     bbox: connected       getFillColor: #10b981
   40.68]      endpoint: default     opacity: 0.7
  point2:
  [-73.90,
   40.82]
```

## More Examples

### Cafes and Restaurants

Query amenities with specific tags:

```
[out:json][timeout:25];
(
  node["amenity"="cafe"]({{bbox}});
  node["amenity"="restaurant"]({{bbox}});
);
out;
```

Then visualize as points with `GeoJsonLayerOp`:

- **pointType**: `circle`
- **getPointRadius**: `8`
- **pointRadiusUnits**: `pixels`
- **getFillColor**: Use accessor to color by type:
  ```javascript
  d => d.properties.amenity === 'cafe' ? [139, 92, 246] : [234, 88, 12]
  ```

### Bike Lanes

Query cycling infrastructure:

```
[out:json][timeout:25];
(
  way["highway"="cycleway"]({{bbox}});
  way["cycleway"]({{bbox}});
  way["bicycle"="designated"]({{bbox}});
);
out geom;
```

Visualize with:

- **stroked**: `true`
- **filled**: `false`
- **getLineColor**: `#2563eb`
- **getLineWidth**: `3`
- **lineWidthUnits**: `pixels`

### Historic Buildings

Query buildings with historic significance:

```
[out:json][timeout:25];
(
  way["historic"="yes"]({{bbox}});
  way["building"]["historic"]({{bbox}});
  relation["historic"]({{bbox}});
);
out geom;
```

### Trees in a Park

Query natural features within a specific area (without using `{{bbox}}` template):

```
[out:json][timeout:25];
(
  node["natural"="tree"](40.7829,-73.9654,40.7850,-73.9630);
);
out;
```

Note: This uses a fixed bbox instead of the `{{bbox}}` template for precise areas. Simply don't connect a BoundsOp to the bbox input.

## Advanced Queries

### Combining Multiple Filters

Query parks with specific amenities:

```
[out:json][timeout:25];
(
  // Parks
  way["leisure"="park"]({{bbox}});

  // Playgrounds within those parks
  node["leisure"="playground"]({{bbox}});

  // Drinking water fountains
  node["amenity"="drinking_water"]({{bbox}});
);
out geom;
```

### Using Regular Expressions

Query shops of various types:

```
[out:json][timeout:25];
(
  node["shop"~"^(supermarket|convenience|grocery)$"]({{bbox}});
);
out;
```

### Recursion (Get Related Features)

Query bus stops with their routes:

```
[out:json][timeout:25];
(
  node["highway"="bus_stop"]({{bbox}});
  <;  // Recurse up to get parent relations (routes)
);
out geom;
```

## Query Without Bounding Box

For landmark or named feature queries, you can omit the bbox input:

```
[out:json][timeout:25];
(
  node["name"="Central Park"];
  way["name"="Central Park"];
  relation["name"="Central Park"];
);
out geom;
```

Simply leave the `bbox` input disconnected in the `OverpassOp` - the `{{bbox}}` template will remain as-is or you can write queries without it.

## Tips and Best Practices

### Rate Limiting

Overpass API has rate limits:

- **Avoid rapid-fire queries**: Use the `pulse` input to manually trigger refreshes
- **Use reasonable timeouts**: `[timeout:25]` is usually sufficient
- **Public mirrors**: Use alternative endpoints if needed:
  - `https://overpass.kumi.systems/api/interpreter`
  - `https://overpass.openstreetmap.fr/api/interpreter`

### Bounding Box Size

- **Small areas**: Overpass works best for city-block to city-scale queries
- **Large bbox warning**: Queries over large regions may timeout
- **Recommended size**: < 0.1° × 0.1° for complex features, < 1° × 1° for simple queries

### Query Performance

1. **Filter early**: Use specific tags to reduce result size
2. **Limit geometry**: Use `out center;` for simple points instead of `out geom;`
3. **Test queries**: Use [overpass-turbo.eu](https://overpass-turbo.eu/) to test before implementing
4. **Be specific**: Narrow queries with precise tags run faster

### Data Quality

- **OSM tags**: Check [OSM Wiki](https://wiki.openstreetmap.org/wiki/Map_features) for tag definitions
- **Data freshness**: Usually updates within minutes of OSM edits
- **Missing data**: OSM coverage varies by region - urban areas generally have better data
- **Tag variations**: Multiple tags may represent similar features (e.g., `building=yes` vs `building=house`)

## Error Handling

The `OverpassOp` automatically handles common errors:

- **Timeout errors**: Returns empty GeoJSON FeatureCollection with console warning
- **HTTP errors**: Throws error with status code
- **Invalid responses**: Catches and reports fetch errors

If you see errors, try:

1. Reducing the bounding box area
2. Simplifying the query (fewer tags/elements)
3. Increasing the timeout: `[timeout:60]`
4. Using a different endpoint

## Differences from Overture Maps

| Feature | Overpass API (OSM) | Overture Maps |
|---------|-------------------|---------------|
| **Data Source** | Live OpenStreetMap | Pre-processed OSM + other sources |
| **Freshness** | Real-time (minutes) | Monthly releases |
| **Query Language** | Overpass QL | SQL (via DuckDB) |
| **Scale** | City/region scale | Global scale |
| **Performance** | Rate limited, smaller queries | Large queries, pre-indexed |
| **Use Case** | Current POIs, routing | Analytics, bulk processing |
| **Data Model** | OSM tags (flexible) | Structured schema (consistent) |

## When to Use Overpass vs Overture

**Use Overpass API when:**

- You need the latest OSM data
- Querying specific, smaller areas
- Working with OSM-specific tags and relations
- Building tools that interact with OSM community data

**Use Overture Maps when:**

- Querying large geographic areas
- Need consistent global schema
- Performing analytics on bulk data
- Don't need real-time updates

## Resources

- [Overpass API Documentation](https://wiki.openstreetmap.org/wiki/Overpass_API)
- [Overpass QL Language Guide](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL)
- [Overpass Turbo (Query Builder)](https://overpass-turbo.eu/)
- [OSM Tag Reference](https://wiki.openstreetmap.org/wiki/Map_features)
- [Overpass API by Example](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_API_by_Example)
