# Vector Input Ports

Point and vector inputs (Point2D, Point3D, Vec2 and Vec3) can take one connection for the whole value, or one number connection per component. Outputs always have one port.

## Choose a Port Layout

The button at the right of a vector input switches between:

- **Whole value**: one port for the point or vector. Connect a Geocoder location, a GeoJSON Point or another vector straight to it.
- **Component ports**: one number port per component, such as `lng` and `lat`, or `x`, `y` and `z`. Use this when the components come from different nodes.

Only one layout is active at a time. The button is disabled while the input is connected or has an expression; disconnect it and clear its expressions first, so changing layouts never drops a connection.

With component ports, a connected component follows its edge and the others stay editable. Each component can hold its own [expression](./expressions.md) and be keyframed on its own.

## MapViewState Center

MapViewState takes its camera position as one Point2D input, `center`, next to zoom, pitch and bearing. A new node uses the whole-value port, so a Geocoder or GeoJSON Point can connect to `center` directly. Switch to component ports to wire longitude and latitude separately.

Projects saved before this change open with their longitude and latitude connections on `center.lng` and `center.lat`, with expressions and keyframes kept. Expressions that read `op('/camera').par.longitude` or `{{/camera.par.longitude}}` still work. New edges must use `par.center.lng` and `par.center.lat`.

## Related

- [Essential Operators](./operators-guide.md)
- [Properties Panel](./properties-panel.md)
- [Expressions](./expressions.md)
