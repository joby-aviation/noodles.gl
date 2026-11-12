# Camera Switch

## Overview
Three cameras over a dozen US cities, and a Switch Value that picks the one the map shows. Its Index is keyframed from 0 to 2 with Blend on, so the camera flies from San Francisco out to the whole country and down into New York. This is how a project cuts or flies between shots: each shot is a View State, and one keyframed number chooses among them.

## Nodes
- **`cities`** (File) loads `@/data.csv`
- **`position`** (Attribute Create) writes `position` as `[lng, lat]`
- **`dots`** (Scatterplot Layer) draws a dot per city
- **`san-francisco`**, **`usa`**, **`new-york`** (View State) are the three cameras
- **`shots`** (Switch Value) takes the three, in wiring order, and passes on the one its Index picks; with Blend, a decimal Index is partway between two
- **`deck`** (Deck) holds the Carto Voyager basemap and reads its camera from `shots`

## Data Structure
The CSV file contains one row per city:
- `city`: Name
- `lng`, `lat`: Position
- `population`: Population

## Try next
- With the playhead at 0s, click the padlock in the map's corner and move the map: it moves `san-francisco`, the camera `shots` picks there.
- Turn Blend off: the map cuts from one camera to the next as Index passes each whole number.
- Add a fourth View State and wire it into `shots`, then keyframe Index to 3.
