// A deck's map style as one control (compound-params.ts, StyleGroup), inline rather than through
// a separate node: pick a basemap from the gallery, paste a URL or style JSON into the URL row
// (which, like any parameter, can also be wired from a Code node), and change the style's layers
// in the style editor, the changes kept on the deck. Split out moves the style and its changes
// into a Map Style node wired into the deck, so other decks and projects can share it.

import { type DocNode, type EditorDoc, OPERATOR_INDEX, type ParamValue } from '@noodles.gl/planner'
import { useState } from 'react'
import { BasemapGallery } from '../noodles/components/basemap-gallery'
import { MapStyleConfiguratorDialog } from '../noodles/components/map-style-configurator'
import { BASEMAPS } from '../runtime/engine'
import { parseStyleChanges } from '../runtime/map-style'
import { analytics } from '../utils/analytics'
import type { StyleConfiguratorData } from '../utils/map-style-utils'
import { BASEMAP_CATALOG } from '../utils/map-styles'
import type { StyleGroup } from './compound-params'
import s from './doc-editor.module.css'
import { addNode, connect, setParam } from './doc-ops'
import { docStore } from './doc-store'
import type { NodeFields } from './field-adapter'
import { ParamRow } from './param-row'

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

const describe = (changes: StyleConfiguratorData) => {
  const layers = changes.layers?.length ?? 0
  const global = Object.keys(changes.global ?? {}).length > 0
  return [layers ? `${layers} layer${layers === 1 ? '' : 's'}` : '', global ? 'colors' : '']
    .filter(Boolean)
    .join(', ')
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
  const style = addNode(doc, 'map-style', node.x - 320, node.y + 200)
  style.params = { overrides: changes as unknown as ParamValue }
  if (base !== undefined) style.params.baseStyle = base as unknown as ParamValue
  connect(doc, style.id, 'mapStyle', nodeId, `par:${group.url}`)
  setParam(doc, nodeId, group.changes, undefined)
  return style.id
}

export function MapStyleRows({
  node,
  group,
  fields,
  wired,
}: {
  node: DocNode
  group: StyleGroup
  fields: NodeFields
  wired: Set<string>
}) {
  const [gallery, setGallery] = useState(false)
  const [editor, setEditor] = useState(false)
  const isWired = wired.has(`par:${group.url}`)
  const changes = parseStyleChanges(node.params[group.changes])
  const url = fields.bindings.get(group.url)
  const edit = (via: string, fn: (d: EditorDoc) => void, tag?: string) => {
    docStore().edit(fn, tag)
    analytics.track('map_style_changed', { via })
  }
  const wiredNote =
    'A style wired into the URL wins; pick or edit the style on the node it comes from'

  return (
    <div className={s.compound}>
      <div className={s.paramDriven}>
        <span className={s.paramLabel}>Map style</span>
        <span className={s.styleActions}>
          <button
            type="button"
            className={s.stylePick}
            disabled={isWired}
            title={isWired ? wiredNote : `${styleLabel(node, group)}: click to pick a basemap`}
            onClick={() => setGallery(true)}
          >
            <i className="pi pi-images" />
            <span>{isWired ? 'Wired' : styleLabel(node, group)}</span>
          </button>
          <button
            type="button"
            className={s.styleAction}
            disabled={isWired}
            aria-label="Edit style"
            title={isWired ? wiredNote : 'Edit the style: hide or recolor its layers'}
            onClick={() => setEditor(true)}
          >
            <i className="pi pi-sliders-h" />
          </button>
          <button
            type="button"
            className={s.styleAction}
            disabled={isWired}
            aria-label="Split out"
            title={
              isWired
                ? wiredNote
                : 'Split out: move the style and its changes into a Map Style node wired into the deck, to share it'
            }
            onClick={() =>
              edit('split', d => {
                const id = splitOutStyle(d, node.id, group)
                if (id) docStore().set({ selection: [id] })
              })
            }
          >
            <i className="pi pi-external-link" />
          </button>
        </span>
      </div>
      <div className={s.compoundBody}>
        {url && (
          <ParamRow
            node={node}
            def={url.def}
            field={url.field}
            wired={isWired}
            label="URL or JSON"
          />
        )}
        {changes && !isWired && (
          <div className={s.paramDriven}>
            <span className={s.paramLabel}>Changes</span>
            <span className={s.styleChanges}>
              {describe(changes)}
              <button
                type="button"
                className={s.refChipBreak}
                title="Drop the style changes"
                onClick={() => edit('reset', d => setParam(d, node.id, group.changes, undefined))}
              >
                ×
              </button>
            </span>
          </div>
        )}
      </div>
      <BasemapGallery
        open={gallery}
        onOpenChange={setGallery}
        currentValue={
          typeof baseStyleOf(node, group) === 'string'
            ? String(baseStyleOf(node, group))
            : undefined
        }
        onSelect={value => {
          edit('gallery', d => chooseStyle(d, node.id, group, value))
          setGallery(false)
        }}
      />
      {editor && (
        <MapStyleConfiguratorDialog
          open={editor}
          onOpenChange={setEditor}
          baseStyle={baseStyleOf(node, group)}
          overrides={changes}
          onOverridesChange={next =>
            edit(
              'editor',
              d =>
                setParam(
                  d,
                  node.id,
                  group.changes,
                  parseStyleChanges(JSON.stringify(next)) ? JSON.stringify(next) : undefined
                ),
              `style:${node.id}`
            )
          }
        />
      )}
    </div>
  )
}
