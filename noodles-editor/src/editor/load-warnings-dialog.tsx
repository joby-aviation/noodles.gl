// What converting an older project couldn't keep: nodes dropped, keyframes on parameters that
// have no counterpart now. Opening such a project shows the list once; saving writes the
// project as converted, so this is the moment to check it.

import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useEffect } from 'react'
import s from '../noodles/components/menu.module.css'
import { analytics } from '../utils/analytics'
import { useUIStore } from './ui-store'

const SHOWN = 20

export function LoadWarningsDialog() {
  const warnings = useUIStore(st => st.loadWarnings)
  const setWarnings = useUIStore(st => st.setLoadWarnings)
  const open = warnings.length > 0

  useEffect(() => {
    if (open) {
      analytics.track('project_load_error', {
        errorType: 'migration_warnings',
        count: warnings.length,
      })
    }
  }, [open, warnings.length])

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && setWarnings([])}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Converted from an older project</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            This project was saved in the format before documents. It opened, but{' '}
            {warnings.length === 1 ? 'one part' : `${warnings.length} parts`} didn't carry over.
            Saving writes the converted project, so check these first.
          </Dialog.Description>
          <ul className={s.dialogDescription} style={{ marginLeft: '1.25rem' }}>
            {warnings.slice(0, SHOWN).map(w => (
              <li key={w}>{w}</li>
            ))}
            {warnings.length > SHOWN && <li>…and {warnings.length - SHOWN} more</li>}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>
              <button type="button" className={cx(s.dialogButton, s.green)}>
                Continue
              </button>
            </Dialog.Close>
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
