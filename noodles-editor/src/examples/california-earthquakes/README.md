# California Earthquakes

_Adapted from [Kepler.gl example](https://kepler.gl/demo/earthquakes)_

## Overview
This animated example visualizes California earthquake data from 1967-2024, progressively revealing earthquakes as they occurred through timeline animation. The size and color of each point are driven by magnitude values, demonstrating data-driven styling, temporal filtering with DateMathOp, and keyframed timeline animation.

## Key Techniques
- **Data source**: `FileOp` loads earthquake data from CSV
- **Timeline animation**: `DateTimeOp` keyframed from 1967 to 2024 controls cutoff date
- **Date string extraction**: `AccessorOp` extracts and cleans DateTime strings (`d.DateTime.replace(' ', 'T')`)
- **Date parsing**: `DateMathOp` with `format` operator parses ISO strings to Temporal dates (accessor mode)
- **Time difference**: `DateMathOp` calculates days between earthquake date and cutoff date
- **Temporal filtering**: `FilterOp` only shows earthquakes before the animated cutoff date
- **Position accessor**: `AccessorOp` with expression `[d.Longitude, d.Latitude]` extracts coordinates
- **Magnitude accessor**: `AccessorOp` with expression `d.Magnitude` extracts magnitude value
- **Value normalization**: `MapRangeOp` scales magnitude from 2.5-7 range to 0-1
- **Color mapping**: `ColorRampOp` maps normalized values to turbo gradient
- **Radius calculation**: `MathOp` with sqrt and multiply for perceptually better sizing
- **Layer**: `ScatterplotLayerOp` displays the circles

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
Timeline Animation:
TimeOp (unused, for reference)
DateTimeOp (cutoff-date) [KEYFRAMED 1967→2024] → DateMathOp (difference) → Filter

Date Processing Pipeline:
Data → DateTime String Accessor (d.DateTime.replace) 
    → DateMathOp (parse via format operator)
    → DateMathOp (extract year) → [available for grouping]
    → DateMathOp (format date) → [available for labels]
    → DateMathOp (days since cutoff) → Filter Accessor (d >= 0) → FilterOp

Visualization Pipeline:
Data → FilterOp → ScatterplotLayer → DeckRenderer
     → Position Accessor → Layer (getPosition)
     → Magnitude Accessor → MapRange → ColorRamp → Layer (getFillColor)
                          → sqrt → multiply → Layer (getRadius)
```

## Date/Time Features & Timeline Animation

This example demonstrates **DateMathOp** for temporal filtering and animation:

### Timeline Animation
The visualization animates through 58 years of earthquake data (1967-2024) using a keyframed `DateTimeOp`:
- **Start keyframe** (position 0): `1967-01-01T00:00:00`
- **End keyframe** (position 60): `2024-12-31T23:59:59`
- Press **Play** in the timeline to see earthquakes appear chronologically

### DateTime String Processing (Split Pipeline)
Instead of combining string manipulation and parsing in one accessor, we split it into two steps:

1. **AccessorOp** extracts and cleans the DateTime string:
   ```javascript
   d.DateTime.replace(' ', 'T')
   ```

2. **DateMathOp** (format operator with empty string) parses the ISO string to `Temporal.PlainDateTime` in accessor mode

This split allows DateField to handle the Temporal conversion, keeping string logic separate.

### Temporal Filtering
The core animation logic uses `DateMathOp` with `difference` operator:
1. Calculate days between each earthquake's date and the animated cutoff date
2. Filter accessor checks if difference is >= 0 (earthquake occurred before cutoff)
3. `FilterOp` only passes earthquakes that meet the condition

### Additional Date Operations
- **Year extraction**: `DateMathOp` with operator `year` for temporal grouping
- **Date formatting**: `DateMathOp` with operator `format` and pattern `YYYY-MM-DD` for display

## Use Cases
This pattern is useful for visualizing:
- Seismic activity with temporal analysis
- Scientific measurements with intensity scales and timestamps
- Weather events (temperature, precipitation) over time
- Pollution levels with date filtering
- Any point data where size, color, and time represent different aspects of the data
