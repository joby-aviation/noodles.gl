import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

describe('RenderSettingsPanel transparency', () => {
  it('turns on a transparent background once the codec can carry alpha', () => {
    const op = new OutOp('/out')
    render(<RenderSettingsPanel op={op} />)

    // The default H.264 cannot
    const checkbox = screen.getByLabelText('Transparent background')
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('Needs the VP9 codec')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Codec'), { target: { value: 'vp9' } })
    expect(checkbox).toBeEnabled()
    fireEvent.click(checkbox)
    expect(op.inputs.exportAlpha.value).toBe(true)
    expect(checkbox).toBeChecked()
    expect(screen.getByText('Saves a WebM video with an alpha channel')).toBeInTheDocument()
  })

  it('shows the setting unchecked while the codec cannot use it', () => {
    const op = new OutOp('/out')
    op.inputs.exportAlpha.setValue(true)
    render(<RenderSettingsPanel op={op} />)

    const checkbox = screen.getByLabelText('Transparent background')
    expect(checkbox).not.toBeChecked()
    act(() => op.inputs.codec.setValue('vp9'))
    expect(checkbox).toBeChecked()
  })
})

describe('RenderSettingsPanel capture mode', () => {
  it('defaults to Final, and warns and ignores the delay in Preview', () => {
    const op = new OutOp('/out')
    render(<RenderSettingsPanel op={op} />)

    const mode = screen.getByLabelText('Capture')
    const delay = screen.getByLabelText('Delay')
    expect(mode).toHaveValue('final')
    expect(delay).toBeEnabled()
    expect(screen.queryByText(/may drop frames/)).not.toBeInTheDocument()

    fireEvent.change(mode, { target: { value: 'preview' } })
    expect(op.inputs.captureMode.value).toBe('preview')
    expect(delay).toBeDisabled()
    expect(screen.getByText(/may drop frames/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Reset to Defaults'))
    expect(op.inputs.captureMode.value).toBe('final')
  })
})
