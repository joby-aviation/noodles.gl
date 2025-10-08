import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodeOp, JSONOp, NumberOp } from './operators'
import { getOp, opMap } from './store'
import {
  generateQualifiedPath,
  getBaseName,
  getParentPath,
  isAbsolutePath,
  isValidPath,
  joinPath,
  normalizePath,
  parseHandleId,
  resolvePath,
} from './utils/path-utils'

describe('Path Format Validation', () => {
  beforeEach(() => {
    opMap.clear()
  })

  afterEach(() => {
    opMap.clear()
  })

  describe('Path Format Consistency', () => {
    it('should validate correct absolute path formats', () => {
      const validPaths = [
        '/',
        '/operator',
        '/container/operator',
        '/deep/nested/container/operator',
        '/container-with-dashes/operator_with_underscores',
        '/container123/operator456',
        '/a/b/c/d/e/f/g/h/i/j', // Deep nesting
      ]

      validPaths.forEach(path => {
        expect(isValidPath(path), `Path should be valid: ${path}`).toBe(true)
        expect(isAbsolutePath(path), `Path should be absolute: ${path}`).toBe(true)
      })
    })

    it('should reject invalid path formats', () => {
      const invalidPaths = [
        '', // Empty string
        'relative/path', // Not absolute
        '//', // Double slash
        '/container/', // Trailing slash (except root)
        '/container//operator', // Double slash in middle
        '/container/\0/operator', // Null character
        'operator', // Missing leading slash
        './relative', // Relative path
        '../parent', // Parent relative path
      ]

      invalidPaths.forEach(path => {
        expect(isValidPath(path), `Path should be invalid: ${path}`).toBe(false)
      })
    })

    it('should ensure path normalization is consistent', () => {
      const testCases = [
        { input: '/container/../operator', expected: '/operator' },
        { input: '/container/./operator', expected: '/container/operator' },
        { input: '/container/sub/../operator', expected: '/container/operator' },
        { input: '/container/sub/../../operator', expected: '/operator' },
        { input: '/', expected: '/' },
        { input: '/operator', expected: '/operator' },
        { input: '/a/b/c/../d', expected: '/a/b/d' },
        { input: '/a/./b/./c', expected: '/a/b/c' },
      ]

      testCases.forEach(({ input, expected }) => {
        const normalized = normalizePath(input)
        expect(normalized, `Normalization of ${input}`).toBe(expected)
        expect(isValidPath(normalized), `Normalized path should be valid: ${normalized}`).toBe(true)
      })
    })

    it('should validate handle ID format consistency', () => {
      const validHandleIds = [
        'par.field',
        'out.result',
        'par.input_data',
        'out.field456',
        'par.complex.field.name',
      ]

      validHandleIds.forEach(handleId => {
        const parsed = parseHandleId(handleId)
        expect(parsed, `Handle ID should be parseable: ${handleId}`).toBeDefined()

        if (parsed) {
          expect(['par', 'out']).toContain(parsed.namespace)
          expect(parsed.fieldName).toBeTruthy()
        }
      })
    })

    it('should reject invalid handle ID formats', () => {
      const invalidHandleIds = [
        '', // Empty
        'operator.par.field', // Not absolute path
        '/operator.invalid.field', // Invalid namespace
        '/operator.par.', // Empty field name
        '/operator.par', // Missing field name
        '/operator', // No namespace or field
        '.par.field', // Missing operator
      ]

      invalidHandleIds.forEach(handleId => {
        const parsed = parseHandleId(handleId)
        expect(parsed, `Handle ID should be invalid: ${handleId}`).toBeUndefined()
      })
    })

    it('should ensure qualified path generation is consistent', () => {
      const testCases = [
        { baseName: 'operator', containerId: '/', expected: '/operator' },
        { baseName: 'operator', containerId: '/container', expected: '/container/operator' },
        { baseName: 'operator', containerId: 'container', expected: '/container/operator' }, // Should normalize
        {
          baseName: 'op-123',
          containerId: '/deep/nested/container',
          expected: '/deep/nested/container/op-123',
        },
      ]

      testCases.forEach(({ baseName, containerId, expected }) => {
        const generated = generateQualifiedPath(baseName, containerId)
        expect(generated, `Generated path for ${baseName} in ${containerId}`).toBe(expected)
        expect(isValidPath(generated), `Generated path should be valid: ${generated}`).toBe(true)
      })
    })

    it('should validate path joining consistency', () => {
      const testCases = [
        { segments: ['/', 'operator'], expected: '/operator' },
        { segments: ['/container', 'operator'], expected: '/container/operator' },
        { segments: ['/container', 'sub', 'operator'], expected: '/container/sub/operator' },
        { segments: ['', 'operator'], expected: '/operator' },
        { segments: ['container', 'operator'], expected: '/container/operator' },
      ]

      testCases.forEach(({ segments, expected }) => {
        const joined = joinPath(...segments)
        expect(joined, `Joined path for [${segments.join(', ')}]`).toBe(expected)
        expect(isValidPath(joined), `Joined path should be valid: ${joined}`).toBe(true)
      })
    })
  })

  describe('Path Resolution Validation', () => {
    it('should ensure resolution results are always valid paths', () => {
      const contextPaths = ['/operator', '/container/operator', '/deep/nested/container/operator']

      const testPaths = [
        '/absolute/path',
        './relative',
        '../parent',
        'same-container',
        '/another/absolute',
        './sub/relative',
        '../../grandparent',
      ]

      contextPaths.forEach(contextPath => {
        testPaths.forEach(testPath => {
          const resolved = resolvePath(testPath, contextPath)

          if (resolved !== undefined) {
            expect(
              isValidPath(resolved),
              `Resolved path should be valid: ${testPath} from ${contextPath} -> ${resolved}`
            ).toBe(true)
            expect(isAbsolutePath(resolved), `Resolved path should be absolute: ${resolved}`).toBe(
              true
            )
          }
        })
      })
    })

    it('should validate parent path extraction consistency', () => {
      const testCases = [
        { path: '/operator', expectedParent: '/' },
        { path: '/container/operator', expectedParent: '/container' },
        { path: '/deep/nested/operator', expectedParent: '/deep/nested' },
        { path: '/', expectedParent: '/' },
      ]

      testCases.forEach(({ path, expectedParent }) => {
        const parent = getParentPath(path)
        expect(parent, `Parent of ${path}`).toBe(expectedParent)

        if (parent !== undefined) {
          expect(isValidPath(parent), `Parent path should be valid: ${parent}`).toBe(true)
        }
      })
    })

    it('should validate base name extraction consistency', () => {
      const testCases = [
        { path: '/operator', expectedBase: 'operator' },
        { path: '/container/operator', expectedBase: 'operator' },
        { path: '/deep/nested/operator', expectedBase: 'operator' },
        { path: '/', expectedBase: '' },
        { path: '', expectedBase: '' },
      ]

      testCases.forEach(({ path, expectedBase }) => {
        const base = getBaseName(path)
        expect(base, `Base name of ${path}`).toBe(expectedBase)
      })
    })
  })

  describe('OpMap Consistency Validation', () => {
    it('should ensure all operators in opMap have valid path IDs', () => {
      // Create operators with various path formats
      const operators = [
        new NumberOp('/root-op', { val: 1 }),
        new CodeOp('/container/code-op', { code: 'test' }),
        new JSONOp('/deep/nested/container/json-op', { text: '{}' }),
      ]

      operators.forEach(op => {
        opMap.set(op.id, op)
      })

      // Validate all operators have valid path IDs
      for (const [id, op] of opMap) {
        expect(isValidPath(id), `OpMap key should be valid path: ${id}`).toBe(true)
        expect(op.id, `Operator ID should match map key: ${id}`).toBe(id)
        expect(isValidPath(op.id), `Operator ID should be valid path: ${op.id}`).toBe(true)
      }
    })

    it('should validate getOp function returns consistent results', () => {
      // Create test operators
      const testOps = [
        new NumberOp('/op1', { val: 1 }),
        new NumberOp('/container/op2', { val: 2 }),
        new NumberOp('/deep/nested/op3', { val: 3 }),
      ]

      testOps.forEach(op => {
        opMap.set(op.id, op)
      })

      // Test direct lookup
      testOps.forEach(expectedOp => {
        const foundOp = getOp(expectedOp.id)
        expect(foundOp, `Should find operator: ${expectedOp.id}`).toBeDefined()
        expect(foundOp?.id, 'Found operator should have correct ID').toBe(expectedOp.id)
      })

      // Test relative lookup
      const contextOp = '/container/context'
      const relativeTests = [
        { path: './op2', expected: '/container/op2' },
        { path: '../op1', expected: '/op1' },
        { path: 'op2', expected: '/container/op2' },
      ]

      relativeTests.forEach(({ path, expected }) => {
        const resolved = resolvePath(path, contextOp)
        expect(resolved, `Resolution of ${path} from ${contextOp}`).toBe(expected)

        if (opMap.has(expected)) {
          const foundOp = getOp(path, contextOp)
          expect(foundOp, `Should find operator via relative path: ${path}`).toBeDefined()
          expect(foundOp?.id, 'Found operator should have correct ID').toBe(expected)
        }
      })
    })
  })

  describe('Edge Case Validation', () => {
    it('should handle edge cases gracefully', () => {
      // Test with null/undefined inputs
      expect(isValidPath(null as unknown as string)).toBe(false)
      expect(isValidPath(undefined as unknown as string)).toBe(false)
      expect(isAbsolutePath('')).toBe(false)
      expect(getParentPath('')).toBeUndefined()
      expect(getBaseName('')).toBe('')
      expect(normalizePath('')).toBe('/')
      expect(resolvePath('', '/context')).toBeUndefined()
      expect(parseHandleId('')).toBeUndefined()
    })

    it('should validate very long paths', () => {
      // Create a very long but valid path
      const longPath = `/${Array.from({ length: 100 }, (_, i) => `segment${i}`).join('/')}`

      expect(isValidPath(longPath)).toBe(true)
      expect(isAbsolutePath(longPath)).toBe(true)
      expect(getBaseName(longPath)).toBe('segment99')
      expect(getParentPath(longPath)).toBe(
        `/${Array.from({ length: 99 }, (_, i) => `segment${i}`).join('/')}`
      )
    })

    it('should validate special characters in paths', () => {
      const specialCharPaths = [
        '/operator-with-dashes',
        '/operator_with_underscores',
        '/operator123',
        '/container/operator.with.dots', // Note: dots are valid in path segments, just not in our handle parsing
        '/container/operator@special',
        '/container/operator#hash',
      ]

      specialCharPaths.forEach(path => {
        // These should be valid paths (though some might not work well with handle parsing)
        expect(isValidPath(path), `Special char path should be valid: ${path}`).toBe(true)
        expect(isAbsolutePath(path), `Special char path should be absolute: ${path}`).toBe(true)
      })
    })
  })
})
