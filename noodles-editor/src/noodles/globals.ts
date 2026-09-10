// Query parameters for app configuration
const queryParams = new URLSearchParams(window?.location.search ?? '')

// Disables execution of operators, useful for debugging or when the
// app has broken in an invalid state
export const safeMode = queryParams.get('safeMode') === 'true'

// Enables external control of the app (WebMCP tool registration and the
// legacy WebSocket bridge)
export const externalControl = queryParams.get('externalControl') === 'true'

export const IS_PROD =
  typeof location !== 'undefined' ? location.hostname === import.meta.env.VITE_PROD_HOSTNAME : false

// Default map view coordinates (NYC)
export const DEFAULT_LATITUDE = 40.7128
export const DEFAULT_LONGITUDE = -74.006
