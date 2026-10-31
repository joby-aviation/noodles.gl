import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { NodeProps } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocCommentComponent, linkifyText } from './doc-comment'
import { docStore } from './doc-store'

// The resizer needs a React Flow node around it; here it only says whether it shows
vi.mock('@xyflow/react', async original => ({
  ...(await original<typeof import('@xyflow/react')>()),
  NodeResizer: ({ isVisible }: { isVisible: boolean }) =>
    isVisible ? <div data-testid="resizer" /> : null,
}))

const comment = (text?: string): DocNode => ({
  id: 'note',
  op: 'comment',
  name: 'note',
  x: 0,
  y: 0,
  params: text === undefined ? {} : { text },
})
const doc = (n: DocNode): EditorDoc => ({ version: 1, name: 'c', nodes: [n], edges: [] })
const props = (selected = false) => ({ id: 'note', selected }) as unknown as NodeProps

function show(text?: string, selected = false) {
  docStore().load(doc(comment(text)))
  return render(<DocCommentComponent {...props(selected)} />)
}

describe('DocCommentComponent', () => {
  afterEach(() => cleanup())

  it('shows its text, links included, and a hint when empty', () => {
    show('See https://noodles.gl/docs for more.')
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://noodles.gl/docs')
    cleanup()
    show()
    expect(screen.getByText('Double-click to write a note')).toBeTruthy()
  })

  it('edits on double-click and writes the text once, on Escape', () => {
    show('old')
    fireEvent.doubleClick(screen.getByRole('note'))
    const box = screen.getByLabelText('Comment text')
    fireEvent.change(box, { target: { value: 'new text' } })
    expect(docStore().get().doc.nodes[0].params.text).toBe('old')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(docStore().get().doc.nodes[0].params.text).toBe('new text')
    // One edit: one undo brings the old text back
    docStore().undo()
    expect(docStore().get().doc.nodes[0].params.text).toBe('old')
  })

  it('keeps the network shortcuts away from the text', () => {
    show('x')
    fireEvent.doubleClick(screen.getByRole('note'))
    const onKey = vi.fn()
    document.addEventListener('keydown', onKey)
    fireEvent.keyDown(screen.getByLabelText('Comment text'), { key: 'Backspace' })
    expect(onKey).not.toHaveBeenCalled()
    document.removeEventListener('keydown', onKey)
  })

  it('shows its resize handles only while selected', () => {
    show('x')
    expect(screen.queryByTestId('resizer')).toBeNull()
    cleanup()
    show('x', true)
    expect(screen.getByTestId('resizer')).toBeTruthy()
  })
})

describe('linkifyText', () => {
  it('links bare URLs and leaves trailing punctuation out', () => {
    const parts = linkifyText('Read https://example.com/a, then go.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('Read ')
    expect(parts[2]).toBe(', then go.')
  })
})
