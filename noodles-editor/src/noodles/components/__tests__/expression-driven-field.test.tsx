// UI tests for per-field expression mode: the ƒx toggle in FieldComponent and the
// ExpressionDrivenInput editor
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberOp } from '../../operators'
import { clearOps, setOp } from '../../store'
import { FieldComponent } from '../field-components'

const setEdgesSpy = vi.fn()

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      setEdges: setEdgesSpy,
      getNode: vi.fn(),
      getEdges: vi.fn(() => []),
      setNodes: vi.fn(),
      getNodes: vi.fn(() => []),
    }),
  }
})

// Avoid loading Monaco in tests
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="mock-monaco" />,
}))

function renderField(op: NumberOp, disabled = false) {
  return render(
    <ReactFlowProvider>
      <FieldComponent id="val" field={op.inputs.val} disabled={disabled} />
    </ReactFlowProvider>
  )
}

describe('per-field expression mode UI', () => {
  beforeEach(() => {
    clearOps()
    setEdgesSpy.mockClear()
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows the ƒx toggle for drivable fields', () => {
    const op = new NumberOp('/num')
    setOp('/num', op)
    renderField(op)
    expect(screen.getByTitle('Drive with expression')).toBeTruthy()
  })

  it('enters expression mode pre-filled with the current value', () => {
    const op = new NumberOp('/num')
    setOp('/num', op)
    op.inputs.val.setValue(12)
    renderField(op)

    fireEvent.click(screen.getByTitle('Drive with expression'))

    expect(op.inputs.val.expression).toEqual('12')
    // The driven input shows the expression source
    const input = screen.getByDisplayValue('12')
    expect(input).toBeTruthy()
  })

  it('applies an edited expression on blur and shows the evaluated value', () => {
    const op = new NumberOp('/num')
    setOp('/num', op)
    renderField(op)

    fireEvent.click(screen.getByTitle('Drive with expression'))
    const input = screen.getByPlaceholderText('Enter expression…')
    fireEvent.change(input, { target: { value: '2 + 3' } })
    fireEvent.blur(input)

    expect(op.inputs.val.expression).toEqual('2 + 3')
    expect(op.inputs.val.value).toEqual(5)
    expect(screen.getByTitle('Current evaluated value').textContent).toEqual('5')
  })

  it('shows an error indicator for invalid expressions', () => {
    const op = new NumberOp('/num')
    setOp('/num', op)
    renderField(op)

    fireEvent.click(screen.getByTitle('Drive with expression'))
    const input = screen.getByPlaceholderText('Enter expression…')
    fireEvent.change(input, { target: { value: '2 +' } })
    fireEvent.blur(input)

    expect(screen.getByText('⚠')).toBeTruthy()
  })

  it('shows evaluation errors from unknown operator references', () => {
    const op = new NumberOp('/num')
    setOp('/num', op)
    renderField(op)

    fireEvent.click(screen.getByTitle('Drive with expression'))
    const input = screen.getByPlaceholderText('Enter expression…')
    fireEvent.change(input, { target: { value: "op('/missing').out.val" } })
    fireEvent.blur(input)

    expect(op.inputs.val.expressionError$.value).toMatch(/not found/)
    expect(screen.getByText('⚠')).toBeTruthy()
  })

  it('exits expression mode keeping the evaluated value', () => {
    const op = new NumberOp('/num')
    setOp('/num', op)
    renderField(op)

    fireEvent.click(screen.getByTitle('Drive with expression'))
    const input = screen.getByPlaceholderText('Enter expression…')
    fireEvent.change(input, { target: { value: '40 + 2' } })
    fireEvent.blur(input)
    expect(op.inputs.val.value).toEqual(42)

    fireEvent.click(screen.getByTitle('Remove expression (keeps current value)'))

    expect(op.inputs.val.expression).toBeNull()
    expect(op.inputs.val.value).toEqual(42)
    // Back to the regular number input
    expect(screen.queryByPlaceholderText('Enter expression…')).toBeNull()
  })

  it('syncs reference edges for cross-op expressions', () => {
    const source = new NumberOp('/source')
    source.outputs.val.setValue(1)
    setOp('/source', source)
    const op = new NumberOp('/num')
    setOp('/num', op)
    renderField(op)

    fireEvent.click(screen.getByTitle('Drive with expression'))
    const input = screen.getByPlaceholderText('Enter expression…')
    fireEvent.change(input, { target: { value: "op('/source').out.val + 1" } })
    fireEvent.blur(input)

    // The reference-edge sync effect should have been asked to update edges
    expect(setEdgesSpy).toHaveBeenCalled()
    const updater = setEdgesSpy.mock.calls.at(-1)?.[0]
    const newEdges = updater([])
    expect(newEdges).toHaveLength(1)
    expect(newEdges[0]).toMatchObject({
      type: 'ReferenceEdge',
      source: '/source',
      target: '/num',
      sourceHandle: 'out.val',
      targetHandle: 'par.val',
    })
  })

  it('does not show the toggle for expression-type fields', async () => {
    const { ExpressionOp } = await import('../../operators')
    const exprOp = new ExpressionOp('/expr')
    setOp('/expr', exprOp)
    render(
      <ReactFlowProvider>
        <FieldComponent id="expression" field={exprOp.inputs.expression} disabled={false} />
      </ReactFlowProvider>
    )
    expect(screen.queryByTitle('Drive with expression')).toBeNull()
  })
})
