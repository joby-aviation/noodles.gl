import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  SchemaOverlayColumnPreview,
  SchemaOverlayDecision,
  SchemaOverlayPreview,
  SchemaOverlayValueCounts,
} from '../table-schema-clipboard'
import s from './schema-overlay-dialog.module.css'

export type SchemaOverlayDecisions = Record<number, SchemaOverlayDecision>

interface SchemaOverlayDialogProps {
  open: boolean
  preview?: SchemaOverlayPreview
  error?: string
  onOpenChange: (open: boolean) => void
  onRenameIncoming: (incomingIndex: number, name: string) => void
  onApply: (decisions: SchemaOverlayDecisions) => void
}

function decisionsForPreview(preview?: SchemaOverlayPreview): SchemaOverlayDecisions {
  return Object.fromEntries(
    preview?.columns.map(column => [column.incomingIndex, column.defaultDecision]) ?? []
  )
}

function canApplyColumn(column: SchemaOverlayColumnPreview): boolean {
  return column.status !== 'conflict' && column.proposedColumn !== undefined
}

function safeDecision(
  column: SchemaOverlayColumnPreview,
  decision: SchemaOverlayDecision | undefined
): SchemaOverlayDecision {
  const nextDecision = decision ?? column.defaultDecision
  return nextDecision === 'apply' && !canApplyColumn(column) ? 'keep' : nextDecision
}

function keptValueCount(preview: SchemaOverlayPreview, column: SchemaOverlayColumnPreview): number {
  if (!column.targetColumn) return 0
  return preview.targetData.filter(
    row => typeof row === 'object' && row !== null && !Array.isArray(row)
  ).length
}

function countsForDecision(
  preview: SchemaOverlayPreview,
  column: SchemaOverlayColumnPreview,
  decision: SchemaOverlayDecision
): SchemaOverlayValueCounts {
  if (decision === 'apply') return column.counts
  return { preserved: keptValueCount(preview, column), coerced: 0, reset: 0 }
}

export function SchemaOverlayDialog({
  open,
  preview,
  error,
  onOpenChange,
  onRenameIncoming,
  onApply,
}: SchemaOverlayDialogProps) {
  const [decisions, setDecisions] = useState<SchemaOverlayDecisions>(() =>
    decisionsForPreview(preview)
  )
  const explicitDecisionIndexes = useRef(new Set<number>())

  useEffect(() => {
    if (!open || !preview) {
      explicitDecisionIndexes.current.clear()
      setDecisions({})
      return
    }

    setDecisions(current => {
      const incomingIndexes = new Set(preview.columns.map(column => column.incomingIndex))
      const next = Object.fromEntries(
        preview.columns.map(column => {
          const incomingIndex = column.incomingIndex
          const explicitDecision = explicitDecisionIndexes.current.has(incomingIndex)
            ? current[incomingIndex]
            : undefined
          const decision = safeDecision(column, explicitDecision ?? column.defaultDecision)

          if (explicitDecision === 'apply' && decision !== 'apply') {
            explicitDecisionIndexes.current.delete(incomingIndex)
          }
          return [incomingIndex, decision]
        })
      )

      for (const incomingIndex of explicitDecisionIndexes.current) {
        if (!incomingIndexes.has(incomingIndex)) {
          explicitDecisionIndexes.current.delete(incomingIndex)
        }
      }
      return next
    })
  }, [open, preview])

  const totals = useMemo(
    () =>
      preview?.columns.reduce(
        (total, column) => {
          const decision = safeDecision(column, decisions[column.incomingIndex])
          const counts = countsForDecision(preview, column, decision)
          return {
            preserved: total.preserved + counts.preserved,
            coerced: total.coerced + counts.coerced,
            reset: total.reset + counts.reset,
          }
        },
        { preserved: 0, coerced: 0, reset: 0 }
      ),
    [decisions, preview]
  )

  const applyDecisions = () => {
    if (!preview) return
    onApply(
      Object.fromEntries(
        preview.columns.map(column => [
          column.incomingIndex,
          safeDecision(column, decisions[column.incomingIndex]),
        ])
      )
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <Dialog.Title className={s.title}>Paste Schema Overlay</Dialog.Title>
          <Dialog.Description className={s.description}>
            Existing columns stay in place. Choose which incoming definitions to apply.
          </Dialog.Description>

          {error ? (
            <div className={s.error} role="alert">
              <strong>That clipboard content is not a valid table schema.</strong>
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div className={s.summary} aria-live="polite">
                <span>{preview?.columns.length ?? 0} incoming columns</span>
                <span>{totals?.preserved ?? 0} values preserved</span>
                <span>{totals?.coerced ?? 0} values coerced</span>
                <span className={(totals?.reset ?? 0) > 0 ? s.resetCount : undefined}>
                  {totals?.reset ?? 0} values would reset
                </span>
              </div>

              <div className={s.columnList}>
                {preview?.columns.map(column => {
                  const decision = safeDecision(column, decisions[column.incomingIndex])
                  const canApply = canApplyColumn(column)
                  const counts = countsForDecision(preview, column, decision)
                  return (
                    <div key={column.incomingIndex} className={s.columnRow}>
                      <div className={s.columnIdentity}>
                        <InputText
                          value={column.incomingColumn.name}
                          onChange={event =>
                            onRenameIncoming(column.incomingIndex, event.target.value)
                          }
                          aria-label={`Incoming column name ${column.incomingIndex + 1}`}
                          className={s.nameInput}
                        />
                        <span className={s.type}>{column.incomingColumn.type}</span>
                        <span className={s.status} data-status={column.status}>
                          {column.status}
                        </span>
                      </div>

                      <div className={s.columnDetails}>
                        {column.targetColumn && (
                          <span>
                            Matches <strong>{column.targetColumn.name}</strong>
                            {column.matchedBy ? ` by ${column.matchedBy}` : ''}
                          </span>
                        )}
                        {column.conflict && (
                          <span className={s.conflict} role="alert">
                            {column.conflict}
                          </span>
                        )}
                        {!column.safe && column.status !== 'conflict' && (
                          <span className={s.warning}>
                            Applying this definition resets values that cannot be converted.
                          </span>
                        )}
                      </div>

                      <div className={s.columnFooter}>
                        <span className={s.counts}>
                          {counts.preserved} preserved · {counts.coerced} coerced · {counts.reset}{' '}
                          reset
                        </span>
                        <label className={s.decisionLabel}>
                          <span className={s.visuallyHidden}>
                            Decision for {column.incomingColumn.name}
                          </span>
                          <select
                            value={decision}
                            onChange={event => {
                              explicitDecisionIndexes.current.add(column.incomingIndex)
                              setDecisions(current => ({
                                ...current,
                                [column.incomingIndex]: event.currentTarget
                                  .value as SchemaOverlayDecision,
                              }))
                            }}
                            className={s.decision}
                          >
                            {canApply && (
                              <option value="apply">
                                {column.safe ? 'Apply overlay' : 'Apply and reset'}
                              </option>
                            )}
                            <option value="keep">Keep existing</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <div className={s.footer}>
            <Dialog.Close asChild>
              <Button label="Cancel" className="p-button-text" />
            </Dialog.Close>
            {!error && preview && (
              <Button label="Apply Overlay" icon="pi pi-check" onClick={applyDecisions} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface ClipboardPasteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPasteText: (text: string) => void
}

/** Fallback for browsers that deny programmatic clipboard reads. */
export function ClipboardPasteDialog({
  open,
  onOpenChange,
  onPasteText,
}: ClipboardPasteDialogProps) {
  const pasteTargetRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => pasteTargetRef.current?.focus())
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.pasteContent}>
          <Dialog.Title className={s.title}>Paste Schema</Dialog.Title>
          <Dialog.Description className={s.description}>
            Clipboard access is unavailable. Press Cmd+V or Ctrl+V in the field below.
          </Dialog.Description>
          <textarea
            ref={pasteTargetRef}
            className={s.pasteTarget}
            aria-label="Paste schema JSON"
            placeholder="Paste schema JSON here"
            onPaste={event => {
              const text = event.clipboardData.getData('text/plain')
              if (!text) return
              event.preventDefault()
              onOpenChange(false)
              onPasteText(text)
            }}
          />
          <div className={s.footer}>
            <Dialog.Close asChild>
              <Button label="Cancel" className="p-button-text" />
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
