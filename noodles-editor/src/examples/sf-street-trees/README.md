# San Francisco Street Trees

_Adapted from [Kepler.gl examples](https://kepler.gl/demo/sftrees)_

## Overview
This example plots thousands of individual street trees across San Francisco as points on a map, creating a visual inventory of the city's urban forest. The density and clustering of points reveal which neighborhoods have more tree coverage, and the data includes species, age, and size information that could be used for color or size styling.

## Key Techniques
- **Data source**: `FileOp` loads street tree inventory with coordinates
- **Point layer**: `ScatterplotLayerOp` renders individual trees
- **Styling**: Points can be colored/sized by species, size, or age
- **Basemap**: `MaplibreBasemapOp` centered on San Francisco

## Data Structure
The CSV file contains street tree records with fields:
- `TreeID`: Unique identifier
- `latitude`, `longitude`: Tree location
- `qSpecies`: Species name (common and scientific)
- `qAddress`: Street address
- `PlantType`: Type (e.g., Tree)
- `PlantDate`: Date planted
- `Plan`: Planning year
- `Age`: Tree age in years
- `DBH`: Diameter at breast height (inches)
- `qSiteInfo`, `SiteOrder`: Location details

## Use Cases
This pattern is useful for:
- Urban forestry management
- Environmental planning
- Biodiversity studies
- Heat island analysis
- Urban green space assessment
- Municipal asset tracking
