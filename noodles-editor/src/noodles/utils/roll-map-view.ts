import {
  MapView,
  type MapViewProps,
  type MapViewState,
  Viewport,
  WebMercatorViewport,
} from '@deck.gl/core'
import { mat4 } from 'gl-matrix'

type RollViewState = MapViewState & { roll?: number }
type RollMapViewProps = MapViewProps & { roll?: number }

// deck.gl 9.4's MapView and MapLibreOverlay omit camera roll. Rotate the camera
// before projection so CPU projection, picking and GPU rendering agree, including
// at non-square aspect ratios. The sign accounts for deck.gl's Y-up common coordinates.
// Replace this adapter once https://github.com/visgl/deck.gl/pull/10697 is released.
class RolledViewport extends Viewport {
  get longitude() {
    return this.source.longitude
  }
  get latitude() {
    return this.source.latitude
  }
  get pitch() {
    return this.source.pitch
  }
  get bearing() {
    return this.source.bearing
  }
  get altitude() {
    return this.source.altitude
  }
  get fovy() {
    return this.source.fovy
  }
  get orthographic() {
    return this.source.orthographic
  }

  constructor(
    private readonly source: WebMercatorViewport,
    private readonly roll: number
  ) {
    const rotation = mat4.fromZRotation(new Float64Array(16), (roll * Math.PI) / 180)
    const viewMatrix = mat4.multiply(new Float64Array(16), rotation, source.viewMatrixUncentered)
    super({
      id: source.id,
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
      longitude: source.longitude,
      latitude: source.latitude,
      zoom: source.zoom,
      position: source.position,
      padding: source.padding,
      focalDistance: source.focalDistance,
      viewMatrix: Array.from(viewMatrix),
      projectionMatrix: source.projectionMatrix,
    })
  }

  get subViewports(): Viewport[] | null {
    return this.source.subViewports?.map(view => new RolledViewport(view, this.roll)) ?? null
  }
}

export function createRollViewport(
  options: ConstructorParameters<typeof WebMercatorViewport>[0] & { roll?: number }
): Viewport {
  const viewport = new WebMercatorViewport(options)
  return options?.roll ? new RolledViewport(viewport, options.roll) : viewport
}

export class RollMapView extends MapView {
  declare readonly props: RollMapViewProps

  constructor(props: RollMapViewProps = {}) {
    super(props)
  }

  makeViewport(options: { width: number; height: number; viewState: RollViewState }) {
    const viewport = super.makeViewport(options) as WebMercatorViewport | null
    const viewState = this.filterViewState(options.viewState) as RollViewState
    const roll = this.props.roll ?? viewState.roll ?? 0
    return viewport && roll ? new RolledViewport(viewport, roll) : viewport
  }
}
