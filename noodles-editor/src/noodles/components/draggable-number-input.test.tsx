import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraggableNumberInput } from './draggable-number-input'

describe('DraggableNumberInput', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the precision ladder and scrubs with the selected step', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const onDragEnd = vi.fn()
    const onStepChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput
        value={10}
        step={0.1}
        onChange={onChange}
        onDragEnd={onDragEnd}
        onStepChange={onStepChange}
        aria-label="Value"
      />
    )

    const input = screen.getByRole('spinbutton', { name: 'Value' })
    const wrapper = container.querySelector('[role="group"]') as HTMLElement

    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    act(() => vi.advanceTimersByTime(400))

    expect(screen.getByText('0.01')).toBeInTheDocument()

    // Move down one rung to select 0.1x, then right to lock and apply it.
    fireEvent.mouseMove(document, { clientX: 100, clientY: 120 })
    expect(screen.getByText('0.01').parentElement?.className).toContain('stepLadderItemActive')

    fireEvent.mouseMove(document, { clientX: 120, clientY: 120 })
    expect(onStepChange).toHaveBeenCalledOnce()
    expect(onStepChange).toHaveBeenCalledWith(0.01)
    expect(onChange).toHaveBeenLastCalledWith(10.2)
    expect(input).toHaveValue(10.2)

    fireEvent.mouseUp(document, { clientX: 120, clientY: 120 })
    expect(onDragEnd).toHaveBeenCalledOnce()
    expect(screen.queryByText('0.01')).not.toBeInTheDocument()
  })

  it('clamps dragged values when only a minimum is configured', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput value={5} min={0} onChange={onChange} aria-label="Value" />
    )

    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 80, clientY: 100 })

    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.mouseUp(document)
  })

  it('clamps dragged values when only a maximum is configured', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput value={5} max={10} onChange={onChange} aria-label="Value" />
    )

    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 100 })

    expect(onChange).toHaveBeenLastCalledWith(10)
    fireEvent.mouseUp(document)
  })

  it('keeps partial numeric input editable without emitting a placeholder value', () => {
    const onChange = vi.fn()
    render(<DraggableNumberInput value={5} onChange={onChange} aria-label="Value" />)

    const input = screen.getByRole('spinbutton', { name: 'Value' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })

    expect(input).toHaveValue(null)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '-1' } })
    expect(onChange).toHaveBeenLastCalledWith(-1)
  })

  it('displays the complete number when no display formatter is provided', () => {
    render(
      <DraggableNumberInput
        value={1.234567891234}
        step={1e-12}
        onChange={vi.fn()}
        aria-label="Value"
      />
    )

    expect(screen.getByRole('spinbutton', { name: 'Value' })).toHaveValue(1.234567891234)
  })

  it('freezes the step for the duration of a focused interaction', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <DraggableNumberInput value={0.25} step={0.01} onChange={onChange} aria-label="Value" />
    )
    const input = screen.getByRole('spinbutton', { name: 'Value' })

    fireEvent.focus(input)
    rerender(<DraggableNumberInput value={1} step={1} onChange={onChange} aria-label="Value" />)
    expect(input).toHaveAttribute('step', '0.01')

    fireEvent.blur(input)
    expect(input).toHaveAttribute('step', '1')
  })

  it('uses a selected ladder step immediately after mouseup while focused', () => {
    const { container } = render(
      <DraggableNumberInput value={0.25} step={0.1} onChange={vi.fn()} aria-label="Value" />
    )
    const input = screen.getByRole('spinbutton', { name: 'Value' })
    const wrapper = container.querySelector('[role="group"]') as HTMLElement

    fireEvent.focus(input)
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 100, clientY: 120 })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 120 })
    fireEvent.mouseUp(document)

    expect(input).toHaveAttribute('step', '0.01')
  })

  it('releases a frozen step when a drag is interrupted by window blur', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(
      <DraggableNumberInput value={0.25} step={0.01} onChange={onChange} aria-label="Value" />
    )
    const input = screen.getByRole('spinbutton', { name: 'Value' })
    const wrapper = container.querySelector('[role="group"]') as HTMLElement

    fireEvent.focus(input)
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    rerender(<DraggableNumberInput value={1} step={1} onChange={onChange} aria-label="Value" />)
    fireEvent(window, new Event('blur'))

    expect(input).toHaveAttribute('step', '1')
  })

  it('does not truncate dragged values to seven decimal places', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput
        value={1.234567891}
        step={1e-9}
        onChange={onChange}
        aria-label="Value"
      />
    )
    const wrapper = container.querySelector('[role="group"]') as HTMLElement

    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 116, clientY: 100 })

    expect(onChange).toHaveBeenLastCalledWith(1.234567907)
    fireEvent.mouseUp(document)
  })

  it('removes binary residue from decimal scrub deltas', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput value={0.1} step={0.1} onChange={onChange} aria-label="Value" />
    )
    const wrapper = container.querySelector('[role="group"]') as HTMLElement

    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 116, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 102, clientY: 100 })

    expect(onChange).toHaveBeenLastCalledWith(0.3)
    fireEvent.mouseUp(document)
  })

  it('preserves starting decimals finer than the selected scrub step', () => {
    const onChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput value={1.234567891} step={0.1} onChange={onChange} aria-label="Value" />
    )
    const wrapper = container.querySelector('[role="group"]') as HTMLElement

    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 116, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 102, clientY: 100 })

    expect(onChange).toHaveBeenLastCalledWith(1.434567891)
    fireEvent.mouseUp(document)
  })

  it('removes document drag listeners when unmounted mid-gesture', () => {
    const onChange = vi.fn()
    const onDragEnd = vi.fn()
    const { container, unmount } = render(
      <DraggableNumberInput
        value={5}
        onChange={onChange}
        onDragEnd={onDragEnd}
        aria-label="Value"
      />
    )

    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    unmount()
    fireEvent.mouseMove(document, { clientX: 120, clientY: 100 })
    fireEvent.mouseUp(document)

    expect(onChange).not.toHaveBeenCalled()
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('ends and cleans up a drag when a touch gesture is cancelled', () => {
    const onChange = vi.fn()
    const onDragEnd = vi.fn()
    const { container } = render(
      <DraggableNumberInput
        value={5}
        onChange={onChange}
        onDragEnd={onDragEnd}
        aria-label="Value"
      />
    )

    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    const touchAt = (clientX: number) =>
      new Touch({ identifier: 1, target: wrapper, clientX, clientY: 100 })
    fireEvent.touchStart(wrapper, { touches: [touchAt(100)] })
    fireEvent.touchMove(document, { touches: [touchAt(120)] })
    fireEvent.touchCancel(document)

    expect(onDragEnd).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()

    fireEvent.touchMove(document, { touches: [touchAt(140)] })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('ends and cleans up a drag when the window loses focus', () => {
    const onChange = vi.fn()
    const onDragEnd = vi.fn()
    const { container } = render(
      <DraggableNumberInput
        value={5}
        onChange={onChange}
        onDragEnd={onDragEnd}
        aria-label="Value"
      />
    )

    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 100 })
    fireEvent(window, new Event('blur'))

    expect(onDragEnd).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()

    fireEvent.mouseMove(document, { clientX: 140, clientY: 100 })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it.each([0, -1])('uses a safe fallback when step is %s', invalidStep => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { container } = render(
      <DraggableNumberInput value={5} step={invalidStep} onChange={onChange} aria-label="Value" />
    )

    const input = screen.getByRole('spinbutton', { name: 'Value' })
    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    expect(input).toHaveAttribute('step', '1')

    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByText('0.01')).toBeInTheDocument()

    fireEvent.mouseMove(document, { clientX: 120, clientY: 100 })
    expect(onChange).toHaveBeenLastCalledWith(25)
    fireEvent.mouseUp(document)
  })

  it('supports very small steps without crashing the precision ladder', () => {
    vi.useFakeTimers()
    const { container } = render(
      <DraggableNumberInput value={0} step={1e-100} onChange={vi.fn()} aria-label="Value" />
    )

    const wrapper = container.querySelector('[role="group"]') as HTMLElement
    fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
    act(() => vi.advanceTimersByTime(400))

    expect(screen.getByText('1e-100')).toBeInTheDocument()
    fireEvent.mouseUp(document)
  })
})
