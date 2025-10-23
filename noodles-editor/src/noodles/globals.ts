const queryParams = new URLSearchParams(window.location.search)

// Extract projectId from either:
// 1. URL path: /examples/project-name -> "project-name"
// 2. Query string: ?project=project-name -> "project-name" (legacy)
function getProjectId(): string | null {
  // Try path-based routing first (e.g., /examples/nyc-taxis)
  const pathMatch = window.location.pathname.match(/^\/examples\/([^/]+)/)
  if (pathMatch) {
    return pathMatch[1]
  }

  // Fall back to query string (legacy support for ?project=name)
  return queryParams.get('project')
}

export const projectId = getProjectId()

// Disables execution of operators, useful for debugging or when the
// app has broken in an invalid state
export const safeMode = queryParams.get('safeMode') === 'true'

export const IS_PROD = location.hostname === import.meta.env.VITE_PROD_HOSTNAME

// Default map view coordinates (NYC)
export const DEFAULT_LATITUDE = 40.7128
export const DEFAULT_LONGITUDE = -74.006
