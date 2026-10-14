# Vector Input Ports

Point and vector inputs can be connected as one complete value or as separate numeric components. This keeps the graph compact when values already belong together while still allowing precise control over individual coordinates.

Supported inputs are Point2D, Point3D, Vec2, and Vec3. Outputs are unchanged.

## Choose a Port Layout

Use the layout button at the right of a vector field to switch between:

- **Whole value** — one port for the complete point or vector. Use this to connect a Geocoder location, a GeoJSON Point, or another compatible vector directly.
- **Components** — one port per numeric component, such as `lng` and `lat` or `x`, `y`, and `z`. Use this when coordinates come from different nodes.

Both layouts represent the same input. They are never active at the same time, so there is no connection-priority rule to remember. The example below connects a Geocoder Point in whole-value mode and a Number to `lng` in component mode.

![A Geocoder Point connected to a whole-value MapViewState center and a Number connected to its longitude component](/img/map-view-state-port-modes.png)

## Connections and Editing

Disconnect the whole input and all of its components before changing layouts. While a connection exists, the layout button is disabled and its tooltip explains what to disconnect.

In component mode, connected components are driven by their edges while unconnected components remain editable. Point Lookup remains available in either layout.

Keyframe diamonds appear in the Properties Panel sidebar, not on graph nodes. An unconnected component can still be edited and animated from the sidebar when another component is connected.

## MapViewState Center

MapViewState uses a Point2D `center` input while keeping zoom, pitch, and bearing independent. New nodes start in whole-value mode, so a Geocoder or GeoJSON Point can connect directly to `center`. Switch to component mode when separate longitude and latitude wiring is more useful.

Existing projects are migrated automatically and retain their longitude/latitude presentation and animation data.

## Related

- [Essential Operators](./operators-guide.md)
- [Properties Panel](./properties-panel.md)
- [Animation and Rendering](./animation-and-rendering.md)
