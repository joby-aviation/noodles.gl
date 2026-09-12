import cx from 'classnames'
import {
  type FocusEventHandler,
  type FormEvent,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import s from '../noodles.module.css'
import { addDecimalSteps } from '../utils/number-precision'

type DragState = {
  startX: number
  startY: number
  totalDistanceMoved: number
  detected: boolean
}

export type UseDragOptions = {
  disabled?: boolean
  onDragStart?: (event: MouseEvent | TouchEvent) => boolean
  onDrag?: (deltaX: number, deltaY: number, event: MouseEvent | TouchEvent) => void
  onDragEnd?: (event: Event) => void
  onInteractionEnd?: (event: Event) => void
}

export function useDrag(options: UseDragOptions) {
  const { disabled, onDragStart, onDrag, onDragEnd, onInteractionEnd } = options
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef<DragState | null>(null)
  const removeListenersRef = useRef<(() => void) | null>(null)

  const clearDrag = useCallback(() => {
    removeListenersRef.current?.()
    removeListenersRef.current = null
    dragStateRef.current = null
  }, [])

  const finishDrag = useCallback(
    (event: Event) => {
      const detected = dragStateRef.current?.detected ?? false
      clearDrag()
      if (detected) setIsDragging(false)
      onInteractionEnd?.(event)
      if (detected) onDragEnd?.(event)
    },
    [clearDrag, onDragEnd, onInteractionEnd]
  )

  useEffect(() => clearDrag, [clearDrag])

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (disabled) return
      if (onDragStart && !onDragStart(event.nativeEvent)) return

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStateRef.current) return

        const { startX, startY, detected } = dragStateRef.current
        const deltaX = moveEvent.clientX - startX
        const deltaY = startY - moveEvent.clientY

        if (!detected) {
          dragStateRef.current.totalDistanceMoved += Math.abs(deltaX) + Math.abs(deltaY)
          if (dragStateRef.current.totalDistanceMoved > 5) {
            dragStateRef.current.detected = true
            setIsDragging(true)
          }
        }

        if (dragStateRef.current.detected) {
          onDrag?.(deltaX, deltaY, moveEvent)
        }
      }

      const handleMouseUp = (upEvent: MouseEvent) => finishDrag(upEvent)
      const handleWindowBlur = (blurEvent: Event) => finishDrag(blurEvent)

      clearDrag()
      dragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        totalDistanceMoved: 0,
        detected: false,
      }
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('blur', handleWindowBlur)
      removeListenersRef.current = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('blur', handleWindowBlur)
      }
    },
    [clearDrag, disabled, finishDrag, onDragStart, onDrag]
  )

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent) => {
      if (disabled) return
      if (onDragStart && !onDragStart(event.nativeEvent)) return

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (!dragStateRef.current) return

        const { startX, startY, detected } = dragStateRef.current
        const deltaX = moveEvent.touches[0].clientX - startX
        const deltaY = startY - moveEvent.touches[0].clientY

        if (!detected) {
          dragStateRef.current.totalDistanceMoved += Math.abs(deltaX) + Math.abs(deltaY)
          if (dragStateRef.current.totalDistanceMoved > 5) {
            dragStateRef.current.detected = true
            setIsDragging(true)
          }
        }

        if (dragStateRef.current.detected) {
          onDrag?.(deltaX, deltaY, moveEvent)
        }
      }

      const handleTouchEnd = (endEvent: TouchEvent) => finishDrag(endEvent)
      const handleTouchCancel = (cancelEvent: TouchEvent) => finishDrag(cancelEvent)
      const handleWindowBlur = (blurEvent: Event) => finishDrag(blurEvent)

      clearDrag()
      dragStateRef.current = {
        startX: event.touches[0].clientX,
        startY: event.touches[0].clientY,
        totalDistanceMoved: 0,
        detected: false,
      }
      document.addEventListener('touchmove', handleTouchMove)
      document.addEventListener('touchend', handleTouchEnd)
      document.addEventListener('touchcancel', handleTouchCancel)
      window.addEventListener('blur', handleWindowBlur)
      removeListenersRef.current = () => {
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
        document.removeEventListener('touchcancel', handleTouchCancel)
        window.removeEventListener('blur', handleWindowBlur)
      }
    },
    [clearDrag, disabled, finishDrag, onDragStart, onDrag]
  )

  return {
    isDragging,
    handleMouseDown,
    handleTouchStart,
  }
}

// The ladder only scales by powers of ten. Adjusting the exponent directly avoids
// persisting artifacts such as 0.1 * 0.1 === 0.010000000000000002.
function scaleStep(baseStep: number, multiplier: number): number {
  const multiplierExponent = Math.round(Math.log10(multiplier))
  const [coefficient, exponent = '0'] = baseStep.toExponential().split('e')
  return Number(`${coefficient}e${Number(exponent) + multiplierExponent}`)
}

export function StepLadder({
  baseStep,
  currentStepMultiplier,
  mousePos,
  containerRect,
}: {
  baseStep: number
  currentStepMultiplier: number
  mousePos: { x: number; y: number }
  containerRect?: DOMRect | null
}) {
  const steps = []
  for (let i = 2; i >= -2; i--) {
    const multiplier = 10 ** i
    const stepSize = scaleStep(baseStep, multiplier)
    const isActive = Math.abs(currentStepMultiplier - multiplier) < 0.01

    steps.push({
      multiplier,
      stepSize,
      isActive,
      label: Number.parseFloat(stepSize.toPrecision(12)).toString(),
    })
  }

  const defaultStepIndex = steps.findIndex(step => step.multiplier === 1)
  const stepItemHeight = 28
  let topPosition = 0

  if (containerRect) {
    const relativeMouseY = mousePos.y - containerRect.top
    topPosition = relativeMouseY - (defaultStepIndex * stepItemHeight + stepItemHeight / 2)
  }

  return (
    <div
      className={s.stepLadder}
      style={{
        right: 'calc(100% + 4px)',
        top: `${topPosition}px`,
        transform: 'none',
      }}
    >
      {steps.map(({ multiplier, stepSize, isActive, label }) => (
        <div
          key={multiplier}
          className={cx(s.stepLadderItem, {
            [s.stepLadderItemActive]: isActive,
          })}
          title={`Step size: ${stepSize}`}
        >
          <span className={s.stepLadderLabel}>{label}</span>
        </div>
      ))}
    </div>
  )
}

export interface DraggableNumberInputProps {
  id?: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
  onCommit?: () => void
  onDragEnd?: () => void
  onInteractionStart?: () => void
  onStepChange?: (step: number) => void
  onBlur?: FocusEventHandler<HTMLInputElement>
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
  min?: number
  max?: number
  softMin?: number
  softMax?: number
  step?: number
  autoFocus?: boolean
  className?: string
  wrapperClassName?: string
  formatDisplayValue?: (value: number) => string | number
  title?: string
  placeholder?: string
  'aria-label'?: string
}

export function DraggableNumberInput({
  id,
  value,
  disabled = false,
  onChange,
  onCommit,
  onDragEnd,
  onInteractionStart,
  onStepChange,
  onBlur,
  onKeyDown,
  min,
  max,
  softMin,
  softMax,
  step = 1,
  autoFocus,
  className,
  wrapperClassName,
  formatDisplayValue,
  title,
  placeholder,
  'aria-label': ariaLabel,
}: DraggableNumberInputProps) {
  const validStep = Number.isFinite(step) && step > 0 ? step : 1
  const [displayValue, setDisplayValue] = useState(value?.toString() ?? '0')
  const [isActive, setIsActive] = useState(false)
  const [currentStepMultiplier, setCurrentStepMultiplier] = useState(1)
  const [isDragStarted, setIsDragStarted] = useState(false)
  const [showLadder, setShowLadder] = useState(false)
  const [initialMousePos, setInitialMousePos] = useState({ x: 0, y: 0 })
  const [interactionStep, setInteractionStep] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const startValueRef = useRef(0)
  const interactionStepRef = useRef(validStep)
  const interactionActiveRef = useRef(false)
  const inputFocusedRef = useRef(false)
  const isHorizontalLockedRef = useRef(false)
  const lockedStepMultiplierRef = useRef(1)
  const selectedStepRef = useRef<number | null>(null)
  const ladderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDisplayValue(value?.toString() ?? '0')
  }, [value])

  useEffect(
    () => () => {
      if (ladderTimerRef.current) clearTimeout(ladderTimerRef.current)
    },
    []
  )

  const resetDragUi = useCallback(() => {
    setIsDragStarted(false)
    setShowLadder(false)
    isHorizontalLockedRef.current = false
    setCurrentStepMultiplier(1)
    lockedStepMultiplierRef.current = 1
    if (ladderTimerRef.current) {
      clearTimeout(ladderTimerRef.current)
      ladderTimerRef.current = null
    }
  }, [])

  const beginStepInteraction = useCallback(() => {
    if (interactionActiveRef.current) return
    interactionActiveRef.current = true
    interactionStepRef.current = validStep
    setInteractionStep(validStep)
  }, [validStep])

  const endStepInteraction = useCallback(() => {
    interactionActiveRef.current = false
    setInteractionStep(null)
  }, [])

  const handleInputChange = useCallback(
    (event: FormEvent<HTMLInputElement>) => {
      const newValue = event.currentTarget.value
      setDisplayValue(newValue)
      if (!(+newValue === 0 && newValue.length !== 1)) {
        onChange(+newValue)
      }
    },
    [onChange]
  )

  const { isDragging, handleMouseDown, handleTouchStart } = useDrag({
    disabled,
    onDragStart: event => {
      const target = event.target as HTMLInputElement
      const touchEvent = event as TouchEvent
      if (
        target.type === 'number' &&
        ('offsetX' in event ? event.offsetX : touchEvent.touches[0].clientX - target.offsetLeft) >
          target.offsetWidth - 20
      ) {
        return false
      }

      onInteractionStart?.()
      beginStepInteraction()
      startValueRef.current = value
      setInitialMousePos({
        x: 'clientX' in event ? event.clientX : touchEvent.touches[0].clientX,
        y: 'clientY' in event ? event.clientY : touchEvent.touches[0].clientY,
      })
      setCurrentStepMultiplier(1)
      isHorizontalLockedRef.current = false
      setIsDragStarted(true)
      lockedStepMultiplierRef.current = 1
      selectedStepRef.current = null

      ladderTimerRef.current = setTimeout(() => {
        window.getSelection()?.removeAllRanges()
        setShowLadder(true)
      }, 400)

      return true
    },
    onDrag: (deltaX, deltaY) => {
      const horizontalMovement = Math.abs(deltaX) > 15
      let snappedStepMultiplier = 1

      if (!isHorizontalLockedRef.current) {
        const rawStepMultiplier = 10 ** (deltaY / 20)
        const logMultiplier = Math.log10(rawStepMultiplier)
        const snappedLogMultiplier = Math.round(logMultiplier)
        const clampedLogMultiplier = Math.max(-2, Math.min(2, snappedLogMultiplier))
        snappedStepMultiplier = 10 ** clampedLogMultiplier
      }

      if (!isHorizontalLockedRef.current) {
        if (!horizontalMovement) {
          setCurrentStepMultiplier(snappedStepMultiplier)
        } else {
          lockedStepMultiplierRef.current = snappedStepMultiplier
          isHorizontalLockedRef.current = true
          const selectedStep = scaleStep(interactionStepRef.current, snappedStepMultiplier)
          selectedStepRef.current = selectedStep
          onStepChange?.(selectedStep)
        }
      }

      if (horizontalMovement || isHorizontalLockedRef.current) {
        const activeStepMultiplier = isHorizontalLockedRef.current
          ? lockedStepMultiplierRef.current
          : snappedStepMultiplier
        const stepSize = scaleStep(interactionStepRef.current, activeStepMultiplier)
        const newValue = addDecimalSteps(startValueRef.current, stepSize, deltaX)
        const minClampedValue = min === undefined ? newValue : Math.max(newValue, min)
        const clampedValue = max === undefined ? minClampedValue : Math.min(minClampedValue, max)
        setDisplayValue(clampedValue.toString())
        onChange(clampedValue)
      }
    },
    onInteractionEnd: event => {
      const selectedStep = selectedStepRef.current
      selectedStepRef.current = null
      resetDragUi()
      if (event.type === 'blur' || event.type === 'touchcancel') {
        inputFocusedRef.current = false
        endStepInteraction()
      } else if (inputFocusedRef.current && selectedStep !== null) {
        interactionStepRef.current = selectedStep
        setInteractionStep(selectedStep)
      } else if (!inputFocusedRef.current) {
        endStepInteraction()
      }
    },
    onDragEnd: () => {
      onCommit?.()
      onDragEnd?.()
    },
  })

  const shouldShowLadder = showLadder && isDragStarted && !isHorizontalLockedRef.current
  const containerRect = containerRef.current?.getBoundingClientRect()
  const formatted = displayValue === '' ? '' : (formatDisplayValue?.(+displayValue) ?? displayValue)
  const effectiveStep = interactionStep ?? validStep

  return (
    // biome-ignore lint/a11y/useSemanticElements: Number input wrapper with drag interaction requires div with role
    <div
      className={cx(s.fieldInputWrapper, wrapperClassName)}
      style={{ position: 'relative' }}
      role="group"
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      ref={containerRef}
    >
      <input
        id={id}
        type="number"
        onFocus={() => {
          inputFocusedRef.current = true
          beginStepInteraction()
          setIsActive(true)
          onInteractionStart?.()
        }}
        onBlur={event => {
          inputFocusedRef.current = false
          endStepInteraction()
          setIsActive(false)
          onCommit?.()
          onBlur?.(event)
        }}
        onKeyDown={onKeyDown}
        className={cx(className, {
          [s.fieldInputNumberDragging]: isDragging,
        })}
        value={isActive ? displayValue : formatted}
        title={title || displayValue}
        placeholder={placeholder}
        onChange={handleInputChange}
        disabled={disabled}
        min={Number.isFinite(softMin ?? -Infinity) ? softMin : min}
        max={Number.isFinite(softMax ?? Infinity) ? softMax : max}
        step={effectiveStep}
        // biome-ignore lint/a11y/noAutofocus: Cell editors must focus the control that replaced the display cell.
        autoFocus={autoFocus}
        aria-label={ariaLabel}
      />
      {shouldShowLadder && (
        <StepLadder
          baseStep={effectiveStep}
          currentStepMultiplier={currentStepMultiplier}
          mousePos={initialMousePos}
          containerRect={containerRect}
        />
      )}
    </div>
  )
}
