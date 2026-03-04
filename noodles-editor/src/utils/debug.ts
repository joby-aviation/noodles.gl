import createDebug from 'debug'

// History namespaces for undo/redo operations
export const debugHistory = createDebug('noodles:history')
export const debugHistorySnapshot = createDebug('noodles:history:snapshot')
export const debugHistoryUndo = createDebug('noodles:history:undo')
export const debugHistoryRedo = createDebug('noodles:history:redo')

// Executor namespace for graph execution
export const debugExecutor = createDebug('noodles:executor')
