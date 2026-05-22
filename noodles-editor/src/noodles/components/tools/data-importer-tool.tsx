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
import { getOpEntries } from '../../store'
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

type GeoJsonFeature = {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: unknown
  }
  properties?: Record<string, unknown>
}

type GeoJsonData = {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

const GEOMETRY_TYPE_TO_OP: Record<string, OpType> = {
  Point: 'PointOp',
  LineString: 'LineStringOp',
  Polygon: 'PolygonOp',
  MultiPoint: 'MultiPointOp',
  MultiLineString: 'MultiLineStringOp',
  MultiPolygon: 'MultiPolygonOp',
}

export function createGeoJsonDropNodes(
  geojson: GeoJsonData,
  basePosition: { x: number; y: number }
) {
  const geojsonId = nodeId('geojson', '/')
  const geojsonLayerId = nodeId('geojson-layer', '/')

  // Find existing DeckRendererOp in the graph
  const existingDeck = getOpEntries().find(
    ([_, op]) => (op.constructor as { displayName?: string }).displayName === 'DeckRenderer'
  )
  const deckId = existingDeck ? existingDeck[0] : nodeId('deck', '/')

  const nodes: NodeJSON<OpType>[] = []
  const featureEdges: Array<{
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }> = []

  // Create a geometry operator for each feature
  const colSpacing = 350
  const rowSpacing = 150
  const maxColumns = 4
  geojson.features.forEach((feature, i) => {
    const opType = GEOMETRY_TYPE_TO_OP[feature.geometry.type]
    if (!opType) return

    const col = i % maxColumns
    const row = Math.floor(i / maxColumns)
    const featureId = nodeId(`feature-${i}`, '/')

    const inputs: Record<string, unknown> =
      opType === 'PointOp'
        ? {
            coordinates: feature.geometry.coordinates,
            properties: feature.properties || {},
          }
        : {
            geometry: JSON.stringify(feature.geometry.coordinates, null, 2),
            properties: JSON.stringify(feature.properties || {}, null, 2),
          }

    nodes.push({
      id: featureId,
      type: opType,
      data: { inputs },
      position: {
        x: basePosition.x + col * colSpacing,
        y: basePosition.y + row * rowSpacing,
      },
    })

    featureEdges.push({
      source: featureId,
      target: geojsonId,
      sourceHandle: 'out.feature',
      targetHandle: 'par.features',
    })
  })

  const featureRowCount = Math.ceil(geojson.features.length / maxColumns)
  const geojsonY = basePosition.y + featureRowCount * rowSpacing + 100

  // GeoJsonOp collects all features
  nodes.push({
    id: geojsonId,
    type: 'GeoJsonOp',
    data: { inputs: {} },
    position: { x: basePosition.x + colSpacing, y: geojsonY },
  })

  // GeoJsonLayerOp renders the collection
  nodes.push({
    id: geojsonLayerId,
    type: 'GeoJsonLayerOp',
    data: { inputs: {} },
    position: { x: basePosition.x + colSpacing * 2, y: geojsonY },
  })

  const allEdges = [
    ...featureEdges,
    {
      source: geojsonId,
      target: geojsonLayerId,
      sourceHandle: 'out.featureCollection',
      targetHandle: 'par.data',
    },
    {
      source: geojsonLayerId,
      target: deckId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    },
  ].map(connection => ({ ...connection, id: edgeId(connection) }))

  return { nodes, edges: allEdges }
}

function isGeoJson(data: unknown): data is GeoJsonData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as { type: string }).type === 'FeatureCollection' &&
    'features' in data &&
    Array.isArray((data as GeoJsonData).features)
  )
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

        debugUI('File imported:', file.name)

        // Position nodes at center of viewport (same as block library)
        const pane = reactFlowRef.current?.getBoundingClientRect()
        if (!pane) return

        const basePosition = screenToFlowPosition({
          x: pane.left + pane.width / 2,
          y: pane.top + pane.height / 2,
        })

        // Detect GeoJSON and use specialized import
        const isGeoJsonFile = file.name.endsWith('.geojson')
        let format: string
        let nodes: NodeJSON<OpType>[]
        let edges: {
          id: string
          source: string
          target: string
          sourceHandle: string
          targetHandle: string
        }[]

        if (isGeoJsonFile || file.type.includes('json')) {
          try {
            const parsed = JSON.parse(contents)
            if (isGeoJson(parsed)) {
              const result = createGeoJsonDropNodes(parsed, basePosition)
              nodes = result.nodes
              edges = result.edges
              format = 'geojson'
            } else {
              format = 'json'
              const result = createFileDropNodes(projectScheme + file.name, format, basePosition)
              nodes = result.nodes
              edges = result.edges
            }
          } catch {
            format = file.type.includes('csv') ? 'csv' : 'json'
            const result = createFileDropNodes(projectScheme + file.name, format, basePosition)
            nodes = result.nodes
            edges = result.edges
          }
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
            Upload CSV, JSON, or GeoJSON files to create a visualization pipeline.
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
