// Validates that a ViewState object has valid latitude and longitude values.
export function validateViewState(viewState: unknown): void {
  if (!viewState || typeof viewState !== 'object') {
    return // Skip validation for null/undefined/non-objects
  }

  const vs = viewState as Record<string, unknown>

  // Check for direct latitude/longitude (MapViewState)
  if ('latitude' in vs && typeof vs.latitude === 'number') {
    if (vs.latitude < -90 || vs.latitude > 90) {
      throw new Error(`Invalid ViewState: latitude ${vs.latitude} is outside valid range [-90, 90]`)
    }
  }

  if ('longitude' in vs && typeof vs.longitude === 'number') {
    if (vs.longitude < -180 || vs.longitude > 180) {
      throw new Error(`Invalid ViewState: longitude ${vs.longitude} is outside valid range [-180, 180]`)
    }
  }

  // Check for nested viewStates (multi-view case)
  for (const [key, value] of Object.entries(vs)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>
      if ('latitude' in nested && typeof nested.latitude === 'number') {
        if (nested.latitude < -90 || nested.latitude > 90) {
          throw new Error(`Invalid ViewState in view '${key}': latitude ${nested.latitude} is outside valid range [-90, 90]`)
        }
      }
      if ('longitude' in nested && typeof nested.longitude === 'number') {
        if (nested.longitude < -180 || nested.longitude > 180) {
          throw new Error(`Invalid ViewState in view '${key}': longitude ${nested.longitude} is outside valid range [-180, 180]`)
        }
      }
    }
  }
}
