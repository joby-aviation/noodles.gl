import type {
  Edge as ReactFlowEdge,
  ReactFlowJsonObject,
  Node as ReactFlowNode,
} from '@xyflow/react'
import { debugSerialize } from '../../utils/debug'
import type { StorageType } from './filesystem'
import { CACHE_DIRECTORY_NAME, type OutputCacheFiles } from './output-cache'
import type { RenderSettings } from './render-settings-constants'

export { NOODLES_VERSION } from './migrate-schema'

// Older projects may also carry `algorithm` and `direction`; they are ignored on load
export type AutoLayoutSettings = {
  enabled: boolean
}

export const DEFAULT_AUTO_LAYOUT: AutoLayoutSettings = {
  enabled: false,
}

export type EditorSettings = {
  showOverlay?: boolean
  autoLayout?: Partial<AutoLayoutSettings>
  showDebugInfo?: boolean
  // Examples only: node selected when the example first opens (see utils/starter-node.ts)
  startNode?: string
}

export type { RenderSettings } from './render-settings-constants'
export { DEFAULT_RENDER_SETTINGS } from './render-settings-constants'

export type NoodlesProjectJSON = Omit<ReactFlowJsonObject, 'viewport'> & {
  // Older files carry the graph viewport. It is ignored on load, which fits the graph
  // instead, and never written.
  viewport?: ReactFlowJsonObject['viewport']
  version: number
  timeline: Record<string, unknown>
  name?: string
  editorSettings?: EditorSettings
  renderSettings?: Partial<RenderSettings>
  apiKeys?: {
    mapbox?: string
    googleMaps?: string
    cesium?: string
    // Older files may carry AI keys. They are dropped on load and never written.
    anthropic?: string
  }
}
export type CopiedNodesJSON = Omit<ReactFlowJsonObject, 'viewport'>

export const EMPTY_PROJECT: NoodlesProjectJSON = {
  version: 0,
  timeline: {},
  nodes: [],
  edges: [],
  editorSettings: {},
}

// Replace functions and circular references while preserving repeated references.
// A connected field can share the exact same object value with its source. Once the
// field is disconnected, that value becomes local state and must serialize in full.
function getJsonSanitizer() {
  const ancestors: unknown[] = []
  return function (this: unknown, _key: string, value: unknown) {
    if (typeof value === 'function') {
      return undefined
    }

    if (typeof value === 'object' && value !== null) {
      // JSON.stringify calls the replacer with the containing object as `this`.
      // Objects no longer in that containing object's ancestry are safe to visit
      // again; only a value already in the current ancestry is truly circular.
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop()
      }
      if (ancestors.includes(value)) {
        return undefined
      }
      ancestors.push(value)
    }
    return value
  }
}

export function safeStringify(obj: Record<string, unknown>) {
  return `${JSON.stringify(obj, getJsonSanitizer(), 2)}\n`
}

// Pre-load all example asset URLs for download functionality
const exampleAssetUrls: Record<string, string> = import.meta.glob('../../examples/**/*', {
  eager: true,
  import: 'default',
  query: '?url',
})

export async function saveProjectLocally(
  projectName: string,
  projectJson: NoodlesProjectJSON,
  storageType: StorageType,
  cacheFiles: OutputCacheFiles
) {
  debugSerialize('saveProjectLocally: %s (storage: %s)', projectName, storageType)
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  // Use a readable folder name for the ZIP (strip draft ID prefixes)
  const folderName =
    projectName.startsWith('draft-') ||
    projectName.startsWith('example-') ||
    projectName.startsWith('import-')
      ? 'project'
      : projectName
  const projectFolder = zip.folder(folderName)
  if (!projectFolder) {
    throw new Error('Failed to create project folder in zip')
  }

  // Add noodles.json to the project folder
  const contents = safeStringify(projectJson)
  projectFolder.file('noodles.json', contents)
  for (const [fileName, cacheContents] of cacheFiles) {
    projectFolder.file(`${CACHE_DIRECTORY_NAME}/${fileName}`, cacheContents)
  }

  // Handle data files based on storage type
  if (storageType === 'memory') {
    const { memoryProjectStore } = await import('./memory-project-store')
    const assets = memoryProjectStore.getAllAssets(projectName)
    for (const [fileName, blob] of assets) {
      const arrayBuffer = await blob.arrayBuffer()
      projectFolder.file(`data/${fileName}`, arrayBuffer)
    }
  } else if (storageType === 'publicFolder') {
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
        // The cache folder was written above from the current outputs
        if (relativePath.startsWith(`${CACHE_DIRECTORY_NAME}/`)) continue

        try {
          const response = await fetch(assetUrl)
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer()
            projectFolder.file(relativePath, arrayBuffer)
          }
        } catch (error) {
          debugSerialize(`Could not fetch asset ${relativePath}:`, error)
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
      debugSerialize('Could not read data files for export:', error)
      // Continue with export even if data files can't be read
    }
  }

  // Generate the zip file and trigger download
  const blob = await zip.generateAsync({ type: 'blob' })

  const a = document.createElement('a')
  a.download = `${folderName}.zip`
  const url = URL.createObjectURL(blob)
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
