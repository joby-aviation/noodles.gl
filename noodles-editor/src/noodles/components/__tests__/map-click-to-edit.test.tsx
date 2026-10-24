// Tests that clicking a map feature selects the node that drew it, and that drags,
// empty clicks and a disabled editor leave the selection alone
import type { PickingInfo } from '@deck.gl/core'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../../utils/analytics'
import type { IOperator, Operator } from '../../operators'
import { useGraphStore, useNestingStore, useUIStore } from '../../store'
import { useMapClickToEdit } from '../map-click-to-edit'

vi.mock('../../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const track = vi.mocked(analytics.track)

type ClickToEdit = ReturnType<typeof useMapClickToEdit>
let api: ClickToEdit

function Harness({ enabled }: { enabled: boolean }) {
  api = useMapClickToEdit(enabled)
  return (
    <div
      data-testid="surface"
      style={{ position: 'relative', width: 500, height: 300 }}
      {...api.surfaceHandlers}
    >
      {api.label}
    </div>
  )
}

const node = (id: string, type: string, selected = false) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {},
  selected,
})

// deck's pointer event, carrying the DOM event's client coordinates
const pointerAt = (clientX: number, clientY: number) => ({ srcEvent: { clientX, clientY } })

// An operator instance whose class has the given display name
const fakeOp = (displayName: string) =>
  ({ constructor: { displayName } }) as unknown as Operator<IOperator>

const pick = (layerId: string | null, x = 50, y = 60) =>
  ({
    picked: layerId !== null,
    layer: layerId ? { id: layerId } : null,
    x,
    y,
  }) as unknown as PickingInfo

function press(from: { x: number; y: number }, to: { x: number; y: number }) {
  const surface = document.querySelector('[data-testid="surface"]')!
  fireEvent.pointerDown(surface, { clientX: from.x, clientY: from.y })
  fireEvent.pointerUp(surface, { clientX: to.x, clientY: to.y })
}

const selectedIds = () =>
  useGraphStore
    .getState()
    .nodes.filter(n => n.selected)
    .map(n => n.id)

describe('useMapClickToEdit', () => {
  beforeEach(() => {
    track.mockClear()
    useGraphStore.setState({
      nodes: [
        node('/scatter', 'ScatterplotLayerOp', true),
        node('/group', 'ContainerOp'),
        node('/group/arcs', 'ArcLayerOp'),
        node('/data', 'FileOp'),
      ],
      operators: new Map([
        ['/scatter', fakeOp('ScatterplotLayer')],
        ['/group', fakeOp('Container')],
        ['/group/arcs', fakeOp('ArcLayer')],
        ['/data', fakeOp('File')],
      ]),
    })
    useNestingStore.setState({ currentContainerId: '/' })
    useUIStore.setState({ mapPickFocus: null })
  })

  afterEach(() => {
    cleanup()
    useGraphStore.setState({ nodes: [], operators: new Map() })
  })

  it('selects the layer node, opens its container and asks the graph to show it', () => {
    render(<Harness enabled />)
    press({ x: 10, y: 10 }, { x: 11, y: 10 })
    act(() => api.onClick(pick('/group/arcs')))

    expect(selectedIds()).toEqual(['/group/arcs'])
    expect(useNestingStore.getState().currentContainerId).toBe('/group')
    expect(useUIStore.getState().mapPickFocus).toEqual({ nodeId: '/group/arcs', seq: 1 })
    expect(track).toHaveBeenCalledWith('map_feature_clicked', {
      operatorType: 'ArcLayerOp',
      selected: true,
    })
  })

  it('maps a composite sublayer to its node', () => {
    render(<Harness enabled />)
    const parent = { id: '/scatter' }
    act(() =>
      api.onClick({
        picked: true,
        layer: parent,
        sourceLayer: { id: '/scatter-points', parent },
      } as unknown as PickingInfo)
    )
    expect(useUIStore.getState().mapPickFocus?.nodeId).toBe('/scatter')
  })

  it('never selects a non-layer node that shares the picked id', () => {
    render(<Harness enabled />)
    act(() => api.onClick(pick('/data')))
    expect(selectedIds()).toEqual(['/scatter'])
    expect(track).toHaveBeenCalledWith('map_feature_clicked', {
      operatorType: 'unknown',
      selected: false,
    })
  })

  it('ignores a drag that moved the map', () => {
    render(<Harness enabled />)
    press({ x: 10, y: 10 }, { x: 80, y: 40 })
    act(() => api.onClick(pick('/group/arcs')))

    expect(selectedIds()).toEqual(['/scatter'])
    expect(useUIStore.getState().mapPickFocus).toBeNull()
    expect(track).not.toHaveBeenCalled()
  })

  it('does nothing for a click on empty map', () => {
    render(<Harness enabled />)
    act(() => api.onClick(pick(null)))
    expect(selectedIds()).toEqual(['/scatter'])
    expect(track).not.toHaveBeenCalled()
  })

  it('reports a feature no node drew without changing the selection', () => {
    render(<Harness enabled />)
    act(() => api.onClick(pick('custom-layer')))
    expect(selectedIds()).toEqual(['/scatter'])
    expect(track).toHaveBeenCalledWith('map_feature_clicked', {
      operatorType: 'unknown',
      selected: false,
    })
  })

  it('stays out of the way while disabled', () => {
    render(<Harness enabled={false} />)
    act(() => api.onClick(pick('/group/arcs')))
    api.onHover(pick('/group/arcs'), pointerAt(10, 10))
    expect(selectedIds()).toEqual(['/scatter'])
    expect(document.querySelector('[aria-hidden="true"]')).toHaveProperty('hidden', true)
    expect(api.getCursor({ isDragging: false, isHovering: true })).toBe('grab')
  })

  it('shows the label and a pointer cursor over a feature a node drew', () => {
    render(<Harness enabled />)
    const label = document.querySelector<HTMLElement>('[aria-hidden="true"]')!
    expect(label.hidden).toBe(true)

    const surface = document.querySelector('[data-testid="surface"]')!.getBoundingClientRect()
    api.onHover(pick('/scatter'), pointerAt(surface.left + 100, surface.top + 40))
    expect(label.hidden).toBe(false)
    expect(label.textContent).toBe('Click to edit')
    expect(label.style.transform).toBe('translate(114px, 54px)')
    expect(api.getCursor({ isDragging: false, isHovering: true })).toBe('pointer')
    expect(api.getCursor({ isDragging: true, isHovering: true })).toBe('grabbing')

    api.onHover(pick('custom-layer'), pointerAt(surface.left + 100, surface.top + 40))
    expect(label.hidden).toBe(true)
    expect(api.getCursor({ isDragging: false, isHovering: true })).toBe('grab')
  })
})
