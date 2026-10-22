/**
 * Layer outputs: the render node generalized to deck.gl's layer catalog.
 *
 * A `render` node binds four channels because the WebGPU pass draws exactly one mark. A layer
 * node binds whatever its kind needs — an arc has two positions, a trip has a timestamp per
 * vertex, a label has a string — so its channels are a table per kind rather than fields on a
 * type. That table is the one place the planner learns what a layer reads: `analyze` resolves
 * every binding against it once, and emit, the optimizer and the runtimes read the resolved
 * list instead of re-deriving it.
 *
 * Rows are always instances. For `path` and `trips`, an instance is one *vertex*: the rows are
 * ordered by `(pathId, orderBy)` and the runtime run-length encodes `pathId` into deck's
 * `startIndices`. That keeps paths inside the row model — no list types reach the planner, and
 * a per-vertex attribute (a color ramp over altitude, say) is an ordinary attribute node.
 *
 * `polygon` is a vertex layer too, with one more grouping: `pathId` names the polygon and
 * `ringId` splits its vertices into rings, the first the outer boundary and the rest holes. It
 * is CesiumJS's `BufferPolygonCollection` layout in the row model: each polygon is an offset
 * and count into one shared vertex array, holes are the vertex index where each inner ring
 * starts, and the triangulation is supplied by the caller (earcut, in the program runtime)
 * rather than computed by the renderer.
 */

export type LayerKind =
  | 'scatter' | 'arc' | 'path' | 'trips' | 'column' | 'text' | 'polygon'
  /** Aggregation layers: deck bins positions on the GPU or CPU, weighted per row. */
  | 'heatmap' | 'hexagon' | 'grid';

export const LAYER_KINDS: readonly LayerKind[] = [
  'scatter', 'arc', 'path', 'trips', 'column', 'text', 'polygon', 'heatmap', 'hexagon', 'grid',
];

/**
 * What a channel holds. `vec` accepts a 2- or 3-component position; `color` a 3- or 4-
 * component 0..1 color; `num` a scalar; `str` a string column, which only SQL can produce.
 */
export type ChannelType = 'vec' | 'color' | 'num' | 'str';

export interface ChannelSpec {
  name: string;
  type: ChannelType;
  required?: boolean;
  /** Attribute bound when the layer does not name one, if it exists after the graph ran. */
  fallback?: 'position' | 'color' | 'size' | 'opacity';
}

export interface LayerKindSpec {
  channels: ChannelSpec[];
  /** Vertex layers: rows are ordered and grouped into paths by `pathId`. */
  vertices?: boolean;
  /** Vertex groups are further split into rings by `ringId`: polygons with holes. */
  rings?: boolean;
}

export const LAYER_SPECS: Record<LayerKind, LayerKindSpec> = {
  scatter: {
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'color', type: 'color', fallback: 'color' },
      { name: 'radius', type: 'num', fallback: 'size' },
    ],
  },
  arc: {
    channels: [
      { name: 'sourcePosition', type: 'vec', required: true },
      { name: 'targetPosition', type: 'vec', required: true },
      { name: 'sourceColor', type: 'color' },
      { name: 'targetColor', type: 'color' },
      { name: 'width', type: 'num' },
    ],
  },
  path: {
    vertices: true,
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'color', type: 'color', fallback: 'color' },
      { name: 'width', type: 'num' },
    ],
  },
  trips: {
    vertices: true,
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'timestamp', type: 'num', required: true },
      { name: 'color', type: 'color', fallback: 'color' },
    ],
  },
  column: {
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'elevation', type: 'num' },
      { name: 'color', type: 'color', fallback: 'color' },
    ],
  },
  text: {
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'text', type: 'str', required: true },
      { name: 'color', type: 'color', fallback: 'color' },
      { name: 'size', type: 'num' },
    ],
  },
  polygon: {
    vertices: true,
    rings: true,
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'color', type: 'color', fallback: 'color' },
      { name: 'lineColor', type: 'color' },
      { name: 'elevation', type: 'num' },
    ],
  },
  heatmap: {
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'weight', type: 'num' },
    ],
  },
  hexagon: {
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'colorWeight', type: 'num' },
      { name: 'elevationWeight', type: 'num' },
    ],
  },
  grid: {
    channels: [
      { name: 'position', type: 'vec', required: true, fallback: 'position' },
      { name: 'colorWeight', type: 'num' },
      { name: 'elevationWeight', type: 'num' },
    ],
  },
};

/**
 * A layer prop value. Props are deck layer properties — `currentTime`, `opacity`,
 * `radiusScale` — that deck applies as uniforms, so changing one costs no query, no CPU pass
 * and no upload. A string of the form `{{name}}` reads a graph parameter, alone or as an array
 * element (a color is three); that is how a timeline or a slider drives a prop, and why such a
 * parameter routes as `prop`.
 */
export type LayerPropValue = number | string | boolean | (number | string)[];

/** The parameter a prop reads, if it is a `{{name}}` reference. */
export function propParam(value: LayerPropValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(value);
  return m?.[1];
}

/** Every parameter a prop reads, including array elements. */
export function propParams(value: LayerPropValue): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.map((v) => propParam(v)).filter((p): p is string => p !== undefined);
}

export type ResolvedProp = number | string | boolean | (number | string)[];

/** Resolve a layer's props against current parameter values. */
export function resolveProps(
  props: Record<string, LayerPropValue> | undefined,
  params: Record<string, number | string>,
): Record<string, ResolvedProp> {
  const one = (v: number | string | boolean) => {
    const p = typeof v === 'string' ? propParam(v) : undefined;
    return p !== undefined ? (params[p] ?? 0) : v;
  };
  const out: Record<string, ResolvedProp> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    out[key] = Array.isArray(value) ? value.map((v) => one(v) as number | string) : one(value);
  }
  return out;
}
