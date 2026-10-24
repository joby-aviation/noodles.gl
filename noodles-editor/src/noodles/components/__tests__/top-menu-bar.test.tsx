// Tests for the editor preferences in the top menu bar's Editor sub-menu
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directoryHandleCache } from '../../utils/directory-handle-cache'
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

const openSubmenu = (name: RegExp) => {
  const item = screen.getByRole('menuitem', { name })
  act(() => {
    item.focus()
    fireEvent.keyDown(item, { key: 'ArrowRight' })
  })
}

describe('TopMenuBar File menu', () => {
  // The recent list comes from IndexedDB, a real browser task the fake clock can't settle
  beforeEach(async () => {
    vi.useRealTimers()
    await directoryHandleCache.clearCache()
  })

  afterEach(async () => {
    cleanup()
    await directoryHandleCache.clearCache()
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
  })

  it('opens the projects list from Manage Projects', () => {
    window.history.replaceState({}, '', '/examples/nyc-taxis')
    renderMenuBar()
    act(() => {
      fireEvent.keyDown(screen.getByTitle('Menu'), { key: 'Enter' })
    })
    openSubmenu(/^File/)

    act(() => screen.getByRole('menuitem', { name: 'Manage Projects...' }).click())
    expect(window.location.pathname).toBe('/projects')
  })

  it('drops a project from Open Recent once it is removed from the list', async () => {
    const handle = { kind: 'directory', name: 'alpha' } as FileSystemDirectoryHandle
    await directoryHandleCache.cacheHandle('alpha', handle, 'alpha')
    renderMenuBar({ onOpen: vi.fn() })
    act(() => {
      fireEvent.keyDown(screen.getByTitle('Menu'), { key: 'Enter' })
    })
    openSubmenu(/^File/)
    openSubmenu(/^Open Recent/)
    await vi.waitFor(() => screen.getByRole('menuitem', { name: 'alpha' }))

    await act(() => directoryHandleCache.removeHandle('alpha'))

    await vi.waitFor(() => screen.getByRole('menuitem', { name: 'No recent projects' }))
    expect(screen.queryByRole('menuitem', { name: 'alpha' })).toBeNull()
  })
})
