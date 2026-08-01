import { describe, expect, it } from 'vitest'
import { TextLayerOp } from './operators'

function getInputProps(op: TextLayerOp) {
  return Object.fromEntries(Object.entries(op.inputs).map(([key, field]) => [key, field.value]))
}

describe('TextLayerOp', () => {
  it('exposes Deck.gl text background, border, and outline defaults', () => {
    const op = new TextLayerOp('/text')
    const { layer } = op.execute(getInputProps(op))

    expect(layer.background).toBe(false)
    expect(layer.getBackgroundColor).toEqual([255, 255, 255, 255])
    expect(layer.getBorderColor).toEqual([0, 0, 0, 255])
    expect(layer.getBorderWidth).toBe(0)
    expect(layer.backgroundPadding).toEqual([0, 0])
    expect(layer.backgroundBorderRadius).toBe(0)
    expect(layer.outlineWidth).toBe(0)
    expect(layer.outlineColor).toEqual([0, 0, 0, 255])
  })

  it('passes text background, border, outline, sizing, and wrapping props through', () => {
    const op = new TextLayerOp('/text')

    op.inputs.background.setValue(true)
    op.inputs.getBackgroundColor.setValue('#112233cc')
    op.inputs.getBorderColor.setValue('#445566ff')
    op.inputs.getBorderWidth.setValue(2)
    op.inputs.backgroundPadding.setValue([8, 4])
    op.inputs.backgroundBorderRadius.setValue(6)
    op.inputs.outlineWidth.setValue(0.2)
    op.inputs.outlineColor.setValue('#778899ff')
    op.inputs.sizeUnits.setValue('common')
    op.inputs.sizeScale.setValue(2)
    op.inputs.sizeMinPixels.setValue(10)
    op.inputs.sizeMaxPixels.setValue(100)
    op.inputs.lineHeight.setValue(1.25)
    op.inputs.wordBreak.setValue('break-all')
    op.inputs.maxWidth.setValue(12)
    op.inputs.characterSet.setValue('auto')

    const { layer } = op.execute(getInputProps(op))

    expect(layer).toMatchObject({
      background: true,
      getBackgroundColor: [17, 34, 51, 204],
      getBorderColor: [68, 85, 102, 255],
      getBorderWidth: 2,
      backgroundPadding: [8, 4],
      backgroundBorderRadius: 6,
      outlineWidth: 0.2,
      outlineColor: [119, 136, 153, 255],
      sizeUnits: 'common',
      sizeScale: 2,
      sizeMinPixels: 10,
      sizeMaxPixels: 100,
      lineHeight: 1.25,
      wordBreak: 'break-all',
      maxWidth: 12,
      characterSet: 'auto',
    })
  })

  it('tracks accessor-backed background props in update triggers', () => {
    const op = new TextLayerOp('/text')
    const backgroundColor = () => [255, 0, 0, 255]
    const borderColor = () => [0, 255, 0, 255]
    const borderWidth = () => 3

    op.inputs.getBackgroundColor.setValue(backgroundColor)
    op.inputs.getBorderColor.setValue(borderColor)
    op.inputs.getBorderWidth.setValue(borderWidth)

    const { layer } = op.execute(getInputProps(op))

    expect(layer.updateTriggers).toEqual(
      expect.objectContaining({
        getBackgroundColor: [expect.any(Function)],
        getBorderColor: [expect.any(Function)],
        getBorderWidth: [expect.any(Function)],
      })
    )
  })
})
