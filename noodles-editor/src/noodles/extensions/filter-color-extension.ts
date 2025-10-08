import {
  type CompositeLayer,
  type Layer,
  LayerExtension,
  type UpdateParameters,
} from '@deck.gl/core'
import type { ShaderPass } from '@luma.gl/shadertools'

type Uniforms = { [uniform: string]: number | number[] }

type FilterColorExtensionProps = {
  [shaderName: string]: Uniforms
}

type FilterColorExtensionOptions = ShaderPass

// Extension for applying luma.gl shader effects to deck.gl layers.
// Supports brightness/contrast, vibrance, hue/saturation, sepia, and other color effects.
//
// @example
// ```typescript
// // Single brightness/contrast effect
// import {brightnessContrast} from '@luma.gl/effects';
//
// new Tiles3DLayer({
//   extensions: [new FilterColorExtension(brightnessContrast)],
//   brightnessContrast: {
//     brightness: 0.1,  // -1 to 1 (-1 is black, 0 is no change, 1 is white)
//     contrast: 0.2     // -1 to 1 (-1 is gray, 0 is no change, 1 is max contrast)
//   }
// });
//
// // Multiple effects with vibrance and hue/saturation
// import {brightnessContrast, vibrance, hueSaturation} from '@luma.gl/effects';
//
// new ScatterplotLayer({
//   extensions: [
//     new FilterColorExtension(brightnessContrast),
//     new FilterColorExtension(vibrance),
//     new FilterColorExtension(hueSaturation)
//   ],
//   brightnessContrast: {brightness: 0.1, contrast: 0.2},
//   vibrance: {amount: 0.5},           // -1 to 1 (modifies desaturated colors)
//   hueSaturation: {hue: 0.1, saturation: 0.3}  // hue: -1 to 1, saturation: -1 to 1
// });
//
// // Sepia effect
// import {sepia} from '@luma.gl/effects';
//
// new TileLayer({
//   extensions: [new FilterColorExtension(sepia)],
//   sepia: {amount: 0.7}  // 0 to 1 (0 is no effect, 1 is full sepia)
// });
// ```

// alt names: ColorEffectExtension, FilterExtension, PostProcessingEffectExtension
export class FilterColorExtension extends LayerExtension<FilterColorExtensionOptions> {
  static extensionName = 'FilterColorExtension'

  constructor(shaderModule: FilterColorExtensionOptions) {
    if (
      shaderModule.passes?.length !== 1 ||
      Object.keys(shaderModule.passes[0]).some(pass => pass !== 'filter')
    ) {
      throw new Error('shaderModule is not a single pass color filter')
    }
    super(shaderModule)
  }

  getShaders(this: Layer, extension: FilterColorExtension) {
    const shaderModule = extension.opts

    return {
      modules: [shaderModule],
      inject: {
        'fs:DECKGL_FILTER_COLOR': `
          // TODO: Add texSize to geometry struct? Where to populate from?
          // TODO: Why does doubling geometry.uv help?
          color = ${shaderModule.name}_filterColor_ext(color, vec2(0., 0.), geometry.uv * 2.0);
        `,
      },
    }
  }

  getSubLayerProps(
    this: CompositeLayer<FilterColorExtensionProps>,
    extension: FilterColorExtension
  ): FilterColorExtensionProps {
    const name = extension.opts.name
    // Only pass extension uniforms down to sublayers.
    return { [name]: this.props[name] }
  }

  updateState(
    this: Layer<FilterColorExtensionProps>,
    params: UpdateParameters<Layer<FilterColorExtensionProps>>,
    extension: FilterColorExtension
  ) {
    const { props } = params
    const name = extension.opts.name
    // Add defaults
    const extensionUniforms = extension.opts.getUniforms?.(props[name]) || {}
    const userUniforms = props[name]
    const uniforms: Uniforms = {
      ...extensionUniforms,
      ...userUniforms,
    }

    // Use the new v9 API for setting shader module props
    this.setShaderModuleProps({
      [name]: uniforms,
    })
  }
}
