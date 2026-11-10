// Opening the project the route names, as one state: opening, open, not found or failed.
//
// Each open takes a token, and an open that a later one overtook drops its result, so the
// project that ends up open is the one the URL shows. The folder, the storage type and the
// document change together, and only once the document has loaded: an open that fails leaves
// the previous project as it was, so autosave can't write it under the new project's name.
//
// A save that moves the document to a new route (the first save of an example or new project,
// Save As, Rename) opens that route with the document already in the editor: the route change
// that follows doesn't read it back from disk, which would drop undo history and selection.

import type { EditorDoc } from '@noodles.gl/planner'
import { create } from 'zustand'
import type { ProjectOpenProblem } from '../noodles/components/project-not-found-dialog'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { getKeysStore, type KeysConfig, keysProjectId } from '../noodles/keys-store'
import newProjectJSON from '../noodles/new.json'
import { copyExampleAssetsToMemory, load, openFailureReason } from '../noodles/storage'
import type { StorageType } from '../noodles/utils/filesystem'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import { expandTimelineIfAnimated } from '../noodles/utils/timeline-panel'
import { analytics } from '../utils/analytics'
import { docStore } from './doc-store'
import { resetTimelinePanel } from './doc-timeline'
import { loadDoc } from './load-doc'
import { getUIStore } from './ui-store'

const exampleProjectUrls = import.meta.glob('../examples/**/noodles.json', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export type RoutePrefix = '/projects' | '/examples'

// Why a project didn't open: missing, or a remembered folder whose permission the browser reset
export interface OpenProblem {
  reason: ProjectOpenProblem
  directoryHandle?: FileSystemDirectoryHandle
}

/** `route` is the path the open is for, e.g. `/projects/flights`. */
export type ProjectOpenState =
  | { status: 'idle' }
  | { status: 'opening'; route: string; token: number }
  | { status: 'open'; route: string }
  | { status: 'not-found'; route: string; kind: 'project' | 'example'; problem?: OpenProblem }
  | { status: 'failed'; route: string }

export const useProjectOpen = create<ProjectOpenState>(() => ({ status: 'idle' }))

let latest = 0

export const routePath = (prefix: RoutePrefix, name: string | null) =>
  name ? `${prefix}/${name}` : ''

/** Where an opened document lives, for the file-system store. */
interface Location {
  directory: FileSystemDirectoryHandle | null
  name: string
  storage: StorageType
}

/**
 * Show a document. The timeline panel follows it through `bindTimeline`. `keysProject` names
 * the project for the per-project key choices in Settings.
 */
function showDoc(doc: EditorDoc, keysProject?: string) {
  // The project's own keys win over the browser's, so they go in before anything reads a key
  getKeysStore().setProjectKeys(doc.meta?.apiKeys as KeysConfig | undefined, keysProject)
  resetTimelinePanel()
  getUIStore().setStarterHintNodeId(null)
  docStore().load(doc)
  expandTimelineIfAnimated(doc)
}

function begin(route: string): number {
  latest += 1
  useProjectOpen.setState({ status: 'opening', route, token: latest }, true)
  return latest
}

const current = (token: number) => token === latest

/** Load a project file; open it if no later open started meanwhile. */
async function openJson(
  token: number,
  route: string,
  json: unknown,
  name: string,
  { keysProject, location }: { keysProject?: string; location?: Location } = {}
): Promise<boolean> {
  const { doc, warnings } = await loadDoc(json, name)
  if (!current(token)) return false
  for (const w of warnings) console.info('[open]', w)
  if (location) {
    const fs = useFileSystemStore.getState()
    fs.setCurrentDirectory(location.directory, location.name)
    fs.setActiveStorageType(location.storage)
  }
  showDoc(doc, keysProject)
  useProjectOpen.setState({ status: 'open', route }, true)
  return true
}

function failed(token: number, route: string, message: string, error: unknown) {
  if (!current(token)) return
  useProjectOpen.setState({ status: 'failed', route }, true)
  useFileSystemStore.getState().setError({
    type: 'unknown',
    message,
    details: error instanceof Error ? error.message : String(error),
    originalError: error,
  })
}

/**
 * Open what the route names. Does nothing when the editor already has that route open or
 * opening, e.g. the route a save just moved the document to.
 */
export async function openRoute(
  prefix: RoutePrefix,
  name: string | null,
  { onExampleOpened }: { onExampleOpened?: (name: string) => void } = {}
): Promise<void> {
  const route = routePath(prefix, name)
  const state = useProjectOpen.getState()
  if ((state.status === 'open' || state.status === 'opening') && state.route === route) return
  const token = begin(route)
  const notFound = (kind: 'project' | 'example', problem?: OpenProblem) => {
    if (current(token)) useProjectOpen.setState({ status: 'not-found', route, kind, problem }, true)
  }
  try {
    if (!name) {
      await openJson(token, route, newProjectJSON, 'Untitled')
      return
    }
    const keysProject = keysProjectId(prefix, name)
    const inMemory: Location = { directory: null, name, storage: 'memory' }
    if (name === 'new' || prefix === '/examples') {
      const json = memoryProjectStore.getProjectJson(name)
      if (json) {
        await openJson(token, route, json, name, { keysProject, location: inMemory })
        return
      }
    }
    if (name === 'new') {
      await openJson(token, route, newProjectJSON, 'new', { keysProject, location: inMemory })
      return
    }
    if (prefix === '/examples') {
      const url = exampleProjectUrls[`../examples/${name}/noodles.json`]
      if (!url) {
        notFound('example')
        return
      }
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to fetch example: ${response.statusText}`)
      const json = await response.json()
      if (!current(token)) return
      await copyExampleAssetsToMemory(name, name)
      if (await openJson(token, route, json, name, { keysProject, location: inMemory })) {
        onExampleOpened?.(name)
      }
      return
    }
    const storage = useFileSystemStore.getState().activeStorageType
    const result = await load(storage, name)
    if (!current(token)) return
    if (!result.success) {
      const { type, directoryHandle } = result.error
      analytics.track('project_open_failed', {
        storageType: storage,
        reason: openFailureReason(type),
        source: 'url',
      })
      if (type === 'not-found') {
        notFound('project', { reason: 'not-found' })
        return
      }
      if ((type === 'permission-prompt' || type === 'permission-denied') && directoryHandle) {
        // A remembered folder whose permission the browser reset, e.g. after a restart
        notFound('project', { reason: type, directoryHandle })
        return
      }
      throw new Error(result.error.message)
    }
    const location = { directory: result.data.directoryHandle, name, storage }
    if (await openJson(token, route, result.data.projectData, name, { keysProject, location })) {
      analytics.track('project_opened', { storageType: storage, source: 'url' })
    }
  } catch (error) {
    failed(token, route, 'Error opening project', error)
  }
}

/**
 * Open a project file the user picked, such as an import or one the not-found dialog found,
 * under `route`. It overtakes an open still under way.
 */
export async function openFile(
  json: unknown,
  name: string,
  route: string,
  keysProject?: string
): Promise<void> {
  const token = begin(route)
  try {
    await openJson(token, route, json, name, { keysProject })
  } catch (error) {
    failed(token, route, 'Error opening project', error)
  }
}

/**
 * The open document was saved to a folder: it is now the project at `/projects/<name>`, and
 * navigating there keeps it as it is. Any open still under way is dropped.
 */
export function savedAs(directory: FileSystemDirectoryHandle, name: string) {
  latest += 1
  const fs = useFileSystemStore.getState()
  fs.setCurrentDirectory(directory, name)
  fs.setActiveStorageType('fileSystemAccess')
  useProjectOpen.setState({ status: 'open', route: routePath('/projects', name) }, true)
}

/** The user closed the not-found dialog: the editor keeps what it had. */
export function dismissNotFound() {
  if (useProjectOpen.getState().status === 'not-found') {
    useProjectOpen.setState({ status: 'idle' }, true)
  }
}

/** The editor closed: drop any open under way, and open the route afresh next time. */
export function closeProject() {
  latest += 1
  useProjectOpen.setState({ status: 'idle' }, true)
}
