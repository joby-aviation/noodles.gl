# California Earthquakes

_Adapted from [Kepler.gl example](https://kepler.gl/demo/earthquakes)_

## Overview
This example visualizes California earthquake data where both the size and color of each point are driven by magnitude values. Larger earthquakes appear as bigger circles with more intense colors, using a radius that grows with the square root of magnitude and a normalized color ramp to map magnitude values to a gradient. This demonstrates data-driven styling where a single metric (magnitude) controls multiple visual properties.

## Nodes
- **`data-source`** (File) loads `@/data.csv`
- **`position`** (Attribute Create) writes `position` as `[Longitude, Latitude]`
- **`map-range`** (Map Range) scales `Magnitude` from 2.5 to 7 into 0 to 1, written as `map_range`
- **`magnitude-color`** (Color Ramp) maps `map_range` through the `turbo` ramp into `magnitude_color`
- **`sqrt`** (Attribute Create) writes `sqrt(Magnitude)`
- **`multiply`** (Attribute Create) writes `sqrt * 1700.0`, the radius in meters
- **`scatterplot-layer`** (Scatterplot Layer) draws circles with `position: "position"`, `color: "magnitude_color"`, `radius: "multiply"` and `radiusUnits: "meters"`
- **`deck`** (Deck) holds the Carto Voyager basemap and the camera over California

## Data Structure
The CSV file contains earthquake records with fields:
- `DateTime`: Timestamp of earthquake
- `Latitude`, `Longitude`: Geographic location
- `Depth`: Depth in kilometers
- `Magnitude`: Richter scale magnitude
- `MagType`: Magnitude type (e.g., Mx)
- `NbStations`, `Gap`, `Distance`, `RMS`: Seismic measurement metadata
- `Source`, `EventID`: Data source and unique identifier

## Pipeline
Each node adds a column to the rows and passes them on:
```
data-source → position → map-range → magnitude-color → sqrt → multiply → scatterplot-layer → deck
```

## Use Cases
This pattern is useful for visualizing:
- Seismic activity
- Scientific measurements with intensity scales
- Weather events (temperature, precipitation)
- Pollution levels
- Any point data where size and color represent different aspects of the same metric
