// Saving and finding project folders: Save, Save As and Rename write the document to a folder
// the user picks, an example or new project saved for the first time moves from memory to a
// folder, and a project or example that is not there gets a dialog saying what to do instead.

import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { ExampleNotFoundDialog } from '../noodles/components/example-not-found-dialog'
import { ProjectNotFoundDialog } from '../noodles/components/project-not-found-dialog'
import { RenameDialog } from '../noodles/components/rename-dialog'
import { SaveAsDialog } from '../noodles/components/save-as-dialog'
import { StorageErrorHandler } from '../noodles/components/storage-error-handler'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { getKeysForProject, getKeysStore, keysProjectId } from '../noodles/keys-store'
import {
  copyDataDirectory,
  copyMemoryDataToDirectory,
  copyPublicFolderData,
  hasDataDirectory,
  save,
} from '../noodles/storage'
import { directoryHandleCache } from '../noodles/utils/directory-handle-cache'
import {
  fileExists,
  requestPermission,
  type StorageType,
  selectDirectory,
  writeFileToDirectory,
} from '../noodles/utils/filesystem'
import { shouldBlockKeyboardShortcut } from '../noodles/utils/input-detection'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import { type NoodlesProjectJSON, safeStringify } from '../noodles/utils/serialization'
import { analytics } from '../utils/analytics'
import { docStore } from './doc-store'
import { dismissNotFound, openFile, routePath, savedAs, useProjectOpen } from './project-open'

interface ProjectFilesOptions {
  projectName: string | null
  storageType: StorageType
  navigate: (to: string, options?: { replace?: boolean }) => void
  onNewProject: () => Promise<void>
  onImport: () => Promise<void>
}

// The document as saved, with the project's keys as they are now: Settings can edit them
export function projectJson(): NoodlesProjectJSON {
  const { doc } = docStore().get()
  const { apiKeys: _opened, ...meta } = doc.meta ?? {}
  const apiKeys = getKeysForProject()
  return {
    ...doc,
    meta: { ...meta, ...(apiKeys ? { apiKeys } : {}) },
  } as unknown as NoodlesProjectJSON
}

// What a save writes, and which document and revision of it that is: the user can keep
// editing, or open another project, while it writes
function snapshot() {
  const { loadId, revision } = docStore().get()
  return { json: projectJson(), loadId, revision, keys: getKeysStore().projectKeys }
}
type Snapshot = ReturnType<typeof snapshot>

const stillOpen = (saved: Snapshot) => docStore().get().loadId === saved.loadId

// The document is written: it is clean unless edited since, and what Settings shows as the
// project's saved keys follows the file
function markSaved(saved: Snapshot) {
  if (!stillOpen(saved)) return
  getKeysStore().markProjectKeysSaved(saved.keys)
  docStore().saved(saved.revision)
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

export function useProjectFiles({
  projectName,
  storageType,
  navigate,
  onNewProject,
  onImport,
}: ProjectFilesOptions) {
  const { currentDirectory, setCurrentDirectory, setError } = useFileSystemStore()
  const opened = useProjectOpen()
  const notFound = opened.status === 'not-found' ? opened.kind : null
  const problem = opened.status === 'not-found' ? opened.problem : undefined
  const [renaming, setRenaming] = useState(false)
  const [saveAs, setSaveAs] = useState<{
    target: FileSystemDirectoryHandle
    hasExistingProject: boolean
    hasDataFiles: boolean
  } | null>(null)

  const reportError = useCallback(
    (message: string, error: unknown) =>
      setError({
        type: 'unknown',
        message,
        details: error instanceof Error ? error.message : String(error),
        originalError: error,
      }),
    [setError]
  )

  // The document now lives in a folder: remember it and show its name in the route, keeping
  // the document as it is in the editor. The per-project key choices move with a project, or
  // are copied to a copy of it (Save As).
  const savedTo = useCallback(
    async (
      directory: FileSystemDirectoryHandle,
      name: string,
      keys: 'move' | 'copy',
      saved: Snapshot
    ) => {
      await directoryHandleCache.cacheHandle(name, directory, directory.name)
      if (!stillOpen(saved)) return
      const keysProject = keysProjectId('/projects', name)
      if (keys === 'move') getKeysStore().moveKeyOverridesTo(keysProject)
      else getKeysStore().copyKeyOverridesTo(keysProject)
      savedAs(directory, name)
      navigate(routePath('/projects', name), { replace: true })
      markSaved(saved)
    },
    [navigate]
  )

  const onSaveProject = useCallback(async () => {
    if (!projectName) return
    // An example or a new project is only in memory until the user picks a folder for it
    if (storageType === 'memory') {
      try {
        const directory = await selectDirectory()
        if (!(await requestPermission(directory, 'readwrite'))) return
        const saved = snapshot()
        await writeFileToDirectory(directory, 'noodles.json', safeStringify(saved.json))
        await copyMemoryDataToDirectory(projectName, directory)
        await savedTo(directory, directory.name, 'move', saved)
        memoryProjectStore.deleteProject(projectName)
        analytics.track('project_saved', { storageType: 'memory', promoted: true })
      } catch (error) {
        if (!isAbort(error)) reportError('Error saving project', error)
      }
      return
    }
    const saved = snapshot()
    const result = await save(storageType, projectName, saved.json, new Map())
    if (!result.success) {
      setError(result.error)
      return
    }
    if (stillOpen(saved)) setCurrentDirectory(result.data.directoryHandle, projectName)
    markSaved(saved)
    analytics.track('project_saved', { storageType })
  }, [projectName, storageType, savedTo, reportError, setError, setCurrentDirectory])

  // Save As, step 1: pick the folder, then ask what to bring along
  const onSaveAs = useCallback(async () => {
    try {
      const target = await selectDirectory()
      if (!(await requestPermission(target, 'readwrite'))) return
      setSaveAs({
        target,
        hasExistingProject: await fileExists(target, 'noodles.json'),
        hasDataFiles: projectName ? await hasDataDirectory(storageType, projectName) : false,
      })
    } catch (error) {
      if (!isAbort(error)) reportError('Error selecting directory', error)
    }
  }, [projectName, storageType, reportError])

  // Save As, step 2: write it there
  const onSaveAsConfirm = useCallback(
    async ({ copyDataFiles }: { copyDataFiles: boolean }) => {
      if (!saveAs) return
      const { target } = saveAs
      const saved = snapshot()
      await writeFileToDirectory(target, 'noodles.json', safeStringify(saved.json))
      if (copyDataFiles && projectName) {
        if (storageType === 'memory') await copyMemoryDataToDirectory(projectName, target)
        else if (storageType === 'publicFolder') await copyPublicFolderData(projectName, target)
        else if (currentDirectory) await copyDataDirectory(currentDirectory, target)
      }
      if (storageType === 'memory' && projectName) memoryProjectStore.deleteProject(projectName)
      await savedTo(target, target.name, 'copy', saved)
      analytics.track('project_saved_as', {
        fromStorageType: storageType,
        toStorageType: 'fileSystemAccess',
        copyDataFiles,
        overwroteExisting: saveAs.hasExistingProject,
      })
    },
    [saveAs, projectName, storageType, currentDirectory, savedTo]
  )

  // Rename: a copy in a folder with the new name. The dialog shows what goes wrong.
  const canRename = !!projectName && storageType !== 'publicFolder' && storageType !== 'memory'
  const onRenameConfirm = useCallback(
    async (newName: string) => {
      let directory: FileSystemDirectoryHandle
      try {
        directory = await selectDirectory()
      } catch (error) {
        if (isAbort(error)) throw new Error('Directory selection was cancelled')
        throw error
      }
      if (directory.name.toLowerCase() !== newName.toLowerCase()) {
        throw new Error(
          `Selected folder name "${directory.name}" does not match the entered name "${newName}". Please select or create a folder with the name "${newName}".`
        )
      }
      if (!(await requestPermission(directory, 'readwrite'))) {
        throw new Error('Permission denied to write to directory')
      }
      const saved = snapshot()
      await writeFileToDirectory(directory, 'noodles.json', safeStringify(saved.json))
      if (currentDirectory) await copyDataDirectory(currentDirectory, directory)
      if (projectName) await directoryHandleCache.renameProject(projectName, newName, directory)
      await savedTo(directory, newName, 'move', saved)
      analytics.track('project_renamed', {
        fromStorageType: storageType,
        toStorageType: 'fileSystemAccess',
      })
    },
    [currentDirectory, projectName, storageType, savedTo]
  )

  // mod+shift+s saves as, mod+shift+a renames
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldBlockKeyboardShortcut(e) || !(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        void onSaveAs()
      } else if (key === 'a' && canRename) {
        e.preventDefault()
        setRenaming(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSaveAs, canRename])

  const dialogs: ReactNode = (
    <>
      <ProjectNotFoundDialog
        projectName={projectName ?? ''}
        open={notFound === 'project'}
        reason={problem?.reason}
        directoryHandle={problem?.directoryHandle}
        onProjectLoaded={(project, name) => {
          // Opening it first means the route change that follows doesn't read it again
          const route = routePath('/projects', name)
          void openFile(project, name, route, keysProjectId('/projects', name))
          navigate(route)
        }}
        onNewProject={onNewProject}
        onImport={onImport}
        onClose={dismissNotFound}
      />
      <ExampleNotFoundDialog
        projectName={projectName ?? ''}
        open={notFound === 'example'}
        onBrowseExamples={() => {
          dismissNotFound()
          navigate('/examples')
        }}
        onCheckMyProjects={() => {
          dismissNotFound()
          if (projectName) navigate(routePath('/projects', projectName))
        }}
        onClose={dismissNotFound}
      />
      <SaveAsDialog
        open={saveAs !== null}
        onClose={() => setSaveAs(null)}
        onConfirm={onSaveAsConfirm}
        targetDirectoryName={saveAs?.target.name ?? ''}
        hasExistingProject={saveAs?.hasExistingProject ?? false}
        hasDataFiles={saveAs?.hasDataFiles ?? false}
      />
      <RenameDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        onConfirm={onRenameConfirm}
        currentName={projectName ?? ''}
      />
      <StorageErrorHandler />
    </>
  )

  return {
    onSaveProject,
    onSaveAs,
    onRename: canRename ? () => setRenaming(true) : undefined,
    dialogs,
  }
}
