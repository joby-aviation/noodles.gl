import { useCallback, useEffect, useRef, useState } from 'react'
import { ChromePicker } from 'react-color'
import { createPortal } from 'react-dom'
import { colorToHex } from '../../utils/color'
import s from '../noodles.module.css'

interface ColorSwatchProps {
  // Color value as hex string (e.g., "#ff0000" or "#ff0000ff") or color array [r, g, b, a]
  value: string | [number, number, number, number?]
  // Callback when color changes
  onChange: (color: string) => void
  // Whether the swatch is disabled
  disabled?: boolean
}

// ColorSwatch - A color picker component
//
// Features:
// - Color swatch button with checkered background for transparency
// - ChromePicker from react-color for color selection
// - Click-outside, escape, scroll, and touch-to-close behavior
// - Global blur when picker closes
// - Smart positioning (below or above swatch based on available space)
export function ColorSwatch({ value, onChange, disabled = false }: ColorSwatchProps) {
  const [showPicker, setShowPicker] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const swatchRef = useRef<HTMLButtonElement>(null)

  // Convert value to hex string for display
  const hexValue =
    typeof value === 'string'
      ? value
      : (() => {
          const [r, g, b, a = 255] = value
          return colorToHex([r, g, b, a])
        })()

  // Handle click outside, escape, wheel, and touch events
  useEffect(() => {
    const closePicker = () => {
      setShowPicker(false)
      // Global blur: remove focus from the button to ensure the node loses focus
      swatchRef.current?.blur()
      // Also blur any active element to ensure complete blur behavior
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node

      // Check if click is outside both picker and swatch
      const isOutsidePicker = pickerRef.current && !pickerRef.current.contains(target)
      const isOutsideSwatch = swatchRef.current && !swatchRef.current.contains(target)

      if (isOutsidePicker && isOutsideSwatch) {
        closePicker()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showPicker) {
        closePicker()
      }
    }

    const handleWheel = (event: WheelEvent) => {
      // Close picker on any scroll/wheel event (e.g., React Flow canvas zoom)
      const target = event.target as Node
      const isInsidePicker = pickerRef.current?.contains(target)

      if (!isInsidePicker) {
        closePicker()
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      // Close picker on touch events outside
      const target = event.target as Node
      const isOutsidePicker = pickerRef.current && !pickerRef.current.contains(target)
      const isOutsideSwatch = swatchRef.current && !swatchRef.current.contains(target)

      if (isOutsidePicker && isOutsideSwatch) {
        closePicker()
      }
    }

    if (showPicker) {
      // Use capture phase to ensure we catch events before they're handled elsewhere
      document.addEventListener('mousedown', handleClickOutside, true)
      document.addEventListener('keydown', handleEscape)
      document.addEventListener('wheel', handleWheel, true)
      document.addEventListener('touchstart', handleTouchStart, true)

      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true)
        document.removeEventListener('keydown', handleEscape)
        document.removeEventListener('wheel', handleWheel, true)
        document.removeEventListener('touchstart', handleTouchStart, true)
      }
    }
  }, [showPicker])

  const calculatePickerPosition = useCallback(() => {
    if (!swatchRef.current) return null

    const swatchRect = swatchRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const pickerWidth = 225
    const pickerHeight = 240

    const margin = 8

    // Calculate available space in all directions
    const spaceBelow = viewportHeight - swatchRect.bottom
    const spaceAbove = swatchRect.top

    let top = swatchRect.bottom + margin
    let left = swatchRect.left

    // Vertical positioning: prefer below, but use above if not enough space
    if (spaceBelow < pickerHeight + margin && spaceAbove > spaceBelow) {
      top = swatchRect.top - pickerHeight - margin
    }

    // Horizontal positioning: ensure picker stays within viewport
    if (left + pickerWidth > viewportWidth) {
      left = Math.max(margin, viewportWidth - pickerWidth - margin)
    }

    return { top, left }
  }, [])

  const handleSwatchClick = useCallback(() => {
    if (disabled) return

    if (showPicker) {
      // Close picker if already open
      setShowPicker(false)
    } else {
      // Calculate position and open picker
      const position = calculatePickerPosition()
      if (position) {
        setPickerPosition(position)
        setShowPicker(true)
      }
    }
  }, [disabled, showPicker, calculatePickerPosition])

  const onPickerChange = useCallback(
    (color: { rgb: { r: number; g: number; b: number; a?: number } }) => {
      // Convert from react-color format to hex with alpha
      // color.rgb = { r: 0-255, g: 0-255, b: 0-255, a: 0-1 }
      const { r, g, b, a = 1 } = color.rgb
      const hexColor = colorToHex([r, g, b, Math.round(a * 255)])
      onChange(hexColor)
    },
    [onChange]
  )

  return (
    <>
      <button
        ref={swatchRef}
        type="button"
        onClick={handleSwatchClick}
        disabled={disabled}
        className={s.colorSwatch}
        title="Open color picker"
        aria-label="Open color picker"
      >
        <div
          className={s.colorSwatchInner}
          style={{ '--color-value': hexValue } as React.CSSProperties}
        />
      </button>
      {showPicker &&
        pickerPosition &&
        createPortal(
          <div
            ref={pickerRef}
            style={{
              position: 'fixed',
              top: `${pickerPosition.top}px`,
              left: `${pickerPosition.left}px`,
              zIndex: 10000,
            }}
          >
            <div className={s.chromePickerWrapper}>
              <ChromePicker color={hexValue} onChange={onPickerChange} disableAlpha={false} />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
