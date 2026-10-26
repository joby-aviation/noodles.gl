# Properties Panel

Edit a node's parameters, drive them from other parameters, and keyframe them in the Properties Panel.

## Overview

The Properties Panel shows the node you select on the canvas, in the Layers list or on the map. In the default workspace it sits on the left, under Layers; see [Workspaces and Areas](./getting-started.md#workspaces-and-areas) to move it. At the top are the node's operator type, its name (click to rename), its path, its **B** (bypass) and **D** (display) flags, and a description of the operator. Below are its parameters, grouped into folders such as Channels, Style and Export. Click a folder's heading to fold it away.

With nothing selected, the panel shows the project's name.

When you open an example, its main map layer is already selected, so the panel starts with controls you can change.

You can also click a point, line or shape on the map to select the node that draws it and edit its settings here.

## Parameters

### Editing Values

The editor for each parameter fits its kind:

| Parameter Kind | Editor |
|------------|--------|
| Number | Numeric input with scroll-to-scrub |
| Text, column, expression | Text input |
| Toggle | Checkbox |
| Color | Color swatch with picker |
| Menu | Dropdown menu |
| Code, SQL | Code editor |

Some parameters only appear for certain values of another: a Filter shows Column and Value in Compare mode, and Expression in Expression mode. Some operators add an editor above their parameters, such as the Map Style node's style editor and the Table node's rows.

### Channels, Colors and Units

A layer's **channels** (Position, Color, Radius…) say where each row's value comes from, and the panel marks what each one holds:

- **▦ in teal**: an attribute of the layer's rows, such as `position`.
- **ƒ in violet**: a row expression, computed for each row, such as `sqrt(mag) * 2`.
- **Empty**: the layer's own value applies; the row says which, such as "default · Fill color".

A layer's **Color** is one control with four modes:

- **Solid**: one color for every row, set with the swatch.
- **Attr**: an RGB attribute of the rows; the field suggests the input's columns.
- **Ramp**: a color ramp over a numeric column. Pick the column and the ramp; the picker shows each ramp's colors. **Auto**, on by default, fits the range to the column's smallest and largest values over the layer's rows, and follows the data when it changes. Uncheck it to set the range that maps to the ramp's ends by hand.
- **ƒ**: any row expression in 0–1 color.

A value with **units**, such as Radius scale or Width scale, shows its units menu on the same row.

These are still separate parameters in the project file: `color`, `fillColor`, `ramp`, `radiusUnits` and so on.

### Driven Parameters

A parameter can take its value from somewhere other than its editor:

- **Wired**: a number output, such as an Extent's `max`, wired into the parameter. The row shows the output it reads.
- **Expression**: shows the expression text and its current value. See [Expressions](./expressions.md).
- **Reference**: shows a chip naming the parameter it follows. Click the chip to go to that node, or click × to break the reference and keep the value.

### Linking Parameters by Dragging

Each parameter that can follow another has two **ports**, as in Cavalry: an input at the left of its row and an output at the right. A node with number outputs, such as an Extent's `min` and `max`, lists them under **Outputs**, each with an output port. A port is hollow until it is connected and blue once it is. Rest the pointer on a port to see what it is connected to; click an entry to go to it.

- **Output onto a parameter**: drag an output port onto another parameter's row. That parameter now reads it. Rows that can take the link light up while you drag; a color only links to a color, a number to a number.
- **Input onto an output**: drag a parameter's input port onto another row, or onto an output, to make the parameter read it, as After Effects' pick whip does.
- **Port onto a node**: drop a port on a node in the Layers list, and pick from the parameters and outputs of that node that fit. Rest on the node for a moment instead, and Properties switches to it, so you can drop on the exact row.
- **Node onto a parameter**: drag a node from the Layers list onto a parameter's row and pick which of the node's parameters or outputs it reads.

A link between parameters is a reference, so it shows as a chip and breaks with ×. A link from an output is a wire, the same one the node graph draws. Cmd+Z undoes either. Links that would loop back on themselves are refused.

### Keyframes

The **diamond icon** (◇) next to a number parameter is its keyframe indicator. Click it to add a keyframe at the playhead, and click it again on a keyframe to remove it. See [Animation and Rendering](./animation-and-rendering.md) for details.

## Right-Click Context Menu

Right-click any parameter row for its menu. Items appear disabled when they don't apply.

| Action | Description |
|--------|-------------|
| **Set expression...** | Drive a number with an expression (`T`, `F`, `ch('node/param')`) |
| **Revert to value** | Replace an expression with a plain number |
| **Reference a parameter...** | Follow another node's parameter of the same kind |
| **Copy parameter** | Remember this parameter for a reference |
| **Paste relative reference** | Follow the copied parameter |
| **Remove reference** | Keep the current value and stop following |
| **Add keyframe at playhead** / **Update keyframe** | Keyframe the current value |
| **Remove keyframe here** | Remove the keyframe at the playhead |
| **Clear keyframes** | Remove every keyframe of this parameter |
| **Revert to default** | Reset the parameter and clear its keyframes (disabled while wired) |
| **Promote to subnet** | Show this parameter on the subnet the node is in, to control it from outside |

## Subnets

A subnet's panel lists its promoted parameters. Each edits the parameter inside that it drives. Right-click one and choose **Remove promotion** to take it off the subnet.

## Debug Information

With **Show editor debug info** on in the top menu, the panel also shows what the engine made of the node: its query, how its table is stored, and what a change to each parameter costs.

## Related

- [Introduction to Workflows](./workflows-intro.md): parameters and connections
- [Animation and Rendering](./animation-and-rendering.md): keyframes and the timeline editor
- [Essential Operators](./operators-guide.md): operators and their parameters
