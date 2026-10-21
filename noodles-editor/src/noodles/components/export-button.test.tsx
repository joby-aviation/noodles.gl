import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetRenderProgress,
  setRenderProgress,
  useRenderProgressStore,
} from '../../render/render-progress-store'
import { ExportButton } from './export-button'

beforeEach(() => {
  resetRenderProgress()
})

afterEach(() => {
  cleanup()
})

// Radix opens the menu on pointerdown or Enter; Enter works without pointer capture
function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /export/i }), { key: 'Enter' })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('ExportButton', () => {
  it('offers image and video export using the active Out node', () => {
    render(
      <ExportButton
        activeOutOpId="/out"
        isRendering={false}
        takeScreenshot={vi.fn()}
        startRender={vi.fn()}
      />
    )

    const button = screen.getByRole('button', { name: /export/i })
    expect(button).toBeEnabled()
    expect(button.parentElement).toHaveAttribute('title', "Export using /out's render settings")

    openMenu()
    expect(screen.getByRole('menuitem', { name: /image \(png\)/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /video \(mp4\)/i })).toBeInTheDocument()
    expect(screen.getByText("Uses /out's render settings")).toBeInTheDocument()
  })

  it('takes a screenshot with the toolbar as its analytics source', async () => {
    const takeScreenshot = vi.fn().mockResolvedValue(undefined)
    render(
      <ExportButton
        activeOutOpId="/out"
        isRendering={false}
        takeScreenshot={takeScreenshot}
        startRender={vi.fn()}
      />
    )

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /image \(png\)/i }))
    await flush()

    expect(takeScreenshot).toHaveBeenCalledExactlyOnceWith('toolbar')
  })

  it('starts a render with the toolbar as its analytics source', async () => {
    const startRender = vi.fn().mockResolvedValue(undefined)
    render(
      <ExportButton
        activeOutOpId="/out"
        isRendering={false}
        takeScreenshot={vi.fn()}
        startRender={startRender}
      />
    )

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /video \(mp4\)/i }))
    await flush()

    expect(startRender).toHaveBeenCalledExactlyOnceWith('toolbar')
  })

  it('disables the open menu when another export starts', async () => {
    const takeScreenshot = vi.fn().mockResolvedValue(undefined)
    const startRender = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <ExportButton
        activeOutOpId="/out"
        isRendering={false}
        takeScreenshot={takeScreenshot}
        startRender={startRender}
      />
    )
    openMenu()

    // An export_video run starts while the menu is still open
    rerender(
      <ExportButton
        activeOutOpId="/out"
        isRendering
        takeScreenshot={takeScreenshot}
        startRender={startRender}
      />
    )
    const image = screen.getByRole('menuitem', { name: /image \(png\)/i })
    const video = screen.getByRole('menuitem', { name: /video \(mp4\)/i })
    expect(image).toHaveAttribute('data-disabled')
    expect(video).toHaveAttribute('data-disabled')

    fireEvent.click(image)
    fireEvent.click(video)
    await flush()
    expect(takeScreenshot).not.toHaveBeenCalled()
    expect(startRender).not.toHaveBeenCalled()
  })

  it('is disabled with a reason when the project has no Out node', () => {
    render(
      <ExportButton
        activeOutOpId={null}
        isRendering={false}
        takeScreenshot={vi.fn()}
        startRender={vi.fn()}
      />
    )

    const button = screen.getByRole('button', { name: /export/i })
    expect(button).toBeDisabled()
    expect(button.parentElement).toHaveAttribute('title', 'Add an Out node to export')
  })

  it('shows progress and stays disabled while a render runs', () => {
    const { rerender } = render(
      <ExportButton
        activeOutOpId="/out"
        isRendering
        takeScreenshot={vi.fn()}
        startRender={vi.fn()}
      />
    )

    // Before the first frame finishes there is no percent to show
    const button = screen.getByRole('button', { name: /exporting/i })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent(/^Exporting$/)
    expect(button.parentElement).toHaveAttribute('title', 'An export is running')

    act(() => setRenderProgress(21, 50))
    expect(button).toHaveTextContent('Exporting 42%')

    rerender(
      <ExportButton
        activeOutOpId="/out"
        isRendering={false}
        takeScreenshot={vi.fn()}
        startRender={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /export/i })).toHaveTextContent(/^Export$/)
  })
})

describe('render progress store', () => {
  it('only updates when the whole percent changes', () => {
    const listener = vi.fn()
    const unsubscribe = useRenderProgressStore.subscribe(listener)

    setRenderProgress(1, 1000)
    setRenderProgress(5, 1000)
    expect(useRenderProgressStore.getState().percent).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)

    setRenderProgress(10, 1000)
    expect(useRenderProgressStore.getState().percent).toBe(1)
    expect(listener).toHaveBeenCalledTimes(2)

    setRenderProgress(1000, 1000)
    expect(useRenderProgressStore.getState().percent).toBe(100)

    resetRenderProgress()
    expect(useRenderProgressStore.getState().percent).toBeNull()
    unsubscribe()
  })
})
