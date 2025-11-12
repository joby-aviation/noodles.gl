import { beforeEach, describe, expect, it } from 'vitest'
import { clearOps, deleteOp, getOp, setOp } from '../store'
import { nodeId } from './id-utils'

describe('nodeId', () => {
  beforeEach(() => {
    clearOps()
  })

  describe('root level operators', () => {
    it('returns the qualified path when no ids exist', () => {
      expect(getOp('/test')).toBeUndefined()
      expect(nodeId('test')).toBe('/test')
    })

    it('generates a unique id when ids exist', () => {
      setOp('/test', {})
      expect(getOp('/test-1')).toBeUndefined()
      expect(nodeId('test')).toBe('/test-1')

      setOp('/test-1', {})
      expect(getOp('/test-2')).toBeUndefined()
      expect(nodeId('test')).toBe('/test-2')
    })

    it('handles explicit root containerId "/"', () => {
      expect(nodeId('test', '/')).toBe('/test')

      setOp('/test', {})
      expect(nodeId('test', '/')).toBe('/test-1')

      setOp('/test-1', {})
      expect(nodeId('test', '/')).toBe('/test-2')
    })
  })

  describe('container level operators', () => {
    it('returns the qualified path when no ids exist in container', () => {
      expect(getOp('/container/test')).toBeUndefined()
      expect(nodeId('test', 'container')).toBe('/container/test')
    })

    it('generates unique ids within container context', () => {
      setOp('/container/test', {})
      expect(nodeId('test', 'container')).toBe('/container/test-1')

      setOp('/container/test-1', {})
      expect(nodeId('test', 'container')).toBe('/container/test-2')
    })

    it('handles container ID with leading slash', () => {
      expect(nodeId('test', '/container')).toBe('/container/test')
    })

    it('allows same base name in different containers', () => {
      setOp('/container1/test', {})
      setOp('/container2/test', {})

      expect(nodeId('test', 'container1')).toBe('/container1/test-1')
      expect(nodeId('test', 'container2')).toBe('/container2/test-1')
      expect(nodeId('test', 'container3')).toBe('/container3/test')
    })
  })

  describe('nested containers', () => {
    it('handles deeply nested containers', () => {
      expect(nodeId('test', '/parent/child')).toBe('/parent/child/test')

      setOp('/parent/child/test', {})
      expect(nodeId('test', '/parent/child')).toBe('/parent/child/test-1')
    })
  })

  describe('real-world scenario', () => {
    it('handles the boolean operator clobbering case', () => {
      // Simulate: user adds boolean, boolean-1, then boolean-1 gets removed but boolean-2 should be next
      setOp('/boolean', {})
      expect(nodeId('boolean', '/')).toBe('/boolean-1')

      setOp('/boolean-1', {})
      expect(nodeId('boolean', '/')).toBe('/boolean-2')

      // Simulate boolean-1 gets removed (but boolean stays)
      deleteOp('/boolean-1')
      expect(nodeId('boolean', '/')).toBe('/boolean-1') // Should reuse the available slot
    })
  })
})
