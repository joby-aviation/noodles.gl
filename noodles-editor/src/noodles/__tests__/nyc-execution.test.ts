import { describe, expect, it } from 'vitest'
import nycTaxisProject from '../../../src/examples/nyc-taxis/noodles.json'
import { migrateProject } from '../utils/migrate-schema'

describe('NYC Taxis multi-accessor chaining', () => {
  it('should chain CreateAttributeOps when a layer uses multiple accessors', async () => {
    const project = nycTaxisProject as any
    const migrated = await migrateProject(project)

    // Find the arc layer which uses BOTH pickup-position and dropoff-position accessors
    const arcLayer = migrated.nodes.find((n: any) => n.id === '/arc-layer')
    expect(arcLayer).toBeDefined()

    // Find the data connection to arc-layer
    const arcDataEdge = migrated.edges.find(
      (e: any) => e.target === '/arc-layer' && e.targetHandle === 'par.data'
    )
    expect(arcDataEdge).toBeDefined()

    // The arc layer should be connected to a CreateAttributeOp
    const finalCreateAttr = migrated.nodes.find((n: any) => n.id === arcDataEdge!.source)
    expect(finalCreateAttr?.type).toBe('CreateAttributeOp')

    // Walk backwards through the chain to find all CreateAttributeOps
    const createAttrChain: any[] = []
    let currentNodeId = arcDataEdge!.source

    while (currentNodeId) {
      const node = migrated.nodes.find((n: any) => n.id === currentNodeId)
      if (node?.type === 'CreateAttributeOp') {
        createAttrChain.push(node)

        // Find the input edge
        const inputEdge = migrated.edges.find(
          (e: any) => e.target === currentNodeId && e.targetHandle === 'par.data'
        )
        currentNodeId = inputEdge?.source || null
      } else {
        // Reached the data source
        break
      }
    }

    // Should have multiple CreateAttributeOps chained together
    expect(createAttrChain.length).toBeGreaterThan(1)

    // Extract attribute names from the chain
    const attributeNames = createAttrChain.map((n: any) => n.data.inputs.name)

    // Arc layer needs BOTH sourcePosition and targetPosition
    expect(attributeNames).toContain('sourcePosition')
    expect(attributeNames).toContain('targetPosition')

    // Verify each CreateAttributeOp in the chain has a data input
    // (either from data source or from previous CreateAttributeOp)
    for (const node of createAttrChain) {
      const inputEdge = migrated.edges.find(
        (e: any) => e.target === node.id && e.targetHandle === 'par.data'
      )
      expect(inputEdge).toBeDefined()
      expect(inputEdge!.source).toBeTruthy()
    }
  })

  it('should create unique attributes for each layer', async () => {
    const project = nycTaxisProject as any
    const migrated = await migrateProject(project)

    // Verify pickup-layer gets data with 'position' attribute
    const pickupDataEdge = migrated.edges.find(
      (e: any) => e.target === '/pickup-layer' && e.targetHandle === 'par.data'
    )
    expect(pickupDataEdge).toBeDefined()

    // Walk the chain to find position attribute
    let currentId = pickupDataEdge!.source
    let foundPositionAttr = false

    while (currentId) {
      const node = migrated.nodes.find((n: any) => n.id === currentId)
      if (node?.type === 'CreateAttributeOp' && node.data.inputs.name === 'position') {
        foundPositionAttr = true
        break
      }

      const inputEdge = migrated.edges.find(
        (e: any) => e.target === currentId && e.targetHandle === 'par.data'
      )
      currentId = inputEdge?.source || null
    }

    expect(foundPositionAttr).toBe(true)

    // Similarly for dropoff-layer
    const dropoffDataEdge = migrated.edges.find(
      (e: any) => e.target === '/dropoff-layer' && e.targetHandle === 'par.data'
    )
    expect(dropoffDataEdge).toBeDefined()

    currentId = dropoffDataEdge!.source
    foundPositionAttr = false

    while (currentId) {
      const node = migrated.nodes.find((n: any) => n.id === currentId)
      if (node?.type === 'CreateAttributeOp' && node.data.inputs.name === 'position') {
        foundPositionAttr = true
        break
      }

      const inputEdge = migrated.edges.find(
        (e: any) => e.target === currentId && e.targetHandle === 'par.data'
      )
      currentId = inputEdge?.source || null
    }

    expect(foundPositionAttr).toBe(true)
  })
})
