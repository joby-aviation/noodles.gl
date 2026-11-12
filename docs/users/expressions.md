# Expressions

Noodles has two kinds of expression. A **row expression** computes a value for every row of a table: a position, a radius, a color. A **parameter expression** computes one number for a parameter from the time and other parameters, like expressions in Houdini and TouchDesigner or drivers in Blender.

## Row Expressions

Layer channels (Position, Color, Radius, Width...), Attribute Create, the inputs of Map Range and Color Ramp, and a Filter in Expression mode take a row expression over the input table's columns:

```
[lng, lat]                    a position from two columns
sqrt(pop) * 2.0               arithmetic and functions
ramp(fit(mag, 0, 8, 0, 1))    a color from the layer's color ramp
mag > 5 ? 2.0 : 1.0           a condition
coalesce(depth, 0)            a fallback for missing values
present(h3, hex, 'none')      the first of these columns the rows have
hex_color(color)              a "#rrggbb" text column as a color
```

- The input suggests the table's columns as you type, and the functions once you type a letter. Column names are case-sensitive. A channel holding just a column name, such as `position` or `Cd`, reads that column.
- `[a, b]` makes a vector. A column with 2 to 4 numbers per row (`coordinates: [lng, lat]` in JSON) is a vector too. Read one item by index (`coordinates[1]`) or by component name (`coordinates.y`; `x y z w` and `r g b a` both work). A vector column, such as a Color Ramp's output, reads the same way wherever it goes.
- Tables store a vector as numbered columns (`magnitude_color_0`, `_1`, `_2`). The Spreadsheet shows them under the vector's name, and a Code node's `d` has it as one array (`d[i].magnitude_color`).
- Operators: `+ - * / %`, comparisons (`== != < <= > >=`), `&&`, `||`, `!` and `test ? a : b`.
- `ch('node/param')` reads a parameter's value: `mag * ch('size/value')`.
- Colors are `[r, g, b]` from 0 to 1 in expressions. Constant color parameters, such as a layer's Fill color, are 0 to 255.

A value several layers share belongs in an **Attribute Create** node (`attribute`): it writes one column, and the layers after it name that column.

### Functions

| Kind | Functions |
|------|-----------|
| Math | `sqrt`, `abs`, `sign`, `floor`, `ceil`, `round`, `fract`, `exp`, `ln`, `log10`, `log2`, `pow`, `sin`, `cos`, `tan`, `asin`, `atan`, `atan2`, `min`, `max`, `clamp`, `fit(x, inMin, inMax, outMin, outMax)`, `lerp(a, b, t)`, `smoothstep`, `radians`, `degrees` |
| Vectors | `length`, `normalize`, `dot`, `cross` |
| Values | `coalesce(a, b)` (`a` unless it is missing), `present(a, b, ...)` (the arguments that are columns the rows have, then `coalesce` of them: for files that name one column differently, such as `h3` and `hex`), `to_number` (text as a number), `category(value, n)` (a bucket from 0 to n - 1, always the same one for the same value), `random()` (0 to 1 per row) |
| Color | `ramp(t)` (the layer's Color ramp at `t` from 0 to 1), `hex_color(text)` |
| Dates | Times are epoch seconds. `epoch(t)` (a timestamp, date or ISO text as seconds), `date_add(t, n, 'days')`, `date_diff(a, b, 'hours')`, `date_part(t, 'month')`, `date_format(t, 'YYYY-MM-DD')`. Units: `years`, `months`, `weeks`, `days`, `hours`, `minutes`, `seconds`, `milliseconds` |
| Geographic | Points are `[lng, lat]`. `distance(a, b)` in kilometers, `bearing(a, b)`, `destination(p, km, degrees)`, `midpoint(a, b)`; `st_distance`, `st_dwithin` and `st_contains` against a WKT or GeoJSON literal |
| Layer channels only | `colmin(col)` and `colmax(col)`: a column's smallest and largest value over the layer's rows, so `ramp(fit(mag, colmin(mag), colmax(mag), 0, 1))` spreads the ramp over the data |

### JS Function

For logic the expression language has no words for, a **JS Function** node (`js-function`) defines a function any expression can call by name. Set its **Name**, **Parameters** (comma-separated; `name: text` for a text parameter), **Returns** (1 number, or an array of 2 to 4) and **Body**:

```javascript
// Name: jitter, Parameters: x
return x + (Math.random() - 0.5) * 0.01
```

A layer's Position can then be `[jitter(lng), jitter(lat)]`. The body runs in the engine worker with `d3`, `turf` and `utils` in scope. DuckDB runs it about 20 times slower than SQL, so prefer an expression where one will do.

## Parameter Expressions

Right-click a number parameter in the parameter pane and choose **Set expression...**. The parameter then shows the expression and its current value. **Revert to value** goes back to a plain number.

| Name | Value |
|------|-------|
| `T` | Seconds on the timeline |
| `F` | The frame number |
| `MX`, `MY` | The pointer over the map, in pixels from its top left |
| `ch('node/param')` | Another parameter's value, by path (`ch('../controls/size')` reaches up out of a subnet) |

The math functions work here too:

```
4 + 2 * sin(T)
ch('threshold/value') * 2
```

An expression updates when the playhead or the pointer moves, or when a parameter it reads changes. Any other name is an error on the node.

## References

To make a parameter follow another one, right-click it and choose **Reference a parameter...**, or click the link button next to it, and pick a parameter of the same kind on another node. A referenced parameter shows a chip naming its source: click the chip to go to that node, or × to break the reference and keep the current value. **Copy parameter** and **Paste relative reference** in the same menu do it by copy and paste.

References work for numbers, colors, toggles and text; several layers can share one color from a **Color** node this way. Every reference and `ch()` call draws a dashed edge on the canvas.

## In SQL

A `sql` node's query reads parameters with `ch()` as well, so a slider can drive a `WHERE` clause:

```sql
SELECT * FROM {{input0}} WHERE pop > ch('threshold/value')
```

## In Project Files

Expressions and references are saved in a node's `params`:

```json
{ "radiusScale": { "expr": "4 + 2 * sin(T)" },
  "fillColor": { "ref": "accent/color" },
  "position": "[lng, lat]" }
```

A row expression is a plain string, since it is the parameter's value.
