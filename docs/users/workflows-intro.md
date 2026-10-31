# Introduction to Workflows

Learn the fundamentals of creating data visualizations with Noodles.gl's node-based workflow.

## What is a Workflow?

A workflow in Noodles.gl is a network of connected nodes (operators). Tables flow along the wires from left to right: a data node loads a table, row nodes filter it and add columns, layers draw it, and the deck node shows the layers on a map.

You work on an **infinite canvas** where you can freely arrange nodes, zoom in and out, and move through large networks without running out of space.

![Workflow Overview](/img/workflow-overview.png)

## The Basic Workflow Structure

Every workflow follows a simple pattern:

```
Data → Rows → Layers → Deck
```

### Key Principle: Inputs on the Left, Outputs on the Right

**This is the fundamental layout rule in Noodles.gl.** Every node follows this convention:
- **Left ports (inputs)**: Receive tables, layers or values from other nodes
- **Right ports (outputs)**: Send them on

This consistent design makes it easy to trace how data flows through your visualization.

## Core Concepts

### Nodes

Nodes are the building blocks of your workflow. Each performs one step:

- **Data nodes**: Load tables (`file`, `geojson`, `sql`, `code`)
- **Row nodes**: Filter, sort, join and add columns (`filter`, `attribute`, `map-range`, `color-ramp`, `aggregate`, `join`, `sort`, `limit`)
- **Layers**: Draw a table (`scatter`, `arc`, `path`, `trips`, `polygon`, `heatmap`, `hexagon`, `text`...)
- **Deck**: The map, with the basemap, the camera and the export settings
- **Numbers**: Constants, the clock, math and curves that drive parameters

To add a node:
1. Press `Tab` or right-click on the canvas
2. Type to search for the operator you need
3. Click it, or press `Enter`, to place it

### Parameters

Parameters are the settings of each node, edited in the [Properties Panel](./properties-panel.md). A parameter can be:

- A plain value you type or drag
- An [expression](./expressions.md) over the time and other parameters
- A reference to another node's parameter
- Keyframed on the timeline (any number)
- Driven by a wire from a number node, through the parameter's port

Layer channels such as Position, Color and Radius are parameters too. They hold a column name or an expression over the table's columns, like `[lng, lat]` or `sqrt(pop) * 2.0`, and Noodles computes them for every row.

### Connections

Connections are the wires between nodes. To create one, drag from an output port and drop onto an input port.

- Tables leave by `out` and enter by `in`. A `sql` node takes `in0` to `in2`, and a `join` takes `left` and `right`.
- Layers leave by `out` and enter the deck's `layers` port. The order of the wires is the drawing order, bottom to top.
- A number output wired to a parameter port (`par:<name>`) drives that parameter. While you drag a number wire, the ports it can drive appear on each node.

A wire only connects ports of matching types: while you drag one, the ports it fits stay lit and the rest dim.

#### Inserting Nodes into Connections

Right-click a wire and choose **Insert node here...** to put a node between the two it connects.

## Reactive Execution

Workflows in Noodles.gl are **reactive**:

- Changes propagate through the workflow on their own
- When you change a parameter, everything after it updates
- No need to refresh or recalculate

Noodles runs each project in DuckDB and plans what each change costs, so dragging a slider re-runs only what that slider affects.

## Building Your First Workflow

Let's build a simple workflow to show data on a map:

### Step 1: Add a Data Source

```
[File] → (out: a table)
```

1. Press `Tab`, type "File", and place a File node.
2. Set its URL and Format (CSV, JSON or Parquet) in the Properties Panel. A file in the project is `@/name.csv`.
3. Its output is a table, one row per record.

### Step 2: Transform the Data (Optional)

```
[File] → [Filter] → (out: the rows that pass)
```

1. Add a Filter node.
2. Wire the File's `out` to the Filter's `in`.
3. Set the condition. For data with a numeric `value` column, set Column to `value`, Operator to `>` and Value to `100`.

### Step 3: Visualize

```
[Filter] → [Scatterplot Layer] → [Deck]
```

1. Add a Scatterplot Layer.
2. Wire the Filter's `out` to the layer's `in`.
3. Wire the layer's `out` to the deck node's `layers` port. A new project has a deck node; it holds the basemap and the camera.
4. Set the layer's Position to the coordinate columns, such as `[longitude, latitude]`. Names are the table's column names.

### Step 4: Style and Configure

Use the Properties Panel to:
- Adjust colors, sizes and opacity
- Set the Color or Radius channels to expressions over columns
- Keyframe parameters for animation

## Workflow Organization

### Subnets

For larger workflows, group nodes into **subnets** (`subnet`):

- Select nodes and press `Shift+C` to collapse them into a subnet
- Double-click a subnet, or select it and press `Enter`, to go inside
- Press `U` or use the breadcrumbs to go back up
- Promote a parameter from inside to control it from the subnet

### Comments

Add a **Comment** to explain part of a graph in place. Open the Add Node menu and choose **Comment** (under Structure), then move it next to the nodes it describes. The featured examples include a few to show the idea.

- **Edit the text**: Double-click the comment, type, then press Escape or click away to finish. Line breaks are kept, and web addresses become links.
- **Resize**: Select the comment and drag its corners or edges.
- **Move**: Drag the comment from anywhere on it.

Comments sit behind other nodes, have no inputs or outputs, and don't change what the graph does. Their text and size are saved with the project, and the parameter pane edits them too.

### Layer Stack

The Layers editor's **Layers** tab lists what the deck draws, top layer first, as in Kepler or Cavalry. Open a layer to see the nodes that feed it, data sources first, without opening the node graph:

- **Select**: Click a layer or node to edit it in the Properties Panel
- **Reorder**: Drag a layer up or down, or press Alt+Up or Alt+Down on its name
- **Hide**: Click the eye. A hidden layer is bypassed, so its settings stay
- **Shared nodes**: A node that feeds more than one layer is listed under each, with a link icon. Hover it to see the other layers
- **Show in graph**: Hover a row and click the graph icon to open the node graph on it
- **Find**: Type in the search box, or press Cmd+F, to filter by name or node type

**Scene** lists the deck and what feeds its other ports, such as views and widgets. **Not drawn** lists nodes nothing reads.

### Node Tree

The Layers editor's **Nodes** tab shows every node in the project as a tree, a subnet's nodes under it:

- **Select nodes**: Click a node name to select it on the canvas
- **Navigate to node**: Click the compass icon to zoom the canvas to that node
- **Navigate into subnets**: Click the arrow icon on a subnet to enter it
- **Rename nodes**: Double-click a node name to edit it (press Enter to confirm, Escape to cancel)

### Best Practices

1. **Arrange nodes clearly**: Lay the network out left to right
2. **Group related operations**: Use subnets for logical sections
3. **Name your nodes**: Names are what paths and `ch()` references use
4. **Start simple**: Build incrementally, checking each step
5. **Inspect rows**: Select a node and press `D` to display its rows in the spreadsheet
6. **Leave notes**: Add a Comment next to anything a reader might not understand

## Data Flow Patterns

### Linear Pipeline

The simplest pattern, a series of steps:

```
[Data] → [Row node A] → [Row node B] → [Layer] → [Deck]
```

### Split and Merge

Process a table in two branches, then combine them with a Join or a Union:

```
         → [Filter A] →
[Data] →                → [Union] → [Layer] → [Deck]
         → [Filter B] →
```

### Multi-Output

One table feeding several layers on the same map:

```
         → [Layer A] →
[Data] →               → [Deck]
         → [Layer B] →
```

### Switch

A Switch passes one of several layers through, chosen by its Index. Keyframe the index or drive it from a number node to change which layer is drawn.

```
[Layer A] →
             [Switch] → [Deck]
[Layer B] →    ↑
          (Index)
```

## Common Operators

See the [Operators Guide](./operators-guide.md) for the full list. The ones you'll use most:

### Data

- **File**: Load CSV, JSON or Parquet from a URL or the project
- **GeoJSON**: Load GeoJSON and other vector files as features or vertex rows
- **DuckDB SQL**: Run a SELECT over the tables wired in
- **Code**: Make rows with JavaScript

### Rows

- **Filter**: Keep only rows matching a condition
- **Sort** and **Limit**: Order rows and keep the first N
- **Join** and **Union**: Combine tables
- **Attribute Create**: Add a column from an expression
- **Map Range** and **Color Ramp**: Scale values and turn them into colors

### Layers

- **Scatterplot Layer**: Points on a map
- **Path Layer**: Lines and routes
- **Polygon Layer**: Areas, with optional extrusion
- **Arc Layer**: Arcs between two points
- **Text Layer**: Labels
- **Heatmap Layer**: Density from point data

### Views

- **Map View**, **Globe View**, **First Person View**, **Orbit View**: Other cameras, wired into the deck's `views` port

### Utilities

- **Table**: Type in rows and edit them in a table editor
- **Subnetwork**: Group related nodes
- **Switch**: Choose one of several layers by index
- **Color**: A color that several layers reference
- **Number** and **Time**: Values that drive parameters

## Tips for Success

1. **Use the Properties Panel**: Most configuration happens here
2. **Inspect data**: Display a node (`D`) to see its rows in the spreadsheet
3. **Bypass a node**: Press `B` to pass its input straight through while you compare
4. **Check errors**: A node with an error shows it on the node; hover the `i` in its header for details
5. **Experiment freely**: Every edit can be undone

## Next Steps

Now that you understand workflows, explore:

- [Operators Guide](./operators-guide.md): specific operators
- [Data Guide](./data-guide.md): working with different data types and transformations
- [Animation and Rendering](./animation-and-rendering.md): animated visualizations
- [Creating Operators](../developers/creating-operators.md): build new operators

## Quick Reference

| Action | Shortcut |
|--------|----------|
| Add node | `Tab` or right-click the canvas |
| Delete node | Select and press `Delete` or `Backspace` |
| Copy, paste, duplicate | `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D` |
| Undo, redo | `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` |
| Bypass node | `B` |
| Display node's rows | `D` |
| Collapse into subnet | `Shift+C` |
| Enter subnet | `Enter` or double-click |
| Go up one subnet | `U` |
| Frame all | `F` |
| Lay out the network, left to right | `L` |
| Search operators | Type after pressing `Tab` |
| Play animation | `Space` |
| Rename node | Double-click its name in the Nodes tab |
| Insert node into wire | Right-click the wire |
