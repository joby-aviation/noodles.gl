import { describe, expect, it, vi } from 'vitest'
import { FileUrlField } from './fields'
import { IconLayerOp } from './operators'

describe('IconLayerOp Upload Support', () => {
  it('iconAtlas should be a FileUrlField', () => {
    const op = new IconLayerOp('/test-icon-layer')

    expect(op.inputs.iconAtlas).toBeInstanceOf(FileUrlField)
  })

  it('iconAtlas should accept image file types', () => {
    const op = new IconLayerOp('/test-icon-layer')
    const iconAtlasField = op.inputs.iconAtlas as FileUrlField

    expect(iconAtlasField.accept).toBe('.png,.jpg,.jpeg,.gif,.webp,.svg')
  })

  it('iconAtlas should have default CDN URL', () => {
    const op = new IconLayerOp('/test-icon-layer')

    expect(op.inputs.iconAtlas.value).toBe(
      'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png'
    )
  })

  it('iconAtlas should accept custom URLs (backward compatibility)', () => {
    const op = new IconLayerOp('/test-icon-layer')

    op.inputs.iconAtlas.setValue('https://example.com/custom-icons.png')
    expect(op.inputs.iconAtlas.value).toBe('https://example.com/custom-icons.png')
  })

  it('iconAtlas should accept project-relative URLs', () => {
    const op = new IconLayerOp('/test-icon-layer')

    op.inputs.iconAtlas.setValue('@/my-icons.png')
    expect(op.inputs.iconAtlas.value).toBe('@/my-icons.png')
  })

  it('should execute with default CDN URLs', async () => {
    const op = new IconLayerOp('/test-icon-layer')

    op.inputs.data.setValue([{ name: 'Point 1', lat: 37.7849, lng: -122.4294 }])
    op.inputs.getPosition.setValue([0, 0])

    const result = await op.execute({
      data: op.inputs.data.value,
      visible: true,
      opacity: 1,
      getPosition: op.inputs.getPosition.value,
      iconAtlas: op.inputs.iconAtlas.value,
      iconMapping: op.inputs.iconMapping.value,
      billboard: true,
      getIcon: null,
      getSize: 1,
      sizeUnits: 'pixels',
      sizeScale: 1,
      sizeMinPixels: 0,
      sizeMaxPixels: 100,
      getPixelOffset: [0, 0],
      getColor: [255, 255, 255, 255],
      getAngle: 0,
      sizeBasis: 'pixels',
      parameters: { depthTest: true },
      extensions: [],
    })

    expect(result.layer.type).toBe('IconLayer')
    expect(result.layer.iconAtlas).toBe(
      'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png'
    )
  })

  it('should execute with project-relative iconAtlas URL', async () => {
    const op = new IconLayerOp('/test-icon-layer')

    op.inputs.data.setValue([{ name: 'Point 1', lat: 37.7849, lng: -122.4294 }])
    op.inputs.getPosition.setValue([0, 0])
    op.inputs.iconAtlas.setValue('@/custom-icons.png')

    // This test will fail without a loaded project since we can't resolve @/ URLs
    // In a real scenario with a loaded project, the @/ URL would be resolved to a blob URL
    await expect(
      op.execute({
        data: op.inputs.data.value,
        visible: true,
        opacity: 1,
        getPosition: op.inputs.getPosition.value,
        iconAtlas: '@/custom-icons.png',
        iconMapping: op.inputs.iconMapping.value,
        billboard: true,
        getIcon: '',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 100,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })
    ).rejects.toThrow('No project loaded')
  })

  it('getIcon should be a FileUrlField', () => {
    const op = new IconLayerOp('/test-icon-layer')

    expect(op.inputs.getIcon).toBeInstanceOf(FileUrlField)
  })

  it('getIcon should accept image file types', () => {
    const op = new IconLayerOp('/test-icon-layer')
    const getIconField = op.inputs.getIcon as FileUrlField

    expect(getIconField.accept).toBe('.png,.jpg,.jpeg,.gif,.webp,.svg')
  })

  it('should use simple icon mode with getIcon URL', async () => {
    const op = new IconLayerOp('/test-icon-layer')

    op.inputs.data.setValue([{ name: 'Point 1', lat: 37.7849, lng: -122.4294 }])
    op.inputs.getPosition.setValue([0, 0])
    op.inputs.getIcon.setValue('https://example.com/marker.png')

    const result = await op.execute({
      data: op.inputs.data.value,
      visible: true,
      opacity: 1,
      getPosition: op.inputs.getPosition.value,
      iconAtlas: op.inputs.iconAtlas.value,
      iconMapping: op.inputs.iconMapping.value,
      billboard: true,
      getIcon: 'https://example.com/marker.png',
      getSize: 1,
      sizeUnits: 'pixels',
      sizeScale: 1,
      sizeMinPixels: 0,
      sizeMaxPixels: 100,
      getPixelOffset: [0, 0],
      getColor: [255, 255, 255, 255],
      getAngle: 0,
      sizeBasis: 'pixels',
      parameters: { depthTest: true },
      extensions: [],
    })

    expect(result.layer.type).toBe('IconLayer')
    expect(typeof result.layer.getIcon).toBe('function')
    // Test that the accessor returns the URL
    const iconResult = (result.layer.getIcon as () => string)()
    expect(iconResult).toBe('https://example.com/marker.png')
  })

  it('should use accessor function mode with getIcon function', async () => {
    const op = new IconLayerOp('/test-icon-layer')

    op.inputs.data.setValue([{ name: 'Point 1', lat: 37.7849, lng: -122.4294 }])
    op.inputs.getPosition.setValue([0, 0])

    const getIconFn = vi.fn((d: any) => `https://example.com/${d.name}.png`)

    const result = await op.execute({
      data: op.inputs.data.value,
      visible: true,
      opacity: 1,
      getPosition: op.inputs.getPosition.value,
      iconAtlas: op.inputs.iconAtlas.value,
      iconMapping: op.inputs.iconMapping.value,
      billboard: true,
      getIcon: getIconFn,
      getSize: 1,
      sizeUnits: 'pixels',
      sizeScale: 1,
      sizeMinPixels: 0,
      sizeMaxPixels: 100,
      getPixelOffset: [0, 0],
      getColor: [255, 255, 255, 255],
      getAngle: 0,
      sizeBasis: 'pixels',
      parameters: { depthTest: true },
      extensions: [],
    })

    expect(result.layer.type).toBe('IconLayer')
    expect(result.layer.getIcon).toBe(getIconFn)
  })
})
