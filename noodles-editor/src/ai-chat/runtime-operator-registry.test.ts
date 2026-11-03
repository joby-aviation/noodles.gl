import { describe, expect, it } from 'vitest'
import { buildOperatorRegistry } from './runtime-operator-registry'

describe('runtime operator registry', () => {
  it('retains serialized TableEditor state without exposing an output port', () => {
    const tableEditor = buildOperatorRegistry().operators.TableEditorOp

    expect(Object.keys(tableEditor.inputs)).toEqual(['data', 'schema'])
    expect(tableEditor.inputs.schema.internal).toBe(true)
    expect(Object.keys(tableEditor.outputs)).toEqual(['data'])
  })
})
