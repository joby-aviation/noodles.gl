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

type ValidateViewStateOptions = {
  // Map views can't look up past the horizon; first-person views can look down to -90
  minPitch?: number
}

function validateSingleViewState(
  viewState: Record<string, unknown>,
  { minPitch = 0 }: ValidateViewStateOptions,
  viewKey?: string
): void {
  validateProperty(viewState.latitude, 'latitude', -90, 90, viewKey)
  validateProperty(viewState.longitude, 'longitude', -180, 180, viewKey)
  validateProperty(viewState.pitch, 'pitch', minPitch, 90, viewKey)

  if (typeof viewState.zoom === 'number') {
    const hasLatLng = 'latitude' in viewState || 'longitude' in viewState
    if (hasLatLng) {
      validateProperty(viewState.zoom, 'zoom', 0, 24, viewKey)
    }
  }
}

export function validateViewState(
  viewState: unknown,
  options: ValidateViewStateOptions = {}
): void {
  if (!viewState || typeof viewState !== 'object') {
    return
  }

  const vs = viewState as Record<string, unknown>

  validateSingleViewState(vs, options)

  for (const [key, value] of Object.entries(vs)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      validateSingleViewState(value as Record<string, unknown>, options, key)
    }
  }
}
