import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { type Node as ReactFlowNode, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../../utils/analytics'
import { GraphExecutor } from '../../graph-executor'
import { CommentOp, type MathOp, StringOp } from '../../operators'
import { clearOps, getOp, getOpStore, setOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { layoutNodes } from '../../utils/auto-layout'
import { FIELD_EDIT_IDLE_MS } from '../../utils/field-edit-analytics'
import { registerPropertyMutationCallback } from '../../utils/property-history'
import { safeStringify, serializeNodes } from '../../utils/serialization'
import { getSuggestedNodes } from '../../utils/suggested-nodes'
import { linkifyText } from '../comment-op'
import { nodeComponents } from '../op-components'

const TEXT = 'This loads the CSV.\nClick it to see the columns.'

function commentNode(overrides: Partial<ReactFlowNode> = {}): ReactFlowNode {
  return {
    id: '/note',
    type: 'CommentOp',
    position: { x: 10, y: 20 },
    data: { inputs: { text: TEXT }, locked: false },
    width: 320,
    height: 90,
    ...overrides,
  }
}

describe('CommentOp', () => {
  afterEach(() => {
    clearOps()
  })

  it('has a text input, no outputs, and runs to nothing', () => {
    const op = new CommentOp('/note')
    expect(op.inputs.text.value).toBe('')
    expect(Object.keys(op.outputs)).toEqual([])
    expect(op.execute({ text: 'hello' })).toEqual({})
  })

  it('does not get in the way of the graph executor', async () => {
    const edges = ['a', 'b'].map(field => ({
      id: `/${field}.out.val->/add.par.${field}`,
      source: `/${field}`,
      target: '/add',
      sourceHandle: 'out.val',
      targetHandle: `par.${field}`,
    }))
    transformGraph({
      nodes: [
        { id: '/a', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 2 } } },
        { id: '/b', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 3 } } },
        { id: '/add', type: 'MathOp', position: { x: 0, y: 0 }, data: { inputs: {} } },
        commentNode(),
      ],
      edges,
    })
    const executor = new GraphExecutor()
    executor.buildFromEdges(edges)

    await executor.executeFrame(performance.now())

    expect((getOp('/add') as MathOp).outputs.result.value).toBe(5)
    const note = getOp('/note') as CommentOp
    expect(note.executionState.value.status).not.toBe('error')
    expect(note.inputs.text.value).toBe(TEXT)
  })

  it('keeps its text and size through save and reload', () => {
    transformGraph({ nodes: [commentNode()], edges: [] })
    expect((getOp('/note') as CommentOp).inputs.text.value).toBe(TEXT)

    const json = safeStringify({
      nodes: serializeNodes(getOpStore(), [commentNode({ selected: true, resizing: false })], []),
    })
    const [saved] = JSON.parse(json).nodes
    expect(saved).toMatchObject({
      id: '/note',
      type: 'CommentOp',
      position: { x: 10, y: 20 },
      width: 320,
      height: 90,
      data: { inputs: { text: TEXT } },
    })
    expect(saved.selected).toBeUndefined()
    expect(saved.resizing).toBeUndefined()

    clearOps()
    transformGraph({ nodes: [saved], edges: [] })
    expect((getOp('/note') as CommentOp).inputs.text.value).toBe(TEXT)
  })

  it('saves an empty comment without a text value', () => {
    setOp('/note', new CommentOp('/note'))
    const [saved] = serializeNodes(getOpStore(), [commentNode()], [])
    expect(saved.data.inputs).toEqual({})
  })

  it('is left in place by auto layout', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
      { id: '/b', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
      commentNode(),
    ]
    const laidOut = layoutNodes(nodes, [{ id: 'e', source: '/a', target: '/b' }])
    expect(laidOut).toHaveLength(3)
    expect(laidOut.find(n => n.id === '/note')?.position).toEqual({ x: 10, y: 20 })
  })

  it('is never suggested as a next node, and suggests nothing itself', () => {
    const suggestions = getSuggestedNodes(new StringOp('/s'), 50).map(s => s.opType)
    expect(suggestions).not.toContain('CommentOp')
    expect(getSuggestedNodes(new CommentOp('/note'))).toEqual([])
  })
})

describe('linkifyText', () => {
  afterEach(() => cleanup())

  it('turns bare URLs into links and leaves the rest as text', () => {
    const { container } = render(<div>{linkifyText('See https://noodles.gl/docs. Or not.')}</div>)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://noodles.gl/docs')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(container.textContent).toBe('See https://noodles.gl/docs. Or not.')
  })
})

describe('CommentOpComponent', () => {
  const mutations = vi.fn()

  beforeEach(() => {
    clearOps()
    registerPropertyMutationCallback(mutations)
  })

  afterEach(() => {
    cleanup()
    clearOps()
    registerPropertyMutationCallback(undefined)
    mutations.mockReset()
    vi.restoreAllMocks()
  })

  function renderComment(selected = false) {
    const Comment = nodeComponents.CommentOp
    return render(
      <ReactFlowProvider>
        <Comment
          id="/note"
          type="CommentOp"
          selected={selected}
          data={{ inputs: {} }}
          isConnectable={false}
          zIndex={0}
          dragging={false}
        />
      </ReactFlowProvider>
    )
  }

  it('shows the text with its line breaks and no handles', () => {
    transformGraph({ nodes: [commentNode()], edges: [] })
    const { container, getByText } = renderComment()
    expect(getByText(/This loads the CSV/).textContent).toBe(TEXT)
    expect(container.querySelector('.react-flow__handle')).toBeNull()
  })

  it('edits on double-click and commits on Escape as one undo step', async () => {
    const track = vi.spyOn(analytics, 'track')
    transformGraph({ nodes: [commentNode()], edges: [] })
    const view = renderComment()

    fireEvent.doubleClick(view.getByText(/This loads the CSV/))
    const textarea = view.getByLabelText('Comment text') as HTMLTextAreaElement
    expect(textarea.value).toBe(TEXT)

    fireEvent.change(textarea, { target: { value: 'New note\nSecond line' } })
    // Typing doesn't touch the operator until the edit ends
    expect((getOp('/note') as CommentOp).inputs.text.value).toBe(TEXT)
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(view.queryByLabelText('Comment text')).toBeNull()
    expect((getOp('/note') as CommentOp).inputs.text.value).toBe('New note\nSecond line')
    expect(mutations).toHaveBeenCalledTimes(1)
    expect(mutations.mock.calls[0][0]).toBe('Edit comment')

    await act(() => vi.advanceTimersByTimeAsync(FIELD_EDIT_IDLE_MS + 10))
    expect(track).toHaveBeenCalledWith('field_value_changed', {
      fieldType: 'string',
      operatorType: 'CommentOp',
      source: 'node',
    })
  })

  it('allows an empty comment', () => {
    transformGraph({ nodes: [commentNode()], edges: [] })
    const view = renderComment()

    fireEvent.doubleClick(view.getByText(/This loads the CSV/))
    const textarea = view.getByLabelText('Comment text')
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.blur(textarea)

    expect((getOp('/note') as CommentOp).inputs.text.value).toBe('')
    expect(view.getByText('Double-click to write a note')).toBeTruthy()
  })

  it('does not open the editor when locked', () => {
    transformGraph({
      nodes: [commentNode({ data: { inputs: { text: TEXT }, locked: true } })],
      edges: [],
    })
    const view = renderComment()
    fireEvent.doubleClick(view.getByText(/This loads the CSV/))
    expect(view.queryByLabelText('Comment text')).toBeNull()
  })

  it('shows resize handles only while selected', () => {
    transformGraph({ nodes: [commentNode()], edges: [] })
    const unselected = renderComment(false)
    expect(unselected.container.querySelector('.react-flow__resize-control')).toBeNull()
    cleanup()
    const selected = renderComment(true)
    expect(selected.container.querySelector('.react-flow__resize-control')).not.toBeNull()
  })
})
