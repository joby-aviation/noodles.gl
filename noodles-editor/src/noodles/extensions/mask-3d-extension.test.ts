import { describe, expect, it } from 'vitest'
import { Mask3DExtensionOp } from '../operators'
import { toGeocentric, toMaskTargetPosition } from './mask-3d-extension'

const A = 6378137 // WGS84 semi-major axis
const B = 6356752.314245 // WGS84 semi-minor axis

function expectClose(actual: number[], expected: number[], digits = 3) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i], digits)
  })
}

describe('toGeocentric', () => {
  it('puts lng 0 on the equator on the X axis', () => {
    expectClose(toGeocentric(0, 0), [A, 0, 0])
  })

  it('puts lng 90 on the equator on the Y axis', () => {
    expectClose(toGeocentric(90, 0), [0, A, 0])
  })

  it('puts the north pole on the Z axis at the semi-minor axis', () => {
    expectClose(toGeocentric(0, 90), [0, 0, B])
  })

  it('adds the height along the surface normal', () => {
    expectClose(toGeocentric(0, 0, 100), [A + 100, 0, 0])
    expectClose(toGeocentric(0, 90, 100), [0, 0, B + 100])
  })

  it('matches PROJ for downtown Los Angeles', () => {
    // From PROJ: echo "34.0171 -118.2637 0" | cs2cs EPSG:4979 EPSG:4978
    expectClose(
      toGeocentric(-118.2637, 34.0171),
      [-2_506_015.753, -4_661_248.627, 3_548_018.904],
      2
    )
  })
})

describe('toMaskTargetPosition', () => {
  it('is ECEF with Y negated, to match the swizzles in the Y-up glTF shader', () => {
    const [x, y, z] = toGeocentric(-118.2637, 34.0171, 50)
    expectClose(toMaskTargetPosition(-118.2637, 34.0171, 50), [x, -y, z])
  })
})

describe('Mask3DExtensionOp', () => {
  it('converts the lng/lat/alt target to the shader frame', () => {
    const op = new Mask3DExtensionOp('/mask-3d')
    const { extension } = op.execute({
      targetPosition: [-118.2637, 34.0171, 50],
      innerRadius: 500,
      fadeRange: 10,
    })

    expect(extension.extension).toEqual({ type: 'Mask3DExtension' })
    expect(extension.props.innerRadius).toBe(500)
    expect(extension.props.fadeRange).toBe(10)
    expectClose(
      extension.props.targetPosition as number[],
      toMaskTargetPosition(-118.2637, 34.0171, 50)
    )
  })
})
