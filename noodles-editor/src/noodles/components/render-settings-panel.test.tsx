import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OutOp } from '../operators'
import { RenderSettingsPanel } from './render-settings-panel'

describe('RenderSettingsPanel preview scale', () => {
  it('defaults to Fit and preserves manual scale while its slider is hidden', () => {
    const op = new OutOp('/out')
    render(<RenderSettingsPanel op={op} />)

    const previewMode = screen.getByLabelText('Preview')
    expect(previewMode).toHaveValue('fit')
    expect(screen.queryByLabelText('Scale')).not.toBeInTheDocument()

    fireEvent.change(previewMode, { target: { value: 'manual' } })
    const manualScale = screen.getByLabelText('Scale')
    fireEvent.change(manualScale, { target: { value: '0.65' } })
    expect(op.inputs.scaleControl.value).toBe(0.65)

    fireEvent.change(previewMode, { target: { value: 'fit' } })
    expect(screen.queryByLabelText('Scale')).not.toBeInTheDocument()
    expect(op.inputs.scaleControl.value).toBe(0.65)

    fireEvent.change(previewMode, { target: { value: 'manual' } })
    expect(screen.getByLabelText('Scale')).toHaveValue('0.65')
  })

  it('shows the resolved filename and protects expression-driven values', () => {
    const op = new OutOp('/out')
    op.inputs.fileName.setValue('LA-vertistop')
    op.inputs.fileName.setExpression("'FL-' + 'routes'")
    const { container } = render(<RenderSettingsPanel op={op} />)

    const fileName = container.querySelector<HTMLInputElement>('#render-file-name')!
    expect(fileName).toHaveValue('FL-routes')
    expect(fileName).toBeDisabled()
    expect(container.textContent).toContain('fx')
    expect(op.inputs.fileName.serialize()).toEqual({ $expr: "'FL-' + 'routes'" })
  })

  it('updates a literal filename from the output settings', () => {
    const op = new OutOp('/out')
    const { container } = render(<RenderSettingsPanel op={op} />)
    const fileName = container.querySelector<HTMLInputElement>('#render-file-name')!

    fireEvent.change(fileName, { target: { value: 'LA-vertistop' } })

    expect(op.inputs.fileName.value).toBe('LA-vertistop')
  })

  it('configures the photo format for direct exports', () => {
    const op = new OutOp('/out')
    const { container } = render(<RenderSettingsPanel op={op} />)
    const format = container.querySelector<HTMLSelectElement>('#render-image-format')!

    fireEvent.change(format, { target: { value: 'jpeg' } })

    expect(op.inputs.imageFormat.value).toBe('jpeg')
  })
})
