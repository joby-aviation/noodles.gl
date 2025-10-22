# EV Chargers with Live API Data

## Overview
This example fetches live EV charging station data from the Open Charge Map API based on a geocoded location (Denver, CO). It demonstrates a complete data pipeline: converting a city name to coordinates, fetching nearby charging stations via API, calculating the bounding box, and displaying results as either individual points (scatterplot) or a density heatmap. The map automatically centers on the data.

## Key Techniques
- **Geocoder**: `GeocoderOp` with query `"Denver, CO"` converts place name to coordinates
- **API query**: `DuckDbOp` fetches charging station data from Open Charge Map API
- **Bounding box**: `BoundingBoxOp` calculates map extent with 200px padding
- **View state**: `MapViewStateOp` centers map on data at zoom 10.8
- **Position accessor**: `AccessorOp` with expression `[d.lng, d.lat]` extracts coordinates
- **Scatterplot layer**: `ScatterplotLayerOp` shows individual stations
- **Heatmap layer**: `HeatmapLayerOp` shows density with 100px radius
- **Layer switching**: `SwitchOp` toggles between the two visualization styles
- **Basemap**: `MaplibreBasemapOp`

## Data Structure
The Open Charge Map API returns charging station records with:
- `AddressInfo.Latitude`, `AddressInfo.Longitude`: Station location
- Additional fields like operator, connection types, power output

## Node Graph Flow
```
Geocoder → DuckDB (API fetch) → BoundingBox → ViewState → Basemap
                               ↘ Position Accessor → Scatterplot Layer → Switch → Deck
                                                   ↘ Heatmap Layer ↗
```

## Use Cases
This pattern is useful for:
- Live data dashboards
- Location-based services
- Infrastructure mapping (charging stations, bike shares, transit)
- Dynamic map applications that respond to user input
- API integration and real-time data visualization
- Geocoding user locations or place names
