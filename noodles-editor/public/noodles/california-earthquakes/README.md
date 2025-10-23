# California Earthquakes

_Adapted from [Kepler.gl example](https://kepler.gl/demo/earthquakes)_

## Overview
This example visualizes California earthquake data where both the size and color of each point are driven by magnitude values. Larger earthquakes appear as bigger circles with more intense colors, using a square root scale for perceptually accurate sizing and a normalized color ramp to map magnitude values to a gradient. This demonstrates data-driven styling where a single metric (magnitude) controls multiple visual properties.

## Key Techniques
- **Data source**: `FileOp` loads earthquake data from CSV
- **Position accessor**: `AccessorOp` with expression `[d.Longitude, d.Latitude]` extracts coordinates
- **Magnitude accessor**: `AccessorOp` with expression `d.Magnitude` extracts magnitude value
- **Radius calculation**: `AccessorOp` with expression `Math.sqrt(d.Magnitude) * 15` for perceptually better sizing
- **Value normalization**: `MapRangeOp` scales magnitude from 0-5 range to 0-1
- **Color mapping**: `ColorRampOp` maps normalized values to a color gradient
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
Data → Magnitude Accessor → MapRange → ColorRamp → Layer (getFillColor)
                          ↘
                           Radius Accessor → Layer (getRadius)
     → Position Accessor → Layer (getPosition)
```

## Use Cases
This pattern is useful for visualizing:
- Seismic activity
- Scientific measurements with intensity scales
- Weather events (temperature, precipitation)
- Pollution levels
- Any point data where size and color represent different aspects of the same metric
