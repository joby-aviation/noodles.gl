# California Earthquakes

## Overview
This example visualizes earthquake data for California, where the size of each point represents earthquake magnitude and colors represent intensity using a color ramp.

## What It Demonstrates
- **Data-driven sizing**: Circle radius scales with earthquake magnitude using square root for better visual perception
- **Color ramps**: Using `ColorRampOp` to map magnitude values to a color gradient
- **Value mapping**: `MapRangeOp` normalizes magnitude values for color mapping
- **Accessor expressions**: JavaScript expressions to transform data values

## Key Techniques
- **Data source**: `FileOp` loads earthquake data from CSV
- **Position accessor**: Extracts `[Longitude, Latitude]` from data
- **Magnitude accessor**: Extracts magnitude value for both radius and color calculations
- **Radius calculation**: `Math.sqrt(d.Magnitude) * 15` creates perceptually better sizing
- **Value normalization**: `MapRangeOp` scales magnitude from 0-5 range to 0-1 for color ramp
- **Color ramp**: Maps normalized values to a gradient (likely blue to red for intensity)

## Data Structure
The CSV file contains earthquake records with fields:
- `Longitude`, `Latitude`: Geographic location
- `Magnitude`: Richter scale magnitude
- Additional fields like depth, time, location description

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
