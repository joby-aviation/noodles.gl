import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback, useState } from 'react'
import { useFileSystemStore } from '../filesystem-store'
import { load } from '../storage'
import { selectDirectory } from '../utils/filesystem'
import { migrateProject } from '../utils/migrate-schema'
import type { NoodlesProjectJSON } from '../utils/serialization'
import s from './menu.module.css'

interface ProjectNotFoundDialogProps {
  projectName: string
  open: boolean
  onProjectLoaded: (project: NoodlesProjectJSON, projectName: string) => void
  onNewProject: () => Promise<void>
  onImport: () => Promise<void>
  onClose: () => void
}

export const ProjectNotFoundDialog = ({
  projectName,
  open,
  onProjectLoaded,
  onNewProject,
  onImport: onImportCallback,
  onClose,
}: ProjectNotFoundDialogProps) => {
  const [error, setError] = useState<string | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const { setCurrentDirectory } = useFileSystemStore()

  const onLocateFolder = useCallback(async () => {
    setIsLocating(true)
    setError(null)
    try {
      // Picker must be triggered by user gesture
      const directoryHandle = await selectDirectory()

      if (directoryHandle.name !== projectName) {
        setError(
          `Selected folder name "${directoryHandle.name}" does not match project name "${projectName}". Please select the correct folder.`
        )
        return
      }

      // TODO: support other storage types?
      const result = await load('fileSystemAccess', directoryHandle)
      if (result.success) {
        try {
          const project = await migrateProject(result.data.projectData)
          setCurrentDirectory(result.data.directoryHandle, projectName)
          onProjectLoaded(project, projectName)
          onClose()
        } catch (error) {
          console.error('Error migrating project:', error)
          setError(error instanceof Error ? error.message : 'Failed to migrate project.')
        }
      } else {
        console.error('Failed to load project:', result.error)
        setError(result.error.message)
      }
    } catch (error) {
      // Handle abort error silently (user cancelled folder picker)
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      console.error('Error opening folder:', error)
      setError(error instanceof Error ? error.message : 'Failed to open folder.')
    } finally {
      setIsLocating(false)
    }
  }, [projectName, onProjectLoaded, onClose, setCurrentDirectory])

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
      console.error('Error importing project:', error)
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
      console.error('Error creating new project:', error)
      setError(error instanceof Error ? error.message : 'Failed to create new project.')
    }
  }, [onNewProject, onClose])

  return (
    <Dialog.Root open={open} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Project Not Found</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Project "{projectName}" was not found in storage.
            <br />
            Would you like to locate the project folder, import a project file, or create a new
            project with this name?
          </Dialog.Description>
          {error && <p className={s.dialogError}>{error}</p>}
          <div className={s.dialogRightSlot}>
            <button
              type="button"
              className={cx(s.dialogButton, s.violet)}
              onClick={onLocateFolder}
              disabled={isLocating || isImporting}
            >
              {isLocating ? 'Locating...' : 'Locate Project Folder'}
            </button>
            <button
              type="button"
              className={cx(s.dialogButton, s.violet)}
              onClick={onImport}
              disabled={isLocating || isImporting}
            >
              {isImporting ? 'Importing...' : 'Import Project'}
            </button>
            <button
              type="button"
              className={cx(s.dialogButton, s.green)}
              onClick={onCreateNew}
              disabled={isLocating || isImporting}
            >
              Create New Project
            </button>
          </div>
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
