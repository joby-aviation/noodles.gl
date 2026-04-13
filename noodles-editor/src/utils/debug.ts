import createDebug from 'debug'

// History namespaces for undo/redo operations
export const debugHistory = createDebug('noodles:history') // general history operations
export const debugHistorySnapshot = createDebug('noodles:history:snapshot') // snapshot capture and storage
export const debugHistoryUndo = createDebug('noodles:history:undo') // undo operations
export const debugHistoryRedo = createDebug('noodles:history:redo') // redo operations

// Graph execution namespaces
export const debugExecutor = createDebug('noodles:executor') // graph execution significant events (cycles, etc.)
export const debugExecutorFrame = createDebug('noodles:executor:frame') // per-frame stats (noisy — fires every tick)
export const debugPull = createDebug('noodles:executor:pull') // pull-based operator execution
export const debugExecute = createDebug('noodles:executor:execute') // operator execute calls

// Field update pipeline namespaces
export const debugSetValue = createDebug('noodles:field:setValue') // field value updates
export const debugDirty = createDebug('noodles:field:dirty') // field dirty tracking

// Render namespaces for video/image capture
export const debugRender = createDebug('noodles:render') // video/image rendering setup
export const debugRenderFrame = createDebug('noodles:render:frame') // per-frame capture progress

// Timeline namespaces
export const debugPlayback = createDebug('noodles:playback') // timeline playback driver
export const debugTimeline = createDebug('noodles:timeline') // timeline field bindings, context, and store
export const debugBinding = createDebug('noodles:timeline:binding') // field-to-track binding operations
export const debugKeyframe = createDebug('noodles:timeline:keyframe') // keyframe read/write operations

// Data and project management namespaces
export const debugSerialize = createDebug('noodles:serialize') // project save/load and serialization
export const debugMigration = createDebug('noodles:migration') // project file migrations
export const debugApp = createDebug('noodles:app') // app routing, initialization, and project management
export const debugVis = createDebug('noodles:vis') // visualization layer

// Feature namespaces
export const debugAiChat = createDebug('noodles:ai-chat') // AI chat panel, context loading, and agents
export const debugExternal = createDebug('noodles:external') // external control WebSocket and worker bridge
export const debugGeocode = createDebug('noodles:geocode') // geocoding API calls
export const debugAnalytics = createDebug('noodles:analytics') // analytics tracking and consent

// UI namespace
export const debugUI = createDebug('noodles:ui') // UI component interactions and errors
