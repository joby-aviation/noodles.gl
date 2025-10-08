import { beforeEach, describe, expect, it } from 'vitest'
import { opMap } from '../store'
import { nodeId } from './id-utils'

describe('nodeId', () => {
  beforeEach(() => {
    opMap.clear()
  })

  describe('root level operators', () => {
    it('returns the qualified path when no ids exist', () => {
      expect(opMap.get('/test')).toBeUndefined()
      expect(nodeId('test')).toBe('/test')
    })

    it('generates a unique id when ids exist', () => {
      opMap.set('/test', {})
      expect(opMap.get('/test-1')).toBeUndefined()
      expect(nodeId('test')).toBe('/test-1')

      opMap.set('/test-1', {})
      expect(opMap.get('/test-2')).toBeUndefined()
      expect(nodeId('test')).toBe('/test-2')
    })

    it('handles explicit root containerId "/"', () => {
      expect(nodeId('test', '/')).toBe('/test')

      opMap.set('/test', {})
      expect(nodeId('test', '/')).toBe('/test-1')

      opMap.set('/test-1', {})
      expect(nodeId('test', '/')).toBe('/test-2')
    })
  })

  describe('container level operators', () => {
    it('returns the qualified path when no ids exist in container', () => {
      expect(opMap.get('/container/test')).toBeUndefined()
      expect(nodeId('test', 'container')).toBe('/container/test')
    })

    it('generates unique ids within container context', () => {
      opMap.set('/container/test', {})
      expect(nodeId('test', 'container')).toBe('/container/test-1')

      opMap.set('/container/test-1', {})
      expect(nodeId('test', 'container')).toBe('/container/test-2')
    })

    it('handles container ID with leading slash', () => {
      expect(nodeId('test', '/container')).toBe('/container/test')
    })

    it('allows same base name in different containers', () => {
      opMap.set('/container1/test', {})
      opMap.set('/container2/test', {})

      expect(nodeId('test', 'container1')).toBe('/container1/test-1')
      expect(nodeId('test', 'container2')).toBe('/container2/test-1')
      expect(nodeId('test', 'container3')).toBe('/container3/test')
    })
  })

  describe('nested containers', () => {
    it('handles deeply nested containers', () => {
      expect(nodeId('test', '/parent/child')).toBe('/parent/child/test')

      opMap.set('/parent/child/test', {})
      expect(nodeId('test', '/parent/child')).toBe('/parent/child/test-1')
    })
  })

  describe('real-world scenario', () => {
    it('handles the boolean operator clobbering case', () => {
      // Simulate: user adds boolean, boolean-1, then boolean-1 gets removed but boolean-2 should be next
      opMap.set('/boolean', {})
      expect(nodeId('boolean', '/')).toBe('/boolean-1')

      opMap.set('/boolean-1', {})
      expect(nodeId('boolean', '/')).toBe('/boolean-2')

      // Simulate boolean-1 gets removed (but boolean stays)
      opMap.delete('/boolean-1')
      expect(nodeId('boolean', '/')).toBe('/boolean-1') // Should reuse the available slot
    })
  })
})
