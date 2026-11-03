import type { DefaultProps, Layer, LayerContext } from '@deck.gl/core'
import { LayerExtension, project32 } from '@deck.gl/core'
import type { ShaderModule } from '@luma.gl/shadertools'

export type Mask3DExtensionProps = {
  // [lng, lat, altitude in meters] in geospatial views, world units otherwise
  targetPosition?: [number, number, number]
  // Radius of the visible sphere, in meters (geospatial) or world units
  innerRadius?: number
  // Width of the fade-to-white band beyond innerRadius, in the same units
  fadeRange?: number
}

type UniformProps = {
  targetPosition: [number, number, number]
  innerRadius: number
  fadeRange: number
}

// All values are in deck.gl common space so every sublayer shares one frame,
// regardless of its coordinateSystem, coordinateOrigin or modelMatrix
const mask3DUniforms: ShaderModule<UniformProps> = {
  name: 'mask3D',
  vs: `
    uniform mask3DUniforms {
      vec3 targetPosition;
      float innerRadius;
      float fadeRange;
    } mask3D;
  `,
  fs: `
    uniform mask3DUniforms {
      vec3 targetPosition;
      float innerRadius;
      float fadeRange;
    } mask3D;
  `,
  uniformTypes: {
    targetPosition: 'vec3<f32>',
    innerRadius: 'f32',
    fadeRange: 'f32',
  },
}

const defaultProps: DefaultProps<Mask3DExtensionProps> = {
  targetPosition: { type: 'array', value: [0, 0, 0], compare: true },
  innerRadius: 1000,
  fadeRange: 7,
}

// Forked from https://github.com/grahambates-code/3d_tiles_mask
export class Mask3DExtension extends LayerExtension {
  static extensionName = 'Mask3DExtension'
  // Listing the props here lets CompositeLayers (e.g. Tile3DLayer) forward them to sublayers
  static defaultProps = defaultProps

  getShaders() {
    return {
      modules: [project32, mask3DUniforms],
      inject: {
        'vs:#decl': `
          out vec3 vMask3DCommonPosition;
        `,
        'vs:#main-end': `
          vMask3DCommonPosition = geometry.position.xyz;
        `,
        'fs:#decl': `
          in vec3 vMask3DCommonPosition;
        `,
        'fs:DECKGL_FILTER_COLOR': `
          float distanceToTarget = distance(vMask3DCommonPosition, mask3D.targetPosition);

          // Discard fragments fully outside the highlight (beyond fade range)
          if (distanceToTarget > mask3D.innerRadius + 0.75 * mask3D.fadeRange) {
            discard;
          }

          // Fade to white between innerRadius and innerRadius + fadeRange
          float fade = mask3D.fadeRange > 0.0
            ? smoothstep(mask3D.innerRadius, mask3D.innerRadius + mask3D.fadeRange, distanceToTarget)
            : 0.0;
          color = vec4(mix(color.rgb, vec3(1.0), fade), color.a);
        `,
      },
    }
  }

  // Project the target into common space each frame, since the common-space
  // offset origin moves with the viewport
  draw(this: Layer<Mask3DExtensionProps>, _params: unknown, _extension: this) {
    const {
      targetPosition = [0, 0, 0],
      innerRadius = defaultProps.innerRadius as number,
      fadeRange = defaultProps.fadeRange as number,
    } = this.props
    const viewport = (this.internalState?.viewport ||
      this.context.viewport) as LayerContext['viewport']

    // Interpret the target in the view's default frame, ignoring the layer's own
    // coordinateOrigin / modelMatrix (Tile3DLayer sets these per tile)
    const commonTarget = this.projectPosition(targetPosition, {
      fromCoordinateSystem: 'default',
      fromCoordinateOrigin: [0, 0, 0],
      modelMatrix: null,
    } as Parameters<Layer['projectPosition']>[1])
    const [unitsPerMeter] = viewport.getDistanceScales(targetPosition).unitsPerMeter

    this.setShaderModuleProps({
      mask3D: {
        targetPosition: commonTarget,
        innerRadius: innerRadius * unitsPerMeter,
        fadeRange: fadeRange * unitsPerMeter,
      },
    })
  }
}
