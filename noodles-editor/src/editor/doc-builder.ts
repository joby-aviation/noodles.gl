// What a tool adds to a document, built as plain nodes and edges: Import Data, Draw, Measure,
// Point and the GIS wizard all lay out nodes beside each other, wire them, and draw what they
// make in the document's deck (or a new one). Pure, so a tool's output is tested directly; the
// caller commits it in one edit.

import type { DocEdge, DocNode, EditorDoc, ParamValue } from '@noodles.gl/planner'
import { newId, uniqueName } from './doc-ops'

export interface Built {
  nodes: DocNode[]
  edges: DocEdge[]
  /** The node to select and frame: the one holding what the user asked for. */
  primaryNodeId: string
}

/** How features are drawn when a tool draws them: fill, outline and point colors, 0–255. */
export interface FeatureStyle {
  fill: number[]
  line: number[]
  /** Outline and line width, in pixels. */
  width?: number
  /** Point radius, in pixels. */
  radius?: number
}

export const SHAPE_STYLE: FeatureStyle = { fill: [59, 130, 246], line: [30, 64, 175] }

export class DocBuilder {
  readonly nodes: DocNode[] = []
  readonly edges: DocEdge[] = []
  private deckRef?: { id: string; isNew: boolean }
  private layerIndex?: number

  constructor(
    private readonly doc: EditorDoc,
    private readonly base: { x: number; y: number },
    private readonly parent?: string
  ) {}

  /** A node beside the base position, with a name unused in its network. */
  add(
    op: string,
    name: string,
    dx: number,
    dy: number,
    params: Record<string, ParamValue>
  ): string {
    const node: DocNode = {
      id: newId('n'),
      op,
      name: uniqueName(
        { ...this.doc, nodes: [...this.doc.nodes, ...this.nodes] },
        this.parent,
        name
      ),
      ...(this.parent ? { parent: this.parent } : {}),
      x: this.base.x + dx,
      y: this.base.y + dy,
      params,
    }
    this.nodes.push(node)
    return node.id
  }

  wire(
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
    index?: number
  ): void {
    this.edges.push({
      id: newId('e'),
      source,
      sourcePort,
      target,
      targetPort,
      ...(index !== undefined ? { index } : {}),
    })
  }

  /** The document's deck, or a new one beside the base position. */
  deck(params: Record<string, ParamValue> = {}): { id: string; isNew: boolean } {
    if (this.deckRef) return this.deckRef
    const existing = this.doc.nodes.find(n => n.op === 'deck')
    this.deckRef = existing
      ? { id: existing.id, isNew: false }
      : { id: this.add('deck', 'deck', 950, 160, params), isNew: true }
    return this.deckRef
  }

  /** Draw a layer in the deck, after the layers it draws already. */
  draw(layer: string): void {
    const deck = this.deck()
    this.layerIndex ??=
      Math.max(
        -1,
        ...this.doc.edges
          .filter(e => e.target === deck.id && e.targetPort === 'layers')
          .map(e => e.index ?? 0)
      ) + 1
    this.wire(layer, 'out', deck.id, 'layers', this.layerIndex++)
  }

  /**
   * Draw a table of features (a `geom` column) as GeoJSON is drawn: a geojson node making its
   * vertex rows, then a fill, a path for lines, and points. Returns the geojson node.
   */
  drawFeatures(features: { id: string; port: string }, dx: number, style = SHAPE_STYLE): string {
    const width = style.width ?? 2
    const geo = this.add('geojson', 'shapes', dx, 0, {})
    this.wire(features.id, features.port, geo, 'in')
    const vertex = { position: '[lng, lat]', pathId: 'id', order: 'vertex' }
    const fill = this.add('polygon', 'fill', dx + 300, -160, {
      ...vertex,
      ringId: 'ring',
      fillColor: style.fill,
      stroked: true,
      lineColor: style.line,
      lineWidthScale: width,
      lineWidthUnits: 'pixels',
    })
    const lines = this.add('path', 'lines', dx + 300, 0, {
      ...vertex,
      lineColor: style.line,
      widthScale: width,
      widthUnits: 'pixels',
    })
    const points = this.add('scatter', 'points', dx + 300, 160, {
      position: '[lng, lat]',
      fillColor: style.fill,
      radiusScale: style.radius ?? 5,
      radiusUnits: 'pixels',
    })
    this.wire(geo, 'polygons', fill, 'in')
    this.wire(geo, 'lines', lines, 'in')
    this.wire(geo, 'points', points, 'in')
    for (const layer of [fill, lines, points]) this.draw(layer)
    return geo
  }

  built(primaryNodeId: string): Built {
    return { nodes: this.nodes, edges: this.edges, primaryNodeId }
  }
}

/** Where a tool's nodes go: to the right of the network's nodes, level with the top ones. */
export function besideNetwork(doc: EditorDoc, network?: string): { x: number; y: number } {
  const here = doc.nodes.filter(n => n.parent === network)
  if (here.length === 0) return { x: 0, y: 0 }
  return { x: Math.max(...here.map(n => n.x)) + 400, y: Math.min(...here.map(n => n.y)) }
}

/** Add what a tool built to the store's document in one edit, and select its main node. */
export function commitBuilt(
  store: {
    edit(fn: (doc: EditorDoc) => void, tag?: string): void
    set(patch: { selection: string[] }): void
  },
  built: Built
): void {
  store.edit(d => {
    d.nodes.push(...built.nodes)
    d.edges.push(...built.edges)
  })
  store.set({ selection: [built.primaryNodeId] })
}
