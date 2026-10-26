// Saving and finding project folders: Save, Save As and Rename write the document to a folder
// the user picks, an example or new project saved for the first time moves from memory to a
// folder, and a project or example that is not there gets a dialog saying what to do instead.

import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { ExampleNotFoundDialog } from '../noodles/components/example-not-found-dialog'
import {
  ProjectNotFoundDialog,
  type ProjectOpenProblem,
} from '../noodles/components/project-not-found-dialog'
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

export type NotFound = 'project' | 'example' | null

// Why a project didn't open: missing, or a remembered folder whose permission the browser reset
export interface OpenProblem {
  reason: ProjectOpenProblem
  directoryHandle?: FileSystemDirectoryHandle
}

interface ProjectFilesOptions {
  projectName: string | null
  storageType: StorageType
  navigate: (to: string, options?: { replace?: boolean }) => void
  /** Open a project file the not-found dialog found. */
  open: (json: unknown, name: string) => Promise<void>
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

// The document is written: what Settings shows as the project's saved keys follows it
function markSaved() {
  getKeysStore().markProjectKeysSaved()
  docStore().set({ dirty: false })
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

export function useProjectFiles({
  projectName,
  storageType,
  navigate,
  open,
  onNewProject,
  onImport,
}: ProjectFilesOptions) {
  const { currentDirectory, setCurrentDirectory, setActiveStorageType, setError } =
    useFileSystemStore()
  const [notFound, setNotFoundKind] = useState<NotFound>(null)
  const [problem, setProblem] = useState<OpenProblem | null>(null)
  const setNotFound = useCallback((kind: NotFound, why: OpenProblem | null = null) => {
    setNotFoundKind(kind)
    setProblem(why)
  }, [])
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

  // The document now lives in a folder: remember it and show its name in the route. The
  // per-project key choices move with a project, or are copied to a copy of it (Save As).
  const savedTo = useCallback(
    async (directory: FileSystemDirectoryHandle, name: string, keys: 'move' | 'copy') => {
      await directoryHandleCache.cacheHandle(name, directory, directory.name)
      const keysProject = keysProjectId('/projects', name)
      if (keys === 'move') getKeysStore().moveKeyOverridesTo(keysProject)
      else getKeysStore().copyKeyOverridesTo(keysProject)
      setCurrentDirectory(directory, name)
      setActiveStorageType('fileSystemAccess')
      navigate(`/projects/${name}`, { replace: true })
      markSaved()
    },
    [setCurrentDirectory, setActiveStorageType, navigate]
  )

  const onSaveProject = useCallback(async () => {
    if (!projectName) return
    // An example or a new project is only in memory until the user picks a folder for it
    if (storageType === 'memory') {
      try {
        const directory = await selectDirectory()
        if (!(await requestPermission(directory, 'readwrite'))) return
        await writeFileToDirectory(directory, 'noodles.json', safeStringify(projectJson()))
        await copyMemoryDataToDirectory(projectName, directory)
        await savedTo(directory, directory.name, 'move')
        memoryProjectStore.deleteProject(projectName)
        analytics.track('project_saved', { storageType: 'memory', promoted: true })
      } catch (error) {
        if (!isAbort(error)) reportError('Error saving project', error)
      }
      return
    }
    const result = await save(storageType, projectName, projectJson(), new Map())
    if (!result.success) {
      setError(result.error)
      return
    }
    setCurrentDirectory(result.data.directoryHandle, projectName)
    markSaved()
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
      await writeFileToDirectory(target, 'noodles.json', safeStringify(projectJson()))
      if (copyDataFiles && projectName) {
        if (storageType === 'memory') await copyMemoryDataToDirectory(projectName, target)
        else if (storageType === 'publicFolder') await copyPublicFolderData(projectName, target)
        else if (currentDirectory) await copyDataDirectory(currentDirectory, target)
      }
      if (storageType === 'memory' && projectName) memoryProjectStore.deleteProject(projectName)
      await savedTo(target, target.name, 'copy')
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
      await writeFileToDirectory(directory, 'noodles.json', safeStringify(projectJson()))
      if (currentDirectory) await copyDataDirectory(currentDirectory, directory)
      if (projectName) await directoryHandleCache.renameProject(projectName, newName, directory)
      await savedTo(directory, newName, 'move')
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
          setNotFound(null)
          navigate(`/projects/${name}`)
          void open(project, name)
        }}
        onNewProject={onNewProject}
        onImport={onImport}
        onClose={() => setNotFound(null)}
      />
      <ExampleNotFoundDialog
        projectName={projectName ?? ''}
        open={notFound === 'example'}
        onBrowseExamples={() => {
          setNotFound(null)
          navigate('/examples')
        }}
        onCheckMyProjects={() => {
          setNotFound(null)
          if (projectName) navigate(`/projects/${projectName}`)
        }}
        onClose={() => setNotFound(null)}
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
    setNotFound,
    dialogs,
  }
}
