import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import s from './menu.module.css'

interface UnlockDialogProps {
  open: boolean
  nodeName: string
  onConfirm: () => void
  onClose: () => void
}

export const UnlockDialog = ({ open, nodeName, onConfirm, onClose }: UnlockDialogProps) => (
  <Dialog.Root open={open} onOpenChange={isOpen => !isOpen && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className={s.dialogOverlay} />
      <Dialog.Content className={s.dialogContent}>
        <Dialog.Title className={s.dialogTitle}>Unlock {nodeName}?</Dialog.Title>
        <Dialog.Description className={s.dialogDescription}>
          Unlocking runs this node again with its current inputs and replaces the result it kept.
        </Dialog.Description>
        <div className={s.dialogRightSlot}>
          <button type="button" className={cx(s.dialogButton, s.violet)} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(s.dialogButton, s.green)} onClick={onConfirm}>
            Unlock
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
