// Feature flag for toggling between Theatre.js and native timeline
// Read from URL query param: ?use_theatre=true to use Theatre.js (default: false = native)

// Check the URL for the use_theatre flag
function getTimelineFlag(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('use_theatre') === 'true'
}

// Cache the flag value at module load time (since URL params don't change during session)
export const USE_THEATRE = getTimelineFlag()

// Hook for use in components (returns stable value)
export function useTimelineFlag(): boolean {
  return USE_THEATRE
}
