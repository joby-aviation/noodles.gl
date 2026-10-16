import { describe, expect, it } from 'vitest'
import { buildOperatorRegistry } from './runtime-operator-registry'

describe('runtime operator registry', () => {
  it('exposes only public TableEditor ports', () => {
    const tableEditor = buildOperatorRegistry().operators.TableEditorOp

    expect(Object.keys(tableEditor.inputs)).toEqual(['data'])
    expect(Object.keys(tableEditor.outputs)).toEqual(['data'])
  })
})
