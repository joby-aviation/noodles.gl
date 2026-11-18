// Where the next-step bar shows (#787): on the graph when the workspace has one, over the map
// when it doesn't, so a workspace without the graph still shows it
import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { docStore } from './doc-store'
import { NextStepBar } from './next-step-bar'
import { setEditorShown } from './workspace-store'

const EMPTY: EditorDoc = { version: 1, name: 'p', nodes: [], edges: [] }

afterEach(() => {
  cleanup()
  setEditorShown('graph', true)
})

describe('NextStepBar', () => {
  it('shows over the map only while the workspace hides the graph', () => {
    docStore().load(EMPTY)
    setEditorShown('graph', false)
    const { rerender } = render(<NextStepBar over="map" />)
    expect(screen.getByRole('status').textContent).toMatch(/Start with your data/)
    setEditorShown('graph', true)
    rerender(<NextStepBar over="map" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
