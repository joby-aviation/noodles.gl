// Query parameters for app configuration
const queryParams = new URLSearchParams(window?.location.search ?? '')

// Disables execution of operators, useful for debugging or when the
// app has broken in an invalid state
export const safeMode = queryParams.get('safeMode') === 'true'

// Enables external control of the app (WebMCP tool registration and the
// legacy WebSocket bridge)
export const externalControl = queryParams.get('externalControl') === 'true'

// Exposes the agent benchmark hook (bench/agent/). Dev builds only, so a shared
// link cannot turn it on in production.
export const agentBench = import.meta.env.DEV && queryParams.get('agentBench') === '1'

export const IS_PROD =
  typeof location !== 'undefined' ? location.hostname === import.meta.env.VITE_PROD_HOSTNAME : false

// Default map view coordinates (NYC)
export const DEFAULT_LATITUDE = 40.7128
export const DEFAULT_LONGITUDE = -74.006
