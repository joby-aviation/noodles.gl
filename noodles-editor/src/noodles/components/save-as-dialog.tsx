import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useState } from 'react'
import s from './menu.module.css'

interface SaveAsDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (options: { copyDataFiles: boolean }) => Promise<void>
  targetDirectoryName: string
  hasExistingProject: boolean
  hasDataFiles: boolean
}

export const SaveAsDialog = ({
  open,
  onClose,
  onConfirm,
  targetDirectoryName,
  hasExistingProject,
  hasDataFiles,
}: SaveAsDialogProps) => {
  const [copyDataFiles, setCopyDataFiles] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConfirm = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await onConfirm({ copyDataFiles })
      onClose()
    } catch (err) {
      console.error('Failed to save project:', err)
      setError(err instanceof Error ? err.message : 'Failed to save project')
    } finally {
      setIsSaving(false)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !isSaving) {
      onClose()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Save As</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Save project to: <strong>{targetDirectoryName}</strong>
          </Dialog.Description>

          {hasExistingProject && (
            <p className={s.dialogError}>
              This folder already contains a project. Saving will overwrite the existing project.
            </p>
          )}

          {error && <p className={s.dialogError}>{error}</p>}

          {hasDataFiles && (
            <div className={s.dialogFieldset}>
              <label className={s.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={copyDataFiles}
                  onChange={e => setCopyDataFiles(e.target.checked)}
                  className={s.checkbox}
                  disabled={isSaving}
                />
                <span>Copy data files to new location</span>
              </label>
            </div>
          )}

          <div className={s.dialogRightSlot}>
            <button
              type="button"
              className={cx(s.dialogButton, s.violet)}
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cx(s.dialogButton, s.green)}
              onClick={handleConfirm}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className={s.dialogIconButton}
              aria-label="Close"
              disabled={isSaving}
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
