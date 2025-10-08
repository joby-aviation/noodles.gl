import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useFileSystemError, useFileSystemStore } from '../filesystem-store'
import type { FileSystemError } from '../storage'
import s from './menu.module.css'

const errorTitles: Record<FileSystemError['type'], string> = {
  'permission-denied': 'Permission Denied',
  'not-found': 'Project Not Found',
  unsupported: 'Storage Not Supported',
  'invalid-state': 'Invalid State',
  'security-error': 'Security Error',
  'abort-error': 'Operation Cancelled',
  'already-exists': 'File Already Exists',
  unknown: 'Unknown Error',
}

export function StorageErrorHandler() {
  const error = useFileSystemError()
  const { clearError } = useFileSystemStore()

  if (!error) {
    return null
  }

  return (
    <Dialog.Root open={!!error} onOpenChange={open => !open && clearError()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>{errorTitles[error.type]}</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>{error.message}</Dialog.Description>
          {error.details && (
            <p
              className={s.dialogDescription}
              style={{ marginTop: '10px', fontSize: '13px', color: '#999' }}
            >
              {error.details}
            </p>
          )}
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
