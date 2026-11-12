// A deck's map style as the document keeps it (compound-params.ts, StyleGroup): a named
// basemap, a URL or style JSON, and the style editor's changes. What the map style control
// and the Drive with menu do to a deck, without React.

import { type DocNode, type EditorDoc, OPERATOR_INDEX, type ParamValue } from '@noodles.gl/planner'
import { BASEMAPS } from '../runtime/engine'
import { parseStyleChanges } from '../runtime/map-style'
import { BASEMAP_CATALOG } from '../utils/map-styles'
import type { StyleGroup } from './compound-params'
import { addNode, connect, setParam } from './doc-ops'

// The deck's named basemaps: the engine's URLs, the Basemap menu's labels
const named = (name: string) => ({
  url: BASEMAPS[name],
  label:
    OPERATOR_INDEX.get('deck')
      ?.params.find(p => p.name === 'basemap')
      ?.options?.find(o => o.value === name)?.label ?? name,
})

type Style = string | Record<string, unknown> | undefined

/** What the deck draws its basemap from: its URL or style JSON, else its named basemap. */
export function baseStyleOf(node: DocNode, group: StyleGroup): Style {
  const text = String(node.params[group.url] ?? '').trim()
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  if (text) return text
  return named(String(node.params[group.basemap] ?? 'dark-matter')).url
}

/** The style's name for the picker: a gallery entry's, a named basemap's, or where it's from. */
export function styleLabel(node: DocNode, group: StyleGroup): string {
  const text = String(node.params[group.url] ?? '').trim()
  if (text.startsWith('{')) return 'Custom style'
  if (text) {
    const entry = BASEMAP_CATALOG.find(e => e.url === text)
    if (entry) return entry.name
    try {
      return new URL(text).host
    } catch {
      return text
    }
  }
  return named(String(node.params[group.basemap] ?? 'dark-matter')).label
}

/** A gallery pick: one of the deck's named basemaps by name, any other by its URL or JSON. */
export function chooseStyle(doc: EditorDoc, nodeId: string, group: StyleGroup, value: unknown) {
  const name = Object.entries(BASEMAPS).find(([, url]) => url && url === value)?.[0]
  if (name) {
    setParam(doc, nodeId, group.basemap, name === 'dark-matter' ? undefined : name)
    setParam(doc, nodeId, group.url, undefined)
  } else if (typeof value === 'string') {
    setParam(doc, nodeId, group.url, value)
  } else if (value && typeof value === 'object') {
    // A raster basemap arrives as a style of its own
    setParam(doc, nodeId, group.url, JSON.stringify(value))
  }
}

/** The deck's style and changes as a Map Style node wired into it, for sharing. */
export function splitOutStyle(
  doc: EditorDoc,
  nodeId: string,
  group: StyleGroup
): string | undefined {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return undefined
  const base = baseStyleOf(node, group)
  const changes = parseStyleChanges(node.params[group.changes]) ?? { layers: [], global: {} }
  // In the deck's own network, and with no base style when the deck draws no basemap
  const style = addNode(doc, 'map-style', node.x - 320, node.y + 200, node.parent)
  style.params = {
    overrides: changes as unknown as ParamValue,
    baseStyle: (base ?? '') as unknown as ParamValue,
  }
  connect(doc, style.id, 'mapStyle', nodeId, `par:${group.url}`)
  setParam(doc, nodeId, group.changes, undefined)
  return style.id
}
