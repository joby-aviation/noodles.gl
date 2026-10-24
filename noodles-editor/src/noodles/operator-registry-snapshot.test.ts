// noodles-validate checks project files in plain Node, where the operator classes
// can't load, so it reads this snapshot of them instead. A changed operator, field
// or migration fails this test until the snapshot is regenerated:
//
//   npm run generate:registry

import { describe, expect, it } from 'vitest'
import { buildOperatorRegistry } from '../ai-chat/runtime-operator-registry'
import { fieldTypeToClass } from './fields'
import { NOODLES_VERSION } from './utils/migrate-schema'

// JSON writes Infinity and NaN as null, which would publish a wrong default. Such
// defaults are kept as JS text in defaultText instead.
function hasNonFinite(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (value && typeof value === 'object') return Object.values(value).some(hasNonFinite)
  return false
}

function jsText(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(jsText).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(
      ([, v]) => v !== undefined && typeof v !== 'function'
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${jsText(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function snapshotField(type: string, value: unknown) {
  // A DateField default is a local time, so it differs by timezone
  if (type === 'DateField') return { type }
  return hasNonFinite(value) ? { type, defaultText: jsText(value) } : { type, default: value }
}

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
              snapshotField(field.type, field.defaultValue),
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

describe('jsText', () => {
  it('keeps the non-finite numbers JSON turns into null', () => {
    expect(jsText([-Infinity, -Infinity, Infinity, Infinity])).toBe(
      '[-Infinity,-Infinity,Infinity,Infinity]'
    )
    expect(jsText({ max: Infinity, min: NaN, label: 'a', skip: undefined })).toBe(
      '{"max":Infinity,"min":NaN,"label":"a"}'
    )
  })
})

describe('operator registry snapshot', () => {
  it('matches noodles-validate/registry.json (run npm run generate:registry)', async () => {
    const json = `${JSON.stringify(buildSnapshot(), null, 2)}\n`
    await expect(json).toMatchFileSnapshot('../../../noodles-validate/registry.json')
  })
})
