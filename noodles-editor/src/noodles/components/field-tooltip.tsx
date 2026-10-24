import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactElement } from 'react'
import s from './field-tooltip.module.css'

// Hover tooltip for a field label: the field's description, if any, and its key (the name
// used in edges, references and expressions). `children` must accept a ref, e.g. a DOM element.
export function FieldTooltip({
  fieldKey,
  description,
  side = 'top',
  children,
}: {
  fieldKey: string
  description?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactElement
}) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side={side} sideOffset={6} collisionPadding={8} className={s.content}>
            {description && <div className={s.description}>{description}</div>}
            <code className={s.key}>{fieldKey}</code>
            <Tooltip.Arrow className={s.arrow} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
