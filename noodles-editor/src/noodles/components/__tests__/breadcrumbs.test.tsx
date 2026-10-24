import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { docStore } from '../../../editor/doc-store'
import { Breadcrumbs } from '../breadcrumbs'

const doc: EditorDoc = {
  version: 1,
  name: 'test',
  nodes: [
    { id: 'a', op: 'subnet', name: 'outer', x: 0, y: 0, params: {} },
    { id: 'b', op: 'subnet', name: 'inner', parent: 'a', x: 0, y: 0, params: {} },
  ],
  edges: [],
}

describe('Breadcrumbs', () => {
  afterEach(() => cleanup())

  it('shows the project and the subnets the editor is inside', () => {
    docStore().load(doc)
    docStore().set({ network: 'b' })
    render(<Breadcrumbs projectName="my-project" />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual([
      'my-project',
      'outer',
      'inner',
    ])
  })

  it('goes back up to a segment when clicked', () => {
    docStore().load(doc)
    docStore().set({ network: 'b' })
    render(<Breadcrumbs projectName="my-project" />)
    fireEvent.click(screen.getByText('outer'))
    expect(docStore().get().network).toBe('a')
    fireEvent.click(screen.getByText('my-project'))
    expect(docStore().get().network).toBeUndefined()
  })

  it('marks unsaved changes on the project', () => {
    docStore().load(doc)
    render(<Breadcrumbs projectName="my-project" hasUnsavedChanges />)
    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument()
  })
})
