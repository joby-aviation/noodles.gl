import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { NodeJSON } from '@xyflow/react'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import { analytics } from '../../../utils/analytics'
import { debugUI } from '../../../utils/debug'
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
import {
  createGeoJsonFileDropNodes,
  createGeoJsonTableDropNodes,
  type GeoJsonData,
  type GeoJsonImportMode,
  isGeoJson,
} from './geojson-import-nodes'

export { createGeoJsonFileDropNodes, createGeoJsonTableDropNodes } from './geojson-import-nodes'

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

type GeoJsonPreview = {
  file: File
  contents: string
  data: GeoJsonData
}

export function DataImporterTool({ open, onOpenChange, reactFlowRef }: DataImporterToolProps) {
  const { addNodes, addEdges, screenToFlowPosition } = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [geojsonPreview, setGeojsonPreview] = useState<GeoJsonPreview | null>(null)
  const [importMode, setImportMode] = useState<GeoJsonImportMode>('table')

  const importFile = useCallback(
    async (
      file: File,
      contents: string,
      geojsonData: GeoJsonData | null,
      mode: GeoJsonImportMode
    ) => {
      const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
      if (!currentProjectName) {
        throw new Error('No project loaded. Please save or load a project first.')
      }

      // Write to project storage for file-based imports
      if (!geojsonData || mode === 'file') {
        const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)
        if (!result.success) {
          throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
        }
      }

      debugUI('File imported:', file.name)

      const pane = reactFlowRef.current?.getBoundingClientRect()
      if (!pane) return

      const basePosition = screenToFlowPosition({
        x: pane.left + pane.width / 2,
        y: pane.top + pane.height / 2,
      })

      let format: string
      let nodes: NodeJSON<OpType>[]
      let edges: {
        id: string
        source: string
        target: string
        sourceHandle: string
        targetHandle: string
      }[]

      if (geojsonData && mode === 'table') {
        const result = createGeoJsonTableDropNodes(geojsonData, basePosition)
        nodes = result.nodes
        edges = result.edges
        format = 'geojson_table'
      } else if (geojsonData && mode === 'file') {
        const result = createGeoJsonFileDropNodes(projectScheme + file.name, basePosition)
        nodes = result.nodes
        edges = result.edges
        format = 'geojson_file'
      } else {
        format = file.type.includes('csv') ? 'csv' : 'json'
        const result = createFileDropNodes(projectScheme + file.name, format, basePosition)
        nodes = result.nodes
        edges = result.edges
      }

      addNodes(nodes)
      addEdges(edges)

      analytics.track('data_imported', {
        source: 'tools_shelf',
        format,
      })
    },
    [addNodes, addEdges, screenToFlowPosition, reactFlowRef]
  )

  const handleConfirmImport = useCallback(async () => {
    if (!geojsonPreview) return
    setError(null)
    setIsImporting(true)
    try {
      await importFile(
        geojsonPreview.file,
        geojsonPreview.contents,
        geojsonPreview.data,
        importMode
      )
      setGeojsonPreview(null)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import file')
    } finally {
      setIsImporting(false)
    }
  }, [geojsonPreview, importMode, importFile, onOpenChange])

  const handleFileImport = useCallback(
    async (file: File) => {
      setError(null)
      setIsImporting(true)

      try {
        const { currentProjectName } = useFileSystemStore.getState()
        if (!currentProjectName) {
          throw new Error('No project loaded. Please save or load a project first.')
        }

        const contents = await file.text()

        // Detect GeoJSON and show preview
        const isGeoJsonFile = file.name.endsWith('.geojson')
        if (isGeoJsonFile || file.type.includes('json')) {
          try {
            const parsed = JSON.parse(contents)
            if (isGeoJson(parsed)) {
              setImportMode('table')
              setGeojsonPreview({ file, contents, data: parsed })
              setIsImporting(false)
              return
            }
          } catch {
            // Not valid JSON — fall through to direct import
          }
        }

        await importFile(file, contents, null, 'file')
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import file')
      } finally {
        setIsImporting(false)
      }
    },
    [importFile, onOpenChange]
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
            Upload CSV, JSON, or GeoJSON files to create a visualization pipeline.
          </Dialog.Description>

          {geojsonPreview ? (
            <div className={s.geojsonPreview}>
              <div className={s.previewHeader}>
                <i className="pi pi-map" />
                <span>{geojsonPreview.file.name}</span>
              </div>

              <div className={s.previewStats}>
                <span className={s.featureCount}>
                  {geojsonPreview.data.features.length} features
                </span>
              </div>

              <div className={s.importModeToggle}>
                <label className={s.toggleLabel}>
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'table'}
                    onChange={() => setImportMode('table')}
                  />
                  <span className={s.toggleOption}>
                    <strong>Import as table</strong>
                    <span>Editable table with properties as columns</span>
                  </span>
                </label>
                <label className={s.toggleLabel}>
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'file'}
                    onChange={() => setImportMode('file')}
                  />
                  <span className={s.toggleOption}>
                    <strong>Load as file</strong>
                    <span>Import with a single FileOp</span>
                  </span>
                </label>
              </div>

              <div className={s.previewActions}>
                <button
                  type="button"
                  className={s.cancelButton}
                  onClick={() => setGeojsonPreview(null)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className={s.uploadButton}
                  onClick={handleConfirmImport}
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing...' : 'Import'}
                </button>
              </div>
            </div>
          ) : (
            <>
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
                  accept=".csv,.json,.geojson"
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
                  <div className={s.dropZoneHint}>Supports CSV, JSON, and GeoJSON files</div>
                </div>
              </div>

              {isImporting && (
                <div className={s.importing}>
                  <i className="pi pi-spin pi-spinner" />
                  <span>Importing...</span>
                </div>
              )}
            </>
          )}

          {error && <div className={s.error}>{error}</div>}

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
