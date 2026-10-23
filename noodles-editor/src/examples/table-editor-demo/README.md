# Table Editor Demo

## Overview
A table of five cities, typed in by hand with `TableEditorOp`, drawn as circles and labels on a map. Edit a cell or add a row and the layers update. Hidden from the examples gallery; open it at `/examples/table-editor-demo`. See [table-editor.md](../../../docs/table-editor.md) for the manual test steps.

## Key Techniques
- **Typed table**: `TableEditorOp` with `string`, `point2d` (with geocoder), `number`, `color` and `boolean` columns
- **Accessors**: `AccessorOp` nodes read `position`, `population`, `color` and `city` from each row
- **Layers**: `ScatterplotLayerOp` for the circles, `TextLayerOp` for the city names
- **Basemap**: `MaplibreBasemapOp`
