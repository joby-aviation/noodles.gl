import React, { useRef, useEffect, useCallback, useState } from 'react'
import useDrag from './use-drag'

import './multi-thumb-slider.css'

// --- Helper function to format value as a percentage ---
const formatValue = (value: number) => `${(value).toFixed(1)}`

// --- Thumb Component ---
const Thumb = React.memo(
  ({
    value,
    onMouseDown,
    onTouchStart,
    onClick,
    index,
  }: {
    value: number
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void
    onClick: (index: number) => void
    index: number
  }) => (
    <div
      id={`thumb-${index}`}
      data-index={index}
      className="multi-thumb-slider-thumb"
      style={{ left: `${value * 100}%` }}
      onClick={() => onClick(index)}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={`Slider handle ${index + 1}`}
    >
      <div className="multi-thumb-slider-thumb-label">{formatValue(value)}</div>
    </div>
  )
)

// --- Track Segment Component ---
const TrackSegment = React.memo(({ start, end, color }) => (
  <div
    className="multi-thumb-slider-track-segment"
    style={{
      left: `${start * 100}%`,
      width: `${(end - start) * 100}%`,
    }}
  />
))

// --- Main Multi-Thumb Slider Component ---
export const MultiThumbSlider = ({
  values = [0, 1],
  onChange,
  onClick,
}: {
  values: number[]
  onChange: (values: number[]) => void
  onClick: (index: number) => void
}) => {
  const sliderRef = useRef<HTMLDivElement>(null)
  const activeThumbIndex = useRef<number | null>(null)

  const [sliderValues, setSliderValues] = useState(values)

  const { handleMouseDown, handleTouchStart } = useDrag({
    onDragStart: event => {
      if (event.nativeEvent instanceof TouchEvent) {
        activeThumbIndex.current = event.nativeEvent.touches[0].identifier
      } else {
        activeThumbIndex.current = Number(event.currentTarget.dataset.index)
      }
      return true
    },
    onDrag: (deltaX, deltaY, event) => {
      if (activeThumbIndex.current === null || !sliderRef.current) return

      const { left, width } = sliderRef.current.getBoundingClientRect()
      const clientX = event instanceof TouchEvent ? event.touches[0].clientX : event.clientX
      const newValue = Math.max(0, Math.min(1, (clientX - left) / width))

      const newValues = [...sliderValues]
      const currentIndex = activeThumbIndex.current

      const lowerBound = currentIndex > 0 ? newValues[currentIndex - 1] : 0
      const upperBound = currentIndex < newValues.length - 1 ? newValues[currentIndex + 1] : 1

      // Clamp the value between its neighbors
      newValues[currentIndex] = Math.max(lowerBound, Math.min(newValue, upperBound))

      setSliderValues(newValues)
    },
    onDragEnd: () => {
      activeThumbIndex.current = null
    },
  })

  useEffect(() => {
    setSliderValues(values)
  }, [values, setSliderValues])

  return (
    <div className="multi-thumb-slider">
      <div ref={sliderRef} className="multi-thumb-slider-track">
        {sliderValues.map((value, i) => (
          <TrackSegment key={i} start={sliderValues[i]} end={sliderValues[i + 1] || 1} />
        ))}
        {sliderValues.map((value, index) => (
          <Thumb
            key={index}
            index={index}
            value={value}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onClick={onClick}
          />
        ))}
      </div>
    </div>
  )
}
