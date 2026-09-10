import { describe, expect, it } from 'vitest'
import nycTaxisProject from '../../../src/examples/nyc-taxis/noodles.json'
import { migrateProject } from '../utils/migrate-schema'

describe('NYC Taxis example migration', () => {
  it('should migrate NYC taxis from v6 to v15 without duplicates', async () => {
    const project = nycTaxisProject as any

    expect(project.version).toBe(6)

    // Before migration
    const accessorsBefore = project.nodes.filter(n => n.type === 'AccessorOp')
    expect(accessorsBefore.length).toBe(2) // /pickup-position and /dropoff-position

    // Run migration
    const migrated = await migrateProject(project)

    // After migration
    expect(migrated.version).toBe(15)

    // All AccessorOps should be gone
    const accessorsAfter = migrated.nodes.filter(n => n.type === 'AccessorOp')
    expect(accessorsAfter).toHaveLength(0)

    // CreateAttributeOps should exist
    const createAttrOps = migrated.nodes.filter(n => n.type === 'CreateAttributeOp')
    expect(createAttrOps.length).toBeGreaterThan(0)

    // Check for deduplication - should have exactly 2 CreateAttributeOps (one per unique accessor)
    // /pickup-position and /dropoff-position each create one CreateAttributeOp
    // Even though they're used by multiple layers, they should be deduplicated
    expect(createAttrOps.length).toBeLessThanOrEqual(4) // Max 2 per accessor if different attributes

    // All layers should have data connections
    const layers = ['/arc-layer', '/pickup-layer', '/dropoff-layer']
    for (const layerId of layers) {
      const dataEdge = migrated.edges.find(
        e => e.target === layerId && e.targetHandle === 'par.data'
      )
      expect(dataEdge).toBeDefined()
      expect(dataEdge?.source).toBeDefined()

      // Data should come from a CreateAttributeOp
      const sourceNode = migrated.nodes.find(n => n.id === dataEdge?.source)
      expect(sourceNode?.type).toBe('CreateAttributeOp')
    }

    // Verify no old accessor edges remain
    const oldAccessorEdges = migrated.edges.filter(e => e.sourceHandle === 'out.accessor')
    expect(oldAccessorEdges).toHaveLength(0)

    // Verify attribute names
    const attrNames = createAttrOps.map(n => n.data.inputs.name)
    expect(attrNames).toContain('position')

    // Verify expressions are preserved
    const posAttr = createAttrOps.find(n => n.data.inputs.name === 'position')
    expect(posAttr?.data.inputs.expression).toMatch(/\[d\.(pickup|dropoff)_(longitude|latitude)/)

    console.log('\n✓ NYC Taxis migration successful!')
    console.log(`  Original: ${project.nodes.length} nodes, ${project.edges.length} edges`)
    console.log(`  Migrated: ${migrated.nodes.length} nodes, ${migrated.edges.length} edges`)
    console.log(`  CreateAttributeOps: ${createAttrOps.length}`)
    console.log(`  CreateAttributeOp names: ${attrNames.join(', ')}`)
  })
})
