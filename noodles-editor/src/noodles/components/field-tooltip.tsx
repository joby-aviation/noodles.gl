import * as Tooltip from '@radix-ui/react-tooltip'
import { type ReactElement, useEffect, useId, useRef, useState } from 'react'
import s from './field-tooltip.module.css'

// Rows that hold a field's label and input carry this attribute, so keyboard focus on the
// input can open the label's tooltip
export const FIELD_ROW_ATTR = 'data-field-row'

const rowOf = (el: Element) => el.closest(`[${FIELD_ROW_ATTR}]`)

// Tooltip for a field label: the field's description, if any, and its key (the name used in
// edges, references and expressions). Opens on hover, and when keyboard focus lands on an
// input in the label's row, which is also described by the text for screen readers.
// `children` must accept a ref, e.g. a DOM element.
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
  const triggerRef = useRef<HTMLElement>(null)
  const [hoverOpen, setHoverOpen] = useState(false)
  const [focusOpen, setFocusOpen] = useState(false)
  const descriptionId = useId()

  useEffect(() => {
    const trigger = triggerRef.current
    const row = trigger && rowOf(trigger)
    if (!trigger || !row) return
    // Text inputs match :focus-visible even when clicked, so track pointer presses to open
    // only for keyboard focus
    let pointerDown = false
    const onPointerDown = () => {
      pointerDown = true
    }
    const onPointerUp = () => {
      pointerDown = false
    }
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      // Skip labels that aren't rendered, e.g. a field component's own label the panel hides
      if (rowOf(target) !== row || trigger.getClientRects().length === 0) return
      if (description) target.setAttribute('aria-describedby', descriptionId)
      setFocusOpen(!pointerDown && target.matches(':focus-visible'))
    }
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Element | null
      if (!next || rowOf(next) !== row) setFocusOpen(false)
    }
    row.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    row.addEventListener('focusin', onFocusIn)
    row.addEventListener('focusout', onFocusOut)
    return () => {
      row.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      row.removeEventListener('focusin', onFocusIn)
      row.removeEventListener('focusout', onFocusOut)
    }
  }, [description, descriptionId])

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root open={hoverOpen || focusOpen} onOpenChange={setHoverOpen}>
        <Tooltip.Trigger asChild ref={triggerRef}>
          {children}
        </Tooltip.Trigger>
        {description && (
          <span id={descriptionId} hidden>
            {description}
          </span>
        )}
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
