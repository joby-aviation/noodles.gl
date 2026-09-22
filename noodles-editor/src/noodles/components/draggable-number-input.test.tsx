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
    const { container } = render(
      <DraggableNumberInput
        value={10}
        step={0.1}
        onChange={onChange}
        onDragEnd={onDragEnd}
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
