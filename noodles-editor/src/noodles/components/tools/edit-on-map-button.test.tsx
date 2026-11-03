import { cleanup, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GeoEditorOp, type IOperator, type Operator } from '../../operators'
import { clearOps, getOpStore } from '../../store'
import { EditOnMapButton } from './edit-on-map-button'
import { useMapToolStore } from './map-tool-store'

function renderButton() {
  render(
    <ReactFlowProvider>
      <EditOnMapButton nodeId="/geo-editor" from="properties" />
    </ReactFlowProvider>
  )
  return screen.getByText('Edit on map').closest('button') as HTMLButtonElement
}

describe('EditOnMapButton', () => {
  beforeEach(() => {
    getOpStore().setOp(
      '/geo-editor',
      new GeoEditorOp('/geo-editor') as unknown as Operator<IOperator>
    )
  })

  afterEach(() => {
    cleanup()
    clearOps()
    useMapToolStore.setState({ mapReady: false, editTarget: null, activeTool: null })
  })

  it('starts editing the node when a map is ready', () => {
    useMapToolStore.setState({ mapReady: true })
    const button = renderButton()
    expect(button.disabled).toBe(false)
    button.click()
    expect(useMapToolStore.getState().editTarget).toEqual({
      opId: '/geo-editor',
      kind: 'geo-editor',
    })
    expect(useMapToolStore.getState().activeTool).toBe('draw')
  })

  it('is disabled, saying why, when there is no map to edit on', () => {
    useMapToolStore.setState({ mapReady: false })
    const button = renderButton()
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/map style/)
  })
})
