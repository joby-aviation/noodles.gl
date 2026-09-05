import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpressionEditorOverlay } from './ExpressionEditorOverlay'

const mocks = vi.hoisted(() => {
  const addCommand = vi.fn()
  const editor = {
    addCommand,
    focus: vi.fn(),
    getModel: () => ({ getFullModelRange: () => ({}) }),
    getValue: () => 'd.value',
    setSelection: vi.fn(),
  }
  const monaco = {
    KeyCode: { Enter: 3, Escape: 9 },
    languages: {
      CompletionItemKind: {},
      registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
  }

  return { addCommand, editor, monaco }
})

vi.mock('@monaco-editor/react', () => ({
  default: (props: {
    onMount: (editor: typeof mocks.editor, monaco: typeof mocks.monaco) => void
  }) => {
    props.onMount(mocks.editor, mocks.monaco)
    return <div data-testid="mock-monaco" />
  },
}))

describe('ExpressionEditorOverlay', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('lets Monaco accept a visible suggestion with Enter', () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <ExpressionEditorOverlay
        value="d."
        onChange={onChange}
        onClose={onClose}
        context={{ dataKeys: ['value'], globals: [], operatorPaths: [] }}
        anchorRect={null}
      />
    )

    expect(mocks.addCommand).toHaveBeenCalledWith(
      mocks.monaco.KeyCode.Enter,
      expect.any(Function),
      '!suggestWidgetVisible'
    )

    const enterCommand = mocks.addCommand.mock.calls.find(
      ([keyCode]) => keyCode === mocks.monaco.KeyCode.Enter
    )
    enterCommand?.[1]()
    expect(onChange).toHaveBeenCalledWith('d.value')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('lets Monaco dismiss visible suggestions before Escape cancels the editor', () => {
    const onClose = vi.fn()
    render(
      <ExpressionEditorOverlay
        value="d."
        onChange={vi.fn()}
        onClose={onClose}
        context={{ dataKeys: ['value'], globals: [], operatorPaths: [] }}
        anchorRect={null}
      />
    )

    expect(mocks.addCommand).toHaveBeenCalledWith(
      mocks.monaco.KeyCode.Escape,
      expect.any(Function),
      '!suggestWidgetVisible'
    )

    const escapeCommand = mocks.addCommand.mock.calls.find(
      ([keyCode]) => keyCode === mocks.monaco.KeyCode.Escape
    )
    escapeCommand?.[1]()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
