// Tests for the editor preferences in the top menu bar's Editor sub-menu
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopMenuBar } from '../top-menu-bar'

vi.mock('../tools/tool-shelf', () => ({ ToolShelf: () => null }))
vi.mock('../export-button', () => ({ ExportButton: () => null }))
vi.mock('../../../components/settings-dialog', () => ({ SettingsDialog: () => null }))

const renderMenuBar = (props: Partial<React.ComponentProps<typeof TopMenuBar>> = {}) =>
  render(
    <ReactFlowProvider>
      <TopMenuBar
        onSaveProject={vi.fn()}
        onNewProject={vi.fn()}
        onImport={vi.fn()}
        undoRedoRef={createRef()}
        copyControlsRef={createRef()}
        {...props}
      />
    </ReactFlowProvider>
  )

// Setup installs fake timers, so query synchronously instead of with findBy*
const openEditorMenu = () => {
  act(() => {
    fireEvent.keyDown(screen.getByTitle('Menu'), { key: 'Enter' })
  })
  const editor = screen.getByRole('menuitem', { name: /Editor/ })
  act(() => {
    editor.focus()
    fireEvent.keyDown(editor, { key: 'ArrowRight' })
  })
  return screen.getByRole('menuitemcheckbox', { name: 'Auto-layout when connecting nodes' })
}

describe('TopMenuBar Editor menu', () => {
  afterEach(() => {
    cleanup()
  })

  it('turns auto-layout on connect on', () => {
    const onChange = vi.fn()
    renderMenuBar({ autoLayoutOnConnect: false, onChangeAutoLayoutOnConnect: onChange })

    const item = openEditorMenu()
    expect(item).toHaveAttribute('aria-checked', 'false')
    act(() => item.click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('turns auto-layout on connect off', () => {
    const onChange = vi.fn()
    renderMenuBar({ autoLayoutOnConnect: true, onChangeAutoLayoutOnConnect: onChange })

    const item = openEditorMenu()
    expect(item).toHaveAttribute('aria-checked', 'true')
    act(() => item.click())
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
