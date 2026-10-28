// A deck's map style as one control (compound-params.ts, StyleGroup), inline rather than through
// a separate node: pick a basemap from the gallery (or paste a style URL or JSON in its search),
// and change the style's layers in the style editor, the changes kept on the deck. Like any
// parameter, the row's port takes a wire (a Code node returning style JSON) and the row takes
// a dropped URL; right-click Drive with, Map Style moves the style and its changes into a Map
// Style node wired into the deck, so other decks and projects can share it.

import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { useState } from 'react'
import { BasemapGallery } from '../noodles/components/basemap-gallery'
import { MapStyleConfiguratorDialog } from '../noodles/components/map-style-configurator'
import { parseStyleChanges } from '../runtime/map-style'
import { analytics } from '../utils/analytics'
import type { StyleConfiguratorData } from '../utils/map-style-utils'
import type { StyleGroup } from './compound-params'
import s from './doc-editor.module.css'
import { setParam } from './doc-ops'
import { docStore } from './doc-store'
import type { NodeFields } from './field-adapter'
import { baseStyleOf, chooseStyle, styleLabel } from './map-style-ops'
import { ParamRow } from './param-row'

const describe = (changes: StyleConfiguratorData) => {
  const layers = changes.layers?.length ?? 0
  const global = Object.keys(changes.global ?? {}).length > 0
  return [layers ? `${layers} layer${layers === 1 ? '' : 's'}` : '', global ? 'colors' : '']
    .filter(Boolean)
    .join(', ')
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
  const label = styleLabel(node, group)
  const picker = (
    <span className={s.styleActions}>
      <button
        type="button"
        className={s.stylePick}
        title={`${label}: click to pick a basemap, or paste a style URL or JSON in its search. Drop a URL here, or wire a style into the port, to use that instead. Right-click for more.`}
        onClick={() => setGallery(true)}
      >
        <i className="pi pi-images" />
        <span>{label}</span>
      </button>
      <button
        type="button"
        className={s.styleAction}
        aria-label="Edit style"
        title="Edit the style: hide or recolor its layers"
        onClick={() => setEditor(true)}
      >
        <i className="pi pi-sliders-h" />
      </button>
    </span>
  )

  return (
    <div className={s.compound}>
      {url && (
        <ParamRow
          node={node}
          def={url.def}
          field={url.field}
          wired={isWired}
          label="Map style"
          control={picker}
        />
      )}
      <div className={s.compoundBody}>
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
