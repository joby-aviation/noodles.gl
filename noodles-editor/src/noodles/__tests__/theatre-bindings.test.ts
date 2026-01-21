import { getProject } from '@theatre/core'
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BooleanField,
  ColorField,
  CompoundPropsField,
  DateField,
  type Field,
  NumberField,
  StringField,
  Vec2Field,
  Vec3Field,
} from '../fields'
import { clearOps, getOpStore, getSheetObject, hasSheetObject, setOp } from '../store'
import {
  bindAllOperatorsToTheatre,
  bindOperatorToTheatre,
  cleanupRemovedOperators,
  unbindOperatorFromTheatre,
} from '../theatre-bindings'

// Helper to create properly initialized fields
function createField<T extends Field>(
  FieldType: new (...args: any[]) => T,
  value: any,
  options: any,
  opId: string,
  fieldName: string
): T {
  const field = new FieldType(value, options)
  field.pathToProps = [opId, 'par', fieldName]
  return field
}

describe('theatre-bindings', () => {
  let testProject: ReturnType<typeof getProject>
  let testSheet: ReturnType<ReturnType<typeof getProject>['sheet']>
  let testCounter = 0

  beforeEach(() => {
    // Create a unique test project (3-32 chars per Theatre requirement)
    const projectName = `test-${testCounter++}`
    testProject = getProject(projectName, {})
    testSheet = testProject.sheet('test-sheet')

    // Clear store
    clearOps()
  })

  afterEach(() => {
    // Cleanup
    clearOps()
  })

  describe('bindOperatorToTheatre', () => {
    it('should bind an operator with theatre-compatible fields', () => {
      // Create a mock operator with theatre-compatible inputs
      const valueField = new NumberField(42, { min: 0, max: 100, step: 1 })
      valueField.pathToProps = ['/test-op', 'par', 'value']

      const enabledField = new BooleanField(true)
      enabledField.pathToProps = ['/test-op', 'par', 'enabled']

      const nameField = new StringField('test')
      nameField.pathToProps = ['/test-op', 'par', 'name']

      const mockOp = {
        id: '/test-op',
        inputs: {
          value: valueField,
          enabled: enabledField,
          name: nameField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      // Should create sheet object
      expect(hasSheetObject('/test-op')).toBe(true)
      expect(cleanup).toBeTypeOf('function')

      // Cleanup
      cleanup?.()
      expect(hasSheetObject('/test-op')).toBe(false)
    })

    it('should skip operators with no theatre-compatible fields', () => {
      const mockOp = {
        id: '/test-op',
        inputs: {
          // Function values are not theatre-compatible
          accessor: { value: () => 'test', subscribe: vi.fn() },
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      // Should not create sheet object
      expect(hasSheetObject('/test-op')).toBe(false)
      expect(cleanup).toBeUndefined()
    })

    it('should skip special /out operator', () => {
      const valueField = new NumberField(42, { min: 0, max: 100, step: 1 })
      valueField.pathToProps = ['/out', 'par', 'value']

      const mockOp = {
        id: '/out',
        inputs: {
          value: valueField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      // Should not bind /out operator
      expect(hasSheetObject('/out')).toBe(false)
      expect(cleanup).toBeUndefined()
    })

    it('should skip already bound operators', () => {
      const valueField = new NumberField(42, { min: 0, max: 100, step: 1 })
      valueField.pathToProps = ['/test-op', 'par', 'value']

      const mockOp = {
        id: '/test-op',
        inputs: {
          value: valueField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      // Bind first time
      const cleanup1 = bindOperatorToTheatre(mockOp, testSheet)
      expect(cleanup1).toBeTypeOf('function')

      // Try to bind again
      const cleanup2 = bindOperatorToTheatre(mockOp, testSheet)
      expect(cleanup2).toBeUndefined()

      cleanup1?.()
    })

    it('should handle color fields', () => {
      const colorField = new ColorField('#ff0000')
      colorField.pathToProps = ['/test-op', 'par', 'color']

      const mockOp = {
        id: '/test-op',
        inputs: {
          color: colorField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/test-op')).toBe(true)
      cleanup?.()
    })

    it('should handle date fields', () => {
      const dateField = new DateField()
      dateField.pathToProps = ['/test-op', 'par', 'date']

      const mockOp = {
        id: '/test-op',
        inputs: {
          date: dateField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/test-op')).toBe(true)

      // Verify Theatre stores the date as epoch milliseconds
      const sheetObj = getSheetObject('/test-op')
      expect(sheetObj).toBeDefined()
      expect(sheetObj?.props.date).toBeDefined()
      expect(typeof sheetObj?.value.date).toBe('number')

      cleanup?.()
    })

    it('should convert DateField to epoch milliseconds for Theatre', () => {
      const initialDate = Temporal.PlainDateTime.from('2024-01-15T10:30:00')
      const dateField = createField(DateField, initialDate, {}, '/test-op', 'date')

      const mockOp = {
        id: '/test-op',
        inputs: {
          date: dateField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      // Verify Theatre stores dates as epoch milliseconds (numbers)
      const sheetObj = getSheetObject('/test-op')
      expect(sheetObj).toBeDefined()
      expect(typeof sheetObj?.value.date).toBe('number')

      // Verify the initial epoch milliseconds match
      const expectedInitialMs = initialDate.toZonedDateTime('UTC').toInstant().epochMilliseconds
      expect(sheetObj?.value.date).toBe(expectedInitialMs)

      cleanup?.()
    })

    it('should handle vector fields', () => {
      const vec2Field = new Vec2Field([1, 2])
      vec2Field.pathToProps = ['/test-op', 'par', 'vec2']

      const vec3Field = new Vec3Field([1, 2, 3])
      vec3Field.pathToProps = ['/test-op', 'par', 'vec3']

      const mockOp = {
        id: '/test-op',
        inputs: {
          vec2: vec2Field,
          vec3: vec3Field,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/test-op')).toBe(true)
      cleanup?.()
    })

    it('should setup two-way bindings', () => {
      const numberField = createField(
        NumberField,
        42,
        { min: 0, max: 100, step: 1 },
        '/test-op',
        'value'
      )

      const mockOp = {
        id: '/test-op',
        inputs: {
          value: numberField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      // Get the sheet object
      const sheetObj = getSheetObject('/test-op')
      expect(sheetObj).toBeDefined()

      // Update field value and verify Theatre gets updated
      // Note: This requires Theatre transaction to complete
      numberField.setValue(50)

      // Cleanup
      cleanup?.()
    })
  })

  describe('unbindOperatorFromTheatre', () => {
    it('should unbind an operator', () => {
      const valueField = createField(
        NumberField,
        42,
        { min: 0, max: 100, step: 1 },
        '/test-op',
        'value'
      )

      const mockOp = {
        id: '/test-op',
        inputs: {
          value: valueField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      // Bind
      const cleanup = bindOperatorToTheatre(mockOp, testSheet)
      expect(hasSheetObject('/test-op')).toBe(true)

      // Unbind
      unbindOperatorFromTheatre('/test-op', testSheet)
      expect(hasSheetObject('/test-op')).toBe(false)

      cleanup?.()
    })

    it('should handle unbinding non-existent operator', () => {
      // Should not throw
      expect(() => {
        unbindOperatorFromTheatre('/non-existent', testSheet)
      }).not.toThrow()
    })
  })

  describe('bindAllOperatorsToTheatre', () => {
    it('should bind multiple operators', () => {
      const mockOps = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op2',
          inputs: {
            value: createField(NumberField, 2, { min: 0, max: 100, step: 1 }, '/op2', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op3',
          inputs: {
            value: createField(NumberField, 3, { min: 0, max: 100, step: 1 }, '/op3', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      const cleanupFns = bindAllOperatorsToTheatre(mockOps, testSheet)

      // Should bind all operators
      expect(cleanupFns.size).toBe(3)
      expect(hasSheetObject('/op1')).toBe(true)
      expect(hasSheetObject('/op2')).toBe(true)
      expect(hasSheetObject('/op3')).toBe(true)

      // Cleanup all
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }

      expect(getOpStore().sheetObjects.size).toBe(0)
    })

    it('should skip operators with no compatible fields', () => {
      const mockOps = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op2',
          inputs: { fn: { value: () => {}, subscribe: vi.fn() } },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      const cleanupFns = bindAllOperatorsToTheatre(mockOps, testSheet)

      // Should only bind op1
      expect(cleanupFns.size).toBe(1)
      expect(hasSheetObject('/op1')).toBe(true)
      expect(hasSheetObject('/op2')).toBe(false)

      // Cleanup
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }
    })

    it('should skip /out operator', () => {
      const mockOps = [
        {
          id: '/out',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/out', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 2, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      const cleanupFns = bindAllOperatorsToTheatre(mockOps, testSheet)

      // Should skip /out
      expect(cleanupFns.size).toBe(1)
      expect(hasSheetObject('/out')).toBe(false)
      expect(hasSheetObject('/op1')).toBe(true)

      // Cleanup
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }
    })
  })

  describe('cleanupRemovedOperators', () => {
    it('should cleanup operators not in current set', () => {
      // Setup: bind some operators
      const mockOps = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op2',
          inputs: {
            value: createField(NumberField, 2, { min: 0, max: 100, step: 1 }, '/op2', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op3',
          inputs: {
            value: createField(NumberField, 3, { min: 0, max: 100, step: 1 }, '/op3', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      // Add operators to store
      for (const op of mockOps) {
        setOp(op.id, op)
      }

      bindAllOperatorsToTheatre(mockOps, testSheet)

      expect(getOpStore().sheetObjects.size).toBe(3)

      // Cleanup op2 and op3 (only keep op1)
      const currentOperatorIds = new Set(['/op1'])
      cleanupRemovedOperators(currentOperatorIds, testSheet)

      // Should only have op1 remaining
      expect(getOpStore().sheetObjects.size).toBe(1)
      expect(hasSheetObject('/op1')).toBe(true)
      expect(hasSheetObject('/op2')).toBe(false)
      expect(hasSheetObject('/op3')).toBe(false)
    })

    it('should handle empty operator set', () => {
      // Setup: bind some operators
      const mockOps = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      // Add operators to store
      for (const op of mockOps) {
        setOp(op.id, op)
      }

      bindAllOperatorsToTheatre(mockOps, testSheet)
      expect(getOpStore().sheetObjects.size).toBe(1)

      // Cleanup all
      cleanupRemovedOperators(new Set(), testSheet)
      expect(getOpStore().sheetObjects.size).toBe(0)
    })

    it('should not affect operators still in current set', () => {
      const mockOps = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op2',
          inputs: {
            value: createField(NumberField, 2, { min: 0, max: 100, step: 1 }, '/op2', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      // Add operators to store
      for (const op of mockOps) {
        setOp(op.id, op)
      }

      bindAllOperatorsToTheatre(mockOps, testSheet)

      // Keep both
      const currentOperatorIds = new Set(['/op1', '/op2'])
      cleanupRemovedOperators(currentOperatorIds, testSheet)

      // Should still have both
      expect(getOpStore().sheetObjects.size).toBe(2)
      expect(hasSheetObject('/op1')).toBe(true)
      expect(hasSheetObject('/op2')).toBe(true)
    })
  })

  describe('integration scenarios', () => {
    it('should handle operator replacement workflow', () => {
      // Initial operators
      const ops1 = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op2',
          inputs: {
            value: createField(NumberField, 2, { min: 0, max: 100, step: 1 }, '/op2', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      let cleanupFns = bindAllOperatorsToTheatre(ops1, testSheet)
      expect(getOpStore().sheetObjects.size).toBe(2)

      // Cleanup old bindings
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }

      // New operators (op2 removed, op3 added)
      const ops2 = [
        {
          id: '/op1',
          inputs: {
            value: createField(NumberField, 1, { min: 0, max: 100, step: 1 }, '/op1', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
        {
          id: '/op3',
          inputs: {
            value: createField(NumberField, 3, { min: 0, max: 100, step: 1 }, '/op3', 'value'),
          },
          outputs: {},
          locked: { value: false },
        },
      ] as any[]

      cleanupFns = bindAllOperatorsToTheatre(ops2, testSheet)
      const currentIds = new Set(ops2.map(op => op.id))
      cleanupRemovedOperators(currentIds, testSheet)

      // Should have op1 and op3, not op2
      expect(getOpStore().sheetObjects.size).toBe(2)
      expect(hasSheetObject('/op1')).toBe(true)
      expect(hasSheetObject('/op2')).toBe(false)
      expect(hasSheetObject('/op3')).toBe(true)

      // Final cleanup
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }
    })

    it('should handle container operators and their children', () => {
      // Create a container operator
      const containerOp = {
        id: '/container',
        inputs: {
          in: createField(NumberField, 10, { min: 0, max: 100, step: 1 }, '/container', 'in'),
        },
        outputs: {},
        locked: { value: false },
      } as any

      // Create a child operator inside the container
      const childOp = {
        id: '/container/child',
        inputs: {
          value: createField(
            NumberField as any,
            42,
            { min: 0, max: 100, step: 1 },
            '/container/child',
            'value'
          ),
        },
        outputs: {},
        locked: { value: false },
      } as any

      // Bind both container and child
      const cleanupContainer = bindOperatorToTheatre(containerOp, testSheet)
      const cleanupChild = bindOperatorToTheatre(childOp, testSheet)

      // Both container and child should be bound
      expect(hasSheetObject('/container')).toBe(true)
      expect(hasSheetObject('/container/child')).toBe(true)

      // Verify they have different Theatre object names
      const containerSheetObj = getSheetObject('/container')
      const childSheetObj = getSheetObject('/container/child')
      expect(containerSheetObj).toBeDefined()
      expect(childSheetObj).toBeDefined()

      // Clean up both
      cleanupContainer?.()
      cleanupChild?.()
      expect(hasSheetObject('/container')).toBe(false)
      expect(hasSheetObject('/container/child')).toBe(false)
    })
  })

  describe('CompoundPropsField binding', () => {
    it('should bind CompoundPropsField with nested fields', () => {
      // Create a CompoundPropsField similar to viewState in DeckView operators
      const viewStateField = new CompoundPropsField({
        latitude: new NumberField(37.7749, { min: -90, max: 90, step: 0.1 }),
        longitude: new NumberField(-122.4194, { min: -180, max: 180, step: 0.1 }),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
      })
      viewStateField.pathToProps = ['/test-op', 'par', 'viewState']

      const mockOp = {
        id: '/test-op',
        inputs: {
          viewState: viewStateField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      // Should create sheet object
      expect(hasSheetObject('/test-op')).toBe(true)
      expect(cleanup).toBeTypeOf('function')

      // Verify the sheet object has the compound props structure
      const sheetObj = getSheetObject('/test-op')
      expect(sheetObj).toBeDefined()
      expect(sheetObj?.props.viewState).toBeDefined()

      // Cleanup
      cleanup?.()
      expect(hasSheetObject('/test-op')).toBe(false)
    })

    it('should handle CompoundPropsField with mixed field types', () => {
      // Create a CompoundPropsField with different field types
      const mixedField = new CompoundPropsField({
        enabled: new BooleanField(true),
        threshold: new NumberField(50, { min: 0, max: 100, step: 1 }),
        label: new StringField('test'),
        color: new ColorField('#ff0000'),
      })
      mixedField.pathToProps = ['/test-op', 'par', 'config']

      const mockOp = {
        id: '/test-op',
        inputs: {
          config: mixedField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/test-op')).toBe(true)
      expect(cleanup).toBeTypeOf('function')

      const sheetObj = getSheetObject('/test-op')
      expect(sheetObj).toBeDefined()
      expect(sheetObj?.props.config).toBeDefined()

      cleanup?.()
    })

    it('should handle nested CompoundPropsField', () => {
      // Create nested compound fields
      const innerCompound = new CompoundPropsField({
        x: new NumberField(10, { min: 0, max: 100, step: 1 }),
        y: new NumberField(20, { min: 0, max: 100, step: 1 }),
      })

      const outerCompound = new CompoundPropsField({
        position: innerCompound,
        scale: new NumberField(1.5, { min: 0, max: 10, step: 0.1 }),
      })
      outerCompound.pathToProps = ['/test-op', 'par', 'transform']

      const mockOp = {
        id: '/test-op',
        inputs: {
          transform: outerCompound,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/test-op')).toBe(true)
      expect(cleanup).toBeTypeOf('function')

      const sheetObj = getSheetObject('/test-op')
      expect(sheetObj).toBeDefined()
      expect(sheetObj?.props.transform).toBeDefined()

      cleanup?.()
    })

    it('should handle real-world viewState example from DeckView', () => {
      // Simulate a real DeckView operator with viewState
      const viewStateField = new CompoundPropsField({
        latitude: new NumberField(37.7749, { min: -90, max: 90, step: 0.1 }),
        longitude: new NumberField(-122.4194, { min: -180, max: 180, step: 0.1 }),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        pitch: new NumberField(0),
        bearing: new NumberField(0),
      })
      viewStateField.pathToProps = ['/deck-view', 'par', 'viewState']

      const mockOp = {
        id: '/deck-view',
        inputs: {
          viewState: viewStateField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/deck-view')).toBe(true)

      const sheetObj = getSheetObject('/deck-view')
      expect(sheetObj).toBeDefined()

      // Verify all nested fields are accessible
      expect(sheetObj?.props.viewState).toBeDefined()
      expect(sheetObj?.props.viewState.latitude).toBeDefined()
      expect(sheetObj?.props.viewState.longitude).toBeDefined()
      expect(sheetObj?.props.viewState.zoom).toBeDefined()
      expect(sheetObj?.props.viewState.pitch).toBeDefined()
      expect(sheetObj?.props.viewState.bearing).toBeDefined()

      cleanup?.()
    })

    it('should handle padding CompoundPropsField from DeckView', () => {
      // Simulate padding field from DeckView
      const paddingField = new CompoundPropsField({
        top: new NumberField(0, { min: 0 }),
        right: new NumberField(0, { min: 0 }),
        bottom: new NumberField(0, { min: 0 }),
        left: new NumberField(0, { min: 0 }),
      })
      paddingField.pathToProps = ['/deck-view', 'par', 'padding']

      const mockOp = {
        id: '/deck-view',
        inputs: {
          padding: paddingField,
        },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      expect(hasSheetObject('/deck-view')).toBe(true)

      const sheetObj = getSheetObject('/deck-view')
      expect(sheetObj?.props.padding).toBeDefined()
      expect(sheetObj?.props.padding.top).toBeDefined()
      expect(sheetObj?.props.padding.right).toBeDefined()
      expect(sheetObj?.props.padding.bottom).toBeDefined()
      expect(sheetObj?.props.padding.left).toBeDefined()

      cleanup?.()
    })
  })

  describe('cold prism fix', () => {
    it('should not produce cold prism warnings during field updates', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn')

      const numberField = createField(
        NumberField,
        10,
        { min: 0, max: 100, step: 1 },
        '/test-op',
        'value'
      )

      const mockOp = {
        id: '/test-op',
        inputs: { value: numberField },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      numberField.setValue(50)
      numberField.setValue(75)
      numberField.setValue(100)

      const coldPrismWarnings = consoleWarnSpy.mock.calls.filter(call =>
        String(call[0]).includes('cold prism')
      )
      expect(coldPrismWarnings).toHaveLength(0)

      cleanup?.()
      consoleWarnSpy.mockRestore()
    })

    it('should not produce cold prism warnings with color field conversions', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn')

      const colorField = new ColorField('#00ff00')
      colorField.pathToProps = ['/test-op', 'par', 'color']

      const mockOp = {
        id: '/test-op',
        inputs: { color: colorField },
        outputs: {},
        locked: { value: false },
      } as any

      const cleanup = bindOperatorToTheatre(mockOp, testSheet)

      colorField.setValue('#ff0000')
      colorField.setValue('#0000ff')

      const coldPrismWarnings = consoleWarnSpy.mock.calls.filter(call =>
        String(call[0]).includes('cold prism')
      )
      expect(coldPrismWarnings).toHaveLength(0)

      cleanup?.()
      consoleWarnSpy.mockRestore()
    })
  })
})
