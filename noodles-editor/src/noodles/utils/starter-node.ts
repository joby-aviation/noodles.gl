// Picks the node an example selects when it first opens, so the properties panel shows
// controls instead of "Select a node or edge to inspect it".

import { getParentPath } from './path-utils'

type StarterNode = { id: string; type?: string }
type StarterEdge = { source: string; target: string; targetHandle?: string | null }

export type StarterNodeProject = {
  nodes: StarterNode[]
  edges: StarterEdge[]
  editorSettings?: { startNode?: string }
}

const RENDERER_TYPE = 'DeckRendererOp'
const LAYERS_HANDLE = 'par.layers'
// How far upstream of the renderer's layers input to look through non-layer
// operators (Switch, Concat and the like) for a layer
const MAX_UPSTREAM_DEPTH = 4

const isRootNode = (id: string) => (getParentPath(id) ?? '/') === '/'

// Returns the id of the node to select, or null for no selection.
// An example can name its own with `editorSettings.startNode`. Otherwise this is the first
// layer feeding the root DeckRenderer's `layers` input, in edge order, looking upstream
// through operators that pass layers along. Only root-level nodes qualify, since the graph
// opens at the root.
export function findStarterNodeId(
  project: StarterNodeProject,
  isLayerType: (type: string) => boolean
): string | null {
  const nodesById = new Map(project.nodes.map(node => [node.id, node]))

  const override = project.editorSettings?.startNode
  if (override && nodesById.has(override) && isRootNode(override)) return override

  const renderer = project.nodes.find(node => node.type === RENDERER_TYPE && isRootNode(node.id))
  if (!renderer) return null

  const incoming = new Map<string, string[]>()
  for (const edge of project.edges) {
    const sources = incoming.get(edge.target) ?? []
    sources.push(edge.source)
    incoming.set(edge.target, sources)
  }

  // Breadth-first from the layers input, so a layer wired straight in wins over one
  // reached through a Switch, and edge order breaks ties
  let frontier = project.edges
    .filter(edge => edge.target === renderer.id && edge.targetHandle === LAYERS_HANDLE)
    .map(edge => edge.source)
  const visited = new Set<string>([renderer.id])
  for (let depth = 0; depth < MAX_UPSTREAM_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      if (visited.has(id)) continue
      visited.add(id)
      const node = nodesById.get(id)
      if (!node) continue
      if (node.type && isLayerType(node.type) && isRootNode(id)) return id
      next.push(...(incoming.get(id) ?? []))
    }
    frontier = next
  }
  return null
}

// Examples already given a starter selection in this page session. A later load of the
// same example (navigating back to it, an undo restore) keeps whatever the user chose.
const claimedExamples = new Set<string>()

export type StarterSelectionContext = {
  exampleId: string
  // The project came from the bundled example file, not a copy the user may have edited
  fromBundledExample: boolean
  // ?externalControl=true or agent bench mode: an agent drives the editor
  agentControlled: boolean
}

// Returns true the first time an example qualifies for a starter selection, false after
export function claimStarterSelection({
  exampleId,
  fromBundledExample,
  agentControlled,
}: StarterSelectionContext): boolean {
  if (!fromBundledExample || agentControlled) return false
  if (claimedExamples.has(exampleId)) return false
  claimedExamples.add(exampleId)
  return true
}

export function resetStarterSelectionForTests() {
  claimedExamples.clear()
}

type Rect = { x: number; y: number; width: number; height: number }
type Viewport = { x: number; y: number; zoom: number }

// Pans (never zooms) so a node, in flow coordinates, is on screen. Returns null when it
// already is, so a view the graph already fit is left alone. Only an axis the node
// overflows moves: it centers the node, or lines up its top-left corner (where the
// title is) when the node is larger than the pane.
export function panViewportToShow(
  node: Rect,
  viewport: Viewport,
  pane: { width: number; height: number },
  padding = 24
): Viewport | null {
  const { zoom } = viewport
  const axis = (offset: number, start: number, size: number, paneSize: number) => {
    const screenStart = start * zoom + offset
    const screenSize = size * zoom
    if (screenStart >= 0 && screenStart + screenSize <= paneSize) return offset
    const target = screenSize + 2 * padding <= paneSize ? (paneSize - screenSize) / 2 : padding
    return offset + target - screenStart
  }
  const x = axis(viewport.x, node.x, node.width, pane.width)
  const y = axis(viewport.y, node.y, node.height, pane.height)
  return x === viewport.x && y === viewport.y ? null : { x, y, zoom }
}
