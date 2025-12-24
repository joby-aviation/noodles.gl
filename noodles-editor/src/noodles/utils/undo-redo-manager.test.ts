import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodesProjectJSON } from './serialization'
import { UndoRedoManager } from './undo-redo-manager'

// Mock crypto.randomUUID
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: vi.fn(() => `mock-uuid-${Math.random().toString(36).substring(2, 11)}`),
  },
})

describe('UndoRedoManager', () => {
  let manager: UndoRedoManager
  let mockGetCurrentState: ReturnType<typeof vi.fn>
  let mockRestoreState: ReturnType<typeof vi.fn>
  let mockProjectState: NodesProjectJSON

  beforeEach(() => {
    mockProjectState = {
      nodes: [{ id: '1', type: 'test', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      version: 1,
      timeline: {},
    }

    mockGetCurrentState = vi.fn(() => JSON.parse(JSON.stringify(mockProjectState)))
    mockRestoreState = vi.fn()

    manager = new UndoRedoManager(mockGetCurrentState, mockRestoreState)
  })

  describe('initial state', () => {
    it('should start with empty history and correct initial state', () => {
      const state = manager.getState()
      expect(state.canUndo).toBe(false)
      expect(state.canRedo).toBe(false)
      expect(state.undoDescription).toBeUndefined()
      expect(state.redoDescription).toBeUndefined()
    })

    it('should have empty history initially', () => {
      expect(manager.getHistory()).toEqual([])
    })
  })

  describe('takeSnapshot', () => {
    it('should take a snapshot and update state', () => {
      manager.takeSnapshot('Initial snapshot')

      const history = manager.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].description).toBe('Initial snapshot')
      expect(history[0].projectState).toEqual(mockProjectState)
      expect(history[0].id).toBeDefined()
      expect(history[0].timestamp).toBeDefined()

      const state = manager.getState()
      expect(state.canUndo).toBe(false) // Can't undo with only one snapshot
      expect(state.canRedo).toBe(false)
    })

    it('should allow undo after taking multiple snapshots', () => {
      manager.takeSnapshot('First snapshot')

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second snapshot')

      const state = manager.getState()
      const history = manager.getHistory()
      expect(history).toHaveLength(2)
      expect(state.canUndo).toBe(true)
      expect(state.canRedo).toBe(false)
      expect(state.undoDescription).toBe('First snapshot')
    })

    it('should skip duplicate snapshots', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      manager.takeSnapshot('First snapshot')
      manager.takeSnapshot('Duplicate snapshot')

      expect(manager.getHistory()).toHaveLength(1)
      expect(consoleSpy).toHaveBeenCalledWith('Skipping duplicate snapshot')

      consoleSpy.mockRestore()
    })

    it('should truncate redo history when taking new snapshot after undo', () => {
      manager.takeSnapshot('First')

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')

      mockProjectState.nodes[0].position.x = 200
      manager.takeSnapshot('Third')

      expect(manager.getHistory()).toHaveLength(3)
      expect(manager.getState().canUndo).toBe(true)
      expect(manager.getState().canRedo).toBe(false)

      // Undo twice
      manager.undo()
      manager.undo()
      expect(manager.getState().canRedo).toBe(true)

      // Take new snapshot - should truncate redo history
      mockProjectState.nodes[0].position.x = 300
      manager.takeSnapshot('New branch')

      const history = manager.getHistory()
      expect(history).toHaveLength(2) // First + New branch
      expect(history[0].description).toBe('First')
      expect(history[1].description).toBe('New branch')
      expect(manager.getState().canUndo).toBe(true)
      expect(manager.getState().canRedo).toBe(false)
    })

    it('should limit history size to maxHistorySize', () => {
      // Take 55 snapshots (more than default maxHistorySize of 50)
      for (let i = 0; i < 55; i++) {
        mockProjectState.nodes[0].position.x = i
        manager.takeSnapshot(`Snapshot ${i}`)
      }

      const history = manager.getHistory()
      expect(history).toHaveLength(50)
      expect(history[0].description).toBe('Snapshot 5') // First 5 should be removed
      expect(history[49].description).toBe('Snapshot 54')
    })
  })

  describe('undo', () => {
    it('should undo to previous snapshot', () => {
      manager.takeSnapshot('Initial')
      const initialState = mockGetCurrentState()

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Modified')

      expect(manager.getState().canUndo).toBe(true)

      manager.undo()

      expect(mockRestoreState).toHaveBeenCalledWith(initialState)
      expect(manager.getState().canUndo).toBe(false)
      expect(manager.getState().canRedo).toBe(true)
      expect(manager.getState().redoDescription).toBe('Modified')
    })

    it('should not undo when no history available', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      manager.undo()

      expect(mockRestoreState).not.toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('Cannot undo - no history available')

      consoleSpy.mockRestore()
    })

    it('should handle multiple undos correctly', () => {
      manager.takeSnapshot('State 1')
      const state1 = mockGetCurrentState()

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('State 2')
      const state2 = mockGetCurrentState()

      mockProjectState.nodes[0].position.x = 200
      manager.takeSnapshot('State 3')

      // Undo to state 2
      manager.undo()
      expect(mockRestoreState).toHaveBeenLastCalledWith(state2)
      expect(manager.getState().undoDescription).toBe('State 1')
      expect(manager.getState().redoDescription).toBe('State 3')

      // Undo to state 1
      manager.undo()
      expect(mockRestoreState).toHaveBeenLastCalledWith(state1)
      expect(manager.getState().canUndo).toBe(false)
      expect(manager.getState().redoDescription).toBe('State 2')
    })
  })

  describe('redo', () => {
    it('should redo to next snapshot', () => {
      manager.takeSnapshot('Initial')

      mockProjectState.nodes[0].position.x = 100
      const modifiedState = { ...mockProjectState }
      manager.takeSnapshot('Modified')

      manager.undo()
      expect(manager.getState().canRedo).toBe(true)

      manager.redo()

      expect(mockRestoreState).toHaveBeenLastCalledWith(modifiedState)
      expect(manager.getState().canUndo).toBe(true)
      expect(manager.getState().canRedo).toBe(false)
    })

    it('should not redo when no redo history available', () => {
      manager.takeSnapshot('Only snapshot')

      manager.redo()

      expect(mockRestoreState).not.toHaveBeenCalled()
    })

    it('should handle multiple redos correctly', () => {
      manager.takeSnapshot('State 1')

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('State 2')
      const state2 = mockGetCurrentState()

      mockProjectState.nodes[0].position.x = 200
      manager.takeSnapshot('State 3')
      const state3 = mockGetCurrentState()

      // Undo twice
      manager.undo()
      manager.undo()

      // Redo to state 2
      manager.redo()
      expect(mockRestoreState).toHaveBeenLastCalledWith(state2)
      expect(manager.getState().undoDescription).toBe('State 1')
      expect(manager.getState().redoDescription).toBe('State 3')

      // Redo to state 3
      manager.redo()
      expect(mockRestoreState).toHaveBeenLastCalledWith(state3)
      expect(manager.getState().canRedo).toBe(false)
    })
  })

  describe('canUndo', () => {
    it('should return false with no history', () => {
      expect(manager.canUndo()).toBe(false)
    })

    it('should return false with only one snapshot', () => {
      manager.takeSnapshot('Single snapshot')
      expect(manager.canUndo()).toBe(false)
    })

    it('should return true with multiple snapshots', () => {
      manager.takeSnapshot('First')
      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')
      expect(manager.canUndo()).toBe(true)
    })
  })

  describe('canRedo', () => {
    it('should return false with no history', () => {
      expect(manager.canRedo()).toBe(false)
    })

    it('should return false when at latest snapshot', () => {
      manager.takeSnapshot('Snapshot')
      expect(manager.canRedo()).toBe(false)
    })

    it('should return true after undo', () => {
      manager.takeSnapshot('First')
      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')

      manager.undo()
      expect(manager.canRedo()).toBe(true)
    })
  })

  describe('clear', () => {
    it('should clear all history and reset state', () => {
      manager.takeSnapshot('First')
      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')

      expect(manager.getHistory()).toHaveLength(2)
      expect(manager.getState().canUndo).toBe(true)

      manager.clear()

      expect(manager.getHistory()).toEqual([])
      expect(manager.getState().canUndo).toBe(false)
      expect(manager.getState().canRedo).toBe(false)
      expect(manager.getState().undoDescription).toBeUndefined()
      expect(manager.getState().redoDescription).toBeUndefined()
    })
  })

  describe('getState$', () => {
    it('should return an observable that emits state changes', () => {
      const states: any[] = []
      const subscription = manager.getState$().subscribe(state => {
        states.push(state)
      })

      expect(states).toHaveLength(1) // Initial state

      manager.takeSnapshot('First')
      expect(states).toHaveLength(2)

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')
      expect(states).toHaveLength(3)

      manager.undo()
      expect(states).toHaveLength(4)

      subscription.unsubscribe()
    })
  })

  describe('getHistory', () => {
    it('should return a copy of history array', () => {
      manager.takeSnapshot('Test snapshot')

      const history1 = manager.getHistory()
      const history2 = manager.getHistory()

      expect(history1).toEqual(history2)
      expect(history1).not.toBe(history2) // Should be different array instances
    })
  })

  describe('edge cases', () => {
    it('should handle getCurrentState throwing an error', () => {
      mockGetCurrentState.mockImplementationOnce(() => {
        throw new Error('Failed to get state')
      })

      expect(() => {
        manager.takeSnapshot('Error test')
      }).toThrow('Failed to get state')
    })

    it('should generate unique IDs for snapshots', () => {
      manager.takeSnapshot('First')
      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')

      const history = manager.getHistory()
      expect(history[0].id).not.toBe(history[1].id)
      expect(typeof history[0].id).toBe('string')
      expect(typeof history[1].id).toBe('string')
    })

    it('should have different timestamps for snapshots', () => {
      const before = Date.now()
      manager.takeSnapshot('First')

      // Small delay to ensure different timestamp
      vi.useFakeTimers()
      vi.advanceTimersByTime(1)

      mockProjectState.nodes[0].position.x = 100
      manager.takeSnapshot('Second')

      vi.useRealTimers()

      const history = manager.getHistory()
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(history[1].timestamp).toBeGreaterThan(history[0].timestamp)
    })

    it('should handle complex state objects correctly', () => {
      const complexState = {
        nodes: [
          {
            id: '1',
            type: 'complex',
            position: { x: 0, y: 0 },
            data: {
              nested: { deep: { value: 42 } },
              array: [1, 2, { obj: true }],
            },
          },
        ],
        edges: [{ id: 'e1', source: '1', target: '2' }],
        viewport: { x: 100, y: 200, zoom: 1.5 },
        version: 2,
        timeline: { complex: { nested: { timeline: 'data' } } },
      }

      mockGetCurrentState.mockReturnValueOnce(complexState)
      manager.takeSnapshot('Complex state')

      const history = manager.getHistory()
      expect(history[0].projectState).toEqual(complexState)
    })
  })
})
