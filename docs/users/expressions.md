# Expressions

Noodles has two kinds of expression. A **row expression** computes a value for every row of a table: a position, a radius, a color. A **parameter expression** computes one number for a parameter from the time and other parameters, like expressions in Houdini and TouchDesigner or drivers in Blender. Neither needs a separate node for simple math.

## Row Expressions

Layer channels (Position, Color, Radius, Width...), Attribute Create, the inputs of Map Range and Color Ramp, and a Filter in Expression mode all take a row expression over the input table's columns:

```
[lng, lat]                    a position from two columns
sqrt(pop) * 2.0               arithmetic and functions
ramp(fit(mag, 0, 8, 0, 1))    a color from the layer's color ramp
mag > 5 ? 2.0 : 1.0           a condition
coalesce(depth, 0)            a fallback for missing values
hex_color(color)              a "#rrggbb" text column as a color
```

- Names are column names exactly as the table has them; case matters. A channel holding just a column name, such as `position` or `Cd`, reads that column.
- `[a, b]` makes a vector. A column with 2 to 4 numbers per row (`coordinates: [lng, lat]` in JSON) is a vector too: read one item with `coordinates[1]` or `coordinates.y`.
- Operators: `+ - * / %`, comparisons, `&&`, `||`, `!` and `test ? a : b`.
- Functions include `sqrt`, `abs`, `floor`, `ceil`, `round`, `exp`, `ln`, `log10`, `pow`, `sin`, `cos`, `atan2`, `min`, `max`, `clamp`, `fit(x, inMin, inMax, outMin, outMax)`, `lerp(a, b, t)`, `smoothstep`, `ramp(t)`, `coalesce`, `to_number` (text as a number), `category(value, n)` (a bucket from 0 to n - 1 per distinct value) and `random()`.
- In a layer's channels, `colmin(col)` and `colmax(col)` are a column's smallest and largest value over the layer's rows, so `ramp(fit(mag, colmin(mag), colmax(mag), 0, 1))` spreads the ramp over the data. They are computed once in SQL and reused until the rows change.
- Geographic functions take `[lng, lat]` points: `distance(a, b)` in kilometers, `bearing(a, b)`, `destination(p, km, degrees)`, `midpoint(a, b)`, and `st_distance`, `st_dwithin` and `st_contains` against a WKT or GeoJSON literal.
- `ch('node/param')` reads a parameter's value, as in a parameter expression below: `mag * ch('size/value')`.
- Colors are `[r, g, b]` from 0 to 1 in expressions. Constant color parameters, such as a layer's Fill color, are 0 to 255.

A value several layers share belongs in an **Attribute Create** node (`attribute`): it writes one column, and the layers after it name that column.

### JS Function

For logic the expression language has no words for, a **JS Function** node (`js-function`) defines a function that any expression can call by name. Set its **Name**, **Parameters** (comma-separated; `name: text` for a text parameter), **Returns** (1 number, or an array of 2 to 4) and **Body**:

```javascript
// Name: jitter, Parameters: x
return x + (Math.random() - 0.5) * 0.01
```

A layer's Position can then be `[jitter(lng), jitter(lat)]`. The body runs in the engine worker with `d3`, `turf` and `utils` in scope. DuckDB runs it about 20 times slower than SQL, so prefer an expression where one will do.

## Parameter Expressions

Right-click a number parameter in the parameter pane and choose **Set expression...**. The parameter then shows the expression and its current value. Choose **Revert to value** to go back to a plain number.

| Name | Value |
|------|-------|
| `T` | Seconds on the timeline |
| `F` | The frame number |
| `MX`, `MY` | The pointer over the map, in pixels from its top left |
| `ch('node/param')` | Another parameter's value, by path (`ch('../controls/size')` reaches up out of a subnet) |

The math functions above work here too:

```
4 + 2 * sin(T)
ch('threshold/value') * 2
```

An expression updates when the playhead or the pointer moves, or when a parameter it reads changes. A name other than `T`, `F`, `MX`, `MY` or a `ch()` reference is an error on the node.

## References

To make a parameter follow another one, right-click it and choose **Reference a parameter...**, or click the link button next to it, and pick a parameter of the same kind on another node. A referenced parameter shows a chip naming its source: click the chip to go to that node, or click × to break the reference and keep the current value. **Copy parameter** and **Paste relative reference** do the same from the context menu.

References work for numbers, colors, toggles and text. They are how several layers share one color from a **Color** node. Every reference and `ch()` call draws a dashed edge on the canvas, and a parameter that others read lists them under "used by".

## In SQL

A `sql` node's query can read parameters with `ch()` as well, so a slider can drive a `WHERE` clause:

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
