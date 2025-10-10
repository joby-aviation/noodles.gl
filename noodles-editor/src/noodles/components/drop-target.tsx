import type { NodeJSON } from 'SKIP-@xyflow/react'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFileSystemStore } from '../filesystem-store'
import type { Edge } from '../noodles'
import s from '../noodles.module.css'
import type {
  AccessorOp,
  BoundingBoxOp,
  DeckRendererOp,
  FileOp,
  MaplibreBasemapOp,
  OpType,
  ScatterplotLayerOp,
} from '../operators'
import { writeAsset } from '../storage'
import { projectScheme } from '../utils/filesystem'
import { edgeId, nodeId } from '../utils/id-utils'

function createFileDropNodes(url: string, format: string) {
  const dataId = nodeId('data', '/')
  const scatterId = nodeId('scatter', '/')
  const scatterPositionId = nodeId('scatter-position', '/')
  const bboxId = nodeId('bbox', '/')
  const mapId = nodeId('basemap', '/')
  const deckId = nodeId('deck', '/')
  const nodes: NodeJSON<OpType>[] = [
    {
      id: scatterPositionId,
      type: 'AccessorOp',
      data: {
        inputs: {
          expression: '[d.lng, d.lat]',
        },
      },
      position: { x: -900, y: 0 },
    },
    {
      id: dataId,
      type: 'FileOp',
      data: {
        inputs: { format, url },
      },
      position: { x: -1200, y: -200 },
    },
    {
      id: scatterId,
      type: 'ScatterplotLayerOp',
      data: {
        inputs: {
          getLineColor: '#000000',
          getFillColor: '#ffffff',
        },
      },
      position: { x: -400, y: -200 },
    },
    {
      id: bboxId,
      type: 'BoundingBoxOp',
      data: {
        inputs: {},
      },
      position: { x: -800, y: 200 },
    },
    {
      id: mapId,
      type: 'MaplibreBasemapOp',
      data: {
        inputs: {},
      },
      position: { x: -400, y: 200 },
    },
  ]

  const edges = [
    {
      source: dataId,
      target: scatterId,
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    } as Edge<FileOp, ScatterplotLayerOp>,
    {
      source: scatterPositionId,
      target: scatterId,
      sourceHandle: 'out.accessor',
      targetHandle: 'par.getPosition',
    } as Edge<AccessorOp, ScatterplotLayerOp>,
    {
      source: scatterId,
      target: deckId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    } as Edge<ScatterplotLayerOp, DeckRendererOp>,
    {
      source: dataId,
      target: bboxId,
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    } as Edge<FileOp, BoundingBoxOp>,
    {
      source: bboxId,
      target: mapId,
      sourceHandle: 'out.viewState',
      targetHandle: 'par.viewState',
    } as Edge<BoundingBoxOp, MaplibreBasemapOp>,
    {
      source: mapId,
      target: deckId,
      sourceHandle: 'out.maplibre',
      targetHandle: 'par.basemap',
    } as Edge<MaplibreBasemapOp, DeckRendererOp>,
  ].map(connection => ({ ...connection, id: edgeId(connection) }))
  return { nodes, edges }
}

function useFileDropTarget() {
  const { addNodes, addEdges } = useReactFlow()

  return useCallback(
    async (e: DragEvent) => {
      // Get current project and storage type
      const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
      if (!currentProjectName) {
        throw new Error('No project loaded. Please save or load a project first.')
      }

      const dt = e.dataTransfer
      const files = dt.files

      for (const file of files) {
        // Read file contents and write to project's data directory
        const contents = await file.text()
        const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)

        if (!result.success) {
          throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
        }

        console.log('File added', file)
        const type = file.type.includes('csv') ? 'csv' : 'json'
        const { nodes, edges } = createFileDropNodes(projectScheme + file.name, type)

        addNodes(nodes)
        addEdges(edges)
      }
    },
    [addNodes, addEdges]
  )
}

export function DropTarget() {
  const onDrop = useFileDropTarget()

  const [dragging, setDragging] = useState(false)
  const dropTargetRef = useRef<HTMLDivElement>(null)

  const dragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const dragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const drop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      onDrop(e).then(() => {
        setDragging(false)
      })
    },
    [onDrop]
  )

  useEffect(() => {
    if (!dropTargetRef.current) return
    dropTargetRef.current.addEventListener('dragenter', dragEnter)
    dropTargetRef.current.addEventListener('dragover', dragEnter)
    dropTargetRef.current.addEventListener('dragleave', dragLeave)
    dropTargetRef.current.addEventListener('drop', drop)
    return () => {
      dropTargetRef.current?.addEventListener('dragenter', dragEnter)
      dropTargetRef.current?.removeEventListener('dragover', dragEnter)
      dropTargetRef.current?.addEventListener('dragleave', dragLeave)
      dropTargetRef.current?.removeEventListener('drop', drop)
    }
  }, [drop, dragEnter, dragLeave])

  return (
    <div ref={dropTargetRef} className={s.dropTarget}>
      {dragging && (
        <div className={s.dropTargetOverlay}>
          <div style={{ fontSize: '64px' }}>🗃️</div>
          <div>Drop your file here</div>
        </div>
      )}
    </div>
  )
}
