import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { NodeJSON } from '@xyflow/react'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import { analytics } from '../../../utils/analytics'
import { useFileSystemStore } from '../../filesystem-store'
import type { Edge } from '../../noodles'
import type {
  AccessorOp,
  BoundingBoxOp,
  DeckRendererOp,
  FileOp,
  MaplibreBasemapOp,
  OpType,
  ScatterplotLayerOp,
} from '../../operators'
import { writeAsset } from '../../storage'
import { projectScheme } from '../../utils/filesystem'
import { edgeId, nodeId } from '../../utils/id-utils'
import s from './data-importer-tool.module.css'

function createFileDropNodes(url: string, format: string, basePosition: { x: number; y: number }) {
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
      position: { x: basePosition.x + 300, y: basePosition.y },
    },
    {
      id: dataId,
      type: 'FileOp',
      data: {
        inputs: { format, url },
      },
      position: { x: basePosition.x, y: basePosition.y - 200 },
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
      position: { x: basePosition.x + 800, y: basePosition.y - 200 },
    },
    {
      id: bboxId,
      type: 'BoundingBoxOp',
      data: {
        inputs: {},
      },
      position: { x: basePosition.x + 400, y: basePosition.y + 200 },
    },
    {
      id: mapId,
      type: 'MaplibreBasemapOp',
      data: {
        inputs: {},
      },
      position: { x: basePosition.x + 800, y: basePosition.y + 200 },
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

interface DataImporterToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function DataImporterTool({ open, onOpenChange, reactFlowRef }: DataImporterToolProps) {
  const { addNodes, addEdges, screenToFlowPosition } = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const handleFileImport = useCallback(
    async (file: File) => {
      setError(null)
      setIsImporting(true)

      try {
        // Get current project and storage type
        const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
        if (!currentProjectName) {
          throw new Error('No project loaded. Please save or load a project first.')
        }

        // Read file contents and write to project's data directory
        const contents = await file.text()
        const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)

        if (!result.success) {
          throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
        }

        console.log('File imported:', file.name)
        const type = file.type.includes('csv') ? 'csv' : 'json'

        // Position nodes at center of viewport (same as block library)
        const pane = reactFlowRef.current?.getBoundingClientRect()
        if (!pane) return

        const basePosition = screenToFlowPosition({
          x: pane.left + pane.width / 2,
          y: pane.top + pane.height / 2,
        })

        const { nodes, edges } = createFileDropNodes(projectScheme + file.name, type, basePosition)

        addNodes(nodes)
        addEdges(edges)

        analytics.track('data_imported', {
          source: 'tools_shelf',
          format: type,
        })

        // Close dialog on success
        onOpenChange(false)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import file')
      } finally {
        setIsImporting(false)
      }
    },
    [addNodes, addEdges, screenToFlowPosition, reactFlowRef, onOpenChange]
  )

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      for (const file of Array.from(files)) {
        await handleFileImport(file)
      }

      // Reset file input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [handleFileImport]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (!files || files.length === 0) return

      for (const file of Array.from(files)) {
        await handleFileImport(file)
      }
    },
    [handleFileImport]
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Import Data</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Upload CSV or JSON files to create a visualization pipeline.
          </Dialog.Description>

          {/* biome-ignore lint/a11y/useSemanticElements: div needed for drag-and-drop zone styling */}
          <div
            className={`${s.dropZone} ${isDragging ? s.dropZoneDragging : ''}`}
            role="button"
            tabIndex={0}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFileSelect}
              multiple
              style={{ display: 'none' }}
            />

            <div className={s.dropZoneContent}>
              <i className={`pi pi-cloud-upload ${s.uploadIcon}`} />
              <div className={s.dropZoneText}>Drag and drop files here</div>
              <div className={s.dropZoneSubtext}>or</div>
              <button
                type="button"
                className={s.uploadButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                Browse Files
              </button>
              <div className={s.dropZoneHint}>Supports CSV and JSON files</div>
            </div>
          </div>

          {error && <div className={s.error}>{error}</div>}

          {isImporting && (
            <div className={s.importing}>
              <i className="pi pi-spin pi-spinner" />
              <span>Importing...</span>
            </div>
          )}

          <div className={s.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={s.cancelButton}>
                Close
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Close asChild>
            <button type="button" className={s.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
