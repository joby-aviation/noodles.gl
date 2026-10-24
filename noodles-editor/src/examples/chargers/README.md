# EV Chargers with Live API Data

## Overview
This example fetches live EV charging station data from the Open Charge Map API based on a geocoded location (Denver, CO). It demonstrates a complete data pipeline: converting a city name to coordinates, fetching nearby charging stations via API, calculating the bounding box, and displaying results as either individual points (scatterplot) or a density heatmap. The map automatically centers on the data.

## Nodes
- **`centroid`** (`GeocoderOp`, a host operator) turns `query: "Denver, CO"` into a location
- **`charger-query`** (DuckDB SQL) reads up to 1000 stations from the Open Charge Map API in a box 0.5 degrees around the geocoded point, as `lat` and `lng` columns
- **`charger-bounds`** (`BoundingBoxOp`, a host operator) computes the data's extent with `padding: 200`
- **`auto-view`** (View State) takes `longitude` and `latitude` from `charger-bounds`, with `zoom: 10.8`, and drives the deck's camera
- **`charger-position`** (Attribute Create) writes `charger_position` as `[lng, lat]`
- **`charger-points`** (Scatterplot Layer) draws each station in orange
- **`charger-heatmap`** (Heatmap Layer) shows density with `radiusPixels: 100` and `weightConstant: 5.4`
- **`layer-toggle`** (Switch) picks one layer: `index: 0` is the points, `1` the heatmap
- **`deck`** (Deck) holds the Carto Dark Matter (no labels) basemap

## Data Structure
The Open Charge Map API returns charging station records with:
- `AddressInfo.Latitude`, `AddressInfo.Longitude`: Station location
- Additional fields like operator, connection types, power output

## Pipeline
```
centroid → charger-query → charger-bounds → auto-view → deck (viewState)
                         ↘ charger-position → charger-points  → layer-toggle → deck
                                            ↘ charger-heatmap ↗
```

## Use Cases
This pattern is useful for:
- Live data dashboards
- Location-based services
- Infrastructure mapping (charging stations, bike shares, transit)
- Dynamic map applications that respond to user input
- API integration and real-time data visualization
- Geocoding user locations or place names
