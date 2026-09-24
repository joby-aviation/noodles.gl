import {
  type CurveFactory,
  curveBasis,
  curveCardinal,
  curveCatmullRom,
  curveLinear,
  curveMonotoneX,
  curveMonotoneY,
  curveNatural,
  line,
} from 'd3'

export const LINE_INTERPOLATION_METHODS = [
  'linear',
  'catmull-rom',
  'cardinal',
  'basis',
  'natural',
  'monotone-x',
  'monotone-y',
  'turn-radius',
] as const

export type LineInterpolationMethod = (typeof LINE_INTERPOLATION_METHODS)[number]

export interface LineInterpolationOptions {
  method: LineInterpolationMethod
  samplesPerSegment?: number
  alpha?: number
  tension?: number
  turnRadiusMeters?: number
}

type Point2D = [number, number]

const METERS_PER_DEGREE = 111_319.490_793_273_58
const EPSILON = 1e-9
const MAX_SAMPLES_PER_SEGMENT = 64

class SamplingContext {
  readonly points: Point2D[] = []
  private current: Point2D | undefined
  private first: Point2D | undefined

  constructor(private readonly samplesPerSegment: number) {}

  moveTo(x: number, y: number) {
    const point: Point2D = [x, y]
    this.current = point
    this.first = point
    this.push(point)
  }

  lineTo(x: number, y: number) {
    const point: Point2D = [x, y]
    this.current = point
    this.push(point)
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    if (!this.current) {
      this.moveTo(x, y)
      return
    }

    const [x0, y0] = this.current
    for (let step = 1; step <= this.samplesPerSegment; step++) {
      const t = step / this.samplesPerSegment
      const u = 1 - t
      this.push([
        u ** 3 * x0 + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x,
        u ** 3 * y0 + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y,
      ])
    }
    this.current = [x, y]
  }

  quadraticCurveTo(x1: number, y1: number, x: number, y: number) {
    if (!this.current) {
      this.moveTo(x, y)
      return
    }

    const [x0, y0] = this.current
    for (let step = 1; step <= this.samplesPerSegment; step++) {
      const t = step / this.samplesPerSegment
      const u = 1 - t
      this.push([
        u ** 2 * x0 + 2 * u * t * x1 + t ** 2 * x,
        u ** 2 * y0 + 2 * u * t * y1 + t ** 2 * y,
      ])
    }
    this.current = [x, y]
  }

  closePath() {
    if (this.first) this.lineTo(...this.first)
  }

  private push(point: Point2D) {
    const previous = this.points.at(-1)
    if (
      !previous ||
      Math.abs(previous[0] - point[0]) > EPSILON ||
      Math.abs(previous[1] - point[1]) > EPSILON
    ) {
      this.points.push(point)
    }
  }
}

function curveFactory(
  method: LineInterpolationMethod,
  alpha: number,
  tension: number
): CurveFactory {
  switch (method) {
    case 'basis':
      return curveBasis
    case 'cardinal':
      return curveCardinal.tension(Math.max(0, Math.min(1, tension)))
    case 'catmull-rom':
      return curveCatmullRom.alpha(Math.max(0, Math.min(1, alpha)))
    case 'monotone-x':
      return curveMonotoneX
    case 'monotone-y':
      return curveMonotoneY
    case 'natural':
      return curveNatural
    default:
      return curveLinear
  }
}

function unwrapLongitudes(coordinates: readonly number[][]): number[][] {
  if (coordinates.length === 0) return []

  const unwrapped = [coordinates[0].slice()]
  for (let index = 1; index < coordinates.length; index++) {
    const point = coordinates[index].slice()
    const previousLongitude = unwrapped[index - 1][0]
    while (point[0] - previousLongitude > 180) point[0] -= 360
    while (point[0] - previousLongitude < -180) point[0] += 360
    unwrapped.push(point)
  }
  return unwrapped
}

function wrapLongitude(longitude: number): number {
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 && longitude > 0 ? 180 : wrapped
}

function wrapOutputLongitudes(points: number[][], source: readonly number[][]): number[][] {
  const wrapped = points.map(point => [wrapLongitude(point[0]), ...point.slice(1)])
  if (wrapped.length > 0 && source.length > 0) {
    wrapped[0] = source[0].slice()
    wrapped[wrapped.length - 1] = source[source.length - 1].slice()
  }
  return wrapped
}

function restoreExtraDimensions(
  points: readonly Point2D[],
  source: readonly number[][]
): number[][] {
  const extraDimensionCount = Math.max(0, Math.min(...source.map(point => point.length)) - 2)
  if (extraDimensionCount === 0 || points.length === 0 || source.length < 2) {
    return points.map(point => [...point])
  }

  return points.map(point => {
    let closestSegment = 0
    let closestProgress = 0
    let closestDistanceSquared = Infinity

    for (let segment = 0; segment < source.length - 1; segment++) {
      const start = source[segment]
      const end = source[segment + 1]
      const deltaX = end[0] - start[0]
      const deltaY = end[1] - start[1]
      const lengthSquared = deltaX ** 2 + deltaY ** 2
      const progress =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared
              )
            )
      const projectedX = start[0] + deltaX * progress
      const projectedY = start[1] + deltaY * progress
      const distanceSquared = (point[0] - projectedX) ** 2 + (point[1] - projectedY) ** 2

      if (distanceSquared < closestDistanceSquared) {
        closestDistanceSquared = distanceSquared
        closestSegment = segment
        closestProgress = progress
      }
    }

    const extras = Array.from({ length: extraDimensionCount }, (_, extraIndex) => {
      const start = source[closestSegment][extraIndex + 2]
      const end = source[closestSegment + 1][extraIndex + 2]
      return start + (end - start) * closestProgress
    })
    return [...point, ...extras]
  })
}

function interpolateD3Line(
  coordinates: readonly number[][],
  method: LineInterpolationMethod,
  samplesPerSegment: number,
  alpha: number,
  tension: number
): number[][] {
  if (method === 'linear' || coordinates.length < 3) return coordinates.map(point => [...point])

  const unwrappedCoordinates = unwrapLongitudes(coordinates)
  const context = new SamplingContext(samplesPerSegment)
  line<number[]>()
    .x(point => point[0])
    .y(point => point[1])
    .curve(curveFactory(method, alpha, tension))
    .context(context as unknown as CanvasRenderingContext2D)(unwrappedCoordinates)

  return wrapOutputLongitudes(
    restoreExtraDimensions(context.points, unwrappedCoordinates),
    coordinates
  )
}

function roundLineCorners(
  coordinates: readonly number[][],
  requestedRadius: number,
  samplesPerQuarterTurn: number
): number[][] {
  if (requestedRadius <= 0 || coordinates.length < 3) return coordinates.map(point => [...point])

  const unwrappedCoordinates = unwrapLongitudes(coordinates)
  const rounded: Point2D[] = [[unwrappedCoordinates[0][0], unwrappedCoordinates[0][1]]]

  for (let index = 1; index < unwrappedCoordinates.length - 1; index++) {
    const geographicCorner = unwrappedCoordinates[index]
    const longitudeScale =
      METERS_PER_DEGREE * Math.max(1e-6, Math.abs(Math.cos((geographicCorner[1] * Math.PI) / 180)))
    const project = (point: readonly number[]): Point2D => [
      (point[0] - geographicCorner[0]) * longitudeScale,
      (point[1] - geographicCorner[1]) * METERS_PER_DEGREE,
    ]
    const unproject = (point: Point2D): Point2D => [
      point[0] / longitudeScale + geographicCorner[0],
      point[1] / METERS_PER_DEGREE + geographicCorner[1],
    ]
    const previous = project(unwrappedCoordinates[index - 1])
    const corner: Point2D = [0, 0]
    const next = project(unwrappedCoordinates[index + 1])
    const toPrevious: Point2D = [previous[0] - corner[0], previous[1] - corner[1]]
    const toNext: Point2D = [next[0] - corner[0], next[1] - corner[1]]
    const previousLength = Math.hypot(...toPrevious)
    const nextLength = Math.hypot(...toNext)

    if (previousLength < EPSILON || nextLength < EPSILON) {
      rounded.push([geographicCorner[0], geographicCorner[1]])
      continue
    }

    const towardPrevious: Point2D = [toPrevious[0] / previousLength, toPrevious[1] / previousLength]
    const towardNext: Point2D = [toNext[0] / nextLength, toNext[1] / nextLength]
    const dot = Math.max(
      -1,
      Math.min(1, towardPrevious[0] * towardNext[0] + towardPrevious[1] * towardNext[1])
    )
    const interiorAngle = Math.acos(dot)
    const inbound: Point2D = [-towardPrevious[0], -towardPrevious[1]]
    const cross = inbound[0] * towardNext[1] - inbound[1] * towardNext[0]

    if (interiorAngle < EPSILON || Math.PI - interiorAngle < EPSILON || Math.abs(cross) < EPSILON) {
      rounded.push([geographicCorner[0], geographicCorner[1]])
      continue
    }

    const requestedTangent = requestedRadius / Math.tan(interiorAngle / 2)
    // Each corner may consume at most 45% of either adjacent leg. Therefore two
    // neighboring corners always leave at least 10% of their shared straight leg.
    const tangent = Math.min(requestedTangent, previousLength * 0.45, nextLength * 0.45)
    const radius = tangent * Math.tan(interiorAngle / 2)
    const start: Point2D = [
      corner[0] + towardPrevious[0] * tangent,
      corner[1] + towardPrevious[1] * tangent,
    ]
    const end: Point2D = [corner[0] + towardNext[0] * tangent, corner[1] + towardNext[1] * tangent]
    const bisector: Point2D = [towardPrevious[0] + towardNext[0], towardPrevious[1] + towardNext[1]]
    const bisectorLength = Math.hypot(...bisector)
    const centerDistance = radius / Math.sin(interiorAngle / 2)
    const center: Point2D = [
      corner[0] + (bisector[0] / bisectorLength) * centerDistance,
      corner[1] + (bisector[1] / bisectorLength) * centerDistance,
    ]
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
    const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
    let sweep = endAngle - startAngle
    if (cross > 0) while (sweep <= 0) sweep += Math.PI * 2
    if (cross < 0) while (sweep >= 0) sweep -= Math.PI * 2

    rounded.push(unproject(start))
    const samples = Math.max(
      2,
      Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * samplesPerQuarterTurn)
    )
    for (let step = 1; step <= samples; step++) {
      const angle = startAngle + (sweep * step) / samples
      rounded.push(
        unproject([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius])
      )
    }
  }

  const last = unwrappedCoordinates.at(-1)!
  rounded.push([last[0], last[1]])
  return wrapOutputLongitudes(restoreExtraDimensions(rounded, unwrappedCoordinates), coordinates)
}

function interpolateCoordinates(
  coordinates: readonly number[][],
  options: Required<LineInterpolationOptions>
) {
  if (options.method === 'turn-radius') {
    return roundLineCorners(
      coordinates,
      Math.max(0, options.turnRadiusMeters),
      options.samplesPerSegment
    )
  }
  return interpolateD3Line(
    coordinates,
    options.method,
    options.samplesPerSegment,
    options.alpha,
    options.tension
  )
}

function transformGeometry(
  geometry: Record<string, unknown>,
  options: Required<LineInterpolationOptions>
): Record<string, unknown> {
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return {
      ...geometry,
      coordinates: interpolateCoordinates(geometry.coordinates as number[][], options),
    }
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return {
      ...geometry,
      coordinates: (geometry.coordinates as number[][][]).map(lineCoordinates =>
        interpolateCoordinates(lineCoordinates, options)
      ),
    }
  }
  if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    return {
      ...geometry,
      geometries: geometry.geometries.map(item =>
        isObject(item) ? transformGeometry(item, options) : item
      ),
    }
  }
  return geometry
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function transformGeoJson(value: unknown, options: Required<LineInterpolationOptions>): unknown {
  if (Array.isArray(value)) return value.map(item => transformGeoJson(item, options))
  if (!isObject(value)) return value

  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return { ...value, features: value.features.map(feature => transformGeoJson(feature, options)) }
  }
  if (value.type === 'Feature') {
    return {
      ...value,
      geometry: isObject(value.geometry)
        ? transformGeometry(value.geometry, options)
        : value.geometry,
    }
  }
  return transformGeometry(value, options)
}

/** Interpolate every LineString contained in a GeoJSON value without mutating the input. */
export function interpolateGeoJsonLines<T>(geojson: T, options: LineInterpolationOptions): T {
  const requestedSamples = options.samplesPerSegment ?? 12
  const samplesPerSegment = Number.isFinite(requestedSamples)
    ? Math.max(1, Math.min(MAX_SAMPLES_PER_SEGMENT, Math.round(requestedSamples)))
    : 12
  const alpha = Number.isFinite(options.alpha) ? Math.max(0, Math.min(1, options.alpha!)) : 0.5
  const tension = Number.isFinite(options.tension) ? Math.max(0, Math.min(1, options.tension!)) : 0
  const turnRadiusMeters = Number.isFinite(options.turnRadiusMeters)
    ? Math.max(0, options.turnRadiusMeters!)
    : 250
  const normalizedOptions: Required<LineInterpolationOptions> = {
    method: LINE_INTERPOLATION_METHODS.includes(options.method) ? options.method : 'linear',
    samplesPerSegment,
    alpha,
    tension,
    turnRadiusMeters,
  }
  return transformGeoJson(geojson, normalizedOptions) as T
}
