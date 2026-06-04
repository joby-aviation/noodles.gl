import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttributeToggle, type AttributeMode } from './attribute-toggle'

describe('AttributeToggle', () => {
  afterEach(() => {
    cleanup()
  })

  it('should render with uniform mode', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="uniform" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /Uniform value/ })
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('should render with attribute mode', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="attribute" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /Read from attribute/ })
    expect(button).toBeInTheDocument()
  })

  it('should render with expression mode', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="expression" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /Expression/ })
    expect(button).toBeInTheDocument()
  })

  it('should cycle from uniform to attribute on click', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="uniform" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /Uniform value/ })
    fireEvent.click(button)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('attribute')
  })

  it('should cycle from attribute to expression on click', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="attribute" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /Read from attribute/ })
    fireEvent.click(button)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('expression')
  })

  it('should cycle from expression to uniform on click', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="expression" onChange={onChange} />)

    const button = screen.getByRole('button', { name: /Expression/ })
    fireEvent.click(button)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('uniform')
  })

  it('should not call onChange when disabled', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="uniform" onChange={onChange} disabled />)

    const button = screen.getByRole('button', { name: /Uniform value/ })
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should apply correct CSS classes for each mode', () => {
    const onChange = vi.fn()

    const { rerender } = render(<AttributeToggle mode="uniform" onChange={onChange} />)
    let button = screen.getByRole('button', { name: /Uniform value/ })
    expect(button.className).toContain('uniform')

    rerender(<AttributeToggle mode="attribute" onChange={onChange} />)
    button = screen.getByRole('button', { name: /Read from attribute/ })
    expect(button.className).toContain('attribute')

    rerender(<AttributeToggle mode="expression" onChange={onChange} />)
    button = screen.getByRole('button', { name: /Expression/ })
    expect(button.className).toContain('expression')
  })

  it('should apply disabled class when disabled', () => {
    const onChange = vi.fn()
    render(<AttributeToggle mode="uniform" onChange={onChange} disabled />)

    const button = screen.getByRole('button', { name: /Uniform value/ })
    expect(button.className).toContain('disabled')
  })

  it('should have correct title attribute', () => {
    const onChange = vi.fn()

    const { rerender } = render(<AttributeToggle mode="uniform" onChange={onChange} />)
    const uniformButton = screen.getByRole('button', { name: /Uniform value/ })
    expect(uniformButton.title).toContain('Uniform value')

    rerender(<AttributeToggle mode="attribute" onChange={onChange} />)
    const attributeButton = screen.getByRole('button', { name: /Read from attribute/ })
    expect(attributeButton.title).toContain('Read from attribute')

    rerender(<AttributeToggle mode="expression" onChange={onChange} />)
    const expressionButton = screen.getByRole('button', { name: /Expression/ })
    expect(expressionButton.title).toContain('Expression')
  })

  it('should complete full cycle through all modes', () => {
    const onChange = vi.fn<[AttributeMode], void>()
    const { rerender } = render(<AttributeToggle mode="uniform" onChange={onChange} />)

    let button = screen.getByRole('button', { name: /Uniform value/ })
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith('attribute')

    rerender(<AttributeToggle mode="attribute" onChange={onChange} />)
    button = screen.getByRole('button', { name: /Read from attribute/ })
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith('expression')

    rerender(<AttributeToggle mode="expression" onChange={onChange} />)
    button = screen.getByRole('button', { name: /Expression/ })
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith('uniform')

    expect(onChange).toHaveBeenCalledTimes(3)
  })
})
