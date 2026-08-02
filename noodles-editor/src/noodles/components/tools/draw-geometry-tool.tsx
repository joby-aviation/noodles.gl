import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import { analytics } from '../../../utils/analytics'
import type { Operator, OpType } from '../../operators'
import { useNestingStore, useOperatorStore } from '../../store'
import type { NodeJSON } from '../../transform-graph'
import { edgeId, nodeId } from '../../utils/id-utils'
import { GeoEditorDialog } from '../geo-editor-dialog'

interface DrawGeometryToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

// One-off tool: scaffolds a GeoEditor node (plus a layer so the drawing shows up on the
// map) and opens the drawing dialog straight away. The node keeps the geometry, so
// reopening it later means clicking "Open Editor" on the node the tool just selected.
export function DrawGeometryTool({ open, onOpenChange, reactFlowRef }: DrawGeometryToolProps) {
  const reactFlow = useReactFlow()
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const [editorOpId, setEditorOpId] = useState<string | null>(null)
  const editorOp = useOperatorStore(state => (editorOpId ? state.operators.get(editorOpId) : null))

  const scaffold = useCallback(() => {
    const container = currentContainerId || '/'
    const pane = reactFlowRef.current?.getBoundingClientRect()
    const basePosition = pane
      ? reactFlow.screenToFlowPosition({
          x: pane.left + pane.width / 3,
          y: pane.top + pane.height / 2,
        })
      : { x: 0, y: 0 }

    const editorId = nodeId('geo-editor', container)
    const layerId = nodeId('drawn-layer', container)

    const existingRenderer = Array.from(useOperatorStore.getState().operators.entries()).find(
      ([, op]) => (op.constructor as typeof Operator).displayName === 'DeckRenderer'
    )?.[0]

    const nodes: NodeJSON<OpType>[] = [
      {
        id: editorId,
        type: 'GeoEditorOp',
        data: { inputs: {} },
        position: basePosition,
      },
      {
        id: layerId,
        type: 'GeoJsonLayerOp',
        data: {
          inputs: {
            stroked: true,
            filled: true,
            getFillColor: '#3b82f6',
            getLineColor: '#1e40af',
            getLineWidth: 2,
            getPointRadius: 5,
          },
        },
        position: { x: basePosition.x + 450, y: basePosition.y },
      },
    ]

    const connections = [
      {
        source: editorId,
        target: layerId,
        sourceHandle: 'out.featureCollection',
        targetHandle: 'par.data',
      },
    ]

    let rendererId = existingRenderer
    if (!rendererId) {
      rendererId = nodeId('deck', container)
      const basemapId = nodeId('basemap', container)
      nodes.push({
        id: basemapId,
        type: 'MaplibreBasemapOp',
        data: { inputs: {} },
        position: { x: basePosition.x + 450, y: basePosition.y + 280 },
      })
      nodes.push({
        id: rendererId,
        type: 'DeckRendererOp',
        data: { inputs: {} },
        position: { x: basePosition.x + 900, y: basePosition.y + 120 },
      })
      connections.push({
        source: basemapId,
        target: rendererId,
        sourceHandle: 'out.maplibre',
        targetHandle: 'par.basemap',
      })
    }
    connections.push({
      source: layerId,
      target: rendererId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    })

    reactFlow.addNodes(nodes)
    reactFlow.addEdges(connections.map(c => ({ ...c, id: edgeId(c) })))
    reactFlow.setNodes(ns => ns.map(n => ({ ...n, selected: n.id === editorId })))
    requestAnimationFrame(() => {
      reactFlow.fitView({ nodes: [{ id: editorId }], duration: 300, padding: 0.6 })
    })

    analytics.track('draw_geometry_started', { source: 'tools_shelf' })
    setEditorOpId(editorId)
  }, [currentContainerId, reactFlow, reactFlowRef])

  // Scaffold once per activation; the dialog opens as soon as the operator exists
  useEffect(() => {
    if (open && !editorOpId) scaffold()
    if (!open) setEditorOpId(null)
  }, [open, editorOpId, scaffold])

  if (!open || !editorOp) return null

  return (
    <GeoEditorDialog
      operator={editorOp}
      open
      onOpenChange={next => {
        if (!next) onOpenChange(false)
      }}
    />
  )
}
