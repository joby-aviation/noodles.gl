/**
 * Confirm Delete Dialog
 *
 * Confirmation dialog for deleting a project with "Are you sure?" guard.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback } from 'react'
import s from './menu.module.css'

export interface ConfirmDeleteDialogProps {
  /**
   * Name of project to delete
   */
  projectName: string

  /**
   * Callback when user confirms or cancels
   */
  onComplete: (confirmed: boolean) => void
}

/**
 * Dialog for confirming project deletion
 */
export function ConfirmDeleteDialog({ projectName, onComplete }: ConfirmDeleteDialogProps) {
  const onConfirm = useCallback(() => {
    onComplete(true)
  }, [onComplete])

  const onCancel = useCallback(() => {
    onComplete(false)
  }, [onComplete])

  return (
    <Dialog.Root open onOpenChange={open => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Delete project?</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Are you sure you want to delete "{projectName}"? This action cannot be undone.
          </Dialog.Description>
          <div className={s.dialogRightSlot}>
            <button type="button" className={s.dialogButton} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={cx(s.dialogButton, s.red)} onClick={onConfirm}>
              Delete
            </button>
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              className={s.dialogIconButton}
              aria-label="Close"
              onClick={onCancel}
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
