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
})
