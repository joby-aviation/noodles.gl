import { describe, expect, it } from 'vitest'
import { DECK_OP_INDEX, registerDeckOperators } from '../../runtime/deck-ops'
import { Mask3DExtension } from './mask-3d-extension'

describe('Mask3DExtension', () => {
  // deck.gl keys its merged default props cache on extensionName
  it('sets its own extensionName, which componentName reads', () => {
    expect(Object.hasOwn(Mask3DExtension, 'extensionName')).toBe(true)
    expect(Mask3DExtension.componentName).toBe('Mask3DExtension')
  })
})

// Rendering is covered in extensions.test.ts
describe('the Mask 3D Extension operator', () => {
  it('passes the lng/lat/alt target and radii through to the extension', () => {
    registerDeckOperators()
    const extension = DECK_OP_INDEX.get('mask-3d-extension')?.build(
      { targetPosition: [-118.2637, 34.0171, 50], innerRadius: 500, fadeRange: 10 },
      'mask',
      { surface: { width: 800, height: 600 } }
    )

    expect(extension).toEqual({
      extension: { type: 'Mask3DExtension' },
      props: { targetPosition: [-118.2637, 34.0171, 50], innerRadius: 500, fadeRange: 10 },
    })
  })
})
