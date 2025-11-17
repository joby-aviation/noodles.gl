import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import type { ReactNode } from 'react'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { ConfirmReplaceDialog } from './confirm-replace-dialog'
import { type DialogState, useDialogState } from './dialog-api'
import s from './menu.module.css'
import { ProjectListDialog } from './project-list-dialog'
import { ProjectNameDialog } from './project-name-dialog'
import { WorkspacePickerDialog } from './workspace-picker-dialog'

/**
 * DialogRenderer component that renders the appropriate dialog based on dialog state.
 * Must be used within DialogAPIProvider.
 */
export function DialogRenderer() {
  const dialogState = useDialogState()
  return <>{dialogState && renderDialog(dialogState)}</>
}

/**
 * Render the appropriate dialog component based on dialog state
 */
function renderDialog(state: DialogState): ReactNode {
  if (!state) return null

  switch (state.type) {
    case 'workspace-picker':
      return <WorkspacePickerDialog {...state.props} />

    case 'name-workspace':
      // TODO: Create workspace naming dialog
      return (
        <Dialog.Root open onOpenChange={open => !open && state.props.onComplete(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className={s.dialogOverlay} />
            <Dialog.Content className={s.dialogContent}>
              <Dialog.Title className={s.dialogTitle}>Name Workspace</Dialog.Title>
              <Dialog.Description className={s.dialogDescription}>
                Workspace naming dialog not yet implemented
              </Dialog.Description>
              <div className={s.dialogRightSlot}>
                <button
                  type="button"
                  className={s.dialogButton}
                  onClick={() => state.props.onComplete(null)}
                >
                  Cancel
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

    case 'select-project':
      return <ProjectListDialog {...state.props} />

    case 'prompt-name':
      return <ProjectNameDialog {...state.props} />

    case 'confirm-replace':
      return <ConfirmReplaceDialog {...state.props} />

    case 'confirm-delete':
      return <ConfirmDeleteDialog {...state.props} />

    case 'select-file':
      // File selection is handled by browser native dialog in DialogAPI.selectFile()
      // This should never render
      return null

    case 'error':
      return (
        <Dialog.Root open onOpenChange={open => !open && state.props.onComplete()}>
          <Dialog.Portal>
            <Dialog.Overlay className={s.dialogOverlay} />
            <Dialog.Content className={s.dialogContent}>
              <Dialog.Title className={s.dialogTitle}>Error</Dialog.Title>
              <Dialog.Description className={cx(s.dialogDescription, s.dialogError)}>
                {state.props.message}
              </Dialog.Description>
              <div className={s.dialogRightSlot}>
                <button
                  type="button"
                  className={s.dialogButton}
                  onClick={() => state.props.onComplete()}
                >
                  OK
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

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = state
      return null
    }
  }
}
