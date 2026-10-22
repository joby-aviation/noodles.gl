import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OutOp } from '../operators'
import { RenderSettingsPanel } from './render-settings-panel'

afterEach(cleanup)

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
})

describe('RenderSettingsPanel sequence format', () => {
  it('defaults to PNG and stores the chosen format on the OutOp', () => {
    const op = new OutOp('/out')
    render(<RenderSettingsPanel op={op} />)

    const format = screen.getByLabelText('Sequence')
    expect(format).toHaveValue('png')

    fireEvent.change(format, { target: { value: 'exr' } })
    expect(op.inputs.sequenceFormat.value).toBe('exr')

    fireEvent.click(screen.getByText('Reset to Defaults'))
    expect(op.inputs.sequenceFormat.value).toBe('png')
  })
})
