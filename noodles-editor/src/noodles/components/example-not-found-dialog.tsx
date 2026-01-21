import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import s from './menu.module.css'

interface ExampleNotFoundDialogProps {
  projectName: string
  open: boolean
  onBrowseExamples: () => void
  onCheckMyProjects: () => void
  onClose: () => void
}

export const ExampleNotFoundDialog = ({
  projectName,
  open,
  onBrowseExamples,
  onCheckMyProjects,
  onClose,
}: ExampleNotFoundDialogProps) => {
  return (
    <Dialog.Root open={open} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Example Not Found</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            The example "{projectName}" is not available.
            <br />
            It may have been removed or renamed. Would you like to browse available examples or
            check your saved projects?
          </Dialog.Description>
          <div className={s.dialogRightSlot}>
            <button
              type="button"
              className={cx(s.dialogButton, s.violet)}
              onClick={onBrowseExamples}
            >
              Browse Examples
            </button>
            <button
              type="button"
              className={cx(s.dialogButton, s.green)}
              onClick={onCheckMyProjects}
            >
              Check My Projects
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
