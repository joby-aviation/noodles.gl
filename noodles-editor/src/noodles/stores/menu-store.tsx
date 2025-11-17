/**
 * Menu operations store with Zustand.
 *
 * Manages state for menu operations including:
 * - Current workspace and project
 * - Operation execution state
 * - Dialog state (managed by DialogAPI)
 */

import { create } from 'zustand'
import type { DialogState } from '../components/dialog-api'
import type { Workspace } from '../storage/workspace-types'

// ============================================================================
// Types
// ============================================================================

/**
 * Operation execution state
 */
export type OperationState = 'idle' | 'running' | 'error'

interface MenuOperationsState {
  /**
   * Current workspace (null if none selected)
   */
  currentWorkspace: Workspace | null

  /**
   * Active project name (null if none open)
   */
  activeProject: string | null

  /**
   * Current operation name (null if idle)
   */
  currentOperation: string | null

  /**
   * Operation execution state
   */
  operationState: OperationState

  /**
   * Error from last operation (null if no error)
   */
  operationError: Error | null

  /**
   * Active dialog state (managed by DialogAPI)
   */
  activeDialog: DialogState

  /**
   * Recent workspaces (computed from cache at runtime)
   */
  recentWorkspaces: Workspace[]
}

interface MenuOperationsActions {
  /**
   * Set current workspace
   */
  setWorkspace: (workspace: Workspace | null) => void

  /**
   * Set active project
   */
  setActiveProject: (name: string | null) => void

  /**
   * Set operation state
   */
  setOperationState: (operation: string | null, state: OperationState, error?: Error | null) => void

  /**
   * Set active dialog (called by DialogAPI)
   */
  setActiveDialog: (dialog: DialogState) => void

  /**
   * Update recent workspaces list
   */
  setRecentWorkspaces: (workspaces: Workspace[]) => void

  /**
   * Reset to initial state
   */
  reset: () => void
}

export type MenuOperationsStore = MenuOperationsState & MenuOperationsActions

// ============================================================================
// Store
// ============================================================================

const initialState: MenuOperationsState = {
  currentWorkspace: null,
  activeProject: null,
  currentOperation: null,
  operationState: 'idle',
  operationError: null,
  activeDialog: null,
  recentWorkspaces: [],
}

export const useMenuOperationsStore = create<MenuOperationsStore>(set => ({
  ...initialState,

  setWorkspace: workspace => {
    set({ currentWorkspace: workspace })
  },

  setActiveProject: name => {
    set({ activeProject: name })
  },

  setOperationState: (operation, state, error = null) => {
    set({
      currentOperation: operation,
      operationState: state,
      operationError: error,
    })
  },

  setActiveDialog: dialog => {
    set({ activeDialog: dialog })
  },

  setRecentWorkspaces: workspaces => {
    set({ recentWorkspaces: workspaces })
  },

  reset: () => {
    set(initialState)
  },
}))

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get current workspace
 */
export const useCurrentWorkspace = () => useMenuOperationsStore(state => state.currentWorkspace)

/**
 * Get active project name
 */
export const useActiveProject = () => useMenuOperationsStore(state => state.activeProject)

/**
 * Get current operation name
 */
export const useCurrentOperation = () => useMenuOperationsStore(state => state.currentOperation)

/**
 * Get operation state
 */
export const useOperationState = () => useMenuOperationsStore(state => state.operationState)

/**
 * Get operation error
 */
export const useOperationError = () => useMenuOperationsStore(state => state.operationError)

/**
 * Get active dialog state
 */
export const useActiveDialog = () => useMenuOperationsStore(state => state.activeDialog)

/**
 * Get recent workspaces
 */
export const useRecentWorkspaces = () => useMenuOperationsStore(state => state.recentWorkspaces)

/**
 * Check if an operation is currently running
 */
export const useIsOperationRunning = () =>
  useMenuOperationsStore(state => state.operationState === 'running')
