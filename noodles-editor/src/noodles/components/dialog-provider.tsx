import { Button, Dialog, Flex, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { ConfirmReplaceDialog } from './confirm-replace-dialog'
import { type DialogState, useDialogState } from './dialog-api'
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
          <Dialog.Content>
            <Dialog.Title>Name Workspace</Dialog.Title>
            <Text>Workspace naming dialog not yet implemented</Text>
            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button onClick={() => state.props.onComplete(null)}>Cancel</Button>
              </Dialog.Close>
            </Flex>
          </Dialog.Content>
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
          <Dialog.Content>
            <Dialog.Title>Error</Dialog.Title>
            <Text color="red">{state.props.message}</Text>
            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button onClick={() => state.props.onComplete()}>OK</Button>
              </Dialog.Close>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      )

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = state
      return null
    }
  }
}
