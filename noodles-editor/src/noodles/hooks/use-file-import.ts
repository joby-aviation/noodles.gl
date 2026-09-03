import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
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
import { projectScheme } from '../utils/filesystem'
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

interface UseFileImportOptions {
  // Where to place the pipeline, in flow coordinates
  getBasePosition: (event?: { clientX: number; clientY: number }) => { x: number; y: number }
  onImported?: (format: DetectedFormat) => void
}

export function useFileImport({ getBasePosition, onImported }: UseFileImportOptions) {
  const { addNodes, addEdges, setNodes, fitView, getNodes } = useReactFlow()

  const addPipeline = useCallback(
    (
      url: string,
      format: DetectedFormat,
      basePosition: { x: number; y: number },
      contents?: string
    ) => {
      const built = createImportPipeline({
        url,
        format,
        basePosition,
        contents,
        rendererId: findRendererId(),
      })
      const { edges, primaryNodeId } = built
      const nodes = resolveNodeOverlaps(built.nodes, getNodes())

      addNodes(nodes)
      if (edges.length > 0) addEdges(edges)
      setNodes(ns => ns.map(n => ({ ...n, selected: n.id === primaryNodeId })))
      requestAnimationFrame(() => {
        fitView({ nodes: nodes.map(n => ({ id: n.id })), duration: 300, padding: 0.3 })
      })
    },
    [addNodes, addEdges, setNodes, fitView, getNodes]
  )

  // Copy a dropped or picked file into the project's data directory, then build its pipeline
  const importFile = useCallback(
    async (file: File, basePosition: { x: number; y: number }, source: string) => {
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
        addPipeline(
          projectScheme + file.name,
          format,
          basePosition,
          binary ? undefined : (contents as string)
        )

        analytics.track('file_imported', {
          fileType,
          fileFormat: format,
          source,
          fileSize: file.size,
        })
        analytics.track('data_imported', { source, format })
        onImported?.(format)
        return format
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
