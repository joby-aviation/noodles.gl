# Properties Panel

Edit a node's parameters, drive them from other parameters, and keyframe them.

## Overview

The Properties Panel shows the node you select on the canvas, in the Layers list or on the map (click a point, line or shape to select the node that draws it). In the default workspaces it sits on the left, under Layers; see [Workspaces and Areas](./getting-started.md#workspaces-and-areas) to move it.

At the top are the node's operator type, its name (click to rename), its path, its **B** (bypass) and **D** (display on the map) flags, and a description of the operator. Below are its parameters, grouped into folders such as Channels, Style and Export. Click a folder's heading to fold it away.

<img src="/img/properties-panel-overview.png" alt="The Properties panel with an Arc Layer selected: its channels, then its style" width="388" />

With nothing selected, the panel shows the project's name. When you open an example, its main map layer is already selected.

## Parameters

### Editing Values

| Parameter Kind | Editor |
|------------|--------|
| Number | Numeric input with scroll-to-scrub |
| Text | Text input |
| Column, expression | Text input that suggests the input table's columns and the functions an expression can call |
| Toggle | Checkbox |
| Color | Color swatch with picker |
| Menu | Dropdown menu |
| Code, SQL | Code editor |

A column or expression input lists the columns of the table wired into the node, with their types, as you type; an empty one lists them all. Arrow keys move through the list, Enter or Tab takes one, and Escape closes it. While you type, an expression reaches the map only once it parses, so the layers keep drawing; leaving the input applies what is there.

Some parameters only appear for certain values of another: a Filter shows Column and Value in Compare mode, and Expression in Expression mode. Some operators add an editor above their parameters, such as the Map Style node's style editor and the Table node's rows.

### Channels, Colors and Units

A layer's **channels** (Position, Color, Radius...) say where each row's value comes from. The panel marks what each one holds:

- **▦ in teal**: an attribute of the layer's rows, such as `position`.
- **ƒ in violet**: a row expression, computed for each row, such as `sqrt(mag) * 2`.
- **Empty**: the layer's own value applies; the row says which, such as "default · Fill color".

A layer's **Color** is one control with four modes:

- **Solid**: one color for every row, set with the swatch.
- **Attr**: an RGB attribute of the rows; the field suggests the input's columns.
- **Ramp**: a color ramp over a numeric column. Pick the column and the ramp. **Auto**, on by default, fits the range to the column's smallest and largest values and follows the data when it changes. Uncheck it to set the range by hand.
- **ƒ**: any row expression giving a color in 0 to 1.

A value with **units**, such as Radius scale or Width scale, shows its units menu on the same row. In the project file these are still separate parameters: `color`, `fillColor`, `ramp`, `radiusUnits` and so on.

### Driven Parameters

A parameter can take its value from somewhere other than its editor:

- **Wired**: a number output, such as an Extent's `max`, wired into the parameter's port. The row shows the output it reads.
- **Expression**: the row shows the expression and its current value. See [Expressions](./expressions.md).
- **Reference**: the row shows a chip naming the parameter it follows. Click the chip to go to that node, or click × to break the reference and keep the value.

To make a node that drives a number, right-click its row and choose **Drive with** > Number, Time, Math or Expression. The new node is placed beside this one and wired in. Number, Math and Expression start from the current value, so nothing jumps; Time follows the playhead in seconds, so the value changes to the current time. On the deck's map style, **Drive with** makes a Map Style node.

### Linking Parameters by Dragging

A parameter that can follow another has two **ports**: an input at the left of its row and an output at the right. A node with number outputs, such as an Extent's `min` and `max`, lists them under **Outputs**. A port is hollow until it is connected. Rest the pointer on a port to see what it is connected to, and click an entry to go there.

- **Output onto a parameter**: drag an output port onto another parameter's row, and that parameter reads it. Rows that can take the link light up while you drag; a color only links to a color, a number to a number.
- **Input onto an output**: drag a parameter's input port onto another row or an output to make the parameter read it.
- **Port onto a node**: drop a port on a node in the Layers list and pick one of that node's parameters or outputs. Or rest on the node for a moment: Properties switches to it, so you can drop on the exact row.
- **Node onto a parameter**: drag a node from the Layers list onto a parameter's row and pick which of the node's parameters or outputs it reads.

Press Escape to cancel a drag. A link between two parameters is a reference (a chip, broken with ×); a link from an output is a wire, the same one the node graph draws. `Cmd/Ctrl+Z` undoes either. Links that would loop back on themselves are refused.

### Keyframes

The **diamond** (◇) next to a number parameter adds a keyframe at the playhead; click it again on a keyframe to remove it. A filled diamond marks a keyframe at the playhead.

<img src="/img/properties-panel-keyframe.png" alt="Width scale has a keyframe at the playhead; the other parameters have none" width="388" />

See [Animation and Rendering](./animation-and-rendering.md) for the timeline.

## Right-Click Context Menu

Right-click a parameter row for its menu. Items that don't apply are disabled or left out.

<img src="/img/properties-panel-context-menu.png" alt="The menu for Width scale, opened by right-clicking its row" width="412" />

| Action | Description |
|--------|-------------|
| **Drive with** | Add a node wired into this parameter: Number, Time, Math or Expression for a number, Map Style for the deck's map style |
| **Disconnect input** | Remove the wire into this parameter and keep its current value |
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

With **Editor > Show editor debug info** on in the logo menu, the panel also shows what the engine made of the node: its query, how its table is stored, and what a change to each parameter costs.

## Related

- [Introduction to Workflows](./workflows-intro.md): parameters and connections
- [Animation and Rendering](./animation-and-rendering.md): keyframes and the timeline
- [Essential Operators](./operators-guide.md): operators and their parameters
