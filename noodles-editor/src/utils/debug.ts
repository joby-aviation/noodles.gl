import createDebug from 'debug'

// History namespaces for undo/redo operations
export const debugHistory = createDebug('noodles:history')
export const debugHistorySnapshot = createDebug('noodles:history:snapshot')
export const debugHistoryUndo = createDebug('noodles:history:undo')
export const debugHistoryRedo = createDebug('noodles:history:redo')

// Graph executor namespace
export const debugExecutor = createDebug('noodles:executor')

// Render namespaces for video/image capture
export const debugRender = createDebug('noodles:render')
export const debugRenderFrame = createDebug('noodles:render:frame')

// Playback namespace for timeline playback
export const debugPlayback = createDebug('noodles:playback')

// Serialization namespace for save/load
export const debugSerialize = createDebug('noodles:serialize')

// Field and operator update pipeline namespaces
export const debugSetValue = createDebug('noodles:field:setValue')
export const debugDirty = createDebug('noodles:field:dirty')
export const debugPull = createDebug('noodles:executor:pull')
export const debugExecute = createDebug('noodles:executor:execute')
export const debugVis = createDebug('noodles:vis')

// Parameter editor namespace
export const debugParams = createDebug('noodles:params')
