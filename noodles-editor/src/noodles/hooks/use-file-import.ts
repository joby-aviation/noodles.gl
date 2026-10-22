import { type Edge, useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import {
  type CoordinateDetection,
  detectFileCoordinates,
  rowCountBucket,
} from '../components/tools/detect-coordinates'
import {
  createImportPipeline,
  type DetectedFormat,
  detectFormat,
  detectFormatFromUrl,
  extensionOf,
  isBinaryFormat,
} from '../components/tools/import-pipelines'
import { useFileSystemStore } from '../filesystem-store'
import type { Operator } from '../operators'
import { writeAsset } from '../storage'
import { useOperatorStore } from '../store'
import { appendUniqueEdges } from '../utils/edge-integrity'
import { projectScheme } from '../utils/filesystem'
import { normalizeMultiInputEdges } from '../utils/multi-input-utils'
import { resolveNodeOverlaps } from '../utils/node-layout'

// Shared import behaviour for the Import Data dialog and for dropping a file onto
// the canvas: copy the file into the project, scaffold a pipeline for its format,
// then select and frame the source node so it is clear what to edit next.

function findRendererId(): string | null {
  for (const [id, op] of useOperatorStore.getState().operators.entries()) {
    if ((op.constructor as typeof Operator).displayName === 'DeckRenderer') return id
  }
  return null
}

// Point the renderer's basemap at newly imported data, unless something upstream
// already drives its camera (a BoundingBox, a keyframe source, ...)
function fitExistingBasemap(
  rendererId: string,
  viewState: { longitude: number; latitude: number; zoom: number },
  edges: Edge[]
) {
  const basemapId = edges.find(
    e => e.target === rendererId && e.targetHandle === 'par.basemap'
  )?.source
  const basemap = basemapId ? useOperatorStore.getState().operators.get(basemapId) : undefined
  if (!basemap || (basemap.constructor as typeof Operator).displayName !== 'MaplibreBasemap') return
  const driven = edges.some(
    e => e.target === basemapId && e.targetHandle?.startsWith('par.viewState')
  )
  if (driven) return
  // fitBounds frames the data from straight above, so drop any tilt or rotation
  const field = basemap.inputs.viewState
  field.setValue({ ...(field.value as object), ...viewState, pitch: 0, bearing: 0 })
}

// Size of the map the camera is fitted to. Right after a project loads the map may
// not be laid out yet, so fall back to the render size the Out node will use.
function mapSize() {
  const container =
    document.querySelector('.deckgl-container') || document.querySelector('.maplibregl-map')
  if (container?.clientWidth && container.clientHeight) {
    return { width: container.clientWidth, height: container.clientHeight }
  }
  for (const op of useOperatorStore.getState().operators.values()) {
    if ((op.constructor as typeof Operator).displayName !== 'Out') continue
    const { width, height, lod } = op.inputs as Record<string, { value: number }>
    if (width?.value && height?.value) {
      const scale = lod?.value || 1
      return { width: width.value * scale, height: height.value * scale }
    }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

export interface FileImportResult {
  format: DetectedFormat
  detection?: CoordinateDetection
}

interface UseFileImportOptions {
  // Where to place the pipeline, in flow coordinates
  getBasePosition: (event?: { clientX: number; clientY: number }) => { x: number; y: number }
  onImported?: (format: DetectedFormat) => void
}

export function useFileImport({ getBasePosition, onImported }: UseFileImportOptions) {
  const { addNodes, setEdges, setNodes, fitView, getNodes, getEdges } = useReactFlow()

  const addPipeline = useCallback(
    (
      url: string,
      format: DetectedFormat,
      basePosition: { x: number; y: number },
      detection?: CoordinateDetection
    ) => {
      const rendererId = findRendererId()
      const built = createImportPipeline({
        url,
        format,
        basePosition,
        detection,
        mapSize: mapSize(),
        rendererId,
      })
      const { edges, primaryNodeId, viewState } = built
      const nodes = resolveNodeOverlaps(built.nodes, getNodes())

      addNodes(nodes)
      if (edges.length > 0) {
        setEdges(current => normalizeMultiInputEdges(appendUniqueEdges(current, edges)))
      }
      setNodes(ns => ns.map(n => ({ ...n, selected: n.id === primaryNodeId })))
      // A scaffolded basemap already has the camera; an existing one is moved to the data
      if (rendererId && viewState) fitExistingBasemap(rendererId, viewState, getEdges())
      requestAnimationFrame(() => {
        fitView({ nodes: nodes.map(n => ({ id: n.id })), duration: 300, padding: 0.3 })
      })
    },
    [addNodes, setEdges, setNodes, fitView, getNodes, getEdges]
  )

  // Copy a dropped or picked file into the project's data directory, then build its pipeline
  const importFile = useCallback(
    async (
      file: File,
      basePosition: { x: number; y: number },
      source: string
    ): Promise<FileImportResult> => {
      const fileType = extensionOf(file.name) || 'unknown'
      let analyticsTracked = false

      try {
        const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
        if (!currentProjectName) {
          analytics.track('file_import_failed', {
            fileType,
            attemptedFormat: detectFormat(file.name),
            reason: 'no_project',
            source,
            fileSize: file.size,
          })
          analyticsTracked = true
          throw new Error('No project loaded. Please save or load a project first.')
        }

        // Binary formats have to round-trip as a Blob; reading them as text corrupts them
        const probableFormat = detectFormat(file.name)
        const binary = isBinaryFormat(probableFormat)
        const contents = binary ? file : await file.text()

        const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)
        if (!result.success) {
          analytics.track('file_import_failed', {
            fileType,
            attemptedFormat: probableFormat,
            reason: 'write_failed',
            source,
            fileSize: file.size,
          })
          analyticsTracked = true
          throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
        }

        debugUI('File imported: %s', file.name)
        const format = binary ? probableFormat : detectFormat(file.name, contents as string)
        const detection = binary ? undefined : detectFileCoordinates(format, contents as string)
        addPipeline(projectScheme + file.name, format, basePosition, detection)

        analytics.track('file_imported', {
          fileType,
          fileFormat: format,
          source,
          fileSize: file.size,
        })
        analytics.track('data_imported', { source, format })
        // Tabular files only: GeoJSON always has geometry, so detection says nothing there
        if (detection && detection.kind !== 'geojson') {
          analytics.track('coordinates_detected', {
            source,
            fileFormat: format,
            detected: detection.kind !== 'none',
            method: detection.kind,
            reason: detection.kind === 'none' ? detection.reason : undefined,
            sizedByColumn: 'sizeColumn' in detection && detection.sizeColumn !== undefined,
            rowCountBucket: rowCountBucket(detection.rowCount),
          })
        }
        onImported?.(format)
        return { format, detection }
      } catch (error) {
        // Only track unknown failures if we haven't already tracked this error
        if (!analyticsTracked) {
          analytics.track('file_import_failed', {
            fileType,
            attemptedFormat: detectFormat(file.name),
            reason: 'unknown',
            source,
            fileSize: file.size,
          })
        }
        throw error
      }
    },
    [addPipeline, onImported]
  )

  const importUrl = useCallback(
    (url: string, source: string, format = detectFormatFromUrl(url)) => {
      addPipeline(url, format, getBasePosition())
      // Don't track success here - FileOp will load the URL asynchronously and may fail
      // We can't know if the import succeeded until FileOp actually fetches and parses the data
      analytics.track('data_imported', { source, format })
      onImported?.(format)
      return format
    },
    [addPipeline, getBasePosition, onImported]
  )

  return { importFile, importUrl }
}
