---
title: Editor Basics
---

# Editor Basics

The parts of the editor and how to use them. New to Noodles.gl? Go to [Start here](../intro.md) first to open the editor or an example, and read [Introduction to Workflows](./workflows-intro.md) for how data flows through a network.

<OpenInEditor>

Open the editor and follow along.

</OpenInEditor>

## Interface Overview

### Workspaces and Areas

The editor's window is split into areas, as in Blender. Each area shows one editor: the Map, the Node Graph, Layers, Properties, the Timeline or the Spreadsheet.

![The Layout workspace: Layers and Properties on the left, the map, and the timeline under it](/img/editor-workspace-layout.png)

- **Workspaces**: The tabs at the top right switch layouts. **Layout** has Layers and Properties on the left, the map, and the timeline under it, with no node graph. **Animation** runs the timeline across the whole window. **Nodes** adds the node graph under the map.
- **Change an area's editor**: Click its name in the area's header. Picking an editor that is open in another area swaps the two.
- **Split or close an area**: Hover the area's header and use the buttons on its right. Drag the line between two areas to resize them.
- **Reset**: In the menu under the Noodles.gl logo, **Editor > Reset workspace layout** puts the current workspace back to its default.

Each workspace keeps its own arrangement, and the editor remembers them between visits. Closing the Map area pops the map out into a floating window; its dock button brings the area back. The Spreadsheet is in no workspace at first: turn on **Editor > Show spreadsheet**, or switch an area to it, to see the selected node's rows.

### Node Graph

![The NYC Taxis network: a file, two attribute nodes, three layers and the deck](/img/editor-node-graph.png)

- **Add nodes**: Press `Tab` or right-click an empty part of the canvas to open the Add Node menu
- **Connect**: Drag from an output port to an input port
- **Order inputs**: A port that takes several wires, such as the deck's `layers`, is a pill with a slot per wire, top slot first. Drop a wire between two slots to put it there, or drag a wire's end to another slot to reorder
- **Navigate**: Double-click a subnet (or select it and press `Enter`) to go inside, use the breadcrumbs or press `U` to go back up, press `F` to frame the whole network, and press `L` to lay it out left to right

The full list of shortcuts is in [Introduction to Workflows](./workflows-intro.md#quick-reference).

### Properties

Edit the selected node's parameters, drive them with expressions or other parameters, and click the diamond next to a number to keyframe it. See [Properties Panel](./properties-panel.md).

### Timeline

Click the diamond next to any number parameter to add a keyframe; the timeline interpolates between keyframes along bezier curves. Press `Space` to play and the arrow keys to step one frame. See [Animation and Rendering](./animation-and-rendering.md).

### Tools Shelf

The tools in the top bar:

| Tool | What it does |
|------|-------------|
| **Import Data** | Import a CSV, TSV, JSON, GeoJSON, Shapefile, GeoParquet or PMTiles file and build the nodes that draw it. Its arrow adds a source node for GeoParquet, Shapefile, PMTiles or XYZ tiles |
| **Point** | Add a Point node from an address or coordinates |
| **Draw** | Draw points, lines or polygons on the map into a Features node |
| **Measure** | Measure a distance or an area on the map |
| **Geometry**, **Combine**, **Analysis**, **Transform**, **Grids** | GIS steps, such as Buffer, Spatial Join or Hex Grid, set up with a short form. Those that don't fit move into **More** |
| **Add Op** | Open the Add Node menu |

#### Point

Search for a place by address or paste coordinates. The search tries Google Places if you have a Google Maps key, then Mapbox if you have a Mapbox key, then Photon, which needs no key. It adds a Point node at the place you pick.

#### Import Data

Drag and drop a file or browse for one. The importer saves the file to your project's data directory and adds a data node, the layers that draw it and, if the project has none, a deck node.

For tables of points, the importer looks for latitude and longitude columns (`lat`/`lng`, `Latitude`/`Longitude`, `x`/`y` and common variants) or a WKT or GeoJSON geometry column. It then fits the camera to the data and, when there is an obvious numeric column such as `population` or `magnitude`, sizes the points by it. If no coordinates are found, the Scatterplot Layer's Position is left as `[lng, lat]` for you to change. Dropping a file on the start screen does the same in a new project.

## Your First Project

**Data node** → **Row nodes** → **Layer** → **Deck**

<iframe src="https://drive.google.com/file/d/13e933pV8w_NfLUlmXa1vEw8JB4KfmL4z/preview" width="800" height="460" allow="autoplay"></iframe>

1. **Load data**: Add a `file` node (CSV, JSON or Parquet), a `geojson` node or a `sql` node
2. **Draw it**: Wire the table into a layer such as Scatterplot Layer, and the layer into the deck node's `layers` port
3. **Style it**: Set the layer's Position and other channels to column names or expressions, and adjust its style in Properties
4. **Animate**: [Add keyframes](./animation-and-rendering.md) on the timeline
5. **Export**: Save an image or render a video from the **Export** button

[Introduction to Workflows](./workflows-intro.md#building-your-first-workflow) walks through these steps.

## Try the NYC Taxis Example

<OpenInEditor example="nyc-taxis" label="Open the NYC Taxis example" />

This example draws NYC taxi trips with:
- Attribute nodes that build pickup and dropoff positions from the CSV's columns
- An Arc Layer from each pickup to its dropoff
- A Scatterplot Layer for each end, sharing colors with the arcs through Color nodes

If running locally: `http://localhost:5173/examples/nyc-taxis`

## Need API Keys?

Some features, such as Google and Mapbox geocoding and directions, need API keys. See [API Keys Configuration](./api-keys.md).
