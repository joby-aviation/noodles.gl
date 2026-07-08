# Field Expressions

Drive any input field with a live JavaScript expression — like expressions in TouchDesigner and Houdini, or Drivers in Blender. Expressions let you build reactive relationships between operators without adding Expression or Accessor nodes for simple math.

## Enabling Expression Mode

Hover over any input field and click the **ƒx** button that appears on the right side of the row. The field switches to expression mode, pre-filled with its current value, and turns violet to show it's driven.

Click **ƒx** again to remove the expression. The field keeps its last evaluated value.

## Writing Expressions

Click a driven field to open the expression editor (with autocomplete). Any JavaScript expression works:

```javascript
// Simple math
40 + 2

// Reference another operator's output
op('/time').out.seconds * 2

// Mustache shorthand for the same thing
{{/time.out.seconds}} * 2

// Reference a sibling parameter on the same operator
par.radius * 0.5

// Timeline-driven animation
Math.sin(sequenceTime * Math.PI) * 100

// Use bundled libraries
d3.mean(op('/data-source').out.data.map(d => d.value))
```

Press **Enter** to confirm, **Escape** to cancel, **Tab** to accept an autocomplete suggestion.

## Available Context

| Name | Description |
|------|-------------|
| `op('/path')` | Reference another operator (absolute, `./sibling`, or `../parent` paths) |
| `par` | The current operator's own parameter values |
| `me` | The current operator instance |
| `sequenceTime`, `frame`, `totalFrames`, `sequence` | Timeline state |
| `utils`, `d3`, `turf`, `deck`, `Plot`, `Temporal` | Bundled libraries |

## Reactivity

Driven fields re-evaluate automatically when their dependencies change:

- **Operator references** (`op()` or `{{...}}`) create dashed reference edges on the canvas — the same dependency wires Code fields use. When the referenced value changes, the expression re-runs.
- **Sibling references** (`par.x`) re-evaluate when the sibling parameter changes.
- **Timeline references** (`sequenceTime`, `frame`) re-evaluate as the playhead moves.

## Type Safety and Errors

Expression results are validated against the field's schema. If an expression returns the wrong type (say, a string into a number field), the field keeps its last good value and shows a ⚠ indicator with the error. Syntax errors and unknown operator paths are reported the same way — the graph keeps running with the previous value.

## Serialization

Expressions are saved with the project as `{ "$expr": "..." }` payloads in the field's slot, and they round-trip through undo/redo and copy/paste.
