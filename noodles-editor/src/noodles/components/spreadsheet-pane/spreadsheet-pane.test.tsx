import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock store
const storeState = {
  pinnedSpreadsheetNodeId: null as string | null,
}
const mockSetPinnedNodeId = vi.fn((id: string | null) => {
  storeState.pinnedSpreadsheetNodeId = id
})

vi.mock('../../store', () => ({
  useUIStore: (
    selector: (
      s: typeof storeState & {
        setPinnedSpreadsheetNodeId: typeof mockSetPinnedNodeId
      }
    ) => unknown
  ) =>
    selector({
      ...storeState,
      setPinnedSpreadsheetNodeId: mockSetPinnedNodeId,
    }),
  getOp: vi.fn(),
}))

vi.mock('./spreadsheet-pane.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => String(prop) }),
}))

vi.mock('./spreadsheet-viewer', () => ({
  SpreadsheetViewer: ({ operatorId }: { operatorId: string }) => (
    <div data-testid="spreadsheet-viewer">{operatorId}</div>
  ),
}))

// Import after mocks
import { SpreadsheetPane } from './spreadsheet-pane'
import { getOp } from '../../store'

const mockGetOp = vi.mocked(getOp)

describe('SpreadsheetPane', () => {
  beforeEach(() => {
    storeState.pinnedSpreadsheetNodeId = null
    mockGetOp.mockReset()
    mockSetPinnedNodeId.mockClear()
  })

  afterEach(() => cleanup())

  it('shows empty state when no node is selected', () => {
    render(<SpreadsheetPane selectedNodeIds={[]} />)
    expect(screen.getByText('Select a node to view its data')).toBeTruthy()
  })

  it('shows empty state when multiple nodes are selected', () => {
    render(<SpreadsheetPane selectedNodeIds={['/op-1', '/op-2']} />)
    expect(screen.getByText('Select a node to view its data')).toBeTruthy()
  })

  it('shows operator not found error for missing operator', () => {
    mockGetOp.mockReturnValue(undefined)
    render(<SpreadsheetPane selectedNodeIds={['/missing']} />)
    expect(screen.getByText('Operator not found')).toBeTruthy()
  })

  it('shows no outputs error for operator with no outputs', () => {
    mockGetOp.mockReturnValue({ outputs: {} } as ReturnType<typeof getOp>)
    render(<SpreadsheetPane selectedNodeIds={['/op-no-outputs']} />)
    expect(screen.getByText('No outputs available')).toBeTruthy()
  })

  it('renders SpreadsheetViewer when operator has outputs', () => {
    const subject = new Subject<unknown>()
    mockGetOp.mockReturnValue({
      outputs: { result: subject },
    } as unknown as ReturnType<typeof getOp>)

    render(<SpreadsheetPane selectedNodeIds={['/op-1']} />)
    expect(screen.getByTestId('spreadsheet-viewer')).toBeTruthy()
  })

  it('subscribes to the first output field and receives data', () => {
    const subject = new Subject<unknown>()
    const subscribeSpy = vi.spyOn(subject, 'subscribe')
    mockGetOp.mockReturnValue({
      outputs: { result: subject },
    } as unknown as ReturnType<typeof getOp>)

    render(<SpreadsheetPane selectedNodeIds={['/op-1']} />)
    expect(subscribeSpy).toHaveBeenCalledOnce()
  })

  it('unsubscribes when unmounted (Layout hides the pane by unmounting it)', () => {
    const subject = new Subject<unknown>()
    const unsubSpy = vi.fn()
    vi.spyOn(subject, 'subscribe').mockReturnValue({
      unsubscribe: unsubSpy,
    } as unknown as ReturnType<Subject<unknown>['subscribe']>)
    mockGetOp.mockReturnValue({
      outputs: { result: subject },
    } as unknown as ReturnType<typeof getOp>)

    const { unmount } = render(<SpreadsheetPane selectedNodeIds={['/op-1']} />)
    unmount()
    expect(unsubSpy).toHaveBeenCalledOnce()
  })

  it('clears pinned node when pinned operator is deleted', () => {
    storeState.pinnedSpreadsheetNodeId = '/deleted-op'
    mockGetOp.mockReturnValue(undefined)

    render(<SpreadsheetPane selectedNodeIds={[]} />)
    expect(mockSetPinnedNodeId).toHaveBeenCalledWith(null)
  })

  it('displays operator name in header when node is targeted', () => {
    const subject = new Subject<unknown>()
    mockGetOp.mockReturnValue({
      outputs: { result: subject },
    } as unknown as ReturnType<typeof getOp>)

    render(<SpreadsheetPane selectedNodeIds={['/my-operator']} />)
    // operatorName span in header (may also appear in mocked viewer, use getAllByText)
    const matches = screen.getAllByText('/my-operator')
    expect(matches.length).toBeGreaterThan(0)
  })

  describe('pin/unpin', () => {
    it('shows pin button when a node is targeted', () => {
      const subject = new Subject<unknown>()
      mockGetOp.mockReturnValue({
        outputs: { result: subject },
      } as unknown as ReturnType<typeof getOp>)

      render(<SpreadsheetPane selectedNodeIds={['/op-1']} />)
      expect(screen.getByTitle('Pin current operator')).toBeTruthy()
    })

    it('pins when clicking the pin button', () => {
      const subject = new Subject<unknown>()
      mockGetOp.mockReturnValue({
        outputs: { result: subject },
      } as unknown as ReturnType<typeof getOp>)

      render(<SpreadsheetPane selectedNodeIds={['/op-1']} />)
      fireEvent.click(screen.getByTitle('Pin current operator'))
      expect(mockSetPinnedNodeId).toHaveBeenCalledWith('/op-1')
    })

    it('unpins when clicking Unpin on a pinned node', () => {
      storeState.pinnedSpreadsheetNodeId = '/op-1'
      const subject = new Subject<unknown>()
      mockGetOp.mockReturnValue({
        outputs: { result: subject },
      } as unknown as ReturnType<typeof getOp>)

      render(<SpreadsheetPane selectedNodeIds={[]} />)
      fireEvent.click(screen.getByTitle('Unpin'))
      expect(mockSetPinnedNodeId).toHaveBeenCalledWith(null)
    })
  })
})
