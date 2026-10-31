# Table Editor Demo

## Overview
A table of five cities, typed in by hand in a Table node, drawn as circles and labels on a map. Edit a cell or add a row and the layers update. Hidden from the examples gallery; open it at `/examples/table-editor-demo`. See [table-editor.md](../../../docs/table-editor.md) for the manual test steps.

## Nodes
- **`cities-table`** (Table) holds the rows; its `schema` declares `string`, `point2d` (with geocoder), `number`, `color` and `boolean` columns
- **`city-position`** (Attribute Create) writes `city_position` from the `position` column
- **`city-radius`** (Attribute Create) writes `city_radius` as `sqrt(population) * 25`
- **`cities-layer`** (Scatterplot Layer) draws the circles, colored by `color`; **`labels-layer`** (Text Layer) writes each `city` name above it

## Pipeline
```
cities-table → city-position → city-radius → cities-layer → deck
                                           → labels-layer → deck
```
