import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CodeOp, JSONOp, NumberOp } from './operators'
import { getOp, opMap } from './store'
import {
  getBaseName,
  getDirectChildren,
  getParentPath,
  isWithinContainer,
  normalizePath,
  resolvePath,
} from './utils/path-utils'

describe('Performance Tests for Qualified Paths', () => {
  beforeEach(() => {
    opMap.clear()
  })

  afterEach(() => {
    opMap.clear()
  })

  describe('Path Resolution Performance', () => {
    it('should handle deep nesting efficiently', () => {
      const startTime = performance.now()

      // Create a deeply nested structure (10 levels deep)
      const depth = 10
      const operatorsPerLevel = 5

      // Generate deep nested paths
      for (let level = 1; level <= depth; level++) {
        for (let op = 1; op <= operatorsPerLevel; op++) {
          const pathSegments = Array.from({ length: level }, (_, i) => `container${i + 1}`)
          pathSegments.push(`operator${op}`)
          const fullPath = `/${pathSegments.join('/')}`

          const operator = new NumberOp(fullPath, { val: 42 })
          opMap.set(fullPath, operator)
        }
      }

      const setupTime = performance.now() - startTime
      console.log(
        `Setup time for ${depth * operatorsPerLevel} operators: ${setupTime.toFixed(2)}ms`
      )

      // Test path resolution performance
      const resolutionStartTime = performance.now()
      const testCases = 1000

      for (let i = 0; i < testCases; i++) {
        const level = Math.floor(Math.random() * depth) + 1
        const op = Math.floor(Math.random() * operatorsPerLevel) + 1
        const pathSegments = Array.from({ length: level }, (_, i) => `container${i + 1}`)
        pathSegments.push(`operator${op}`)
        const targetPath = `/${pathSegments.join('/')}`

        // Test absolute path resolution
        const resolved = resolvePath(targetPath, '/container1/operator1')
        expect(resolved).toBe(targetPath)

        // Test relative path resolution from different contexts
        if (level > 1) {
          const contextPath = `/${pathSegments.slice(0, -1).join('/')}/contextOp`
          const relativePath = `./operator${op}`
          const resolvedRelative = resolvePath(relativePath, contextPath)
          expect(resolvedRelative).toBe(targetPath)
        }
      }

      const resolutionTime = performance.now() - resolutionStartTime
      console.log(`Resolution time for ${testCases} operations: ${resolutionTime.toFixed(2)}ms`)
      console.log(
        `Average resolution time: ${(resolutionTime / testCases).toFixed(4)}ms per operation`
      )

      // Performance should be reasonable (less than 1ms per operation on average)
      expect(resolutionTime / testCases).toBeLessThan(1)
    })

    it('should handle large numbers of operators efficiently', () => {
      const startTime = performance.now()
      const operatorCount = 10000

      // Create a large flat structure
      for (let i = 1; i <= operatorCount; i++) {
        const path = `/operator${i}`
        const operator = new NumberOp(path, { val: i })
        opMap.set(path, operator)
      }

      const setupTime = performance.now() - startTime
      console.log(`Setup time for ${operatorCount} operators: ${setupTime.toFixed(2)}ms`)

      // Test lookup performance
      const lookupStartTime = performance.now()
      const lookupTests = 1000

      for (let i = 0; i < lookupTests; i++) {
        const randomId = Math.floor(Math.random() * operatorCount) + 1
        const path = `/operator${randomId}`
        const op = getOp(path)
        expect(op).toBeDefined()
        expect(op?.id).toBe(path)
      }

      const lookupTime = performance.now() - lookupStartTime
      console.log(`Lookup time for ${lookupTests} operations: ${lookupTime.toFixed(2)}ms`)
      console.log(`Average lookup time: ${(lookupTime / lookupTests).toFixed(4)}ms per operation`)

      // Lookup should be very fast (less than 0.1ms per operation)
      expect(lookupTime / lookupTests).toBeLessThan(0.1)
    })

    it('should handle complex relative path resolution efficiently', () => {
      // Create a complex nested structure
      const containers = ['analytics', 'preprocessing', 'visualization', 'export']
      const operators = ['filter', 'transform', 'aggregate', 'validate']

      containers.forEach(container => {
        operators.forEach(op => {
          const path = `/${container}/${op}`
          const operator = new CodeOp(path, { code: `// ${op} in ${container}` })
          opMap.set(path, operator)
        })
      })

      const startTime = performance.now()
      const testCases = 1000

      // Test various relative path patterns
      for (let i = 0; i < testCases; i++) {
        const sourceContainer = containers[i % containers.length]
        const targetContainer = containers[(i + 1) % containers.length]
        const sourceOp = operators[i % operators.length]
        const targetOp = operators[(i + 1) % operators.length]

        const contextPath = `/${sourceContainer}/${sourceOp}`
        const relativePath = `../${targetContainer}/${targetOp}`
        const expectedPath = `/${targetContainer}/${targetOp}`

        const resolved = resolvePath(relativePath, contextPath)
        expect(resolved).toBe(expectedPath)
      }

      const resolutionTime = performance.now() - startTime
      console.log(
        `Complex relative resolution time for ${testCases} operations: ${resolutionTime.toFixed(2)}ms`
      )

      // Should handle complex relative paths efficiently
      expect(resolutionTime / testCases).toBeLessThan(0.5)
    })
  })

  describe('Memory Usage Validation', () => {
    it('should not leak memory with repeated operations', () => {
      if (typeof process?.memoryUsage === 'undefined' || typeof global.gc === 'undefined') {
        return
      }

      const initialMemory = process.memoryUsage()

      // Perform many operations that could potentially leak memory
      for (let cycle = 0; cycle < 100; cycle++) {
        // Create operators
        for (let i = 1; i <= 100; i++) {
          const path = `/temp${cycle}/operator${i}`
          const operator = new NumberOp(path, { val: i })
          opMap.set(path, operator)
        }

        // Perform path operations
        for (let i = 1; i <= 100; i++) {
          const path = `/temp${cycle}/operator${i}`
          resolvePath(path, '/context/op')
          getParentPath(path)
          getBaseName(path)
          normalizePath(path)
        }

        // Clean up
        for (let i = 1; i <= 100; i++) {
          const path = `/temp${cycle}/operator${i}`
          opMap.delete(path)
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc()
      }

      const finalMemory = process.memoryUsage()
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed

      console.log(
        `Memory increase after operations: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`
      )

      // Memory increase should be minimal (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024)
    })

    it('should handle large operator hierarchies without excessive memory usage', () => {
      if (typeof process?.memoryUsage === 'undefined' || typeof global.gc === 'undefined') {
        return
      }

      const initialMemory = process.memoryUsage()

      // Create a large hierarchy
      const depth = 5
      const breadth = 20
      let totalOperators = 0

      function createLevel(parentPath: string, currentDepth: number) {
        if (currentDepth >= depth) return

        for (let i = 1; i <= breadth; i++) {
          const path = `${parentPath}/container${i}`
          const operator = new JSONOp(path, {
            text: JSON.stringify({ level: currentDepth, index: i }),
          })
          opMap.set(path, operator)
          totalOperators++

          createLevel(path, currentDepth + 1)
        }
      }

      createLevel('', 0)

      const afterCreationMemory = process.memoryUsage()
      const creationMemoryIncrease = afterCreationMemory.heapUsed - initialMemory.heapUsed

      console.log(`Created ${totalOperators} operators`)
      console.log(
        `Memory used for creation: ${(creationMemoryIncrease / 1024 / 1024).toFixed(2)}MB`
      )
      console.log(
        `Memory per operator: ${(creationMemoryIncrease / totalOperators / 1024).toFixed(2)}KB`
      )

      // Test operations on the hierarchy
      const operationStartTime = performance.now()

      // Test getDirectChildren performance
      for (let level = 0; level < depth - 1; level++) {
        for (let i = 1; i <= Math.min(breadth, 5); i++) {
          // Test subset to keep test time reasonable
          const parentPath =
            level === 0
              ? `/container${i}`
              : `/container1/${'container1/'.repeat(level - 1)}container${i}`
          const children = getDirectChildren(parentPath, opMap)
          expect(children.length).toBe(breadth)
        }
      }

      const operationTime = performance.now() - operationStartTime
      console.log(`Hierarchy operations time: ${operationTime.toFixed(2)}ms`)

      // Memory per operator should be reasonable (less than 10KB per operator)
      expect(creationMemoryIncrease / totalOperators).toBeLessThan(10 * 1024)
    })
  })

  describe('Container Operations Performance', () => {
    it('should handle container queries efficiently with large hierarchies', () => {
      // Create a complex container structure
      const containers = 10
      const operatorsPerContainer = 100

      for (let c = 1; c <= containers; c++) {
        for (let o = 1; o <= operatorsPerContainer; o++) {
          const path = `/container${c}/operator${o}`
          const operator = new NumberOp(path, { val: o })
          opMap.set(path, operator)
        }
      }

      const startTime = performance.now()

      // Test isWithinContainer performance
      for (let c = 1; c <= containers; c++) {
        const containerPath = `/container${c}`
        let withinCount = 0

        for (const [operatorId] of opMap) {
          if (isWithinContainer(operatorId, containerPath)) {
            withinCount++
          }
        }

        expect(withinCount).toBe(operatorsPerContainer)
      }

      const queryTime = performance.now() - startTime
      console.log(
        `Container query time for ${containers * opMap.size} checks: ${queryTime.toFixed(2)}ms`
      )

      // Container queries should be efficient
      expect(queryTime / (containers * opMap.size)).toBeLessThan(0.001)
    })
  })
})
