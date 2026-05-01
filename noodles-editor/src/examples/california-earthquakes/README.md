# California Earthquakes

_Adapted from [Kepler.gl example](https://kepler.gl/demo/earthquakes)_

## Overview
This animated example visualizes California earthquake data from 1967-2024, progressively revealing earthquakes as they occurred through timeline animation. The size and color of each point are driven by magnitude values, demonstrating data-driven styling, temporal filtering with DateMathOp, and keyframed timeline animation.

## Key Techniques
- **Data source**: `FileOp` loads earthquake data from CSV
- **Timeline animation**: `DateTimeOp` keyframed from 1967 to 2024 controls cutoff date
- **Temporal filtering**: `CodeOp` filters data based on earthquake date vs. animated cutoff
  - Parses DateTime strings with `Temporal.PlainDateTime.from()`
  - Calculates days difference with Temporal's `until()` method
  - References keyframed `/cutoff-date` via `op()` function
  - Returns filtered array showing only earthquakes before cutoff
- **Position accessor**: `AccessorOp` with expression `[d.Longitude, d.Latitude]` extracts coordinates
- **Magnitude accessor**: `AccessorOp` with expression `d.Magnitude` extracts magnitude value
- **Value normalization**: `MapRangeOp` scales magnitude from 2.5-7 range to 0-1
- **Color mapping**: `ColorRampOp` maps normalized values to turbo gradient
- **Radius calculation**: `MathOp` with multiply for perceptually better sizing
- **Layer**: `ScatterplotLayerOp` displays the circles
- **DateMathOp demonstration**: `extract-year` and `format-date` show DateMathOp API (not used in visualization)

## Data Structure
The CSV file contains earthquake records with fields:
- `DateTime`: Timestamp of earthquake
- `Latitude`, `Longitude`: Geographic location
- `Depth`: Depth in kilometers
- `Magnitude`: Richter scale magnitude
- `MagType`: Magnitude type (e.g., Mx)
- `NbStations`, `Gap`, `Distance`, `RMS`: Seismic measurement metadata
- `Source`, `EventID`: Data source and unique identifier

## Node Graph Flow
```
Timeline Animation & Filtering:
DateTimeOp (/cutoff-date) [KEYFRAMED 1967→2024]
    ↓ (referenced via op('/cutoff-date'))
Data → CodeOp (temporal filter) → ScatterplotLayer → DeckRenderer
    ↓ (unused, for demonstration)
    DateMathOp (extract year) → [available for grouping]
    DateMathOp (format date) → [available for labels]

Visualization Pipeline:
FilteredData → Position Accessor → Layer (getPosition)
            → Magnitude Accessor → MapRange → ColorRamp → Layer (getFillColor)
                                 → multiply → Layer (getRadius)

TimeOp (unused, for reference)
```

## Date/Time Features & Timeline Animation

This example demonstrates timeline animation with temporal filtering using `CodeOp`:

### Timeline Animation
The visualization animates through 58 years of earthquake data (1967-2024) using a keyframed `DateTimeOp`:
- **Start keyframe** (position 0): `1967-01-01T00:00:00`
- **End keyframe** (position 60): `2024-12-31T23:59:59`
- Press **Play** in the timeline to see earthquakes appear chronologically

### Temporal Filtering with CodeOp
Instead of using FilterOp (which only supports column-based comparisons like "greater than"), this example uses `CodeOp` for custom temporal logic:

```javascript
return d.filter(row => {
  const dateStr = row.DateTime.replace(/\//g, '-').replace(' ', 'T')
  const earthquakeDate = Temporal.PlainDateTime.from(dateStr)
  const cutoffDate = op('/cutoff-date').out.date
  const daysSince = earthquakeDate.until(cutoffDate, { largestUnit: 'days' }).days
  return daysSince >= 0
})
```

**Why CodeOp instead of FilterOp?**
- FilterOp expects a StringLiteralField condition ('equals', 'greater than') and operates on columns
- Our temporal filtering needs per-row logic comparing parsed Temporal dates
- CodeOp allows full JavaScript access to the Temporal API and op() references
- The keyframed `/cutoff-date` is accessed dynamically via `op('/cutoff-date').out.date`

**How it works:**
1. Loop over data rows (`d` is the input data, `row` is each earthquake)
2. Convert DateTime format `1967/08/01 10:33:50.47` to ISO format `1967-01-01T10:33:50.47`
   - Replace `/` with `-` for date separators
   - Replace space with `T` for ISO datetime format
3. Parse to `Temporal.PlainDateTime`
4. Get the current animated cutoff date from the keyframed DateTimeOp via `op('/cutoff-date').out.date`
5. Calculate days between earthquake and cutoff using Temporal's `until()` method
6. Filter: keep earthquakes where days >= 0 (earthquake occurred before or at cutoff)
7. Return filtered array to ScatterplotLayer

### DateMathOp Demonstration
The example includes DateMathOp nodes to show the API (though not used in the visualization):
- **Year extraction**: `DateMathOp` with operator `year` for temporal grouping
- **Date formatting**: `DateMathOp` with operator `format` and pattern `YYYY-MM-DD` for display

These demonstrate how DateMathOp can extract components and format dates for labels/tooltips in other projects.

## Use Cases
This pattern is useful for visualizing:
- Seismic activity with temporal analysis
- Scientific measurements with intensity scales and timestamps
- Weather events (temperature, precipitation) over time
- Pollution levels with date filtering
- Any point data where size, color, and time represent different aspects of the data
