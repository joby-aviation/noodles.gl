import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { docStore } from '../../../editor/doc-store'
import { EditOnMapButton } from './edit-on-map-button'
import { useMapToolStore } from './map-tool-store'

function renderButton() {
  render(<EditOnMapButton nodeId="shapes" from="properties" />)
  return screen.getByText('Edit on map').closest('button') as HTMLButtonElement
}

describe('EditOnMapButton', () => {
  beforeEach(() => {
    docStore().load({
      version: 1,
      name: 'edit',
      nodes: [{ id: 'shapes', op: 'features', x: 0, y: 0, params: {} }],
      edges: [],
    })
  })

  afterEach(() => {
    cleanup()
    useMapToolStore.setState({ mapReady: false, editTarget: null, activeTool: null })
  })

  it('starts editing the node when a map is ready', () => {
    useMapToolStore.setState({ mapReady: true })
    const button = renderButton()
    expect(button.disabled).toBe(false)
    button.click()
    expect(useMapToolStore.getState().editTarget).toEqual({ nodeId: 'shapes', kind: 'features' })
    expect(useMapToolStore.getState().activeTool).toBe('draw')
  })

  it('is disabled, saying why, when there is no map to edit on', () => {
    useMapToolStore.setState({ mapReady: false })
    const button = renderButton()
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/map style/)
  })
})
