import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from '../fields'
import { clearOps } from '../store'
import { NumberFieldComponent } from './field-components'

describe('NumberFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders with the field value', () => {
    const field = new NumberField(42)
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(42)
  })

  it('renders with soft limits as HTML input attributes', () => {
    const field = new NumberField(50, {
      min: 0,
      max: 200,
      softMin: 10,
      softMax: 100,
    })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    // HTML input should use soft limits for browser hints
    expect(input).toHaveAttribute('min', '10')
    expect(input).toHaveAttribute('max', '100')
  })

  it('falls back to hard limits when soft limits are infinite', () => {
    // When soft limits are not set (default to Infinity), falls back to hard limits
    const field = new NumberField(50, { min: 0, max: 200 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    // Falls back to hard limits when soft limits are infinite
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '200')
  })

  it('uses soft max and falls back to hard min when only softMax is set', () => {
    const field = new NumberField(50, { min: 0, softMax: 100 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '0') // Falls back to hard min
    expect(input).toHaveAttribute('max', '100') // Uses explicit softMax
  })

  it('allows typing values outside soft limits', () => {
    const field = new NumberField(50, { softMin: 0, softMax: 100 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')

    // Type a value above soft max using fireEvent
    fireEvent.change(input, { target: { value: '150' } })

    // The field should accept the value (soft limits don't enforce validation)
    expect(field.value).toBe(150)
  })

  it('rejects values outside hard limits', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const field = new NumberField(50, { min: 0, max: 100 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')

    // Type a value above hard max
    fireEvent.change(input, { target: { value: '150' } })

    // The field rejects the value and keeps previous value (Zod validation fails)
    expect(field.value).toBe(50)
    expect(consoleWarn).toHaveBeenCalled()
  })

  it('updates when field value changes externally', () => {
    const field = new NumberField(10)
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(10)

    // Update field value externally
    act(() => {
      field.setValue(99)
    })

    expect(input).toHaveValue(99)
  })

  it('disables input when disabled prop is true', () => {
    const field = new NumberField(50)
    render(<NumberFieldComponent id="test-field" field={field} disabled={true} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toBeDisabled()
  })

  it('renders with step attribute from field', () => {
    const field = new NumberField(50, { step: 0.5 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('step', '0.5')
  })
})

describe('NumberFieldComponent with typical operator patterns', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('handles scale fields: hard min 0, soft max for UI', () => {
    // Pattern used by widthScale, radiusScale, elevationScale, etc.
    const field = new NumberField(1, { min: 0, softMax: 100 })
    render(<NumberFieldComponent id="widthScale" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '100')

    // Can exceed soft max via typing
    fireEvent.change(input, { target: { value: '500' } })
    expect(field.value).toBe(500)
  })

  it('handles pixel fields: hard min 0, soft max for UI', () => {
    // Pattern used by widthMinPixels, sizeMaxPixels, etc.
    const field = new NumberField(2, { min: 0, softMax: 100 })
    render(<NumberFieldComponent id="widthMinPixels" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '100')
  })

  it('handles normalized fields: hard min/max for constraints', () => {
    // Pattern used by opacity, coverage, intensity, threshold, etc.
    const field = new NumberField(1, { min: 0, max: 1, step: 0.01 })
    render(<NumberFieldComponent id="opacity" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '1')
    expect(input).toHaveAttribute('step', '0.01')
  })

  it('handles geographic fields: hard limits for valid ranges', () => {
    // Pattern used by latitude
    const field = new NumberField(0, { min: -90, max: 90, step: 0.001 })
    render(<NumberFieldComponent id="latitude" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '-90')
    expect(input).toHaveAttribute('max', '90')
  })

  it('handles angle fields: soft limits for UI hints', () => {
    // Pattern used by getAngle, rotate, etc.
    const field = new NumberField(0, { softMin: 0, softMax: 360 })
    render(<NumberFieldComponent id="getAngle" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '360')

    // Can enter angles outside 0-360 (they wrap around)
    fireEvent.change(input, { target: { value: '720' } })
    expect(field.value).toBe(720)
  })
})
