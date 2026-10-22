// noodles-validate checks project files in plain Node, where the operator classes
// can't load, so it reads this snapshot of them instead. A changed operator, field
// or migration fails this test until the snapshot is regenerated:
//
//   npm run generate:registry

import { describe, expect, it } from 'vitest'
import { buildOperatorRegistry } from '../ai-chat/runtime-operator-registry'
import { fieldTypeToClass } from './fields'
import { NOODLES_VERSION } from './utils/migrate-schema'

function buildSnapshot() {
  const registry = buildOperatorRegistry()
  const operators = Object.fromEntries(
    Object.entries(registry.operators)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, op]) => [
        type,
        {
          name: op.name,
          type: op.type,
          category: op.category,
          description: op.description,
          inputs: Object.fromEntries(
            Object.entries(op.inputs).map(([name, field]) => [
              name,
              // A DateField default is a local time, so it differs by timezone
              field.type === 'DateField'
                ? { type: field.type }
                : { type: field.type, default: field.defaultValue },
            ])
          ),
          outputs: Object.fromEntries(
            Object.entries(op.outputs).map(([name, field]) => [name, { type: field.type }])
          ),
        },
      ])
  )
  // What a node's data.customInputs[].type may be
  const customFieldTypes = Object.keys(fieldTypeToClass)
  return { projectVersion: NOODLES_VERSION, customFieldTypes, operators }
}

describe('operator registry snapshot', () => {
  it('matches noodles-validate/registry.json (run npm run generate:registry)', async () => {
    const json = `${JSON.stringify(buildSnapshot(), null, 2)}\n`
    await expect(json).toMatchFileSnapshot('../../../noodles-validate/registry.json')
  })
})
