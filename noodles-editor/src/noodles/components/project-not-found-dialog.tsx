import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import { useFileSystemStore } from '../filesystem-store'
import { type FileSystemProject, type FileSystemResult, load, openFailureReason } from '../storage'
import { requestPermissionState, selectDirectory } from '../utils/filesystem'
import { migrateProject } from '../utils/migrate-schema'
import type { OutputCache } from '../utils/output-cache'
import type { NoodlesProjectJSON } from '../utils/serialization'
import s from './menu.module.css'

// Why a saved project couldn't be opened from its URL
export type ProjectOpenProblem = 'not-found' | 'permission-prompt' | 'permission-denied'

interface ProjectNotFoundDialogProps {
  projectName: string
  open: boolean
  // Defaults to 'not-found'
  reason?: ProjectOpenProblem
  // The remembered folder, when the problem is its permission
  directoryHandle?: FileSystemDirectoryHandle
  onProjectLoaded: (
    project: NoodlesProjectJSON,
    projectName: string,
    outputCache?: OutputCache
  ) => void
  onNewProject: () => Promise<void>
  onImport: () => Promise<void>
  onClose: () => void
}

export const ProjectNotFoundDialog = ({
  projectName,
  open,
  reason = 'not-found',
  directoryHandle,
  onProjectLoaded,
  onNewProject,
  onImport: onImportCallback,
  onClose,
}: ProjectNotFoundDialogProps) => {
  const [, navigate] = useLocation()
  const [view, setView] = useState<ProjectOpenProblem>(reason)
  const [error, setError] = useState<string | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isAllowing, setIsAllowing] = useState(false)
  const { setCurrentDirectory, setActiveStorageType } = useFileSystemStore()
  const folderName = directoryHandle?.name || projectName
  const busy = isLocating || isImporting || isAllowing

  useEffect(() => {
    if (open) {
      setView(reason)
      setError(null)
    }
  }, [open, reason])

  const finishLoad = useCallback(
    async (result: FileSystemResult<FileSystemProject>, source: string) => {
      if (!result.success) {
        debugUI('Failed to load project:', result.error)
        if (result.error.type === 'not-found') setView('not-found')
        setError(result.error.message)
        analytics.track('project_open_failed', {
          storageType: 'fileSystemAccess',
          reason: openFailureReason(result.error.type),
          source,
        })
        return
      }
      try {
        const project = await migrateProject(result.data.projectData)
        setCurrentDirectory(result.data.directoryHandle, projectName)
        setActiveStorageType('fileSystemAccess')
        onProjectLoaded(project, projectName, result.data.outputCache)
        analytics.track('project_opened', { storageType: 'fileSystemAccess', source })
        onClose()
      } catch (error) {
        debugUI('Error migrating project:', error)
        setError(error instanceof Error ? error.message : 'Failed to migrate project.')
        analytics.track('project_open_failed', {
          storageType: 'fileSystemAccess',
          reason: 'migration_error',
          source,
        })
      }
    },
    [projectName, onProjectLoaded, onClose, setCurrentDirectory, setActiveStorageType]
  )

  // The click is the user gesture the browser needs before it can ask for access
  const onAllowAccess = useCallback(async () => {
    if (!directoryHandle) return
    setIsAllowing(true)
    setError(null)
    try {
      const permission = await requestPermissionState(directoryHandle, 'readwrite')
      if (permission !== 'granted') {
        analytics.track('project_permission_denied', { source: 'allow_button', state: permission })
        setView('permission-denied')
        return
      }
      analytics.track('project_permission_granted', { source: 'allow_button' })
      await finishLoad(await load('fileSystemAccess', projectName), 'allow_button')
    } finally {
      setIsAllowing(false)
    }
  }, [directoryHandle, projectName, finishLoad])

  const onLocateFolder = useCallback(async () => {
    setIsLocating(true)
    setError(null)
    try {
      // Picker must be triggered by user gesture
      const handle = await selectDirectory()

      if (handle.name !== projectName) {
        setError(
          `The folder "${handle.name}" doesn't match the project "${projectName}". Choose the "${projectName}" folder.`
        )
        return
      }

      // TODO: support other storage types?
      await finishLoad(await load('fileSystemAccess', handle), 'choose_folder')
    } catch (error) {
      // Handle abort error silently (user cancelled folder picker)
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      debugUI('Error opening folder:', error)
      setError(error instanceof Error ? error.message : 'Failed to open folder.')
    } finally {
      setIsLocating(false)
    }
  }, [projectName, finishLoad])

  const onImport = useCallback(async () => {
    setIsImporting(true)
    setError(null)
    try {
      // Use the onImport callback which handles File System Access API setup
      await onImportCallback()
      onClose()
    } catch (error) {
      // Handle abort error silently (user cancelled file picker)
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      debugUI('Error importing project:', error)
      setError(error instanceof Error ? error.message : 'Failed to import project.')
    } finally {
      setIsImporting(false)
    }
  }, [onImportCallback, onClose])

  const onCreateNew = useCallback(async () => {
    setError(null)
    try {
      // Use the onNewProject callback which handles File System Access API setup
      await onNewProject()
      onClose()
    } catch (error) {
      // Handle abort error silently (user cancelled folder picker)
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      debugUI('Error creating new project:', error)
      setError(error instanceof Error ? error.message : 'Failed to create new project.')
    }
  }, [onNewProject, onClose])

  const onBackToProjects = useCallback(() => {
    onClose()
    navigate('/projects')
  }, [onClose, navigate])

  const backButton = (
    <button
      type="button"
      className={cx(s.dialogButton, s.violet)}
      onClick={onBackToProjects}
      disabled={busy}
    >
      Back to projects
    </button>
  )

  const chooseFolderButton = (primary: boolean) => (
    <button
      type="button"
      className={cx(s.dialogButton, primary ? s.green : s.violet)}
      onClick={onLocateFolder}
      disabled={busy}
    >
      {isLocating ? 'Choosing...' : 'Choose folder'}
    </button>
  )

  let title: string
  let description: ReactNode
  let actions: ReactNode

  if (view === 'permission-prompt' && directoryHandle) {
    title = 'Allow access to your project folder'
    description = (
      <>
        Your browser needs your permission to open the folder "{folderName}" again. It asks for this
        after the browser restarts.
      </>
    )
    actions = (
      <>
        {backButton}
        <button
          type="button"
          className={cx(s.dialogButton, s.green)}
          onClick={onAllowAccess}
          disabled={busy}
        >
          {isAllowing ? 'Opening...' : `Allow access to ${folderName}`}
        </button>
      </>
    )
  } else if (view === 'permission-denied') {
    title = "Can't open the project folder"
    description = (
      <>
        Your browser didn't allow access to the folder "{folderName}". Choose the folder to open the
        project, or go back to your projects.
      </>
    )
    actions = (
      <>
        {backButton}
        {chooseFolderButton(true)}
      </>
    )
  } else {
    title = 'Project not found'
    description = (
      <>
        The project "{projectName}" isn't saved in this browser, or its folder was moved or deleted.
        <br />
        Choose the project folder, import a project file, or create a new project with this name.
      </>
    )
    actions = (
      <>
        {backButton}
        {chooseFolderButton(false)}
        <button
          type="button"
          className={cx(s.dialogButton, s.violet)}
          onClick={onImport}
          disabled={busy}
        >
          {isImporting ? 'Importing...' : 'Import project'}
        </button>
        <button
          type="button"
          className={cx(s.dialogButton, s.green)}
          onClick={onCreateNew}
          disabled={busy}
        >
          Create new project
        </button>
      </>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>{title}</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>{description}</Dialog.Description>
          {error && <p className={s.dialogError}>{error}</p>}
          <div className={s.dialogRightSlot}>{actions}</div>
          <Dialog.Close asChild>
            <button type="button" className={s.dialogIconButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
