# UK Commute Patterns

_Adapted from [Kepler.gl examples](https://kepler.gl/demo/ukcommute)_

## Overview
This example visualizes UK commute patterns using a three-layer approach: orange circles mark where people live (residence), purple circles show where they work (workplace), and arcs that fade from orange to purple connect each home to its corresponding workplace. The visualization uses actual commute flow data to show real transportation patterns across regions.

## Nodes
- **`data-source`** (File) loads the commute CSV
- **`home-position`** (Attribute Create) writes `home_position` as `[residence_lng, residence_lat]`
- **`work-position`** (Attribute Create) writes `work_position` as `[workplace_lng, workplace_lat]`
- **`source-color`** and **`target-color`** (Color) hold orange `#f69a00` and purple `#950c69`
- **`arc-layer`** (Arc Layer) draws from `home_position` to `work_position` in those colors with `widthScale: 80`
- **`residence-layer`** and **`workplace-layer`** (Scatterplot Layer) draw homes and workplaces in those colors
- All three layers use `blend: "additive"`, which brightens overlapping points and arcs
- **`deck`** (Deck) holds the Carto Dark Matter basemap and the camera

## Pipeline
```
data-source → home-position → work-position → arc-layer       → deck
                                            → residence-layer → deck
                                            → workplace-layer → deck
```

## Data Structure
The CSV file contains:
- `residence_lng`, `residence_lat`: Home location coordinates
- `workplace_lng`, `workplace_lat`: Work location coordinates
- `all_flows`: Number of commuters on this route

## Use Cases
This pattern is useful for:
- Transportation planning
- Economic analysis
- Urban development
- Public transit planning
- Regional connectivity studies
- Labor market analysis
