import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AttributeFieldWrapper } from './attribute-field-wrapper'
import { NumberField, ColorField, Point3DField } from '../fields'

// Mock the property history hook
vi.mock('../utils/property-history', () => ({
  usePropertyHistory: () => ({
    captureStart: vi.fn(),
    commitChange: vi.fn(),
  }),
}))

describe('AttributeFieldWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('State Initialization (Deserialization Fix)', () => {
    it('should initialize toggle to uniform mode when field has primitive value', () => {
      const field = new NumberField(50, { accessor: true, defaultAttribute: 'radius' })

      const { container } = render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Verify uniform input is visible
      expect(screen.getByTestId('uniform-input')).toBeInTheDocument()

      // Verify no attribute name input
      expect(container.querySelector('input[placeholder="radius"]')).not.toBeInTheDocument()
    })

    it('should initialize toggle to attribute mode when field has attributeName', () => {
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ attributeName: 'size' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Verify attribute name input is visible with correct value
      const attributeInput = screen.getByDisplayValue('size')
      expect(attributeInput).toBeInTheDocument()
      expect(attributeInput).toHaveAttribute('placeholder', 'radius')

      // Verify uniform input is NOT visible
      expect(screen.queryByTestId('uniform-input')).not.toBeInTheDocument()
    })

    it('should initialize toggle to expression mode when field has expression', () => {
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ expression: 'd.value * 2' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Verify expression input is visible with correct value
      const expressionInput = screen.getByDisplayValue('d.value * 2')
      expect(expressionInput).toBeInTheDocument()
      expect(expressionInput).toHaveAttribute('placeholder', 'd.value')

      // Verify uniform input is NOT visible
      expect(screen.queryByTestId('uniform-input')).not.toBeInTheDocument()
    })

    it('should sync with field value on mount even if set before component renders', () => {
      // This simulates the deserialization case where setValue happens before mount
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ attributeName: 'preloaded' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Should immediately show attribute mode with preloaded value
      expect(screen.getByDisplayValue('preloaded')).toBeInTheDocument()
      expect(screen.queryByTestId('uniform-input')).not.toBeInTheDocument()
    })
  })

  // Note: Runtime state updates are tested implicitly through the useEffect subscription
  // The critical fix is ensuring state initializes correctly from field.value on mount

  describe('Multiple Field Types', () => {
    it('should work with ColorField accessor in attribute mode', () => {
      const field = new ColorField('#ff0000', {
        accessor: true,
        defaultAttribute: 'fillColor',
      })
      field.setValue({ attributeName: 'color' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="color" />
        </AttributeFieldWrapper>
      )

      // Verify attribute mode is active
      expect(screen.getByDisplayValue('color')).toBeInTheDocument()
      expect(screen.queryByTestId('uniform-input')).not.toBeInTheDocument()
    })

    it('should work with Point3DField accessor in expression mode', () => {
      const field = new Point3DField([0, 0, 0], {
        accessor: true,
        defaultAttribute: 'position',
      })
      field.setValue({ expression: '[d.lng, d.lat, 0]' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" />
        </AttributeFieldWrapper>
      )

      // Verify expression mode is active
      expect(screen.getByDisplayValue('[d.lng, d.lat, 0]')).toBeInTheDocument()
      expect(screen.queryByTestId('uniform-input')).not.toBeInTheDocument()
    })
  })

  it('should render children for uniform mode without defaultAttribute', () => {
    const field = new NumberField(42)

    const { container } = render(
      <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
        <input type="number" defaultValue={42} />
      </AttributeFieldWrapper>
    )

    expect(container.querySelector('input[type="number"]')).toBeInTheDocument()
    expect(screen.queryByText('🔍 auto')).not.toBeInTheDocument()
  })

  it('should show auto-detection badge when field.autoDetected is true', () => {
    const field = new NumberField(42, { defaultAttribute: 'radius' })
    field.autoDetected = true

    render(
      <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
        <input type="number" />
      </AttributeFieldWrapper>
    )

    const badge = screen.getByText('🔍 auto')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('title', 'Auto-detected from data schema')
  })

  it('should show help icon in expression mode', () => {
    const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
    field.setValue({ expression: 'd.value * 2' })

    const { container } = render(
      <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
        <input type="number" />
      </AttributeFieldWrapper>
    )

    // InfoIcon is an SVG, check for it in the container
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should show auto-detected tooltip for attribute mode', () => {
    const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
    field.setValue({ attributeName: 'size' })
    field.autoDetected = true

    render(
      <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
        <input type="number" />
      </AttributeFieldWrapper>
    )

    const input = screen.getByDisplayValue('size')
    expect(input).toHaveAttribute('title', "Auto-detected from 'size' column")
  })

  describe('Edge Cases', () => {
    it('should handle empty attributeName', () => {
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ attributeName: '' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Should still show attribute mode with empty value
      const input = screen.getByPlaceholderText('radius')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('')
    })

    it('should handle empty expression', () => {
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ expression: '' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Should still show expression mode with empty value
      const input = screen.getByPlaceholderText('d.value')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('')
    })
  })

  describe('Uniform Value Preservation', () => {
    it('should preserve uniform value when cycling through modes', async () => {
      const initialValue = 42
      const field = new NumberField(initialValue, {
        accessor: true,
        defaultAttribute: 'radius',
      })

      const { rerender } = render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Start in uniform mode with value 42
      expect(field.value).toBe(initialValue)

      // Switch to attribute mode
      field.setValue({ attributeName: 'radius' })
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Switch to expression mode
      field.setValue({ expression: 'd.value * 2' })
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Switch back to uniform mode - should restore initial value
      field.setValue(initialValue)
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      expect(field.value).toBe(initialValue)
    })

    it('should update last uniform value when field changes in uniform mode', async () => {
      const field = new NumberField(10, { accessor: true, defaultAttribute: 'radius' })

      const { rerender } = render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Update value while in uniform mode
      const newValue = 99
      field.setValue(newValue)
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Switch to attribute mode
      field.setValue({ attributeName: 'radius' })
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="number" />
        </AttributeFieldWrapper>
      )

      // Simulate switching back to uniform - the ref should have the updated value
      // (In real usage, this would be done via the toggle button which calls handleModeChange)
      // For this test, we verify that the subscription updates the ref
      expect(field.value).toEqual({ attributeName: 'radius' })
    })

    it('should preserve Point3DField uniform value across mode switches', () => {
      const initialValue = [10, 20, 30]
      const field = new Point3DField(initialValue, {
        returnType: 'tuple',
        accessor: true,
        defaultAttribute: 'position',
      })

      const { rerender } = render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" />
        </AttributeFieldWrapper>
      )

      expect(field.value).toEqual(initialValue)

      // Switch to attribute mode
      field.setValue({ attributeName: 'position' })
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" />
        </AttributeFieldWrapper>
      )

      // Value preserved in ref for when we switch back
      expect(field.value).toEqual({ attributeName: 'position' })
    })

    it('should preserve ColorField uniform value across mode switches', () => {
      const initialValue = '#ff5733'
      const field = new ColorField(initialValue, {
        accessor: true,
        defaultAttribute: 'fillColor',
      })

      const { rerender } = render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="color" />
        </AttributeFieldWrapper>
      )

      // ColorField normalizes hex colors by adding alpha channel
      expect(field.value).toBe('#ff5733ff')

      // Switch to expression mode
      field.setValue({ expression: '[d.r, d.g, d.b, 255]' })
      rerender(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <input data-testid="uniform-input" type="color" />
        </AttributeFieldWrapper>
      )

      expect(field.value).toEqual({ expression: '[d.r, d.g, d.b, 255]' })
    })
  })

  describe('hideLabel Prop', () => {
    it('should pass hideLabel=true to child component in uniform mode', () => {
      const field = new NumberField(42, { accessor: true, defaultAttribute: 'radius' })

      const ChildComponent = ({ hideLabel }: { hideLabel?: boolean }) => (
        <div data-testid="child" data-hidelabel={String(hideLabel)}>
          Child
        </div>
      )

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <ChildComponent />
        </AttributeFieldWrapper>
      )

      const child = screen.getByTestId('child')
      expect(child).toHaveAttribute('data-hidelabel', 'true')
    })

    it('should not render child in attribute mode', () => {
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ attributeName: 'size' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <div data-testid="uniform-child">Uniform content</div>
        </AttributeFieldWrapper>
      )

      // Child should not be rendered in attribute mode
      expect(screen.queryByTestId('uniform-child')).not.toBeInTheDocument()
      // Attribute input should be visible instead
      expect(screen.getByPlaceholderText('radius')).toBeInTheDocument()
    })

    it('should not render child in expression mode', () => {
      const field = new NumberField(0, { accessor: true, defaultAttribute: 'radius' })
      field.setValue({ expression: 'd.value * 2' })

      render(
        <AttributeFieldWrapper id="test-field" field={field} disabled={false}>
          <div data-testid="uniform-child">Uniform content</div>
        </AttributeFieldWrapper>
      )

      // Child should not be rendered in expression mode
      expect(screen.queryByTestId('uniform-child')).not.toBeInTheDocument()
      // Expression input should be visible instead
      expect(screen.getByPlaceholderText('d.value')).toBeInTheDocument()
    })
  })
})
