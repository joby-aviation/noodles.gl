import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import s from './menu.module.css'

interface CreateFromSQLDialogProps {
  // SQL from the ?createFromSQL= link; the dialog is open while this is set
  sql: string | null
  onConfirm: (sql: string) => void
  onClose: () => void
}

// A shared link can carry any SQL, and DuckDB can fetch remote URLs, so the
// query is shown to the user and only runs after they confirm.
export const CreateFromSQLDialog = ({ sql, onConfirm, onClose }: CreateFromSQLDialogProps) => (
  <Dialog.Root open={sql !== null} onOpenChange={isOpen => !isOpen && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className={s.dialogOverlay} />
      <Dialog.Content className={cx(s.dialogContent, 'nokey')}>
        <Dialog.Title className={s.dialogTitle}>Run SQL from this link?</Dialog.Title>
        <Dialog.Description className={s.dialogDescription}>
          This link creates a project that runs the query below in DuckDB. Queries can read files
          from remote URLs. Only run it if you trust where the link came from.
        </Dialog.Description>
        <pre className={s.dialogCode}>{sql}</pre>
        <div className={s.dialogRightSlot}>
          <button type="button" className={cx(s.dialogButton, s.violet)} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={cx(s.dialogButton, s.green)}
            onClick={() => sql !== null && onConfirm(sql)}
          >
            Run query
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
