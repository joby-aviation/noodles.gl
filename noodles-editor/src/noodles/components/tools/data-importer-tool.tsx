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
  GeoJsonLayerOp,
  MaplibreBasemapOp,
  OpType,
  ScatterplotLayerOp,
} from '../../operators'
import { writeAsset } from '../../storage'
import { projectScheme } from '../../utils/filesystem'
import { edgeId, nodeId } from '../../utils/id-utils'
import s from './data-importer-tool.module.css'

const SAMPLE_DATASETS = [
  {
    name: 'World Countries',
    url: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
    format: 'geojson' as const,
  },
  {
    name: 'US States',
    url: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
    format: 'geojson' as const,
  },
  {
    name: 'World Airports',
    url: 'https://raw.githubusercontent.com/datasets/airport-codes/master/data/airport-codes.csv',
    format: 'csv' as const,
  },
  {
    name: 'World Cities',
    url: 'https://raw.githubusercontent.com/datasets/world-cities/master/data/world-cities.csv',
    format: 'csv' as const,
  },
]

type DetectedFormat = 'csv' | 'json' | 'geojson'

function detectFormat(filename: string, contents?: string): DetectedFormat {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (ext === 'geojson') return 'geojson'
  if (ext === 'json' && contents) {
    try {
      const parsed = JSON.parse(contents)
      if (parsed.type === 'FeatureCollection' || parsed.type === 'Feature' || parsed.features) {
        return 'geojson'
      }
    } catch {}
  }
  return 'json'
}

function detectFormatFromUrl(url: string): DetectedFormat {
  const path = new URL(url, 'https://placeholder.com').pathname.toLowerCase()
  if (path.endsWith('.csv') || path.endsWith('.tsv')) return 'csv'
  if (path.endsWith('.geojson')) return 'geojson'
  return 'json'
}

const LNG_PATTERNS = ['lng', 'lon', 'longitude', 'long', 'x']
const LAT_PATTERNS = ['lat', 'latitude', 'y']

function detectPositionAccessor(contents?: string): string {
  if (!contents) return '[d.lng, d.lat]'
  const firstLine = contents.split('\n')[0]
  if (!firstLine) return '[d.lng, d.lat]'

  const columns = firstLine.split(/[,\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''))
  const lower = columns.map(c => c.toLowerCase())

  const lngCol = columns.find((_, i) => LNG_PATTERNS.includes(lower[i]))
  const latCol = columns.find((_, i) => LAT_PATTERNS.includes(lower[i]))

  if (lngCol && latCol) return `[d["${lngCol}"], d["${latCol}"]]`
  return '[d.lng, d.lat]'
}

function createScatterPipeline(
  url: string,
  format: string,
  basePosition: { x: number; y: number },
  positionExpression = '[d.lng, d.lat]'
) {
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
          expression: positionExpression,
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

function createGeoJsonPipeline(url: string, basePosition: { x: number; y: number }) {
  const dataId = nodeId('data', '/')
  const layerId = nodeId('geojson-layer', '/')
  const bboxId = nodeId('bbox', '/')
  const mapId = nodeId('basemap', '/')
  const deckId = nodeId('deck', '/')
  const nodes: NodeJSON<OpType>[] = [
    {
      id: dataId,
      type: 'FileOp',
      data: {
        inputs: { format: 'json', url },
      },
      position: { x: basePosition.x, y: basePosition.y },
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
      position: { x: basePosition.x + 500, y: basePosition.y },
    },
    {
      id: bboxId,
      type: 'BoundingBoxOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 250, y: basePosition.y + 250 },
    },
    {
      id: mapId,
      type: 'MaplibreBasemapOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 500, y: basePosition.y + 250 },
    },
    {
      id: deckId,
      type: 'DeckRendererOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 800, y: basePosition.y + 100 },
    },
  ]

  const edges = [
    {
      source: dataId,
      target: layerId,
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    } as Edge<FileOp, GeoJsonLayerOp>,
    {
      source: layerId,
      target: deckId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    } as Edge<GeoJsonLayerOp, DeckRendererOp>,
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

function createFileDropNodes(
  url: string,
  format: DetectedFormat,
  basePosition: { x: number; y: number },
  contents?: string
) {
  if (format === 'geojson') {
    return createGeoJsonPipeline(url, basePosition)
  }
  const positionExpression = format === 'csv' ? detectPositionAccessor(contents) : '[d.lng, d.lat]'
  return createScatterPipeline(url, format, basePosition, positionExpression)
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
  const [urlInput, setUrlInput] = useState('')

  const getBasePosition = useCallback(() => {
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return { x: 0, y: 0 }
    return screenToFlowPosition({
      x: pane.left + pane.width / 2,
      y: pane.top + pane.height / 2,
    })
  }, [reactFlowRef, screenToFlowPosition])

  const handleFileImport = useCallback(
    async (file: File) => {
      setError(null)
      setIsImporting(true)

      try {
        const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
        if (!currentProjectName) {
          throw new Error('No project loaded. Please save or load a project first.')
        }

        const contents = await file.text()
        const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)

        if (!result.success) {
          throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
        }

        debugUI('File imported:', file.name)
        const format = detectFormat(file.name, contents)

        const basePosition = getBasePosition()
        const { nodes, edges } = createFileDropNodes(
          projectScheme + file.name,
          format,
          basePosition,
          contents
        )

        addNodes(nodes)
        addEdges(edges)

        analytics.track('data_imported', {
          source: 'tools_shelf',
          format,
        })

        onOpenChange(false)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import file')
      } finally {
        setIsImporting(false)
      }
    },
    [addNodes, addEdges, getBasePosition, onOpenChange]
  )

  const handleUrlImport = useCallback(async () => {
    const url = urlInput.trim()
    if (!url) return

    setError(null)
    setIsImporting(true)

    try {
      const format = detectFormatFromUrl(url)
      const basePosition = getBasePosition()
      const { nodes, edges } = createFileDropNodes(url, format, basePosition)

      addNodes(nodes)
      addEdges(edges)

      analytics.track('data_imported', {
        source: 'tools_shelf_url',
        format,
      })

      setUrlInput('')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load URL')
    } finally {
      setIsImporting(false)
    }
  }, [urlInput, addNodes, addEdges, getBasePosition, onOpenChange])

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
            Add data from a file or URL to create a visualization pipeline.
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
              accept=".csv,.json,.geojson,.tsv"
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
              <div className={s.dropZoneHint}>CSV, JSON, GeoJSON</div>
            </div>
          </div>

          <div className={s.urlSection}>
            <div className={s.urlLabel}>Or load from URL</div>
            <div className={s.urlInputGroup}>
              <input
                type="url"
                className={s.urlInput}
                placeholder="https://example.com/data.geojson"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleUrlImport()
                }}
                disabled={isImporting}
              />
              <button
                type="button"
                className={s.urlLoadButton}
                onClick={handleUrlImport}
                disabled={isImporting || !urlInput.trim()}
              >
                Load
              </button>
            </div>
          </div>

          <div className={s.sampleSection}>
            <div className={s.urlLabel}>Sample datasets</div>
            <div className={s.sampleGrid}>
              {SAMPLE_DATASETS.map(sample => (
                <button
                  key={sample.url}
                  type="button"
                  className={s.sampleButton}
                  disabled={isImporting}
                  onClick={() => {
                    setUrlInput(sample.url)
                    const format = sample.format
                    const basePosition = getBasePosition()
                    const { nodes, edges } = createFileDropNodes(sample.url, format, basePosition)
                    addNodes(nodes)
                    addEdges(edges)
                    analytics.track('data_imported', {
                      source: 'sample_dataset',
                      format,
                      dataset: sample.name,
                    })
                    onOpenChange(false)
                  }}
                >
                  <span className={s.sampleName}>{sample.name}</span>
                  <span className={s.sampleFormat}>{sample.format}</span>
                </button>
              ))}
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
