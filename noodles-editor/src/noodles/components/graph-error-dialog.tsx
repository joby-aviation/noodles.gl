import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useEffect } from 'react'
import { analytics } from '../../utils/analytics'
import s from './menu.module.css'

export interface GraphError {
  type: 'unknown-operator' | 'stale-edge' | 'operator-execution'
  message: string
  details?: string
}

interface GraphErrorDialogProps {
  open: boolean
  errors: GraphError[]
  onClose: () => void
  validOperatorCount?: number
}

export const GraphErrorDialog = ({
  open,
  errors,
  onClose,
  validOperatorCount = 0,
}: GraphErrorDialogProps) => {
  const unknownOperators = errors.filter(e => e.type === 'unknown-operator')
  const staleEdges = errors.filter(e => e.type === 'stale-edge')
  const executionErrors = errors.filter(e => e.type === 'operator-execution')

  useEffect(() => {
    if (open) {
      if (unknownOperators.length > 0) {
        analytics.track('project_load_error', {
          errorType: 'unknown_operators',
          count: unknownOperators.length,
        })
      }
      if (staleEdges.length > 0) {
        analytics.track('project_load_error', {
          errorType: 'broken_connections',
          count: staleEdges.length,
        })
      }
      if (executionErrors.length > 0) {
        analytics.track('project_load_error', {
          errorType: 'execution_errors',
          count: executionErrors.length,
        })
      }
    }
  }, [open, unknownOperators.length, staleEdges.length, executionErrors.length])

  return (
    <Dialog.Root open={open} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Project Loading Errors</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            {validOperatorCount > 0 ? (
              <>
                <strong>{validOperatorCount} operators loaded successfully</strong>, but the project
                file contains errors:
              </>
            ) : (
              'The project file contains errors:'
            )}
          </Dialog.Description>

          <div className={s.dialogDescription}>
            {unknownOperators.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <strong>Unknown Operator Types ({unknownOperators.length}):</strong>
                <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                  {unknownOperators.map((error, i) => (
                    <li key={i}>{error.message}</li>
                  ))}
                </ul>
                <p style={{ marginTop: '0.5rem', fontSize: '0.9em', color: 'var(--gray-11)' }}>
                  These operators are not registered and will be skipped. This may happen if the
                  project was created with a newer version of the app or uses custom operators.
                </p>
              </div>
            )}

            {staleEdges.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <strong>Broken Connections ({staleEdges.length}):</strong>
                <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                  {staleEdges.slice(0, 5).map((error, i) => (
                    <li key={i}>{error.message}</li>
                  ))}
                  {staleEdges.length > 5 && (
                    <li>...and {staleEdges.length - 5} more broken connections</li>
                  )}
                </ul>
                <p style={{ marginTop: '0.5rem', fontSize: '0.9em', color: 'var(--gray-11)' }}>
                  These edges reference nodes that no longer exist. This may be caused by a failed
                  node rename or manual file editing.
                </p>
              </div>
            )}

            {executionErrors.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <strong>Execution Errors ({executionErrors.length}):</strong>
                <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                  {executionErrors.slice(0, 3).map((error, i) => (
                    <li key={i}>
                      {error.message}
                      {error.details && (
                        <details style={{ marginTop: '0.25rem' }}>
                          <summary style={{ cursor: 'pointer', color: 'var(--gray-11)' }}>
                            Details
                          </summary>
                          <pre
                            style={{
                              fontSize: '0.8em',
                              padding: '0.5rem',
                              background: 'var(--gray-3)',
                              borderRadius: '4px',
                              overflow: 'auto',
                              maxHeight: '200px',
                            }}
                          >
                            {error.details}
                          </pre>
                        </details>
                      )}
                    </li>
                  ))}
                  {executionErrors.length > 3 && (
                    <li>...and {executionErrors.length - 3} more errors</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className={s.dialogRightSlot}>
            <button type="button" className={cx(s.dialogButton, s.green)} onClick={onClose}>
              {validOperatorCount > 0 ? 'Continue with Valid Operators' : 'Close'}
            </button>
          </div>
          {validOperatorCount > 0 && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.9em', color: 'var(--gray-11)' }}>
              The valid operators have been loaded and the graph is functional. Skipped operators
              and broken connections will not be available.
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
