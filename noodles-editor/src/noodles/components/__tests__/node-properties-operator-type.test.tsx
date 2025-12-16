import { describe, expect, it } from 'vitest'
import { StringOp } from '../../operators'

// Test documenting the constructor.name minification issue and our solution.
//
// PROBLEM: In minified production builds, JavaScript class names get mangled
// (e.g., "StringOp" becomes "NiH"). This breaks any code that relies on
// constructor.name for type identification.
//
// SOLUTION: Always use node.type (from ReactFlow nodes) instead of
// op.constructor.name. The node.type is stored as a string in noodles.json
// and is never minified because it's data, not code.
//
// AFFECTED COMPONENTS:
// - node-properties.tsx: Uses node.type to display operator type
// - node-tree-sidebar.tsx: Uses nodeTypeMap.get(id) from ReactFlow nodes
// - ai-chat/mcp-tools.ts: Uses node.type for operator type identification
//
// TEST LIMITATION: Unit tests run in an unminified environment, so they cannot
// directly verify minification behavior. This test documents the issue and
// verifies the basic contract that node.type is a stable string identifier.
//
// MANUAL VERIFICATION STEPS:
// 1. Build production bundle: yarn build
// 2. Inspect dist/assets/*.js to confirm class names are minified
// 3. Run production build and verify operator types display correctly:
//    - Check the node tree sidebar shows correct operator types
//    - Check the node properties panel header shows correct type
//    - Check AI chat tools return correct operator types
describe('Operator type names in production builds', () => {
  it('documents why we use node.type instead of constructor.name', () => {
    // Create an operator instance
    const op = new StringOp('/test')

    // Mock a ReactFlow node (structure from noodles.json)
    const node = {
      id: '/test',
      type: 'StringOp', // Stored as string in JSON, never minified
      position: { x: 0, y: 0 },
      data: { inputs: { value: 'hello' } },
    }

    // In development builds, constructor.name is readable
    expect(op.constructor.name).toBe('StringOp')

    // In production builds with minification enabled, constructor.name would be:
    // op.constructor.name === "NiH" (or some other mangled name)

    // The node.type property is stable across all build modes
    expect(node.type).toBe('StringOp')
    expect(typeof node.type).toBe('string')

    // Key insight: node.type comes from JSON, not JavaScript class names
    // Therefore it is ALWAYS preserved, making it the source of truth
  })

  it('verifies node.type is the correct source of truth', () => {
    // Create a node structure as it appears in noodles.json
    const node = {
      id: '/my-string-op',
      type: 'StringOp',
      position: { x: 100, y: 200 },
      data: { inputs: { value: 'test' } },
    }

    // Verify the type is a string property (not derived from constructor)
    expect(node.type).toBe('StringOp')
    expect(Object.hasOwn(node, 'type')).toBe(true)

    // This property:
    // 1. Is serialized to/from JSON
    // 2. Is never minified (it's data, not code)
    // 3. Matches the operator class name string in the registry
    // 4. Is the single source of truth for operator types in the UI
  })
})
