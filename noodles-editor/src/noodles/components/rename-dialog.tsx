import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback, useEffect, useState } from 'react'
import s from './menu.module.css'

interface RenameDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (newName: string) => Promise<void>
  currentName: string
}

// Validate project name - allow letters, numbers, hyphens, underscores
const isValidProjectName = (name: string): boolean => {
  if (!name || name.trim().length === 0) return false
  // Allow alphanumeric, hyphens, underscores, spaces
  return /^[\w\s-]+$/.test(name)
}

export const RenameDialog = ({ open, onClose, onConfirm, currentName }: RenameDialogProps) => {
  const [newName, setNewName] = useState(currentName)
  const [isRenaming, setIsRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setNewName(currentName)
      setError(null)
    }
  }, [open, currentName])

  const handleConfirm = useCallback(async () => {
    const trimmedName = newName.trim()

    if (!isValidProjectName(trimmedName)) {
      setError('Project name can only contain letters, numbers, hyphens, underscores, and spaces')
      return
    }

    if (trimmedName === currentName) {
      setError('New name must be different from the current name')
      return
    }

    setIsRenaming(true)
    setError(null)
    try {
      await onConfirm(trimmedName)
      onClose()
    } catch (err) {
      // If user cancelled directory selection, just stay on the dialog without showing error
      if (err instanceof Error && err.message === 'Directory selection was cancelled') {
        setIsRenaming(false)
        return
      }
      console.error('Failed to rename project:', err)
      setError(err instanceof Error ? err.message : 'Failed to rename project')
    } finally {
      setIsRenaming(false)
    }
  }, [newName, currentName, onConfirm, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isRenaming) {
        e.preventDefault()
        handleConfirm()
      }
    },
    [handleConfirm, isRenaming]
  )

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !isRenaming) {
      onClose()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Rename Project</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Enter a new name for the project. This will create a copy of the project with the new
            name.
          </Dialog.Description>

          {error && <p className={s.dialogError}>{error}</p>}

          <div className={s.dialogFieldset}>
            <label htmlFor="projectName" className={s.dialogLabel}>
              Name
            </label>
            <input
              id="projectName"
              type="text"
              className={s.dialogInput}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRenaming}
            />
          </div>

          <div className={s.dialogRightSlot}>
            <button
              type="button"
              className={cx(s.dialogButton, s.violet)}
              onClick={onClose}
              disabled={isRenaming}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cx(s.dialogButton, s.green)}
              onClick={handleConfirm}
              disabled={isRenaming || !newName.trim()}
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </button>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className={s.dialogIconButton}
              aria-label="Close"
              disabled={isRenaming}
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
