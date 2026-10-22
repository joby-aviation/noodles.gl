// Loading a project with a missing operator type through the editor: React Flow renders the
// UnknownOperator placeholder, and saving writes the node back with its original type and data
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../app'
import { getCurrentProject } from '../../webmcp/bridge'
import { getOpStore } from '../store'
import { memoryProjectStore } from '../utils/memory-project-store'
import { NOODLES_VERSION } from '../utils/migrate-schema'
import { serializeNodes } from '../utils/serialization'

// Publishes the editor's React Flow nodes on the WebMCP bridge so the test can read them
vi.mock('../globals', async importOriginal => ({
  ...(await importOriginal<typeof import('../globals')>()),
  externalControl: true,
}))

describe('loading a project with a missing operator type', () => {
  afterEach(() => {
    cleanup()
    vi.useFakeTimers()
    vi.restoreAllMocks()
  })

  it('renders the placeholder and saves the original type', async () => {
    vi.useRealTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const missingNode = {
      id: '/missing',
      type: 'RemovedOp',
      data: { inputs: { threshold: 5 }, locked: true },
      position: { x: 0, y: 0 },
    }
    memoryProjectStore.setProjectJson('unknown-operator-test', {
      version: NOODLES_VERSION,
      nodes: [
        missingNode,
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 3 } }, position: { x: 300, y: 0 } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as Parameters<typeof memoryProjectStore.setProjectJson>[1])
    window.history.replaceState({}, '', '/examples/unknown-operator-test')

    const { container } = render(<App />)

    const placeholder = await waitFor(
      () => {
        const node = container.querySelector('.react-flow__node[data-id="/missing"]')
        expect(node?.classList.contains('react-flow__node-UnknownOperator')).toBe(true)
        return node as HTMLElement
      },
      { timeout: 15_000 }
    )
    expect(placeholder.textContent).toContain('RemovedOp')
    expect(placeholder.querySelector('[title="/missing (RemovedOp)"]')?.textContent).toBe(
      'missing (Removed)'
    )

    // What the editor writes on save
    const editorNodes = getCurrentProject()?.nodes ?? []
    const saved = serializeNodes(
      getOpStore(),
      editorNodes as Parameters<typeof serializeNodes>[1],
      []
    )
    expect(saved.find(node => node.id === '/missing')).toEqual(missingNode)
  })
})
