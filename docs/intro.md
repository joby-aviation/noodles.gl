---
sidebar_position: 1
sidebar_label: Start here
---

# Welcome to Noodles.gl

Noodles.gl is a node-based editor for animated maps. It runs in the browser.

<video autoPlay loop muted playsInline style={{width: '100%', borderRadius: '12px', marginBottom: '1.5rem'}}>
  <source src="/img/example-nyc-taxi-brushing.mp4" type="video/mp4" />
</video>

## Start here

There is nothing to install.

<OpenInEditor label="Open the editor">

Opens the start screen, where you can pick an example or start a new project.

</OpenInEditor>

### Start from an example

Each one opens with its data loaded. Change a value and the map updates.

<StartExamples />

### Bring your own data

Drop a CSV, GeoJSON, GeoParquet or Shapefile file on the start screen, or on the canvas of an open project. Noodles.gl finds the coordinate columns and puts your data on a map. A PMTiles file is added as a source node, but no layer draws it yet.

Once you are in the editor, [Editor Basics](./users/getting-started.md) explains the parts of the screen.

## How it works

You connect nodes into a network: a data source, the steps that filter it and add columns, the layers that draw it, and the deck that shows the layers on a map. Noodles.gl compiles the network to queries that run in DuckDB in your browser. There's no "run" button: change a value and only the work that change needs runs again.

![The NYC Taxis network over its map: a CSV of trips becomes arcs and points](/img/noodles-nyc-taxis-graph.png)

The timeline can keyframe any number parameter: the camera, a layer's opacity, a filter's threshold, an arc's height. Scrub and adjust the curves, then export the timeline as a video or the current frame as an image.

## What you can build

- **Route animations**: fly the camera along a path while trips trail behind it
- **Data over time**: scrub through years of earthquakes, urban growth or flights on one timeline
- **Query-driven maps**: a DuckDB SQL query feeding a layer, updated as you change its inputs
- **High-resolution renders**: video and stills at the size you set, from two dozen deck.gl layer types, including H3, S2 and A5 cells
- **Repeatable projects**: every project is a JSON file you can keep in version control, share, and run on new data

## Next steps

- **<EditorLink>Open the editor →</EditorLink>**, or start from one of the [examples above](#start-from-an-example)
- **[Editor Basics →](./users/getting-started)**: workspaces, the node graph, properties, the timeline and the tools shelf
- **[Framework Developers →](./developers/overview)**: add operators to Noodles.gl
