# Updating an existing visualization: change color, size, radius, opacity

Read this to change the color, size, radius, width, height, opacity, or visibility of an existing layer — making circles, points, or lines bigger, smaller, brighter, or a different colour — or to edit any property of a node already in the graph.

The recurring mistake is editing the wrong node. A layer property can come from either a direct input on the layer *or* an edge from an upstream node, and only `get_node_info` tells you which.

1. `list_nodes` to find the target.
2. `get_node_info` on it — this reports its inputs **and** its incoming edges.
3. If the property arrives over an edge, edit the **source** node. If it does not, edit the layer's input directly.
4. `apply_modifications` with that node.

Changes apply immediately; the visualization updates in real time.

## Inputs versus edges

Every node owns its own inputs. Nodes are wired together by edges that link one node's output to another's input.

Take `ColorOp → ScatterplotLayerOp`:

- `ColorOp` has the input `color: "#ff0000"` — **this is what you change**.
- `ColorOp` exposes `out.color`.
- The edge is `ColorOp.out.color → ScatterplotLayerOp.par.getFillColor`.
- `ScatterplotLayerOp` has no color of its own to edit; it receives one over the edge.

So "make the points blue" means setting `ColorOp.color`, not `ScatterplotLayerOp.getFillColor`. Writing `getFillColor` on the layer while an edge feeds it does nothing visible — the edge wins.

If no edge feeds `getFillColor`, then setting it on the layer is exactly right.

## Which properties tend to be edge-driven

- **Usually edges**: everything named `get*` — `getPosition`, `getFillColor`, `getRadius`, `getWeight`, `getPath`, `getSourcePosition`, `getTargetPosition`. These are per-row accessors, normally supplied by an `AccessorOp`, `ColorOp`, `ColorRampOp`, or `NumberOp`.
- **Usually direct inputs**: `opacity`, `visible`, `radiusScale`, `lineWidthScale`, `pickable`, `stroked`, `filled`.

That is a tendency, not a rule. Check with `get_node_info` before editing.

## Adding nodes to an existing graph

A new node changes nothing until it is wired in. When you add one, add its edges in the same `apply_modifications` call: the data into it, its accessors, and its output onward to the layer or `DeckRendererOp`. Leave no dangling node — an incomplete graph fails silently rather than erroring.
