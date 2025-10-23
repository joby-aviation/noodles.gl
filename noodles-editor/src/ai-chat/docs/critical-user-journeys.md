# Critical User Journeys (CUJs) for Noodles.gl AI Assistant

This document outlines the critical user journeys that the AI assistant should handle effectively.

## 1. Basic Plotting on a Map

### Journey Description
Users want to quickly visualize geospatial data on a map from scratch.

### Example Queries
- "Show me all citibike stations in NYC"
- "Plot earthquake data on a map"
- "Create a heatmap of taxi pickups"
- "Visualize flight paths between cities"

### Expected Flow
1. User provides a data request (may be explicit data source or requires data discovery)
2. AI identifies appropriate data source operator (FileOp, JSONOp, DuckDbOp)
3. AI determines best layer type based on data characteristics:
   - Points → ScatterplotLayerOp or HexagonLayerOp
   - Paths/Lines → PathLayerOp or ArcLayerOp
   - Polygons → GeoJsonLayerOp or PolygonLayerOp
   - Heatmaps → HeatmapLayerOp or HexagonLayerOp
4. AI creates appropriate accessor operators for position/color/size
5. AI connects data → accessors → layer → renderer → output
6. AI captures visualization to verify result

### Key Considerations
- Always arrange nodes left-to-right (data sources → processing → layers → renderer → output)
- Verify data structure and suggest appropriate accessors
- Use reasonable defaults for visual properties (colors, sizes, opacity)
- Always include a basemap (MaplibreBasemapOp) for geographic context
- Capture and review the visualization after creation

### Example Node Graph Structure
```
FileOp ──────────────→ ScatterplotLayerOp.data
                             ↑
AccessorOp (getPosition) ────┤ .getPosition
                             ↑
ColorOp ─────────────────────┤ .getFillColor
                             ↓
                      ScatterplotLayerOp.layer ──→ DeckRendererOp.layers
                                                          ↑
MaplibreBasemapOp.maplibre ───────────────────────────────┤ .basemap
                                                          ↓
                                                   DeckRendererOp.vis ──→ OutOp.vis
```

---

## 2. Updating Options and State

### Journey Description
Users want to modify existing visualizations by adjusting visual properties or data transformations.

### Example Queries
- "Make the circles bigger"
- "Turn them into 3D car models"
- "Change the color to red"
- "Make it more transparent"
- "Add labels to the points"
- "Filter data to show only values above 100"

### Expected Flow
1. User requests a modification to existing visualization
2. AI identifies which node(s) need to be updated
3. AI determines the correct property/input to modify
4. AI updates the node configuration with `update_node` modification
5. AI captures visualization to verify the change took effect

### Key Considerations
- Identify the correct node by type and purpose (e.g., layer nodes for visual properties)
- Understand which inputs map to which visual properties
- Some changes require new nodes (e.g., adding a filter operator)
- Some changes require updating accessors (e.g., changing how size is calculated)
- Always verify changes with a screenshot
- Preserve existing connections and data flow

### Common Property Mappings

- Size: `getRadius` (Scatterplot), `getElevation` (3D layers), `getWidth` (Path/Arc)
- Color: `getFillColor`, `getLineColor`, `getSourceColor`, `getTargetColor`
- Transparency: `opacity` (layer-level property)
- 3D Models: Switch to `SimpleMeshLayerOp` or `ScenegraphLayerOp`

### Update Modification Example

```json
{
  "modifications": [
    {
      "type": "update_node",
      "data": {
        "id": "/scatterplot-layer",
        "data": {
          "inputs": {
            "getRadius": 20,
            "opacity": 0.9
          }
        }
      }
    }
  ]
}
```

**Important Notes**:

- Modifications are **automatically applied** to the project - the visualization updates immediately
- Inputs are **merged**, not replaced - only specify fields you want to change
- Always include the full node ID (e.g., `/scatterplot-layer`)
- Check browser console logs to verify modifications were applied

---

## 3. Debugging and Diagnosing Issues

### Journey Description
Users encounter problems with their visualizations and need help understanding what went wrong.

### Example Queries
- "Why can't I see my models on the map?"
- "The visualization isn't showing up"
- "Why is the map blank?"
- "I'm getting errors in the console"
- "The colors aren't working correctly"

### Expected Flow
1. User describes a problem or unexpected behavior
2. AI captures current visualization to see the issue
3. AI checks console errors using `get_console_errors`
4. AI inspects render stats using `get_render_stats`
5. AI analyzes the project structure for common issues:
   - Disconnected nodes
   - Missing required inputs
   - Invalid data formats
   - Incorrect accessor expressions
   - Layer visibility/opacity set to 0
   - Viewport/camera issues
6. AI explains the problem and suggests fixes
7. AI applies fixes if appropriate
8. AI captures visualization to verify fix

### Common Issues to Check
- **Nothing visible**: Check if layers are connected to renderer, check opacity, check if data is empty
- **Models not showing**: Check if mesh layer is used, verify model URLs, check getOrientation/getScale
- **Console errors**: Use `get_console_errors` to find runtime issues
- **Performance issues**: Use `get_render_stats` to check FPS, draw calls, memory usage
- **Data issues**: Check if data loaded correctly, verify accessor expressions
- **Camera/viewport**: Check if viewport is positioned correctly over data

### Debugging Tools
- `capture_visualization`: See what the user sees
- `get_console_errors`: Find JavaScript errors and warnings
- `get_render_stats`: Check rendering performance metrics
- `inspect_layer`: Get detailed layer information
- `analyze_project`: Validate project structure

---

## 4. SQL and Data-Specific Operations

### Journey Description
Users need to query, filter, transform, or aggregate data before visualization.

### Example Queries
- "Get me a dataset showing all flights from NYC"
- "Filter to show only earthquakes above magnitude 5"
- "Group taxi pickups by neighborhood and count them"
- "Calculate average speed for each route"
- "Join this dataset with census data"
- "Show me what data is in the /data-source operator"

### Expected Flow
1. User requests data operation or wants to inspect operator output
2. AI determines if this requires:
   - New DuckDbOp for SQL query
   - New FilterOp for simple filtering
   - New TransformOp for data transformation
   - Reading operator state to inspect data
3. AI creates appropriate operator with correct SQL or expression
4. AI connects to existing data pipeline
5. AI uses operator state reading tools to verify data
6. AI creates visualization of transformed data

### Key Considerations
- DuckDbOp is powerful for SQL operations (filter, join, aggregate, window functions)
- Can read CSV, JSON, Parquet files directly with DuckDb
- FilterOp is simpler for basic filtering
- TransformOp can add/modify columns
- Use operator state reading to inspect data at any point in pipeline
- Verify data structure before creating visualization

### DuckDB SQL Examples
```sql
-- Filter by value
SELECT * FROM data WHERE magnitude > 5

-- Aggregate by group
SELECT neighborhood, COUNT(*) as count
FROM data
GROUP BY neighborhood

-- Calculate derived values
SELECT *, (distance / time) as speed FROM data

-- Spatial filtering
SELECT * FROM data
WHERE longitude BETWEEN -74.1 AND -73.9
  AND latitude BETWEEN 40.6 AND 40.9

-- Join with other data
SELECT a.*, b.population
FROM data a
JOIN census b ON a.neighborhood = b.name
```

### Reading Operator State
- Use `get_node_output` to read data from any operator
- Inspect data structure and sample rows
- Verify transformations are working correctly
- Debug data pipeline issues

---

## General Best Practices

### Node Graph Layout
- Always arrange LEFT to RIGHT: Data → Transform → Visual → Renderer → Output
- Group related nodes together
- Use clear, descriptive node IDs (e.g., `/data-source`, `/pickup-layer`, `/color-by-type`)

### Error Handling
- Always capture visualization after making changes
- Check console errors when user reports issues
- Validate that data is flowing through the pipeline
- Verify layer visibility and rendering

### Communication
- Explain what you're doing and why
- Break down complex requests into steps
- Show intermediate results when helpful
- Ask clarifying questions if request is ambiguous

### Tool Usage Priority
1. **capture_visualization**: Use frequently to verify results
2. **get_console_errors**: First step when debugging
3. **get_render_stats**: Check performance issues
4. **get_node_output**: Inspect data pipeline
5. **inspect_layer**: Debug specific layer issues

### Project Modifications
- Use JSON format for modifications:
  ```json
  {
    "modifications": [
      {
        "type": "add_node",
        "data": {
          "id": "/my-node",
          "type": "ScatterplotLayerOp",
          "data": { "inputs": {}, "locked": false },
          "position": { "x": 800, "y": 200 }
        }
      },
      {
        "type": "add_edge",
        "data": {
          "id": "/data.out.data->/layer.par.data",
          "source": "/data",
          "target": "/layer",
          "sourceHandle": "out.data",
          "targetHandle": "par.data"
        }
      }
    ]
  }
  ```
- Always provide complete node/edge objects
- Increment x position by ~300-400 for each node from left to right
- Use consistent y position for nodes in the same row

---

## Example Conversations

### Example 1: Basic Plotting
**User**: Show me earthquake data on a map

**AI**: I'll create a visualization of earthquake data for you. Let me set up the node graph:

1. First, I'll add a data source for earthquake data
2. Create accessors for position (lat/lon) and size (magnitude)
3. Add a scatterplot layer to visualize the points
4. Set up a basemap and renderer
5. Connect everything together

[Executes modifications]

Let me capture the visualization to verify it looks correct.

[Captures screenshot]

Great! I've created a map showing earthquake locations. The size of each circle represents the earthquake magnitude. You can see the Ring of Fire pattern clearly in the Pacific. Would you like me to adjust the colors, sizes, or add any filters?

### Example 2: Updating State
**User**: Make the circles bigger

**AI**: I'll increase the radius of the circles in the scatterplot layer.

[Updates node with larger getRadius value]

Let me capture the result to confirm the change.

[Captures screenshot]

Perfect! I've increased the circle radius from 5 to 15. The points are now much more visible. Would you like me to adjust it further or make any other changes?

### Example 3: Debugging
**User**: Why can't I see anything on the map?

**AI**: Let me help diagnose the issue. First, I'll capture what you're seeing and check for errors.

[Captures screenshot and checks console errors]

I can see the map is rendering but no data points are visible. Let me check a few things:

[Analyzes project structure]

I found the issue! Your data layer isn't connected to the renderer. The edge between your ScatterplotLayerOp and DeckRendererOp is missing. Let me fix that.

[Adds missing edge]

[Captures screenshot]

There we go! Your data points are now visible. The issue was that the layer wasn't being included in the renderer's layers array.

### Example 4: SQL Operations
**User**: Show me only earthquakes above magnitude 5

**AI**: I'll add a DuckDB operator to filter the earthquake data.

[Adds DuckDbOp with SQL: SELECT * FROM data WHERE magnitude > 5]

[Connects to existing pipeline]

Let me verify the filtered data and capture the result.

[Reads operator output to verify]
[Captures screenshot]

Done! I've filtered the earthquakes to show only those with magnitude greater than 5. The map now shows 47 earthquakes instead of the original 500. These represent the most significant seismic events in the dataset.
