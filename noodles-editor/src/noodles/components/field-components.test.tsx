import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { Temporal } from 'temporal-polyfill'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BooleanField,
  ColorField,
  CompoundPropsField,
  DataField,
  DateField,
  NumberField,
  Point2DField,
  Point3DField,
  StringField,
  StringLiteralField,
  Vec2Field,
  Vec3Field,
} from '../fields'
import { clearOps } from '../store'
import {
  BooleanFieldComponent,
  ColorFieldComponent,
  CompoundFieldComponent,
  DateFieldComponent,
  EmptyFieldComponent,
  NumberFieldComponent,
  TextFieldComponent,
  VectorFieldComponent,
} from './field-components'

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

describe('TextFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders with the field value for StringField', () => {
    const field = new StringField('hello world')
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('hello world')
  })

  it('updates field value on change for StringField', () => {
    const field = new StringField('initial')
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'updated' } })

    expect(field.value).toBe('updated')
  })

  it('updates field value on blur for StringField', () => {
    const field = new StringField('initial')
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'changed on blur' } })
    fireEvent.blur(input)

    expect(field.value).toBe('changed on blur')
  })

  it('disables input when disabled prop is true', () => {
    const field = new StringField('test')
    render(<TextFieldComponent id="test-field" field={field} disabled={true} />)

    const input = screen.getByRole('textbox')
    expect(input).toBeDisabled()
  })

  it('renders with empty string value', () => {
    const field = new StringField('')
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('')
  })

  it('updates when field value changes externally', () => {
    const field = new StringField('initial')
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('initial')

    act(() => {
      field.setValue('external update')
    })

    expect(input).toHaveValue('external update')
  })

  it('renders a select dropdown for StringLiteralField', () => {
    const field = new StringLiteralField('option1', ['option1', 'option2', 'option3'])
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('option1')
  })

  it('renders all options in StringLiteralField dropdown', () => {
    const field = new StringLiteralField('option1', ['option1', 'option2', 'option3'])
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveValue('option1')
    expect(options[1]).toHaveValue('option2')
    expect(options[2]).toHaveValue('option3')
  })

  it('updates StringLiteralField value on selection change', () => {
    const field = new StringLiteralField('option1', ['option1', 'option2', 'option3'])
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'option2' } })

    expect(field.value).toBe('option2')
  })

  it('renders StringLiteralField with label/value pairs', () => {
    const field = new StringLiteralField('val1', [
      { value: 'val1', label: 'Label 1' },
      { value: 'val2', label: 'Label 2' },
    ])
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Label 1')
    expect(options[0]).toHaveValue('val1')
    expect(options[1]).toHaveTextContent('Label 2')
    expect(options[1]).toHaveValue('val2')
  })

  it('disables StringLiteralField dropdown when disabled', () => {
    const field = new StringLiteralField('option1', ['option1', 'option2'])
    render(<TextFieldComponent id="test-field" field={field} disabled={true} />)

    const select = screen.getByRole('combobox')
    expect(select).toBeDisabled()
  })

  it('handles special characters in string values', () => {
    const field = new StringField('hello <script>alert("xss")</script>')
    render(<TextFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('textbox')
    // The value should be preserved as-is
    expect(input).toHaveValue('hello <script>alert("xss")</script>')
  })

  it('renders label with field id', () => {
    const field = new StringField('test')
    render(<TextFieldComponent id="myFieldName" field={field} disabled={false} />)

    const label = screen.getByText('myFieldName')
    expect(label).toBeInTheDocument()
  })
})

describe('BooleanFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders with checked state when field value is true', () => {
    const field = new BooleanField(true)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={false} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
  })

  it('renders with unchecked state when field value is false', () => {
    const field = new BooleanField(false)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={false} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('updates field value when checkbox is toggled', () => {
    const field = new BooleanField(false)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={false} />)

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    expect(field.value).toBe(true)
  })

  it('toggles from true to false', () => {
    const field = new BooleanField(true)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={false} />)

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    expect(field.value).toBe(false)
  })

  it('disables checkbox when disabled prop is true', () => {
    const field = new BooleanField(true)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={true} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
  })

  it('updates when field value changes externally', () => {
    const field = new BooleanField(false)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={false} />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()

    act(() => {
      field.setValue(true)
    })

    expect(checkbox).toBeChecked()
  })

  it('renders label with field id', () => {
    const field = new BooleanField(true)
    render(<BooleanFieldComponent id="visible" field={field} disabled={false} />)

    const label = screen.getByText('visible')
    expect(label).toBeInTheDocument()
  })

  it('has disabled attribute when disabled prop is true', () => {
    const field = new BooleanField(false)
    render(<BooleanFieldComponent id="test-field" field={field} disabled={true} />)

    const checkbox = screen.getByRole('checkbox')
    // Checkbox should be disabled
    expect(checkbox).toBeDisabled()
    // The field value should remain unchanged
    expect(field.value).toBe(false)
  })
})

describe('DateFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders with datetime-local input type', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="test-field" field={field} disabled={false} />)

    const input = document.querySelector('input[type="datetime-local"]')
    expect(input).toBeInTheDocument()
  })

  it('displays formatted date value', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="test-field" field={field} disabled={false} />)

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    // The format includes the date and time portion
    expect(input.value).toContain('2024-01-15')
    expect(input.value).toContain('10:30')
  })

  it('updates field value on change', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="test-field" field={field} disabled={false} />)

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2024-06-20T14:45:00' } })

    expect(field.value.toString()).toContain('2024-06-20T14:45')
  })

  it('disables input when disabled prop is true', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="test-field" field={field} disabled={true} />)

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    expect(input).toBeDisabled()
  })

  it('updates when field value changes externally', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="test-field" field={field} disabled={false} />)

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    expect(input.value).toContain('2024-01-15')

    act(() => {
      field.setValue(Temporal.PlainDateTime.from('2025-12-25T00:00:00'))
    })

    expect(input.value).toContain('2025-12-25')
  })

  it('has millisecond precision step', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="test-field" field={field} disabled={false} />)

    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    expect(input).toHaveAttribute('step', '0.001')
  })

  it('renders label with field id', () => {
    const field = new DateField(Temporal.PlainDateTime.from('2024-01-15T10:30:00'))
    render(<DateFieldComponent id="startDate" field={field} disabled={false} />)

    const label = screen.getByText('startDate')
    expect(label).toBeInTheDocument()
  })
})

describe('EmptyFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders only a label without input', () => {
    const field = new DataField()
    render(<EmptyFieldComponent id="data" field={field} />)

    const label = screen.getByText('data')
    expect(label).toBeInTheDocument()

    // Should not have any interactive inputs
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders with different field id', () => {
    const field = new DataField()
    render(<EmptyFieldComponent id="customDataField" field={field} />)

    const label = screen.getByText('customDataField')
    expect(label).toBeInTheDocument()
  })
})

describe('VectorFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  describe('Vec2Field', () => {
    it('renders x and y inputs for Vec2Field', () => {
      const field = new Vec2Field({ x: 10, y: 20 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs).toHaveLength(2)
    })

    it('displays x and y labels', () => {
      const field = new Vec2Field({ x: 10, y: 20 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      expect(screen.getByText('x')).toBeInTheDocument()
      expect(screen.getByText('y')).toBeInTheDocument()
    })

    it('renders with correct initial values', () => {
      const field = new Vec2Field({ x: 5, y: 15 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs[0]).toHaveValue(5)
      expect(inputs[1]).toHaveValue(15)
    })

    it('does not render lookup button for non-point fields', () => {
      const field = new Vec2Field({ x: 10, y: 20 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const lookupButton = screen.queryByTitle('Lookup Location')
      expect(lookupButton).not.toBeInTheDocument()
    })
  })

  describe('Vec3Field', () => {
    it('renders x, y, and z inputs for Vec3Field', () => {
      const field = new Vec3Field({ x: 1, y: 2, z: 3 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs).toHaveLength(3)
    })

    it('displays x, y, and z labels', () => {
      const field = new Vec3Field({ x: 1, y: 2, z: 3 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      expect(screen.getByText('x')).toBeInTheDocument()
      expect(screen.getByText('y')).toBeInTheDocument()
      expect(screen.getByText('z')).toBeInTheDocument()
    })

    it('renders with correct initial values', () => {
      const field = new Vec3Field({ x: 10, y: 20, z: 30 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs[0]).toHaveValue(10)
      expect(inputs[1]).toHaveValue(20)
      expect(inputs[2]).toHaveValue(30)
    })
  })

  describe('Point2DField', () => {
    it('renders lng and lat inputs for Point2DField', () => {
      const field = new Point2DField({ lng: -122.4, lat: 37.8 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs).toHaveLength(2)
    })

    it('displays lng and lat labels', () => {
      const field = new Point2DField({ lng: -122.4, lat: 37.8 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      expect(screen.getByText('lng')).toBeInTheDocument()
      expect(screen.getByText('lat')).toBeInTheDocument()
    })

    it('renders lookup button for Point2DField', () => {
      const field = new Point2DField({ lng: -122.4, lat: 37.8 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const lookupButton = screen.getByTitle('Lookup Location')
      expect(lookupButton).toBeInTheDocument()
    })

    it('disables lookup button when disabled', () => {
      const field = new Point2DField({ lng: -122.4, lat: 37.8 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={true} />)

      const lookupButton = screen.getByTitle('Lookup Location')
      expect(lookupButton).toBeDisabled()
    })
  })

  describe('Point3DField', () => {
    it('renders lng, lat, and alt inputs for Point3DField', () => {
      const field = new Point3DField({ lng: -122.4, lat: 37.8, alt: 100 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs).toHaveLength(3)
    })

    it('displays lng, lat, and alt labels', () => {
      const field = new Point3DField({ lng: -122.4, lat: 37.8, alt: 100 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      expect(screen.getByText('lng')).toBeInTheDocument()
      expect(screen.getByText('lat')).toBeInTheDocument()
      expect(screen.getByText('alt')).toBeInTheDocument()
    })

    it('renders lookup button for Point3DField', () => {
      const field = new Point3DField({ lng: -122.4, lat: 37.8, alt: 100 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const lookupButton = screen.getByTitle('Lookup Location')
      expect(lookupButton).toBeInTheDocument()
    })
  })

  describe('disabled state', () => {
    it('disables all inputs when disabled prop is true', () => {
      const field = new Vec2Field({ x: 10, y: 20 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={true} />)

      const inputs = screen.getAllByRole('spinbutton')
      inputs.forEach(input => {
        expect(input).toBeDisabled()
      })
    })
  })

  describe('external updates', () => {
    it('updates when field value changes externally', () => {
      const field = new Vec2Field({ x: 0, y: 0 })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs[0]).toHaveValue(0)
      expect(inputs[1]).toHaveValue(0)

      act(() => {
        field.setValue({ x: 100, y: 200 })
      })

      expect(inputs[0]).toHaveValue(100)
      expect(inputs[1]).toHaveValue(200)
    })
  })

  describe('tuple format', () => {
    it('handles tuple format for Point2DField', () => {
      const field = new Point2DField([-122.4, 37.8], { returnType: 'tuple' })
      render(<VectorFieldComponent id="test-field" field={field} disabled={false} />)

      const inputs = screen.getAllByRole('spinbutton')
      expect(inputs[0]).toHaveValue(-122.4)
      expect(inputs[1]).toHaveValue(37.8)
    })
  })
})

describe('CompoundFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  // Note: CompoundFieldComponent uses FieldComponent internally which requires ReactFlowProvider
  // All tests wrap the component with ReactFlowProvider

  it('renders with expand/collapse button', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
      y: new NumberField(20),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="position" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    const button = screen.getByRole('button', { name: /position/i })
    expect(button).toBeInTheDocument()
  })

  it('shows expand indicator', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="test" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    // The expand indicator should be visible
    expect(screen.getByText('►')).toBeInTheDocument()
  })

  it('hides sub-fields when collapsed', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
      y: new NumberField(20),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="position" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    // Click to collapse
    const button = screen.getByRole('button', { name: /position/i })
    fireEvent.click(button)

    // Sub-fields should be hidden - no spinbuttons
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it('shows hidden props count when collapsed', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
      y: new NumberField(20),
      z: new NumberField(30),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="position" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    // Click to collapse
    const button = screen.getByRole('button', { name: /position/i })
    fireEvent.click(button)

    expect(screen.getByText('(3 hidden props)')).toBeInTheDocument()
  })

  it('re-expands when collapse message is clicked', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
      y: new NumberField(20),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="position" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    // Collapse first
    const mainButton = screen.getByRole('button', { name: /position/i })
    fireEvent.click(mainButton)

    // Then click the hidden props button to expand
    const hiddenPropsButton = screen.getByText('(2 hidden props)')
    fireEvent.click(hiddenPropsButton)

    // Should be expanded again - sub-field labels should appear
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('y')).toBeInTheDocument()
  })

  it('renders sub-fields when expanded', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
      y: new NumberField(20),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="position" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    // Should be expanded by default and have sub-field labels
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('y')).toBeInTheDocument()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(2)
  })

  it('renders nested different field types', () => {
    const field = new CompoundPropsField({
      name: new StringField('test'),
      count: new NumberField(42),
      enabled: new BooleanField(true),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="config" field={field} disabled={false} />
      </ReactFlowProvider>
    )

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('passes disabled state to sub-fields', () => {
    const field = new CompoundPropsField({
      x: new NumberField(10),
      y: new NumberField(20),
    })
    render(
      <ReactFlowProvider>
        <CompoundFieldComponent id="position" field={field} disabled={true} />
      </ReactFlowProvider>
    )

    const inputs = screen.getAllByRole('spinbutton')
    inputs.forEach(input => {
      expect(input).toBeDisabled()
    })
  })
})

describe('ColorFieldComponent', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders with field value', () => {
    const field = new ColorField('#ff0000ff')
    render(<ColorFieldComponent id="test-field" field={field} disabled={false} />)

    // ColorSwatch should be rendered
    const colorSwatch = document.querySelector('[class*="colorSwatch"]')
    expect(colorSwatch).toBeInTheDocument()
  })

  it('renders label with field id', () => {
    const field = new ColorField('#00ff00ff')
    render(<ColorFieldComponent id="fillColor" field={field} disabled={false} />)

    const label = screen.getByText('fillColor')
    expect(label).toBeInTheDocument()
  })

  it('updates when field value changes externally', () => {
    const field = new ColorField('#ff0000ff')
    const { rerender } = render(
      <ColorFieldComponent id="test-field" field={field} disabled={false} />
    )

    act(() => {
      field.setValue('#0000ffff')
    })

    // Re-render to pick up the state change
    rerender(<ColorFieldComponent id="test-field" field={field} disabled={false} />)

    // Verify field value updated
    expect(field.value).toBe('#0000ffff')
  })

  it('normalizes 6-char hex to 8-char', () => {
    const field = new ColorField('#ff0000')
    render(<ColorFieldComponent id="test-field" field={field} disabled={false} />)

    // ColorField should normalize to 8-char hex
    expect(field.value).toBe('#ff0000ff')
  })
})

describe('NumberFieldComponent edge cases', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('handles undefined initial value gracefully', () => {
    const field = new NumberField()
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(0) // Default value
  })

  it('handles negative numbers', () => {
    const field = new NumberField(-50, { min: -100, max: 100 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(-50)
  })

  it('handles floating point numbers', () => {
    const field = new NumberField(1.23456, { step: 0.00001 })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    // The display rounds to 2 decimal places when not focused
    expect(input).toHaveValue(1.23)
    // But the field stores the full precision
    expect(field.value).toBe(1.23456)
  })

  it('handles very large numbers', () => {
    const field = new NumberField(1000000)
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(1000000)
  })

  it('handles zero value', () => {
    const field = new NumberField(0)
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(0)
  })

  it('handles Infinity soft limits - falls back to hard limits', () => {
    // When softMin/softMax are not finite, they fall back to min/max
    const field = new NumberField(50, { min: 0, max: 100, softMin: -Infinity, softMax: Infinity })
    render(<NumberFieldComponent id="test-field" field={field} disabled={false} />)

    const input = screen.getByRole('spinbutton')
    // When soft limits are Infinity, falls back to hard limits
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '100')
  })

  it('renders label with field id', () => {
    const field = new NumberField(42)
    render(<NumberFieldComponent id="myNumber" field={field} disabled={false} />)

    const label = screen.getByText('myNumber')
    expect(label).toBeInTheDocument()
  })
})
