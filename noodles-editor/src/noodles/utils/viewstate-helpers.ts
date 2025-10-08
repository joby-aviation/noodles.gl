function validateProperty(
  value: unknown,
  property: string,
  min: number,
  max: number,
  viewKey?: string
): void {
  if (typeof value === 'number') {
    if (value < min || value > max) {
      const prefix = viewKey ? `Invalid ViewState in view '${viewKey}': ` : 'Invalid ViewState: '
      throw new Error(`${prefix}${property} ${value} is outside valid range [${min}, ${max}]`)
    }
  }
}

function validateSingleViewState(viewState: Record<string, unknown>, viewKey?: string): void {
  validateProperty(viewState.latitude, 'latitude', -90, 90, viewKey)
  validateProperty(viewState.longitude, 'longitude', -180, 180, viewKey)
  validateProperty(viewState.pitch, 'pitch', 0, 90, viewKey)

  if (typeof viewState.zoom === 'number') {
    const hasLatLng = 'latitude' in viewState || 'longitude' in viewState
    if (hasLatLng) {
      validateProperty(viewState.zoom, 'zoom', 0, 24, viewKey)
    }
  }
}

export function validateViewState(viewState: unknown): void {
  if (!viewState || typeof viewState !== 'object') {
    return
  }

  const vs = viewState as Record<string, unknown>

  validateSingleViewState(vs)

  for (const [key, value] of Object.entries(vs)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      validateSingleViewState(value as Record<string, unknown>, key)
    }
  }
}
