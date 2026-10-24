import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { docStore } from '../../editor/doc-store'
import { getRenderSurfaceSize } from '../../render/render-surface-size'
import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import {
  type CoordinateDetection,
  detectFileCoordinates,
  rowCountBucket,
} from '../components/tools/detect-coordinates'
import {
  createImportDoc,
  type DetectedFormat,
  detectFormat,
  detectFormatFromUrl,
  extensionOf,
  isBinaryFormat,
} from '../components/tools/import-pipelines'
import { useFileSystemStore } from '../filesystem-store'
import { writeAsset } from '../storage'
import { projectScheme } from '../utils/filesystem'

// Shared import behaviour for the Import Data dialog and for dropping a file onto
// the canvas: copy the file into the project, scaffold a pipeline for its format,
// then select and frame the source node so it is clear what to edit next.

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
  const { fitView } = useReactFlow()

  const addPipeline = useCallback(
    (
      url: string,
      format: DetectedFormat,
      basePosition: { x: number; y: number },
      detection?: CoordinateDetection
    ) => {
      const store = docStore()
      const built = createImportDoc({
        doc: store.get().doc,
        url,
        format,
        basePosition,
        detection,
        // Fit to the surface the renderer draws to, as BoundingBoxOp does
        mapSize: getRenderSurfaceSize(),
      })
      store.edit(d => {
        d.nodes.push(...built.nodes)
        d.edges.push(...built.edges)
        // A deck already there turns to the data, unless its camera is wired to something
        const deck = d.nodes.find(n => n.id === built.deckId)
        const driven = d.edges.some(e => e.target === built.deckId && e.targetPort === 'viewState')
        if (deck && built.viewState && !built.newDeck && !driven) {
          Object.assign(deck.params, { ...built.viewState, pitch: 0, bearing: 0 })
        }
      })
      store.set({ selection: [built.primaryNodeId] })
      requestAnimationFrame(() => {
        fitView({ nodes: built.nodes.map(n => ({ id: n.id })), duration: 300, padding: 0.3 })
      })
    },
    [fitView]
  )

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
