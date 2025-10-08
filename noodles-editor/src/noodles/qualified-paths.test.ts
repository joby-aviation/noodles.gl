import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodeOp, DuckDbOp, JSONOp, NumberOp } from './operators'
import { getOp, opMap } from './store'
import {
  generateQualifiedPath,
  getBaseName,
  getDirectChildren,
  getParentPath,
  isAbsolutePath,
  isDirectChild,
  isValidPath,
  isWithinContainer,
  joinPath,
  normalizePath,
  parseHandleId,
  resolvePath,
} from './utils/path-utils'

describe('Fully Qualified Operator Paths - Comprehensive Tests', () => {
  beforeEach(() => {
    opMap.clear()
  })

  afterEach(() => {
    opMap.clear()
  })

  describe('Path Resolution Functions', () => {
    describe('Absolute Path Resolution', () => {
      it('resolves and normalizes absolute paths correctly', () => {
        // Basic absolute path resolution
        expect(resolvePath('/operator', '/context/op')).toBe('/operator')
        expect(resolvePath('/container/operator', '/context/op')).toBe('/container/operator')
        expect(resolvePath('/deep/nested/container/operator', '/context/op')).toBe(
          '/deep/nested/container/operator'
        )

        // Normalization of redundant segments
        expect(resolvePath('/container/../operator', '/context/op')).toBe('/operator')
        expect(resolvePath('/container/./operator', '/context/op')).toBe('/container/operator')
        expect(resolvePath('/container/sub/../operator', '/context/op')).toBe('/container/operator')

        // Root path handling
        expect(resolvePath('/', '/context/op')).toBe('/')
      })
    })

    describe('Relative Path Resolution with ./', () => {
      it('resolves same-container references and handles normalization', () => {
        // Basic same-container resolution
        expect(resolvePath('./target', '/container/operator')).toBe('/container/target')
        expect(resolvePath('./sub/target', '/container/operator')).toBe('/container/sub/target')
        expect(resolvePath('./deeply/nested/target', '/container/operator')).toBe(
          '/container/deeply/nested/target'
        )

        // Root-level context
        expect(resolvePath('./target', '/operator')).toBe('/target')
        expect(resolvePath('./sub/target', '/operator')).toBe('/sub/target')

        // Normalization with redundant segments
        expect(resolvePath('./sub/../target', '/container/operator')).toBe('/container/target')
        expect(resolvePath('./sub/./target', '/container/operator')).toBe('/container/sub/target')
      })
    })

    describe('Relative Path Resolution with ../', () => {
      it('resolves parent-container references and handles edge cases', () => {
        // Basic parent resolution
        expect(resolvePath('../target', '/container/operator')).toBe('/target')
        expect(resolvePath('../other/target', '/container/operator')).toBe('/other/target')
        expect(resolvePath('../other/sub/target', '/container/operator')).toBe('/other/sub/target')

        // Multiple parent references
        expect(resolvePath('../../target', '/container/sub/operator')).toBe('/target')
        expect(resolvePath('../../../target', '/deep/nested/container/operator')).toBe('/target')

        // Complex parent navigation
        expect(resolvePath('../../other/target', '/container/sub/operator')).toBe('/other/target')
        expect(resolvePath('../../../other/target', '/deep/nested/container/operator')).toBe(
          '/other/target'
        )

        // Going above root now resolves to valid paths
        expect(resolvePath('../target', '/operator')).toBe('/target')
        expect(resolvePath('../../target', '/container/operator')).toBe('/target')
        expect(resolvePath('../../../target', '/container/sub/operator')).toBe('/target')
      })
    })

    describe('Relative Path Resolution without prefix', () => {
      it('treats as same-container references', () => {
        // Same-container resolution without prefix
        expect(resolvePath('target', '/container/operator')).toBe('/container/target')
        expect(resolvePath('sub/target', '/container/operator')).toBe('/container/sub/target')
        expect(resolvePath('deeply/nested/target', '/container/operator')).toBe(
          '/container/deeply/nested/target'
        )

        // Root-level context
        expect(resolvePath('target', '/operator')).toBe('/target')
        expect(resolvePath('sub/target', '/operator')).toBe('/sub/target')
      })
    })

    describe('Edge Cases and Error Conditions', () => {
      it('handles invalid inputs and malformed paths gracefully', () => {
        // Empty/null paths
        expect(resolvePath('', '/container/operator')).toBeUndefined()
        expect(resolvePath(null as unknown as string, '/container/operator')).toBeUndefined()
        expect(resolvePath(undefined as unknown as string, '/container/operator')).toBeUndefined()

        // Invalid context
        expect(resolvePath('target', '')).toBeUndefined()
        expect(resolvePath('target', null as unknown as string)).toBeUndefined()
        expect(resolvePath('target', undefined as unknown as string)).toBeUndefined()

        // Malformed paths (should normalize)
        expect(resolvePath('//target', '/container/operator')).toBe('/target')
        expect(resolvePath('.//', '/container/operator')).toBe('/container')
        expect(resolvePath('..//', '/container/operator')).toBe('/')

        // Circular references (should not cause infinite loops)
        expect(resolvePath('.././../target', '/container/operator')).toBe('/target')
        expect(resolvePath('././target', '/container/operator')).toBe('/container/target')
      })
    })
  })

  describe('getOp Function with Path Resolution', () => {
    beforeEach(() => {
      // Set up test operators in opMap
      const rootOp = new NumberOp('/root-op', { val: 1 })
      const containerOp = new NumberOp('/container/op1', { val: 2 })
      const nestedOp = new NumberOp('/container/sub/op2', { val: 3 })
      const deepOp = new NumberOp('/deep/nested/container/op3', { val: 4 })

      opMap.set('/root-op', rootOp)
      opMap.set('/container/op1', containerOp)
      opMap.set('/container/sub/op2', nestedOp)
      opMap.set('/deep/nested/container/op3', deepOp)
    })

    describe('Absolute Path Lookup', () => {
      it('finds operators by absolute path at all nesting levels', () => {
        // Root level
        const rootOp = getOp('/root-op')
        expect(rootOp).toBeDefined()
        expect(rootOp?.id).toBe('/root-op')
        expect(rootOp?.inputs.val.value).toBe(1)

        // Nested
        const nestedOp = getOp('/container/op1')
        expect(nestedOp).toBeDefined()
        expect(nestedOp?.id).toBe('/container/op1')
        expect(nestedOp?.inputs.val.value).toBe(2)

        // Deeply nested
        const deepOp = getOp('/deep/nested/container/op3')
        expect(deepOp).toBeDefined()
        expect(deepOp?.id).toBe('/deep/nested/container/op3')
        expect(deepOp?.inputs.val.value).toBe(4)

        // Non-existent paths
        expect(getOp('/non-existent')).toBeUndefined()
        expect(getOp('/container/non-existent')).toBeUndefined()
      })
    })

    describe('Relative Path Lookup with Context', () => {
      it('resolves all types of relative references', () => {
        // Set up additional test operators
        const sameContainerOp2 = new NumberOp('/container/op2', { val: 5 })
        const sameContainerOp3 = new NumberOp('/container/op3', { val: 6 })
        opMap.set('/container/op2', sameContainerOp2)
        opMap.set('/container/op3', sameContainerOp3)

        // Same-container with ./
        const op1 = getOp('./op2', '/container/op1')
        expect(op1?.id).toBe('/container/op2')
        expect(op1?.inputs.val.value).toBe(5)

        // Parent-container with ../
        const op2 = getOp('../op1', '/container/sub/op2')
        expect(op2?.id).toBe('/container/op1')
        expect(op2?.inputs.val.value).toBe(2)

        // Same-container without prefix
        const op3 = getOp('op3', '/container/op1')
        expect(op3?.id).toBe('/container/op3')
        expect(op3?.inputs.val.value).toBe(6)

        // Unresolvable paths
        expect(getOp('./non-existent', '/container/op1')).toBeUndefined()
        expect(getOp('../non-existent', '/container/sub/op2')).toBeUndefined()
        expect(getOp('../../non-existent', '/container/sub/op2')).toBeUndefined()

        // Going above root (still undefined because operators don't exist)
        expect(getOp('../op1', '/root-op')).toBeUndefined()
        expect(getOp('../../op1', '/container/op1')).toBeUndefined()
      })
    })

    describe('Backward Compatibility and Complex Scenarios', () => {
      it('maintains backward compatibility and handles complex resolution', () => {
        // Backward compatibility when no context provided
        const op = getOp('/root-op')
        expect(op).toBeDefined()
        expect(op?.id).toBe('/root-op')

        // Returns undefined for relative paths without context
        expect(getOp('./op1')).toBeUndefined()
        expect(getOp('../op1')).toBeUndefined()
        expect(getOp('op1')).toBeUndefined()

        // Complex nested path resolution
        const complexOp = getOp('../../../container/op1', '/deep/nested/container/op3')
        expect(complexOp?.id).toBe('/container/op1')

        // Multiple levels of parent navigation
        const multiLevelOp = getOp('../../../root-op', '/deep/nested/container/op3')
        expect(multiLevelOp?.id).toBe('/root-op')

        // Complex relative paths with normalization
        const normalizedOp = getOp('./sub/../op1', '/container/op1')
        expect(normalizedOp?.id).toBe('/container/op1')
      })
    })
  })

  describe('Handle ID Parsing', () => {
    it('parses handle IDs correctly for short format and handles errors', () => {
      // Short format parsing
      expect(parseHandleId('par.data')).toEqual({
        namespace: 'par',
        fieldName: 'data',
      })

      expect(parseHandleId('out.result')).toEqual({
        namespace: 'out',
        fieldName: 'result',
      })

      // Field names with dots
      expect(parseHandleId('par.field.name.with.dots')).toEqual({
        namespace: 'par',
        fieldName: 'field.name.with.dots',
      })

      // Both namespaces
      expect(parseHandleId('par.input')?.namespace).toBe('par')
      expect(parseHandleId('out.output')?.namespace).toBe('out')

      // Invalid handle IDs
      expect(parseHandleId('')).toBeUndefined()
      expect(parseHandleId('invalid')).toBeUndefined()
      expect(parseHandleId('invalid.field')).toBeUndefined() // Invalid namespace
      expect(parseHandleId('par')).toBeUndefined() // Missing field
      expect(parseHandleId('out')).toBeUndefined() // Missing field

      // Malformed handle IDs
      expect(parseHandleId('par.')).toBeUndefined() // Empty field
      expect(parseHandleId('.field')).toBeUndefined() // Empty namespace
    })
  })
})

describe('Edge Cases and Error Conditions', () => {
  it('handles path validation edge cases', () => {
    // Empty and null inputs
    expect(isAbsolutePath('')).toBe(false)
    expect(getParentPath('')).toBeUndefined()
    expect(getBaseName('')).toBe('')
    expect(isValidPath('')).toBe(false)

    // Malformed paths
    expect(isValidPath('//operator')).toBe(false) // Double slash
    expect(isValidPath('/operator/')).toBe(false) // Trailing slash
    expect(isValidPath('/operator\0')).toBe(false) // Null character
    expect(normalizePath('//operator')).toBe('/operator') // Should normalize
    expect(normalizePath('/operator/')).toBe('/operator') // Should handle trailing slash

    // Extreme nesting
    const deepPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/operator'
    expect(isAbsolutePath(deepPath)).toBe(true)
    expect(isValidPath(deepPath)).toBe(true)
    expect(getBaseName(deepPath)).toBe('operator')
    expect(getParentPath(deepPath)).toBe('/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z')
  })

  it('handles path resolution edge cases', () => {
    // Circular references (should not cause infinite loops)
    expect(resolvePath('.././.././target', '/container/operator')).toBe('/target')
    expect(resolvePath('./././target', '/container/operator')).toBe('/container/target')
    expect(resolvePath('../../../../../../../target', '/a/b/c/operator')).toBe('/target')

    // Complex paths with redundant segments
    const complexPath = '/container/./sub/../sub/./operator/../operator'
    expect(normalizePath(complexPath)).toBe('/container/sub/operator')
    expect(resolvePath('./sub/../sub/./target', '/container/operator')).toBe(
      '/container/sub/target'
    )

    // Boundary conditions for parent navigation
    expect(resolvePath('../target', '/operator')).toBe('/target') // Now resolves above root
    expect(resolvePath('../../target', '/container/operator')).toBe('/target') // Now resolves above root
    expect(resolvePath('../target', '/container/operator')).toBe('/target') // One level below root
  })

  it('handles handle ID edge cases', () => {
    // Unusual but valid field names
    const testCases = [
      'field123',
      'field_with_underscores',
      'field-with-dashes',
      'field.with.dots',
      'fieldWithCamelCase',
      'FIELD_WITH_CAPS',
      'field123_with-mixed.cases',
    ]
    for (const fieldName of testCases) {
      const handleId = `par.${fieldName}`
      const parsed = parseHandleId(handleId)
      expect(parsed?.fieldName).toBe(fieldName)
    }

    // Edge cases in parsing
    expect(parseHandleId('par.field..with..dots')?.fieldName).toBe('field..with..dots')
    expect(parseHandleId('par..field.')?.fieldName).toBe('.field.')
  })
})

describe('Container Integration Tests', () => {
  describe('Direct Child Detection', () => {
    it('correctly identifies and rejects direct children', () => {
      // Valid direct children
      expect(isDirectChild('/container/child', '/container')).toBe(true)
      expect(isDirectChild('/container/sub/child', '/container/sub')).toBe(true)
      expect(isDirectChild('/deep/nested/container/child', '/deep/nested/container')).toBe(true)

      // Non-direct children
      expect(isDirectChild('/container/sub/child', '/container')).toBe(false) // Grandchild
      expect(isDirectChild('/other/child', '/container')).toBe(false) // Different container
      expect(isDirectChild('/child', '/container')).toBe(false) // Root level
      expect(isDirectChild('/container', '/container')).toBe(false) // Self

      // Root-level and edge cases
      expect(isDirectChild('/root-op', '/')).toBe(false) // Root level ops are not children of root
      expect(isDirectChild('/root-op', '')).toBe(false)
      expect(isDirectChild('', '/container')).toBe(false)
      expect(isDirectChild('/container/child', '')).toBe(false)
      expect(isDirectChild('', '')).toBe(false)
    })
  })

  describe('Get Direct Children and Within Container Detection', () => {
    beforeEach(() => {
      // Set up a hierarchy of operators
      const containerOp = new NumberOp('/container', { val: 0 })
      const child1 = new NumberOp('/container/child1', { val: 1 })
      const child2 = new NumberOp('/container/child2', { val: 2 })
      const grandchild = new NumberOp('/container/child1/grandchild', { val: 3 })
      const otherChild = new NumberOp('/other/child', { val: 4 })
      const rootOp = new NumberOp('/root-op', { val: 5 })

      opMap.set('/container', containerOp)
      opMap.set('/container/child1', child1)
      opMap.set('/container/child2', child2)
      opMap.set('/container/child1/grandchild', grandchild)
      opMap.set('/other/child', otherChild)
      opMap.set('/root-op', rootOp)
    })

    it('returns direct children only and handles within container detection', () => {
      // Direct children
      const children = getDirectChildren('/container', opMap)
      expect(children).toHaveLength(2)
      expect(children.map(c => c.id).sort()).toEqual(['/container/child1', '/container/child2'])

      // Empty array for containers with no children
      const noChildren = getDirectChildren('/container/child2', opMap)
      expect(noChildren).toHaveLength(0)

      // Does not include grandchildren
      expect(children.find(c => c.id === '/container/child1/grandchild')).toBeUndefined()

      // Non-existent containers
      const nonExistent = getDirectChildren('/non-existent', opMap)
      expect(nonExistent).toHaveLength(0)

      // Within container detection
      expect(isWithinContainer('/container/child', '/container')).toBe(true)
      expect(isWithinContainer('/container/sub/child', '/container')).toBe(true)
      expect(isWithinContainer('/container/deep/nested/child', '/container')).toBe(true)
      expect(isWithinContainer('/other/child', '/container')).toBe(false)
      expect(isWithinContainer('/root-op', '/container')).toBe(false)
      expect(isWithinContainer('/container-other/child', '/container')).toBe(false)
      expect(isWithinContainer('/container', '/container')).toBe(false) // Self-reference
    })
  })
})

describe('Integration with Operator Mustache References', () => {
  beforeEach(() => {
    // Set up operators for mustache reference testing
    const sourceOp = new NumberOp('/source', { val: 42 })
    const containerOp = new NumberOp('/container/source', { val: 100 })
    const nestedOp = new NumberOp('/container/nested/source', { val: 200 })

    opMap.set('/source', sourceOp)
    opMap.set('/container/source', containerOp)
    opMap.set('/container/nested/source', nestedOp)
  })

  it('resolves qualified paths in CodeOp mustache references', async () => {
    const codeOp = new CodeOp('/container/code', { code: 'return {{/source.par.val}} + d' })
    opMap.set('/container/code', codeOp)

    const result = await codeOp.execute({ data: [10], code: 'return {{/source.par.val}} + d' })
    expect(result.data).toBe(52) // 42 + 10
  })

  it('resolves qualified paths in JSONOp mustache references', () => {
    const jsonOp = new JSONOp('/container/json', { text: '{"value": {{./source.par.val}}}' })
    opMap.set('/container/json', jsonOp)

    const result = jsonOp.execute({ text: '{"value": {{./source.par.val}}}' })
    expect(result.data).toEqual({ value: 100 })
  })

  it('resolves qualified paths in DuckDbOp mustache references', async () => {
    const duckDbOp = new DuckDbOp('/container/nested/duckdb', {
      query: 'SELECT {{../source.par.val}} as value',
    })
    opMap.set('/container/nested/duckdb', duckDbOp)

    const result = await duckDbOp.execute({ query: 'SELECT {{../source.par.val}} as value' })
    expect(result?.data).toEqual([expect.objectContaining({ value: 100 })])
  })

  it('throws error for unresolvable mustache references', () => {
    const jsonOp = new JSONOp('/container/json', {
      text: '{"value": {{./non-existent.par.val}}}',
    })
    opMap.set('/container/json', jsonOp)

    expect(() => {
      jsonOp.execute({ text: '{"value": {{./non-existent.par.val}}}' })
    }).toThrow('Field val not found on ././non-existent')
  })
})

describe('Path Utilities Integration', () => {
  it('generates qualified paths correctly for various scenarios', () => {
    // Basic path generation
    expect(generateQualifiedPath('operator', '/')).toBe('/operator')
    expect(generateQualifiedPath('operator', 'container')).toBe('/container/operator')
    expect(generateQualifiedPath('operator', '/container')).toBe('/container/operator')
    expect(generateQualifiedPath('operator', '/deep/nested/container')).toBe(
      '/deep/nested/container/operator'
    )

    // Edge cases
    expect(generateQualifiedPath('operator', '')).toBe('/operator')
  })

  it('joins path segments correctly with normalization', () => {
    // Basic joining
    expect(joinPath('container', 'operator')).toBe('/container/operator')
    expect(joinPath('/', 'operator')).toBe('/operator')
    expect(joinPath('container', 'sub', 'operator')).toBe('/container/sub/operator')

    // Empty segment filtering
    expect(joinPath('container', '', 'operator')).toBe('/container/operator')
    expect(joinPath('', 'container', 'operator')).toBe('/container/operator')

    // Normalization
    expect(joinPath('container', '../operator')).toBe('/operator')
    expect(joinPath('container', './operator')).toBe('/container/operator')
  })

  it('handles complete workflow from generation to resolution', () => {
    // Test end-to-end path utilities integration
    const containerPath = generateQualifiedPath('container', '/')
    const operatorPath = generateQualifiedPath('operator', containerPath)
    const handleId = 'par.data'
    const parsed = parseHandleId(handleId)

    expect(containerPath).toBe('/container')
    expect(operatorPath).toBe('/container/operator')
    expect(parsed).toEqual({
      namespace: 'par',
      fieldName: 'data',
    })

    // Test resolution from different contexts
    const resolvedFromRoot = resolvePath(operatorPath, '/other')
    const resolvedFromContainer = resolvePath('./operator', `${containerPath}/other`)

    expect(resolvedFromRoot).toBe('/container/operator')
    expect(resolvedFromContainer).toBe('/container/operator')
  })
})
