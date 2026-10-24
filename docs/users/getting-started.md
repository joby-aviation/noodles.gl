---
title: Editor Basics
---

# Editor Basics

The parts of the editor and how to use them. New to Noodles.gl? Go to [Start here](../intro.md) first to open the editor or an example.

<OpenInEditor>

Open the editor and follow along.

</OpenInEditor>

> New to node-based workflows? Start with [Introduction to Workflows](./workflows-intro.md) to learn how data flows through Noodles.gl.

## Interface Overview

### Workspaces and Areas

The editor's window is split into areas, as in Blender. Each area shows one editor: the Map, the Node Graph, Layers, Properties, the Timeline or the Spreadsheet.

- **Workspaces**: The tabs at the top right switch between layouts. **Layout** has Layers and Properties on the left, the map, and the timeline under it, with no node graph. **Animation** runs the timeline across the whole window. **Nodes** adds the node graph under the map.
- **Change an area's editor**: Click its name in the area's header. Picking an editor that is open in another area swaps the two.
- **Split or close an area**: Hover the area's header and use the buttons on its right. Drag the line between two areas to resize them.
- **Reset**: **View > Reset workspace layout** puts the current workspace back to its default.

Each workspace keeps its own arrangement, and the editor remembers them between visits. Closing the Map area pops the map out into a floating window; its dock button brings the area back.

### Node Editor
- **Add Nodes**: Press `Tab` or right-click an empty area of the canvas to open the Add Node menu
- **Connect Data**: Drag from an output port to an input port
- **Order Inputs**: A port that takes several wires, such as the deck's `layers`, is a pill with a slot per wire, top slot first. Drop a wire between two slots to put it there, or drag a wire's end to another slot to reorder
- **Navigate**: Double-click a subnet (or select it and press `Enter`) to go inside, use the breadcrumbs or press `U` to go back up, press `F` to frame the whole network, and press `L` to lay it out left to right

### Properties
- **Edit Parameters**: Adjust the selected node's parameters, grouped into folders
- **Expressions and References**: Drive a parameter from the time or another parameter (see [Expressions](./expressions.md))
- **Keyframes**: Click the diamond next to a number to keyframe it
- See the full [Properties Panel](./properties-panel.md) reference for the context menu

### Timeline Editor
- **Keyframes**: Click the diamond next to any number parameter to add a keyframe
- **Animation**: Create smooth motion with bezier curve interpolation
- **Playback**: Press `Space` to play

### Tools Shelf

The Tools Shelf in the top menu gives quick access to common operations:

| Tool | Description |
|------|-------------|
| **Import Data** | Import a CSV, JSON, GeoJSON, Shapefile, GeoParquet or PMTiles file and build the nodes that draw it |
| **Point** | Geocoding wizard that adds a Point node from an address or coordinates |
| **Draw** | Draw geometry on the map |
| **Measure** | Measure a distance or an area on the map |
| **Add Op** | Open the Add Node menu |

#### Point Wizard
Search for locations by address or paste coordinates. The wizard uses several geocoding services with automatic fallback:
1. Google Places (if API key configured)
2. Mapbox (if API key configured)
3. Photon (free, no key required)

It adds a Point node at the selected coordinates.

#### Import Data
Drag and drop or browse for a file. The importer adds a data node, a layer for it and, if the project has none, a deck node, then saves the file to your project's data directory.

For tables of points, the importer looks for latitude and longitude columns (`lat`/`lng`, `Latitude`/`Longitude`, `x`/`y` and common variants) or a WKT or GeoJSON geometry column. It then fits the camera to the data and, when there is an obvious numeric column such as `population` or `magnitude`, sizes the points by it. If no coordinates are found, the Scatterplot Layer's Position is left as `[lng, lat]` for you to change. Dropping a CSV on the start screen does the same in a new project.

## Your First Project

**Data node** → **Row nodes** → **Layer** → **Deck**

<iframe src="https://drive.google.com/file/d/13e933pV8w_NfLUlmXa1vEw8JB4KfmL4z/preview" width="800" height="460" allow="autoplay"></iframe>

1. **Load Data**: Add a `file` node (CSV, JSON or Parquet), a `geojson` node or a `sql` node
2. **Add Visualization**: Wire the table into a layer such as Scatterplot Layer, and the layer into the deck node's `layers` port
3. **Style & Configure**: Set the layer's Position and other channels to column names or expressions, and adjust its style in the parameter pane
4. **Animate**: [Add timeline keyframes](./animation-and-rendering.md) to create smooth animations
5. **Export**: Render images or video from the Export button

## Try the NYC Taxis Example

See Noodles.gl in action with a real-world dataset:

<OpenInEditor example="nyc-taxis" label="Open the NYC Taxis example" />

This example visualizes NYC taxi trips using:
- Attribute nodes that build pickup and dropoff positions from the CSV's columns
- An Arc Layer connecting pickup and dropoff locations
- Scatterplot Layers for each end, sharing colors with the arcs through Color nodes

If running locally: `http://localhost:5173/examples/nyc-taxis`

## Need API Keys?

Some features require API keys for external services. See [API Keys Configuration](./api-keys.md) for setup instructions.
