# Introduction to Workflows

How a Noodles.gl project is built from nodes and wires.

## What is a Workflow?

A workflow is a network of connected nodes (operators). Tables flow along the wires from left to right: a data node loads a table, row nodes filter it and add columns, layers draw it, and the deck node shows the layers on a map.

```
Data → Rows → Layers → Deck
```

Every node takes its inputs on the left and sends its outputs from the right, so you can read a network left to right. The canvas has no edges: pan, zoom and spread out as far as you need.

![A network that reads data, adds rows, draws layers and shows them on the deck, from left to right](/img/workflow-overview.png)

## Core Concepts

### Nodes

Each node does one step:

- **Data**: load a table (`file`, `geojson`, `sql`, `code`)
- **Rows**: filter, sort, join and add columns (`filter`, `attribute`, `map-range`, `color-ramp`, `aggregate`, `join`, `sort`, `limit`)
- **Layers**: draw a table (`scatter`, `arc`, `path`, `trips`, `polygon`, `heatmap`, `hexagon`, `text`...)
- **Deck**: the map, with the basemap, the camera and the export settings. A new project has one
- **Numbers**: constants, the clock, math and curves that drive parameters

To add a node, press `Tab` or right-click the canvas, type to search, and click the operator or press `Enter`.

### Parameters

Parameters are a node's settings, edited in the [Properties Panel](./properties-panel.md). A parameter can be:

- A plain value you type or drag
- An [expression](./expressions.md) over the time and other parameters
- A reference to another node's parameter
- Keyframed on the timeline (any number)
- Driven by a wire from a number node into the parameter's port

A layer's channels, such as Position, Color and Radius, are parameters too. They hold a column name or an expression over the table's columns, like `[lng, lat]` or `sqrt(pop) * 2.0`, and Noodles computes them for every row.

### Connections

To connect two nodes, drag from an output port and drop onto an input port.

- Tables leave by `out` and enter by `in`. A `sql` node takes `in0` to `in2`, and a `join` takes `left` and `right`.
- Layers leave by `out` and enter the deck's `layers` port. The order of the wires is the drawing order, bottom to top.
- A number output wired into a parameter's port drives that parameter. While you drag a number wire, the ports it can drive appear on each node.

While you drag a wire, the ports it fits stay lit and the rest dim.

To put a node between two others, right-click the wire and choose **Insert node here...**.

### Updates

There is no run button. When you change a parameter, everything after it updates. Noodles plans what each change costs, so dragging a slider re-runs only what that slider affects.

## Building Your First Workflow

### Step 1: Load data

1. Press `Tab`, type "File", and place a File node.
2. In Properties, set its URL and Format (CSV, JSON or Parquet). A file in the project is `@/name.csv`.

Its output is a table, one row per record.

### Step 2: Filter it (optional)

1. Add a Filter node and wire the File's `out` to its `in`.
2. Set the condition. For a numeric `value` column, set Column to `value`, Operator to `>` and Value to `100`.

### Step 3: Draw it

1. Add a Scatterplot Layer and wire the Filter's `out` to its `in`.
2. Wire the layer's `out` to the deck node's `layers` port.
3. Set the layer's Position to the coordinate columns, such as `[longitude, latitude]`.

### Step 4: Style it

In Properties, set colors, sizes and opacity, set the Color or Radius channels to expressions over columns, and keyframe what you want to animate.

## Organizing a Network

### Subnets

Group nodes into a **subnet** (`subnet`) to keep a large network readable:

- Select nodes and press `Shift+C` to collapse them into a subnet
- Double-click a subnet, or select it and press `Enter`, to go inside
- Press `U` or use the breadcrumbs to go back up
- Right-click a parameter inside and choose **Promote to subnet** to control it from outside

### Comments

A **Comment** explains part of a graph in place. Open the Add Node menu, choose **Comment** (under Structure), and move it next to the nodes it describes. The featured examples include a few.

- **Edit the text**: Double-click the comment, type, then press Escape or click away. Line breaks are kept, and web addresses become links.
- **Resize**: Select the comment and drag its corners or edges.
- **Move**: Drag the comment from anywhere on it.

Comments sit behind other nodes, have no inputs or outputs, and don't change what the graph does. Their text and size are saved with the project.

### Layer Stack

The Layers editor's **Layers** tab lists what the deck draws, top layer first. Open a layer to see the nodes that feed it, data sources first, without opening the node graph:

- **Select**: Click a layer or node to edit it in Properties
- **Reorder**: Drag a layer up or down, or press `Alt+Up` or `Alt+Down` on its name
- **Hide**: Click the eye. A hidden layer is bypassed, so its settings stay
- **Shared nodes**: A node that feeds more than one layer is listed under each, with a link icon. Hover it to see the other layers
- **Show in graph**: Hover a row and click the graph icon to open the node graph on it
- **Find**: Type in the search box, or press `Cmd/Ctrl+F`, to filter by name or node type

**Scene** lists the deck and what feeds its other ports, such as views and widgets. **Not drawn** lists nodes nothing reads.

### Node Tree

The Layers editor's **Nodes** tab shows every node in the project as a tree, each subnet's nodes under it:

- **Select**: Click a node name to select it on the canvas
- **Go to**: Click the compass icon to zoom the canvas to that node
- **Enter a subnet**: Click the arrow icon on a subnet
- **Rename**: Double-click a node name, then press Enter to confirm or Escape to cancel

## Data Flow Patterns

### Linear pipeline

```
[Data] → [Row node A] → [Row node B] → [Layer] → [Deck]
```

### Split and merge

Process a table in two branches, then combine them with a Join or a Union:

```
         → [Filter A] →
[Data] →                → [Union] → [Layer] → [Deck]
         → [Filter B] →
```

### One table, several layers

```
         → [Layer A] →
[Data] →               → [Deck]
         → [Layer B] →
```

### Switch

A Switch passes one of several tables or layers through, chosen by its Index. Keyframe the index or drive it from a number node to change which one is used.

```
[Layer A] →
             [Switch] → [Deck]
[Layer B] →    ↑
          (Index)
```

## Common Operators

See the [Operators Guide](./operators-guide.md) for more, and the [Operator Reference](../reference/operators.md) for all of them.

- **Data**: File, GeoJSON, DuckDB SQL, Code, Table
- **Rows**: Filter, Sort, Limit, Join, Union, Attribute Create, Map Range, Color Ramp
- **Layers**: Scatterplot, Path, Polygon, Arc, Text, Heatmap
- **Views**: Map, Globe, First Person and Orbit views, wired into the deck's `views` port
- **Structure**: Subnetwork, Switch, Comment
- **Values**: Color (one color several layers reference), Number and Time

## Tips

- **Look at the rows**: Show the Spreadsheet (**Editor > Show spreadsheet** in the logo menu) and select a node to see its rows
- **Preview on the map**: Press `D` on a node to draw its rows as yellow points over the map. One node per network can have this display flag
- **Bypass a node**: Press `B` to pass its input straight through while you compare
- **Check errors**: A node with an error shows it on the node; hover the `i` in its header for details
- **Name your nodes**: Names are what paths and `ch()` references use
- **Undo**: Every edit can be undone

## Next Steps

- [Operators Guide](./operators-guide.md): the operators you'll use most
- [Data Guide](./data-guide.md): working with different data types
- [Animation and Rendering](./animation-and-rendering.md): keyframes and export
- [Creating Operators](../developers/creating-operators.md): add your own

## Quick Reference

| Action | Shortcut |
|--------|----------|
| Add node | `Tab` or right-click the canvas, then type to search |
| Delete node | Select and press `Delete` or `Backspace` |
| Copy, paste, duplicate | `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D` |
| Undo, redo | `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` |
| Bypass node | `B` |
| Display node's rows on the map | `D` |
| Collapse into subnet | `Shift+C` |
| Enter subnet | `Enter` or double-click |
| Go up one subnet | `U` |
| Frame all | `F` |
| Lay out the network, left to right | `L` |
| Find a layer or node | `Cmd/Ctrl+F` |
| Play, pause | `Space` |
| Step one frame | Left and right arrow keys |
| Insert node into wire | Right-click the wire |
