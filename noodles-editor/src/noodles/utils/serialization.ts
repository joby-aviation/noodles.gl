import type { NodeJSON } from 'SKIP-@xyflow/react'
import type {
  Edge as ReactFlowEdge,
  ReactFlowJsonObject,
  Node as ReactFlowNode,
} from '@xyflow/react'
import JSZip from 'jszip'
import { isEqual } from 'lodash'

import { resizeableNodes } from '../components/op-components'
import type { useOperatorStore } from '../store'
import type { ExtractProps } from './extract-props'
import { parseHandleId } from './path-utils'

export { NOODLES_VERSION } from './migrate-schema'

export type EditorSettings = {
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
  showOverlay?: boolean
}

export type RenderSettings = {
  display: 'fixed' | 'responsive'
  resolution: { width: number; height: number }
  lod: number
  waitForData: boolean
  codec: 'avc' | 'hevc' | 'vp9' | 'av1'
  bitrateMbps: number
  bitrateMode: 'constant' | 'variable'
  scaleControl: number
  framerate: number
  captureDelay: number
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  display: 'fixed',
  resolution: { width: 1920, height: 1080 },
  lod: 2,
  waitForData: true,
  codec: 'avc',
  bitrateMbps: 10,
  bitrateMode: 'constant',
  scaleControl: 0.3,
  framerate: 30,
  captureDelay: 200,
}

export type NoodlesProjectJSON = ReactFlowJsonObject & {
  version: number
  timeline: Record<string, unknown>
  editorSettings?: EditorSettings
  renderSettings?: Partial<RenderSettings>
  apiKeys?: {
    mapbox?: string
    googleMaps?: string
    anthropic?: string
  }
}
export type CopiedNodesJSON = Omit<ReactFlowJsonObject, 'viewport'>

export const EMPTY_PROJECT: NoodlesProjectJSON = {
  version: 0,
  timeline: {},
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  editorSettings: {},
}

// Replace functions and circular references
function getJsonSanitizer() {
  const seen = new Set()
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return undefined
      }
      seen.add(value)
    } else if (typeof value === 'function') {
      return undefined
    }
    return value
  }
}

export function safeStringify(obj: Record<string, unknown>) {
  return `${JSON.stringify(obj, getJsonSanitizer(), 2)}\n`
}

export function serializeNodes(
  store: ReturnType<typeof useOperatorStore.getState>,
  nodes: ReactFlowNode<Record<string, unknown>>[],
  edges: ReactFlowEdge[]
) {
  // Make a copy of the node to prepared for serialization.
  const preparedNodes: NodeJSON<unknown>[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      // Include visual aid nodes (e.g. for loops) as-is
      preparedNodes.push(node)
      continue
    }
    const op = store.getOp(node.id)
    if (!op) continue

    // Don't set node data for connected inputs (saves space) except if upstream op is locked
    const incomers = edges
      .filter(edge => edge.target === node.id && edge.type !== 'ReferenceEdge')
      .filter(edge => store.getOp(edge.source)?.locked?.value === false)
      .map(edge => parseHandleId(edge.targetHandle)?.fieldName)
      .reduce((acc, fieldName) => acc.add(fieldName), new Set())

    // Serialize fields
    const inputs: ExtractProps<ReturnType<typeof op.createInputs>> = {}
    for (const [name, field] of Object.entries(op.inputs)) {
      const serialized = field.serialize()
      if (
        serialized !== undefined &&
        !isEqual(serialized, field.defaultValue) &&
        !incomers.has(name)
      ) {
        inputs[name] = serialized
      }
    }

    // Clean up the node object to remove unnecessary properties (they're recreated on load)
    const {
      selected: _,
      dragging: __,
      hidden: ___,
      dragHandle: ____,
      measured,
      width,
      height,
      ...cleanedNode
    } = node

    preparedNodes.push({
      ...cleanedNode,
      ...(resizeableNodes.includes(node.type) ? { width, height, measured } : {}),
      data: {
        inputs,
        locked: op.locked.value,
      },
    })
  }
  return preparedNodes
}

export function serializeEdges(
  _store: ReturnType<typeof useOperatorStore.getState>,
  nodes: ReactFlowNode<Record<string, unknown>>[],
  edges: ReactFlowEdge[]
) {
  // Create a set of valid node IDs to filter out orphaned edges
  const validNodeIds = new Set(nodes.map(node => node.id))

  return edges
    .filter(edge => {
      // Skip edges that reference non-existent nodes
      if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) {
        console.warn(
          `Skipping orphaned edge during serialization: ${edge.id} (${edge.source} -> ${edge.target})`
        )
        return false
      }
      // Skip ReferenceEdge types - they should not be persisted in save files
      if (edge.type === 'ReferenceEdge') {
        return false
      }
      return true
    })
    .map(edge =>
      Object.fromEntries(
        Object.entries(edge).filter(([key]) => !['selected', 'animated'].includes(key))
      )
    )
}

// Pre-load all example asset URLs for download functionality
const exampleAssetUrls: Record<string, string> = import.meta.glob('../../examples/**/*', {
  eager: true,
  import: 'default',
  query: '?url',
})

// Export a project as a downloadable zip file containing noodles.json and data files
export async function saveProjectLocally(
  projectName: string,
  projectJson: NoodlesProjectJSON,
  storageType: 'fileSystemAccess' | 'opfs' | 'publicFolder'
) {
  const zip = new JSZip()

  // Create a folder with the project name
  const projectFolder = zip.folder(projectName)
  if (!projectFolder) {
    throw new Error('Failed to create project folder in zip')
  }

  // Add noodles.json to the project folder
  const contents = safeStringify(projectJson)
  projectFolder.file('noodles.json', contents)

  // Handle data files based on storage type
  if (storageType === 'publicFolder') {
    // For public folder projects, use pre-loaded asset URLs
    const projectPrefix = `../../examples/${projectName}/`

    for (const [assetPath, assetUrl] of Object.entries(exampleAssetUrls)) {
      // Skip the noodles.json file itself
      if (assetPath.endsWith('noodles.json')) {
        continue
      }

      // Only include files from this specific project
      if (assetPath.startsWith(projectPrefix)) {
        // Extract the relative path within the project
        const relativePath = assetPath.substring(projectPrefix.length)

        try {
          const response = await fetch(assetUrl)
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer()
            projectFolder.file(relativePath, arrayBuffer)
          }
        } catch (error) {
          console.warn(`Could not fetch asset ${relativePath}:`, error)
        }
      }
    }
  } else {
    // For fileSystemAccess and opfs storage types
    try {
      const { getProjectDirectoryHandle } = await import('../storage')
      const { directoryExists } = await import('./filesystem')
      const projectDirectoryResult = await getProjectDirectoryHandle(
        storageType,
        projectName,
        false
      )

      if (projectDirectoryResult.success) {
        const projectDirectory = projectDirectoryResult.data
        const hasDataDir = await directoryExists(projectDirectory, 'data')

        if (hasDataDir) {
          const dataDirectory = await projectDirectory.getDirectoryHandle('data')

          // Read all files from the data directory
          for await (const entry of dataDirectory.values()) {
            if (entry.kind === 'file') {
              const fileHandle = entry as FileSystemFileHandle
              const file = await fileHandle.getFile()
              const arrayBuffer = await file.arrayBuffer()
              projectFolder.file(`data/${entry.name}`, arrayBuffer)
            }
          }
        }
      }
    } catch (error) {
      console.warn('Could not read data files for export:', error)
      // Continue with export even if data files can't be read
    }
  }

  // Generate the zip file and trigger download
  const blob = await zip.generateAsync({ type: 'blob' })

  const a = document.createElement('a')
  a.download = `${projectName}.zip`
  const url = URL.createObjectURL(blob)
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
