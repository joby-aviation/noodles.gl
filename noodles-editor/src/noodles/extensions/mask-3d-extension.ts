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

// Forked from https://github.com/grahambates-code/3d_tiles_mask
export class Mask3DExtension extends LayerExtension {
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
