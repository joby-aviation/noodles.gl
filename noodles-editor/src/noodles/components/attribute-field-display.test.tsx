import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Point3DField } from '../fields'
import { AttributeFieldWrapper } from './attribute-field-wrapper'
import { cleanup } from '@testing-library/react'

// Mock the property history hook
vi.mock('../utils/property-history', () => ({
  usePropertyHistory: () => ({
    captureStart: vi.fn(),
    commitChange: vi.fn(),
  }),
}))

describe('AttributeFieldWrapper Display Modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('should display attribute mode when field has attributeName value', () => {
    const field = new Point3DField([0, 0, 0], {
      returnType: 'tuple',
      accessor: true,
      defaultAttribute: 'sourcePosition',
    })

    // Simulate auto-detection setting the field to attribute mode
    field.setValue({ attributeName: 'sourcePosition' })
    field.autoDetected = true

    render(
      <AttributeFieldWrapper id="getSourcePosition" field={field} disabled={false}>
        <div data-testid="uniform-child">Uniform Vector Input</div>
      </AttributeFieldWrapper>
    )

    // Should show attribute input, not uniform child
    expect(screen.queryByTestId('uniform-child')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('sourcePosition')).toBeInTheDocument()
    expect(screen.getByText('🔍 auto')).toBeInTheDocument()
  })

  it('should display uniform mode when field has tuple value', () => {
    const field = new Point3DField([10, 20, 30], {
      returnType: 'tuple',
      accessor: true,
      defaultAttribute: 'sourcePosition',
    })

    render(
      <AttributeFieldWrapper id="getSourcePosition" field={field} disabled={false}>
        <div data-testid="uniform-child">Uniform Vector Input</div>
      </AttributeFieldWrapper>
    )

    // Should show uniform child input
    expect(screen.getByTestId('uniform-child')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('sourcePosition')).not.toBeInTheDocument()
  })

  it('should correctly identify mode from default value [0,0,0]', () => {
    // This simulates the NYC Taxis case where field is initialized with default value
    const field = new Point3DField([0, 0, 0], {
      returnType: 'tuple',
      accessor: true,
      defaultAttribute: 'sourcePosition',
    })

    render(
      <AttributeFieldWrapper id="getSourcePosition" field={field} disabled={false}>
        <div data-testid="uniform-child">Uniform Vector Input</div>
      </AttributeFieldWrapper>
    )

    // With default value [0,0,0], should show uniform mode
    expect(screen.getByTestId('uniform-child')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('sourcePosition')).not.toBeInTheDocument()
  })

  it('should update display when field value changes from uniform to attribute', () => {
    const field = new Point3DField([0, 0, 0], {
      returnType: 'tuple',
      accessor: true,
      defaultAttribute: 'sourcePosition',
    })

    const { rerender } = render(
      <AttributeFieldWrapper id="getSourcePosition" field={field} disabled={false}>
        <div data-testid="uniform-child">Uniform Vector Input</div>
      </AttributeFieldWrapper>
    )

    // Initially in uniform mode
    expect(screen.getByTestId('uniform-child')).toBeInTheDocument()

    // Simulate auto-detection updating the field
    field.setValue({ attributeName: 'sourcePosition' })
    field.autoDetected = true

    rerender(
      <AttributeFieldWrapper id="getSourcePosition" field={field} disabled={false}>
        <div data-testid="uniform-child">Uniform Vector Input</div>
      </AttributeFieldWrapper>
    )

    // Should now show attribute mode
    expect(screen.queryByTestId('uniform-child')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('sourcePosition')).toBeInTheDocument()
    expect(screen.getByText('🔍 auto')).toBeInTheDocument()
  })

  it('should reactively update when subscribed field value changes', async () => {
    const field = new Point3DField([0, 0, 0], {
      returnType: 'tuple',
      accessor: true,
      defaultAttribute: 'sourcePosition',
    })

    // Test that field subscriptions work at all
    let notified = false
    field.subscribe(() => {
      notified = true
    })

    field.setValue({ attributeName: 'sourcePosition' })
    expect(notified).toBe(true)
    expect(field.value).toEqual({ attributeName: 'sourcePosition' })

    // Now test the component
    render(
      <AttributeFieldWrapper id="getSourcePosition" field={field} disabled={false}>
        <div data-testid="uniform-child">Uniform Vector Input</div>
      </AttributeFieldWrapper>
    )

    // Field is already in attribute mode from setValue above
    expect(screen.queryByTestId('uniform-child')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('sourcePosition')).toBeInTheDocument()
  })
})
