import { describe, it } from 'vitest'
import nycTaxisProject from '../../../src/examples/nyc-taxis/noodles.json'
import { migrateProject } from '../utils/migrate-schema'
import { opTypes } from '../operators'

describe('NYC Taxis execution test', () => {
  it('should execute operators after migration', async () => {
    const project = nycTaxisProject as any
    const migrated = await migrateProject(project)
    
    console.log('\n=== Migration Results ===')
    console.log('Nodes:', migrated.nodes.map(n => `${n.id} (${n.type})`).join('\n  '))
    console.log('\nALL Edges:')
    for (const e of migrated.edges) {
      console.log(`  ${e.source} -> ${e.target} (${e.sourceHandle} -> ${e.targetHandle})`)
    }
    
    // Try to instantiate operators
    const operators = new Map()
    for (const node of migrated.nodes) {
      const OpClass = opTypes[node.type]
      if (OpClass) {
        try {
          const op = new OpClass(node.id, node.data.inputs)
          operators.set(node.id, op)
        } catch (e) {
          console.error(`Failed to create ${node.type} ${node.id}:`, e.message)
        }
      }
    }
    
    console.log('\nCreated operators:', operators.size, '/', migrated.nodes.length)
  })
})
