import { describe, expect, it } from 'vitest'
import {
  acceptsArrowTables,
  getCapabilities,
  isCompilableByCapability,
  producesArrowTables,
  registerCapabilities,
  registerSQLCompilableOperators,
} from './capabilities'

describe('Capabilities', () => {
  describe('registerCapabilities', () => {
    it('registers operator capabilities', () => {
      registerCapabilities('TestOp', {
        sqlCompilable: true,
        acceptsArrowTables: true,
        producesArrowTables: false,
      })

      const caps = getCapabilities('TestOp')
      expect(caps.sqlCompilable).toBe(true)
      expect(caps.acceptsArrowTables).toBe(true)
      expect(caps.producesArrowTables).toBe(false)
    })

    it('merges with default capabilities', () => {
      registerCapabilities('PartialOp', {
        sqlCompilable: true,
      })

      const caps = getCapabilities('PartialOp')
      expect(caps.sqlCompilable).toBe(true)
      expect(caps.acceptsArrowTables).toBe(false) // default
      expect(caps.producesArrowTables).toBe(false) // default
    })
  })

  describe('getCapabilities', () => {
    it('returns default capabilities for unknown operators', () => {
      const caps = getCapabilities('UnknownOp')
      expect(caps.sqlCompilable).toBe(false)
      expect(caps.acceptsArrowTables).toBe(false)
      expect(caps.producesArrowTables).toBe(false)
    })
  })

  describe('convenience functions', () => {
    it('isCompilableByCapability checks sqlCompilable flag', () => {
      registerCapabilities('CompilableOp', { sqlCompilable: true })
      registerCapabilities('NotCompilableOp', { sqlCompilable: false })

      expect(isCompilableByCapability('CompilableOp')).toBe(true)
      expect(isCompilableByCapability('NotCompilableOp')).toBe(false)
    })

    it('acceptsArrowTables checks acceptsArrowTables flag', () => {
      registerCapabilities('ArrowConsumer', { acceptsArrowTables: true })
      expect(acceptsArrowTables('ArrowConsumer')).toBe(true)
      expect(acceptsArrowTables('UnknownOp')).toBe(false)
    })

    it('producesArrowTables checks producesArrowTables flag', () => {
      registerCapabilities('ArrowProducer', { producesArrowTables: true })
      expect(producesArrowTables('ArrowProducer')).toBe(true)
      expect(producesArrowTables('UnknownOp')).toBe(false)
    })
  })

  describe('registerSQLCompilableOperators', () => {
    it('registers all SQL-compilable operators', () => {
      registerSQLCompilableOperators()

      // Check a few key operators
      expect(isCompilableByCapability('File')).toBe(true)
      expect(isCompilableByCapability('FilterOp')).toBe(true)
      expect(isCompilableByCapability('Sort')).toBe(true)

      // Boundary operators should not be compilable
      expect(isCompilableByCapability('CodeOp')).toBe(false)
      expect(isCompilableByCapability('ColorRamp')).toBe(false)
    })

    it('marks data processing operators as Arrow-compatible', () => {
      registerSQLCompilableOperators()

      // FilterOp should accept and produce Arrow Tables
      const filterCaps = getCapabilities('FilterOp')
      expect(filterCaps.acceptsArrowTables).toBe(true)
      expect(filterCaps.producesArrowTables).toBe(true)
    })
  })
})
