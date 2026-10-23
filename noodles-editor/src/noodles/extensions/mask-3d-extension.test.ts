import { describe, expect, it } from 'vitest'
import { Mask3DExtensionOp } from '../operators'

// Rendering is covered in extensions.test.ts
describe('Mask3DExtensionOp', () => {
  it('passes the lng/lat/alt target and radii through to the extension', () => {
    const op = new Mask3DExtensionOp('/mask-3d')
    const { extension } = op.execute({
      targetPosition: [-118.2637, 34.0171, 50],
      innerRadius: 500,
      fadeRange: 10,
    } as unknown as Parameters<Mask3DExtensionOp['execute']>[0])

    expect(extension).toEqual({
      extension: { type: 'Mask3DExtension' },
      props: { targetPosition: [-118.2637, 34.0171, 50], innerRadius: 500, fadeRange: 10 },
    })
  })
})
