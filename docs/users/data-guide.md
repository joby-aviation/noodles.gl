# Working with Data

Learn how to load, process, and transform data in Noodles.gl for your visualizations.

## Data Sources

Use a `FileOp` to read a file from a URL or text. Supports csv and json, such as:

### JSON Data
```javascript
{
  "flights": [
    {
      "origin": "SFO",
      "destination": "LAX", 
      "coordinates": [-122.4194, 37.7749]
    }
  ]
}
```

### CSV Data  
```javascript
origin,destination,passengers,coordinates
SFO,LAX,150,"[-122.4194, 37.7749]"
```

### GeoJSON
```javascript
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-122.4194, 37.7749]
      },
      "properties": {
        "name": "SFO",
        "passengers": 25000
      }
    }
  ]
}
```

## Data Processing

### Code Operators

Run custom JavaScript code on the data. Use `data` to access the input data list, `d` for the first element of the list, and `op` to access other operators. Also passes a freeExports object with `turf` and `d3` utils. Use `this` to store state.

```javascript
// CodeOp
const csvData = d // input data list connected to FileOp
const filtered = csvData.filter(row => row.passengers > 100)
return filtered.map(row => ({
  ...row,
  coordinates: JSON.parse(row.coordinates)
}))
```

### Referencing Operators

Use the `op` function to reference data from other operators.

```javascript
// In a CodeOp, reference other nodes:
op('/data-source/my-csv').out.data       // Absolute path
op('./sibling-operator').out.val         // Relative path
op('../parent-container/node').out.val   // Parent navigation
```

### Free Exports

Use utilities from `turf`, `d3`, or import any ESM module.

```javascript
// CodeOp - use a pre-bundled d3 utility
return d3.scaleLinear()
  .domain([0, 100])
  .range([0, 1])
```

```javascript
// CodeOp - import an ESM module
const _ = await import('https://esm.sh/lodash');
return _.mapValues(
  _.groupBy(d, 'name'),
  group => _.sortBy(group, 'ts'),
)
```

## Common Data Tasks

### Coordinate Conversion
```javascript
// Convert lat/lng to [lng, lat] for Deck.gl
const data = op('./raw-coordinates').out.data
return data.map(point => ({
  ...point,
  coordinates: [point.longitude, point.latitude] // [lng, lat]
}))
```

### Color Mapping
```javascript
// Map data values to colors
const data = op('./flight-data').out.data
const maxPassengers = Math.max(...data.map(d => d.passengers))

return data.map(flight => ({
  ...flight,
  color: [
    255 * (flight.passengers / maxPassengers), // Red
    0,                                         // Green
    255 * (1 - flight.passengers / maxPassengers) // Blue
  ]
}))
```

### Time-based Filtering
```javascript
// Filter by time range for animations
const allData = op('./complete-dataset').out.data // FileOp
const currentTime = op('./current-time').out.val // NumberOp

return allData.filter(item => {
  const itemTime = new Date(item.timestamp).getTime()
  return itemTime <= currentTime
})
```

## Performance Tips

### Large Datasets
- Use aggregation operators before visualization
- Filter early in your pipeline
- Consider sampling for real-time preview
- Use efficient data structures (arrays vs objects)

### Memory Management
- Avoid copying large datasets unnecessarily
- Use references instead of duplicating data
- Clean up intermediate calculations
- Monitor browser memory usage

## Debugging Data Issues

### Data Preview
- Use `ViewerOp` and `ConsoleOp` to inspect intermediate results
- Check data types and structure
- Verify coordinate formats ([lng, lat])

### Common Issues
- **Wrong coordinate order**: Use [longitude, latitude]
- **String vs number**: Ensure numeric fields are parsed
- **Missing data**: Check for null/undefined handling
- **Array structure**: Deck.gl expects arrays, not objects
