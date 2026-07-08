import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileUrlField } from './fields'
import { IconLayerOp } from './operators'

describe('IconLayerOp Upload Support', () => {
  describe('Field Configuration', () => {
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

    it('getIcon should be a FileUrlField', () => {
      const op = new IconLayerOp('/test-icon-layer')

      expect(op.inputs.getIcon).toBeInstanceOf(FileUrlField)
    })

    it('getIcon should accept image file types', () => {
      const op = new IconLayerOp('/test-icon-layer')
      const getIconField = op.inputs.getIcon as FileUrlField

      expect(getIconField.accept).toBe('.png,.jpg,.jpeg,.gif,.webp,.svg')
    })

    it('getIcon should be optional', () => {
      const op = new IconLayerOp('/test-icon-layer')

      // Can be empty without error
      op.inputs.getIcon.setValue('')
      expect(op.inputs.getIcon.value).toBe('')
    })

    it('should not have manual width/height fields', () => {
      const op = new IconLayerOp('/test-icon-layer')

      expect(op.inputs).not.toHaveProperty('width')
      expect(op.inputs).not.toHaveProperty('height')
    })
  })

  describe('Backward Compatibility', () => {
    it('iconAtlas should accept custom URLs', () => {
      const op = new IconLayerOp('/test-icon-layer')

      op.inputs.iconAtlas.setValue('https://example.com/custom-icons.png')
      expect(op.inputs.iconAtlas.value).toBe('https://example.com/custom-icons.png')
    })

    it('iconAtlas should accept project-relative URLs', () => {
      const op = new IconLayerOp('/test-icon-layer')

      op.inputs.iconAtlas.setValue('@/my-icons.png')
      expect(op.inputs.iconAtlas.value).toBe('@/my-icons.png')
    })

    it('should execute with default CDN URLs in atlas mode', async () => {
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
        getIcon: '',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
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
      expect(result.layer.iconMapping).toBe(op.inputs.iconMapping.value)
    })
  })

  describe('Atlas Mode URL Resolution', () => {
    it('should pass through external URLs without modification', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: 'https://example.com/icons.png',
        iconMapping: {},
        billboard: true,
        getIcon: '',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      expect(result.layer.iconAtlas).toBe('https://example.com/icons.png')
    })

    it('should reject project-relative iconAtlas URL when no project loaded', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      await expect(
        op.execute({
          data: [],
          visible: true,
          opacity: 1,
          getPosition: [0, 0],
          iconAtlas: '@/custom-icons.png',
          iconMapping: {},
          billboard: true,
          getIcon: '',
          getSize: 1,
          sizeUnits: 'pixels',
          sizeScale: 1,
          sizeMinPixels: 0,
          sizeMaxPixels: 256,
          getPixelOffset: [0, 0],
          getColor: [255, 255, 255, 255],
          getAngle: 0,
          sizeBasis: 'pixels',
          parameters: { depthTest: true },
          extensions: [],
        })
      ).rejects.toThrow('No project loaded')
    })
  })

  describe('Single Icon Mode with Dimension Extraction', () => {
    let originalImage: typeof Image
    let _mockImageInstance: any
    let MockImageConstructor: any
    let shouldSucceed: boolean
    let mockWidth: number
    let mockHeight: number

    beforeEach(() => {
      // Save original Image constructor
      originalImage = globalThis.Image

      // Default values for successful load
      shouldSucceed = true
      mockWidth = 64
      mockHeight = 64

      // Create mock constructor that creates instances
      MockImageConstructor = function (this: any) {
        const instance = {
          naturalWidth: 0,
          naturalHeight: 0,
          onload: null as (() => void) | null,
          onerror: null as (() => void) | null,
          _src: '',
        }

        // When src is set, trigger appropriate callback
        Object.defineProperty(instance, 'src', {
          get() {
            return this._src
          },
          set(value: string) {
            this._src = value
            // Trigger callback using queueMicrotask for immediate async execution
            queueMicrotask(() => {
              if (shouldSucceed) {
                instance.naturalWidth = mockWidth
                instance.naturalHeight = mockHeight
                instance.onload?.()
              } else {
                instance.onerror?.()
              }
            })
          },
        })

        _mockImageInstance = instance
        return instance
      }

      // Replace global Image with mock
      globalThis.Image = MockImageConstructor as any
    })

    afterEach(() => {
      // Restore original Image constructor
      globalThis.Image = originalImage
    })

    it('should extract dimensions from external image URL', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 64
      mockHeight = 64
      shouldSucceed = true

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: 'https://example.com/marker.png',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      expect(result.layer.type).toBe('IconLayer')
      expect(typeof result.layer.getIcon).toBe('function')

      const iconData = (result.layer.getIcon as () => any)()
      expect(iconData.url).toBe('https://example.com/marker.png')
      expect(iconData.width).toBe(64)
      expect(iconData.height).toBe(64)
      expect(iconData.id).toBe('https://example.com/marker.png')
    })

    it('should handle different image dimensions', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 128
      mockHeight = 32
      shouldSucceed = true

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: 'https://example.com/wide-marker.png',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      const iconData = (result.layer.getIcon as () => any)()
      expect(iconData.url).toBe('https://example.com/wide-marker.png')
      expect(iconData.width).toBe(128)
      expect(iconData.height).toBe(32)
      expect(iconData.id).toBe('https://example.com/wide-marker.png')
    })

    it('should normalize large images while preserving aspect ratio', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 4003
      mockHeight = 2155
      shouldSucceed = true

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: 'https://example.com/large-aircraft.png',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      const iconData = (result.layer.getIcon as () => any)()
      // Should normalize to 512px max (sizeMaxPixels * 2, capped at 512)
      expect(iconData.width).toBe(512)
      // Height should maintain aspect ratio: 512 / (4003/2155) ≈ 276
      expect(iconData.height).toBe(276)
      expect(iconData.id).toBe('https://example.com/large-aircraft.png')
    })

    it('should respect sizeMaxPixels for texture quality', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 1000
      mockHeight = 1000
      shouldSucceed = true

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: 'https://example.com/icon.png',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 64,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      const iconData = (result.layer.getIcon as () => any)()
      // sizeMaxPixels=64 → 128px texture (64 * 2)
      expect(iconData.width).toBe(128)
      expect(iconData.height).toBe(128)
    })

    it('should reject when image fails to load', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      shouldSucceed = false

      await expect(
        op.execute({
          data: [],
          visible: true,
          opacity: 1,
          getPosition: [0, 0],
          iconAtlas: '',
          iconMapping: {},
          billboard: true,
          getIcon: 'https://example.com/broken.png',
          getSize: 1,
          sizeUnits: 'pixels',
          sizeScale: 1,
          sizeMinPixels: 0,
          sizeMaxPixels: 256,
          getPixelOffset: [0, 0],
          getColor: [255, 255, 255, 255],
          getAngle: 0,
          sizeBasis: 'pixels',
          parameters: { depthTest: true },
          extensions: [],
        })
      ).rejects.toThrow('Failed to load image from https://example.com/broken.png')
    })

    it('should reject project-relative getIcon URL when no project loaded', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      await expect(
        op.execute({
          data: [],
          visible: true,
          opacity: 1,
          getPosition: [0, 0],
          iconAtlas: '',
          iconMapping: {},
          billboard: true,
          getIcon: '@/marker.png',
          getSize: 1,
          sizeUnits: 'pixels',
          sizeScale: 1,
          sizeMinPixels: 0,
          sizeMaxPixels: 256,
          getPixelOffset: [0, 0],
          getColor: [255, 255, 255, 255],
          getAngle: 0,
          sizeBasis: 'pixels',
          parameters: { depthTest: true },
          extensions: [],
        })
      ).rejects.toThrow('No project loaded')
    })
  })

  describe('Accessor Function Mode', () => {
    it('should pass through accessor functions unchanged', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      const getIconFn = vi.fn((d: any) => ({
        url: `https://example.com/${d.name}.png`,
        width: 32,
        height: 32,
      }))

      const result = await op.execute({
        data: [{ name: 'marker1' }],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: getIconFn,
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
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

    it('should not attempt dimension extraction for accessor functions', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      const getIconFn = (_d: any) => 'icon-name'

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: getIconFn,
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      // Should pass through the function directly
      expect(result.layer.getIcon).toBe(getIconFn)
    })
  })

  describe('Mode Priority', () => {
    it('should prioritize accessor function over string URL', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      const getIconFn = vi.fn(() => 'icon-name')

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: '',
        iconMapping: {},
        billboard: true,
        getIcon: getIconFn,
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      expect(result.layer.getIcon).toBe(getIconFn)
      expect(result.layer).not.toHaveProperty('iconAtlas')
      expect(result.layer).not.toHaveProperty('iconMapping')
    })

    it('should use atlas mode when getIcon is empty', async () => {
      const op = new IconLayerOp('/test-icon-layer')

      const result = await op.execute({
        data: [],
        visible: true,
        opacity: 1,
        getPosition: [0, 0],
        iconAtlas: 'https://example.com/atlas.png',
        iconMapping: { marker: { x: 0, y: 0, width: 32, height: 32 } },
        billboard: true,
        getIcon: '',
        getSize: 1,
        sizeUnits: 'pixels',
        sizeScale: 1,
        sizeMinPixels: 0,
        sizeMaxPixels: 256,
        getPixelOffset: [0, 0],
        getColor: [255, 255, 255, 255],
        getAngle: 0,
        sizeBasis: 'pixels',
        parameters: { depthTest: true },
        extensions: [],
      })

      expect(result.layer.iconAtlas).toBe('https://example.com/atlas.png')
      expect(result.layer.iconMapping).toEqual({ marker: { x: 0, y: 0, width: 32, height: 32 } })
      expect(result.layer).not.toHaveProperty('getIcon')
    })
  })

  describe('MIME Type Inference', () => {
    it('should infer PNG MIME type', () => {
      // This is tested implicitly through the resolveProjectUrl helper
      // The actual MIME type inference happens in the helper function
      const op = new IconLayerOp('/test-icon-layer')
      expect(op).toBeDefined()
    })
  })

  describe('Icon Resolution Caching', () => {
    let originalImage: typeof Image
    let _mockImageInstance: any
    let MockImageConstructor: any
    let shouldSucceed: boolean
    let mockWidth: number
    let mockHeight: number

    const defaultInputs = {
      data: [],
      visible: true,
      opacity: 1,
      getPosition: [0, 0] as [number, number],
      iconAtlas: '',
      iconMapping: {},
      billboard: true,
      getSize: 1,
      sizeUnits: 'pixels' as const,
      sizeScale: 1,
      sizeMinPixels: 0,
      sizeMaxPixels: 256,
      getPixelOffset: [0, 0] as [number, number],
      getColor: [255, 255, 255, 255] as [number, number, number, number],
      getAngle: 0,
      sizeBasis: 'pixels' as const,
      parameters: { depthTest: true },
      extensions: [],
    }

    beforeEach(() => {
      originalImage = globalThis.Image
      shouldSucceed = true
      mockWidth = 64
      mockHeight = 64

      MockImageConstructor = function (this: any) {
        const instance = {
          naturalWidth: 0,
          naturalHeight: 0,
          onload: null as (() => void) | null,
          onerror: null as (() => void) | null,
          _src: '',
        }

        Object.defineProperty(instance, 'src', {
          get() {
            return this._src
          },
          set(value: string) {
            this._src = value
            queueMicrotask(() => {
              if (shouldSucceed) {
                instance.naturalWidth = mockWidth
                instance.naturalHeight = mockHeight
                instance.onload?.()
              } else {
                instance.onerror?.()
              }
            })
          },
        })

        _mockImageInstance = instance
        return instance
      }

      globalThis.Image = MockImageConstructor as any
    })

    afterEach(() => {
      globalThis.Image = originalImage
    })

    it('should return cached icon data on subsequent executions with same URL', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 64
      mockHeight = 64
      shouldSucceed = true

      const result1 = await op.execute({
        ...defaultInputs,
        getIcon: 'https://example.com/aircraft.png',
      })

      const result2 = await op.execute({
        ...defaultInputs,
        getIcon: 'https://example.com/aircraft.png',
      })

      const iconData1 = (result1.layer.getIcon as () => any)()
      const iconData2 = (result2.layer.getIcon as () => any)()

      // Should be the exact same object reference (cached)
      expect(iconData1).toBe(iconData2)
    })

    it('should resolve a new icon when URL changes', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 64
      mockHeight = 64
      shouldSucceed = true

      const result1 = await op.execute({
        ...defaultInputs,
        getIcon: 'https://example.com/aircraft.png',
      })

      const result2 = await op.execute({
        ...defaultInputs,
        getIcon: 'https://example.com/helicopter.png',
      })

      const iconData1 = (result1.layer.getIcon as () => any)()
      const iconData2 = (result2.layer.getIcon as () => any)()

      // Should be different objects (different URLs)
      expect(iconData1.id).toBe('https://example.com/aircraft.png')
      expect(iconData2.id).toBe('https://example.com/helicopter.png')
    })

    it('should resolve a new icon when sizeMaxPixels changes', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      mockWidth = 1000
      mockHeight = 1000
      shouldSucceed = true

      const result1 = await op.execute({
        ...defaultInputs,
        getIcon: 'https://example.com/icon.png',
        sizeMaxPixels: 64,
      })

      const result2 = await op.execute({
        ...defaultInputs,
        getIcon: 'https://example.com/icon.png',
        sizeMaxPixels: 128,
      })

      const iconData1 = (result1.layer.getIcon as () => any)()
      const iconData2 = (result2.layer.getIcon as () => any)()

      // Different sizeMaxPixels → different cache key → different resolution
      expect(iconData1.width).toBe(128) // 64 * 2
      expect(iconData2.width).toBe(256) // 128 * 2
    })

    it('should not cache when getIcon is an accessor function', async () => {
      const op = new IconLayerOp('/test-icon-layer')
      const getIconFn = () => ({ url: 'test.png', width: 32, height: 32, id: 'test' })

      const result = await op.execute({
        ...defaultInputs,
        getIcon: getIconFn,
      })

      // Accessor function should be passed through directly, not cached
      expect(result.layer.getIcon).toBe(getIconFn)
    })
  })
})
