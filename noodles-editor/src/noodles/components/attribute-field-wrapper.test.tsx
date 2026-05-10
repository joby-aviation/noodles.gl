import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AttributeFieldWrapper } from './attribute-field-wrapper'
import { NumberField } from '../fields'

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
})
