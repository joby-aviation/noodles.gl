/**
 * Confirm Replace Dialog
 *
 * Confirmation dialog when saving/creating a project that already exists.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback } from 'react'
import s from './menu.module.css'

export interface ConfirmReplaceDialogProps {
  /**
   * Name of project that will be replaced
   */
  projectName: string

  /**
   * Callback when user confirms or cancels
   */
  onComplete: (confirmed: boolean) => void
}

/**
 * Dialog for confirming project replacement
 */
export function ConfirmReplaceDialog({ projectName, onComplete }: ConfirmReplaceDialogProps) {
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
          <Dialog.Title className={s.dialogTitle}>Replace existing project?</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            A project named "{projectName}" already exists. Do you want to replace it?
          </Dialog.Description>
          <div className={s.dialogRightSlot}>
            <button type="button" className={s.dialogButton} onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className={cx(s.dialogButton, s.green)} onClick={onConfirm}>
              Replace
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
