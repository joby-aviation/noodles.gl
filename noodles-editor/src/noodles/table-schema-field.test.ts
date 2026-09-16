import { describe, expect, it } from 'vitest'
import { TableEditorOp } from './operators'
import type { TableSchema } from './table-schema'

describe('TableSchemaField', () => {
  it('retains target-only columns across connection updates and disconnects', () => {
    const sourceSchema: TableSchema = {
      columns: [{ id: 'name', name: 'name', type: 'string', defaultValue: '' }],
    }
    const targetSchema: TableSchema = {
      columns: [
        { id: 'name', name: 'name', type: 'string', defaultValue: '' },
        { id: 'local', name: 'local', type: 'number', defaultValue: 0 },
      ],
    }
    const source = new TableEditorOp('/source', { schema: sourceSchema })
    const target = new TableEditorOp('/target', {
      schema: targetSchema,
      data: [{ name: 'Child', local: 42 }],
    })
    const edgeId = '/source.out.schema->/target.par.schema'
    source.outputs.schema.setValue(sourceSchema)

    target.inputs.schema.addConnection(edgeId, source.outputs.schema)
    source.outputs.schema.setValue({ columns: [] })

    expect(target.inputs.schema.value).toEqual(targetSchema)
    expect(target.inputs.data.value).toEqual([{ name: 'Child', local: 42 }])

    target.inputs.schema.removeConnection(edgeId)
    expect(target.inputs.schema.value).toEqual(targetSchema)

    const reconnectedSchema: TableSchema = {
      columns: [
        ...sourceSchema.columns,
        { id: 'remote', name: 'remote', type: 'boolean', defaultValue: true },
      ],
    }
    source.outputs.schema.setValue(reconnectedSchema)
    expect(target.inputs.schema.value).toEqual(targetSchema)

    target.inputs.schema.addConnection(edgeId, source.outputs.schema)
    expect(target.inputs.schema.value).toEqual({
      columns: [...targetSchema.columns, reconnectedSchema.columns[1]],
    })
    expect(target.inputs.data.value).toEqual([{ name: 'Child', local: 42, remote: true }])
  })

  it('propagates safe renames and additions', () => {
    const source = new TableEditorOp('/source')
    const target = new TableEditorOp('/target', {
      schema: {
        columns: [{ id: 'name', name: 'name', type: 'string', defaultValue: '' }],
      },
      data: [{ name: 'Child' }],
    })
    const incoming: TableSchema = {
      columns: [
        { id: 'name', name: 'display_name', type: 'string', defaultValue: '' },
        { id: 'visible', name: 'visible', type: 'boolean', defaultValue: true },
      ],
    }

    source.outputs.schema.setValue(incoming)
    target.inputs.schema.addConnection('schema-edge', source.outputs.schema)

    expect(target.inputs.schema.value).toEqual(incoming)
    expect(target.inputs.data.value).toEqual([{ display_name: 'Child', visible: true }])
    expect(target.hasConnectionErrors()).toBe(false)
  })

  it('keeps unsafe updates out of the effective schema until corrected', async () => {
    const source = new TableEditorOp('/source')
    const target = new TableEditorOp('/target', {
      schema: {
        columns: [{ id: 'value', name: 'value', type: 'string', defaultValue: '' }],
      },
      data: [{ value: 'keep me' }],
    })
    const edgeId = 'schema-edge'

    source.outputs.schema.setValue({
      columns: [{ id: 'value', name: 'value', type: 'number', defaultValue: 0 }],
    })
    target.inputs.schema.addConnection(edgeId, source.outputs.schema)

    expect(target.inputs.schema.value).toEqual({
      columns: [{ id: 'value', name: 'value', type: 'string', defaultValue: '' }],
    })
    expect(target.connectionErrors.value.get(edgeId)).toContain('invalidate 1 existing value')

    await target.pull()
    expect(target.connectionErrors.value.get(edgeId)).toContain('invalidate 1 existing value')

    const corrected: TableSchema = {
      columns: [{ id: 'value', name: 'value', type: 'string', defaultValue: 'updated' }],
    }
    source.outputs.schema.setValue(corrected)

    expect(target.inputs.schema.value).toEqual(corrected)
    expect(target.connectionErrors.value.has(edgeId)).toBe(false)
  })

  it('clears an unsafe-update warning when the source schema is removed', () => {
    const source = new TableEditorOp('/source')
    const target = new TableEditorOp('/target', {
      schema: {
        columns: [{ id: 'value', name: 'value', type: 'string', defaultValue: '' }],
      },
      data: [{ value: 'keep me' }],
    })
    const edgeId = 'schema-edge'

    source.outputs.schema.setValue({
      columns: [{ id: 'value', name: 'value', type: 'number', defaultValue: 0 }],
    })
    target.inputs.schema.addConnection(edgeId, source.outputs.schema)
    expect(target.connectionErrors.value.has(edgeId)).toBe(true)

    source.outputs.schema.setValue(null)
    expect(target.connectionErrors.value.has(edgeId)).toBe(false)
  })
})
