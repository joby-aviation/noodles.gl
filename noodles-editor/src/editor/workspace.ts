// The editor's window layout, as Blender's screen areas: a tree of splits whose leaves are
// areas, each showing one editor. Every editor but `empty` appears at most once, because the
// map's WebGL canvas and the graph's React Flow instance must never be duplicated or
// remounted; choosing an editor that is already open elsewhere swaps the two areas.
//
// Workspaces are named layouts, like Blender's workspace tabs. Each keeps its own tree, so
// rearranging Animation leaves Layout as it was. Everything here is pure; the store that
// persists it is workspace-store.ts.

export type EditorType =
  | 'map'
  | 'graph'
  | 'layers'
  | 'properties'
  | 'timeline'
  | 'spreadsheet'
  | 'empty'

export const EDITORS: { type: Exclude<EditorType, 'empty'>; label: string; icon: string }[] = [
  { type: 'map', label: 'Map', icon: 'pi-map' },
  { type: 'graph', label: 'Node Graph', icon: 'pi-sitemap' },
  { type: 'layers', label: 'Layers', icon: 'pi-clone' },
  { type: 'properties', label: 'Properties', icon: 'pi-sliders-h' },
  { type: 'timeline', label: 'Timeline', icon: 'pi-clock' },
  { type: 'spreadsheet', label: 'Spreadsheet', icon: 'pi-table' },
]

const EDITOR_TYPES = new Set<string>([...EDITORS.map(e => e.type), 'empty'])

export interface AreaNode {
  type: 'area'
  id: string
  editor: EditorType
}

export interface SplitNode {
  type: 'split'
  id: string
  // `horizontal` lays children side by side, as react-resizable-panels' Group does
  orientation: 'horizontal' | 'vertical'
  children: LayoutNode[]
  // Percent of the split each child takes, by child id
  sizes?: Record<string, number>
}

export type LayoutNode = AreaNode | SplitNode

export type WorkspaceId = 'layout' | 'animation' | 'nodes'

export const WORKSPACES: { id: WorkspaceId; label: string }[] = [
  { id: 'layout', label: 'Layout' },
  { id: 'animation', label: 'Animation' },
  { id: 'nodes', label: 'Nodes' },
]

let nextId = 0
export const newId = (prefix = 'a') =>
  `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`

const area = (id: string, editor: EditorType): AreaNode => ({ type: 'area', id, editor })

function split(
  id: string,
  orientation: SplitNode['orientation'],
  children: [LayoutNode, number][]
): SplitNode {
  return {
    type: 'split',
    id,
    orientation,
    children: children.map(([c]) => c),
    sizes: Object.fromEntries(children.map(([c, size]) => [c.id, size])),
  }
}

// Layers and properties stacked on the left, as Cavalry's scene tree over its attribute editor
const leftColumn = () =>
  split('left', 'vertical', [
    [area('layers', 'layers'), 45],
    [area('properties', 'properties'), 55],
  ])

export const PRESETS: Record<WorkspaceId, () => LayoutNode> = {
  // The map, with the timeline under it; no graph
  layout: () =>
    split('root', 'horizontal', [
      [leftColumn(), 22],
      [
        split('main', 'vertical', [
          [area('map', 'map'), 75],
          [area('timeline', 'timeline'), 25],
        ]),
        78,
      ],
    ]),
  // A full-width timeline under everything
  animation: () =>
    split('root', 'vertical', [
      [
        split('top', 'horizontal', [
          [leftColumn(), 22],
          [area('map', 'map'), 78],
        ]),
        62,
      ],
      [area('timeline', 'timeline'), 38],
    ]),
  // The map over the node graph and the timeline, for building and debugging the dataflow
  nodes: () =>
    split('root', 'horizontal', [
      [leftColumn(), 22],
      [
        split('main', 'vertical', [
          [area('map', 'map'), 40],
          [area('graph', 'graph'), 42],
          [area('timeline', 'timeline'), 18],
        ]),
        78,
      ],
    ]),
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function areas(node: LayoutNode): AreaNode[] {
  return node.type === 'area' ? [node] : node.children.flatMap(areas)
}

export function findEditor(tree: LayoutNode, editor: EditorType): AreaNode | undefined {
  return areas(tree).find(a => a.editor === editor)
}

export const hasEditor = (tree: LayoutNode, editor: EditorType) =>
  findEditor(tree, editor) !== undefined

export function parentOf(tree: LayoutNode, id: string): SplitNode | undefined {
  if (tree.type === 'area') return undefined
  if (tree.children.some(c => c.id === id)) return tree
  for (const c of tree.children) {
    const p = parentOf(c, id)
    if (p) return p
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Edits. Each returns a new tree and leaves its argument alone.
// ---------------------------------------------------------------------------

function mapNode(tree: LayoutNode, id: string, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (tree.id === id) return fn(tree)
  if (tree.type === 'area') return tree
  return { ...tree, children: tree.children.map(c => mapNode(c, id, fn)) }
}

// Show `editor` in an area. If another area already shows it, that area takes this one's
// editor instead, so nothing closes.
export function setEditor(tree: LayoutNode, areaId: string, editor: EditorType): LayoutNode {
  const target = areas(tree).find(a => a.id === areaId)
  if (!target || target.editor === editor) return tree
  const other = editor === 'empty' ? undefined : findEditor(tree, editor)
  const swapped = other ? mapNode(tree, other.id, n => ({ ...n, editor: target.editor })) : tree
  return mapNode(swapped, areaId, n => ({ ...n, editor }))
}

// Split an area in two along `orientation`; the new area shows `editor` and goes after the
// old one (right or below), or before it.
export function splitArea(
  tree: LayoutNode,
  areaId: string,
  orientation: SplitNode['orientation'],
  editor: EditorType = 'empty',
  side: 'before' | 'after' = 'after',
  share = 50
): LayoutNode {
  const target = areas(tree).find(a => a.id === areaId)
  if (!target) return tree
  // An editor already open elsewhere stays there; the new area starts empty
  const added = area(newId(), hasEditor(tree, editor) ? 'empty' : editor)
  const parent = parentOf(tree, areaId)

  // A sibling in a split that already runs this way: the old area gives up `share` of its size
  if (parent && parent.orientation === orientation) {
    return mapNode(tree, parent.id, n => {
      const p = n as SplitNode
      const i = p.children.findIndex(c => c.id === areaId)
      const children = [...p.children]
      children.splice(side === 'after' ? i + 1 : i, 0, added)
      const old = p.sizes?.[areaId] ?? 100 / p.children.length
      const sizes = {
        ...p.sizes,
        [areaId]: old * (1 - share / 100),
        [added.id]: old * (share / 100),
      }
      return { ...p, children, sizes }
    })
  }

  // Otherwise the area becomes a split of itself and the new area, taking the area's place
  const wrapped: SplitNode = {
    type: 'split',
    id: newId('s'),
    orientation,
    children: side === 'after' ? [target, added] : [added, target],
    sizes: { [target.id]: 100 - share, [added.id]: share },
  }
  if (!parent) return wrapped
  return mapNode(tree, parent.id, n => {
    const p = n as SplitNode
    const sizes = p.sizes ? renameKey(p.sizes, areaId, wrapped.id) : undefined
    return { ...p, children: p.children.map(c => (c.id === areaId ? wrapped : c)), sizes }
  })
}

function renameKey(sizes: Record<string, number>, from: string, to: string) {
  return Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k === from ? to : k, v]))
}

// Close an area; its neighbors take its space. The last area never closes.
export function closeArea(tree: LayoutNode, areaId: string): LayoutNode {
  if (tree.type === 'area') return tree
  return collapse(removeNode(tree, areaId))
}

function removeNode(node: SplitNode, id: string): SplitNode {
  const children = node.children
    .filter(c => c.id !== id)
    .map(c => (c.type === 'split' ? removeNode(c, id) : c))
  if (children.length === node.children.length) return { ...node, children }
  return { ...node, children, sizes: rescale(node.sizes, children) }
}

// Drop empty splits and unwrap splits left with one child
function collapse(node: LayoutNode): LayoutNode {
  if (node.type === 'area') return node
  let own = node.sizes
  const children: LayoutNode[] = []
  for (const c of node.children) {
    const tidy = collapse(c)
    if (tidy.type === 'split' && tidy.children.length === 0) continue
    // A split unwrapped to its one child hands that child its size
    if (tidy.id !== c.id && own) own = renameKey(own, c.id, tidy.id)
    children.push(tidy)
  }
  if (children.length === 1) return children[0]
  // A child split that runs the same way as its parent merges into it
  const flat: LayoutNode[] = []
  const sizes: Record<string, number> = {}
  const scaled = rescale(own, children)
  for (const c of children) {
    const share = scaled?.[c.id] ?? 100 / children.length
    if (c.type === 'split' && c.orientation === node.orientation) {
      const inner = rescale(c.sizes, c.children) ?? {}
      for (const g of c.children) {
        flat.push(g)
        sizes[g.id] = ((inner[g.id] ?? 100 / c.children.length) * share) / 100
      }
    } else {
      flat.push(c)
      sizes[c.id] = share
    }
  }
  return { ...node, children: flat, sizes }
}

// Sizes for `children` that sum to 100, keeping the proportions of the ones that had a size
function rescale(sizes: Record<string, number> | undefined, children: LayoutNode[]) {
  if (!sizes) return undefined
  const known = children.map(c => sizes[c.id] ?? 0)
  const total = known.reduce((a, b) => a + b, 0)
  if (total <= 0) return undefined
  // Sizes that already add up stay as they are, rather than picking up rounding error
  const scale = Math.abs(total - 100) < 1e-6 ? 1 : 100 / total
  return Object.fromEntries(children.map((c, i) => [c.id, known[i] * scale]))
}

export function setSizes(tree: LayoutNode, splitId: string, sizes: Record<string, number>) {
  return mapNode(tree, splitId, n => ({ ...n, sizes }))
}

// Where an editor opens when a menu asks for it and no area shows it: beside the editor it
// belongs with, else along an edge of the whole window
type Place = { orientation: SplitNode['orientation']; side: 'before' | 'after'; share: number }

const PLACEMENT: Record<
  Exclude<EditorType, 'empty'>,
  { near: EditorType[]; beside: Place; edge: Place }
> = {
  timeline: {
    near: ['map', 'graph'],
    beside: { orientation: 'vertical', side: 'after', share: 30 },
    edge: { orientation: 'vertical', side: 'after', share: 30 },
  },
  spreadsheet: {
    near: ['graph', 'map'],
    beside: { orientation: 'horizontal', side: 'after', share: 35 },
    edge: { orientation: 'horizontal', side: 'after', share: 35 },
  },
  graph: {
    near: ['map'],
    beside: { orientation: 'vertical', side: 'after', share: 50 },
    edge: { orientation: 'horizontal', side: 'after', share: 50 },
  },
  layers: {
    near: ['properties'],
    beside: { orientation: 'vertical', side: 'before', share: 45 },
    edge: { orientation: 'horizontal', side: 'before', share: 22 },
  },
  properties: {
    near: ['layers'],
    beside: { orientation: 'vertical', side: 'after', share: 55 },
    edge: { orientation: 'horizontal', side: 'before', share: 22 },
  },
  map: {
    near: ['graph', 'timeline'],
    beside: { orientation: 'vertical', side: 'before', share: 60 },
    edge: { orientation: 'horizontal', side: 'after', share: 75 },
  },
}

export function showEditor(tree: LayoutNode, editor: EditorType): LayoutNode {
  if (editor === 'empty' || hasEditor(tree, editor)) return tree
  const empty = findEditor(tree, 'empty')
  if (empty) return setEditor(tree, empty.id, editor)
  const { near, beside, edge } = PLACEMENT[editor]
  const anchor = near.map(e => findEditor(tree, e)).find(Boolean)
  if (anchor)
    return splitArea(tree, anchor.id, beside.orientation, editor, beside.side, beside.share)
  return addAtEdge(tree, area(newId(), editor), edge)
}

// Add an area along one edge of the whole window. A root split that already runs that way
// takes it as one more child; anything else is wrapped with it in a new split.
function addAtEdge(tree: LayoutNode, added: AreaNode, { orientation, side, share }: Place) {
  if (tree.type === 'split' && tree.orientation === orientation) {
    const scaled = rescale(tree.sizes, tree.children)
    const sizes = Object.fromEntries(
      tree.children.map(c => [
        c.id,
        ((scaled?.[c.id] ?? 100 / tree.children.length) * (100 - share)) / 100,
      ])
    )
    const children = side === 'after' ? [...tree.children, added] : [added, ...tree.children]
    return { ...tree, children, sizes: { ...sizes, [added.id]: share } }
  }
  return split(
    newId('s'),
    orientation,
    side === 'after'
      ? [
          [tree, 100 - share],
          [added, share],
        ]
      : [
          [added, share],
          [tree, 100 - share],
        ]
  )
}

export function hideEditor(tree: LayoutNode, editor: EditorType): LayoutNode {
  const a = findEditor(tree, editor)
  return a ? closeArea(tree, a.id) : tree
}

// ---------------------------------------------------------------------------
// Loading a saved tree
// ---------------------------------------------------------------------------

// A tree read back from storage: unknown editors and second copies of an editor become empty
// areas, malformed nodes are dropped, and splits are tidied. Undefined if nothing usable is left.
export function sanitize(value: unknown): LayoutNode | undefined {
  const seen = new Set<string>()
  const ids = new Set<string>()
  const walk = (v: unknown): LayoutNode | undefined => {
    if (!v || typeof v !== 'object') return undefined
    const n = v as Record<string, unknown>
    if (typeof n.id !== 'string' || ids.has(n.id)) return undefined
    ids.add(n.id)
    if (n.type === 'area') {
      let editor = typeof n.editor === 'string' && EDITOR_TYPES.has(n.editor) ? n.editor : 'empty'
      if (editor !== 'empty' && seen.has(editor)) editor = 'empty'
      seen.add(editor)
      return area(n.id, editor as EditorType)
    }
    if (n.type !== 'split' || !Array.isArray(n.children)) return undefined
    if (n.orientation !== 'horizontal' && n.orientation !== 'vertical') return undefined
    const children = n.children.map(walk).filter((c): c is LayoutNode => c !== undefined)
    const sizes =
      n.sizes && typeof n.sizes === 'object'
        ? Object.fromEntries(
            Object.entries(n.sizes as Record<string, unknown>).filter(
              ([, s]) => typeof s === 'number' && Number.isFinite(s) && s >= 0
            ) as [string, number][]
          )
        : undefined
    return { type: 'split', id: n.id, orientation: n.orientation, children, sizes }
  }
  const tree = walk(value)
  if (!tree) return undefined
  const tidy = collapse(tree)
  return tidy.type === 'split' && tidy.children.length === 0 ? undefined : tidy
}
