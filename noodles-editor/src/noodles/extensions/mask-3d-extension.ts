import type { Layer, UpdateParameters } from '@deck.gl/core'
import { LayerExtension, project32 } from '@deck.gl/core'
import type { ShaderModule } from '@luma.gl/shadertools'

type Props = {
  targetPosition: [number, number, number]
  innerRadius: number
  fadeRange: number
}

// Define the shader module for the mask3D uniforms
const mask3DUniforms: ShaderModule<Props> = {
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
  getUniforms: (props: Partial<Props>) => ({
    targetPosition: props.targetPosition || [0.0, 0.0, 0.0],
    innerRadius: props.innerRadius || 1000.0,
    fadeRange: props.fadeRange || 7.0,
  }),
}

// WGS84 geodetic coordinates (degrees, meters above the ellipsoid) to Earth-centered,
// Earth-fixed (ECEF) meters: X through lng 0 on the equator, Y through lng 90, Z north.
export function toGeocentric(
  longitude: number,
  latitude: number,
  height = 0
): [number, number, number] {
  const a = 6378137 // semi-major axis
  const f = 1 / 298.257223563 // flattening
  const e2 = f * (2 - f) // eccentricity squared

  const lat = (latitude * Math.PI) / 180
  const lng = (longitude * Math.PI) / 180
  const sinLat = Math.sin(lat)
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat) // prime vertical radius

  return [
    (n + height) * Math.cos(lat) * Math.cos(lng),
    (n + height) * Math.cos(lat) * Math.sin(lng),
    (n * (1 - e2) + height) * sinLat,
  ]
}

// The targetPosition uniform for a lng/lat/alt. glTF tiles are Y-up, and the shader reads
// geometry.worldPosition before the tile's model matrix turns it Z-up, so vWorldPosition is
// ECEF as (X, Z, -Y). The shader compares vWorldPosition.zyx = (-Y, Z, X) with
// targetPosition.yzx, so the target is ECEF with Y negated. The fork this came from negated
// the longitude instead, which flips Y the same way.
export function toMaskTargetPosition(
  longitude: number,
  latitude: number,
  height = 0
): [number, number, number] {
  const [x, y, z] = toGeocentric(longitude, latitude, height)
  return [x, -y, z]
}

// Forked from https://github.com/grahambates-code/3d_tiles_mask
export class Mask3DExtension extends LayerExtension {
  static extensionName = 'Mask3DExtension'

  getShaders() {
    return {
      modules: [project32, mask3DUniforms],
      inject: {
        'vs:#decl': `
          out vec3 vWorldPosition;
        `,
        'vs:#main-end': `
          // Capture world position
          vWorldPosition = geometry.worldPosition;

          //   vec3 centroid = geometry.positionOrigin;
          //vec3 direction = geometry.worldPosition - centroid;
          //geometry.worldPosition += direction * (uScaleFactor - 1.0);

        `,
        'fs:#decl': `
          in vec3 vWorldPosition;
        `,
        'fs:DECKGL_FILTER_COLOR': `

          // Calculate the distance in adjusted coordinates
          float distanceToTarget = distance(vWorldPosition.zyx, mask3D.targetPosition.yzx);

          // Discard fragments fully outside the highlight (beyond fade range)
          if (distanceToTarget > mask3D.innerRadius + 0.75 * mask3D.fadeRange ) {
              discard;
          }

          // Compute fade factor using smoothstep
          float fade = smoothstep(mask3D.innerRadius, mask3D.innerRadius + mask3D.fadeRange, distanceToTarget);

          // Blend the colors: original color inside, fade to white outside
          vec3 tint = vec3(1.0, 1.0, 1.0); // Fade color
          vec3 finalColor = mix(color.rgb, tint, fade);

          // Apply the final color
          color = vec4(finalColor, color.a);
        `,
      },
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Deck.gl extension context type is not fully typed
  initializeState(this: Layer, _context: any, _extension: this) {
    // Set default uniform values using the new API
    this.setShaderModuleProps({
      mask3D: {
        targetPosition: [0.0, 0.0, 0.0],
        innerRadius: 1000.0,
        fadeRange: 7.0,
      },
    })
  }

  updateState(this: Layer, params: UpdateParameters<Layer>, _extension: this) {
    // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic extension props from layer
    const props = params.props as any
    const {
      targetPosition = props.targetPosition,
      innerRadius = props.innerRadius || 1000.0,
      fadeRange = props.fadeRange || 7.0,
    } = props

    // Use the layer's setShaderModuleProps method to update uniforms
    this.setShaderModuleProps({
      mask3D: {
        targetPosition,
        innerRadius,
        fadeRange,
      },
    })
  }
}
