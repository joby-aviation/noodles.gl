import { describe, expect, it } from 'vitest'
import type { ColumnSchema, TableSchema } from './table-schema'
import {
  applySchemaOverlayPreview,
  coerceSchemaValue,
  createSchemaOverlayPreview,
  parseSchemaClipboard,
  serializeColumnClipboard,
  serializeSchemaClipboard,
} from './table-schema-clipboard'

describe('schema clipboard serialization', () => {
  it('round-trips table and column envelopes without inventing or removing IDs', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'legacy', type: 'string', defaultValue: '' },
        { id: 'stable-id', name: 'renamed', type: 'number', defaultValue: 1 },
      ],
    }

    const parsedSchema = parseSchemaClipboard(serializeSchemaClipboard(schema))
    const parsedColumn = parseSchemaClipboard(serializeColumnClipboard(schema.columns[1]))

    expect(parsedSchema).toEqual({ success: true, payload: { kind: 'table-schema', schema } })
    expect(parsedColumn).toEqual({
      success: true,
      payload: { kind: 'column-schema', column: schema.columns[1] },
    })
  })

  it('accepts validated raw table and column schemas', () => {
    expect(parseSchemaClipboard('{"columns":[{"name":"x","type":"number"}]}')).toEqual({
      success: true,
      payload: {
        kind: 'table-schema',
        schema: { columns: [{ name: 'x', type: 'number' }] },
      },
    })
    expect(parseSchemaClipboard('{"name":"label","type":"string"}')).toEqual({
      success: true,
      payload: { kind: 'column-schema', column: { name: 'label', type: 'string' } },
    })
  })

  it('rejects unsupported versions, malformed JSON, and duplicate names or identities', () => {
    expect(
      parseSchemaClipboard(
        JSON.stringify({ $noodles: 'table-schema', version: 2, schema: { columns: [] } })
      )
    ).toMatchObject({ success: false, error: expect.stringContaining('version') })
    expect(parseSchemaClipboard('not json')).toEqual({
      success: false,
      error: 'Clipboard text is not valid JSON.',
    })
    expect(
      parseSchemaClipboard(
        JSON.stringify({
          columns: [
            { name: 'same', type: 'string' },
            { name: 'same', type: 'number' },
          ],
        })
      )
    ).toMatchObject({ success: false })
    expect(
      parseSchemaClipboard(
        JSON.stringify({
          columns: [
            { id: 'same', name: 'one', type: 'string' },
            { id: 'same', name: 'two', type: 'string' },
          ],
        })
      )
    ).toMatchObject({ success: false })
  })

  it('rejects schemas with invalid defaults or inconsistent constraints', () => {
    expect(
      parseSchemaClipboard(
        JSON.stringify({ name: 'count', type: 'number', defaultValue: 'not a number' })
      )
    ).toMatchObject({ success: false })
    expect(
      parseSchemaClipboard(
        JSON.stringify({
          columns: [{ name: 'count', type: 'number', options: { min: 10, max: 1 } }],
        })
      )
    ).toMatchObject({ success: false })
  })
})

describe('createSchemaOverlayPreview', () => {
  it('keeps target order and target-only columns, updating matches before appending additions', () => {
    const target: TableSchema = {
      columns: [
        { id: 'name', name: 'name', type: 'string', defaultValue: '' },
        { id: 'local', name: 'local', type: 'boolean', defaultValue: false },
      ],
    }
    const source: TableSchema = {
      columns: [
        { id: 'name', name: 'displayName', type: 'string', defaultValue: '' },
        { name: 'offset', type: 'vec2', defaultValue: [10, 20] },
      ],
    }

    const preview = createSchemaOverlayPreview(target, [{ name: 'Alpha', local: true }], source)

    expect(preview.columns.map(column => column.status)).toEqual(['update', 'add'])
    expect(preview.columns[0]).toMatchObject({
      matchedBy: 'id',
      safe: true,
      defaultDecision: 'apply',
      counts: { preserved: 1, coerced: 0, reset: 0 },
    })

    const result = applySchemaOverlayPreview(preview)
    expect(result.schema.columns.map(column => [column.id, column.name])).toEqual([
      ['name', 'displayName'],
      ['local', 'local'],
      ['offset', 'offset'],
    ])
    expect(result.data).toEqual([{ displayName: 'Alpha', local: true, offset: [10, 20] }])
  })

  it('falls back to exact names and adopts the incoming effective identity', () => {
    const target: TableSchema = {
      columns: [{ id: 'old-lineage', name: 'value', type: 'number', defaultValue: 0 }],
    }
    const source: TableSchema = {
      columns: [{ id: 'shared-lineage', name: 'value', type: 'number', defaultValue: 10 }],
    }

    const preview = createSchemaOverlayPreview(target, [{ value: 42 }], source)
    const result = applySchemaOverlayPreview(preview)

    expect(preview.columns[0].matchedBy).toBe('name')
    expect(result.schema.columns[0]).toMatchObject({ id: 'shared-lineage', name: 'value' })
    expect(result.data).toEqual([{ value: 42 }])
  })

  it('uses adopted lineage to propagate later renames while preserving independent values', () => {
    const target: TableSchema = {
      columns: [{ name: 'value', type: 'number', defaultValue: 0 }],
    }
    const initialSource: TableSchema = {
      columns: [{ name: 'value', type: 'number', defaultValue: 0 }],
    }
    const firstTarget = applySchemaOverlayPreview(
      createSchemaOverlayPreview(target, [{ value: 10 }], initialSource)
    )
    const secondTarget = applySchemaOverlayPreview(
      createSchemaOverlayPreview(target, [{ value: 99 }], initialSource)
    )
    const renamedSource: TableSchema = {
      columns: [{ id: 'value', name: 'renamedValue', type: 'number', defaultValue: 0 }],
    }

    const renamedFirst = applySchemaOverlayPreview(
      createSchemaOverlayPreview(firstTarget.schema, firstTarget.data, renamedSource)
    )
    const renamedSecond = applySchemaOverlayPreview(
      createSchemaOverlayPreview(secondTarget.schema, secondTarget.data, renamedSource)
    )

    expect(renamedFirst.data).toEqual([{ renamedValue: 10 }])
    expect(renamedSecond.data).toEqual([{ renamedValue: 99 }])
    expect(renamedFirst.schema.columns[0]).toMatchObject({
      id: 'value',
      name: 'renamedValue',
    })
  })

  it('defaults unsafe updates to keep and only resets invalid cells when explicitly applied', () => {
    const target: TableSchema = {
      columns: [{ id: 'value', name: 'value', type: 'string', defaultValue: '' }],
    }
    const source: TableSchema = {
      columns: [{ id: 'value', name: 'value', type: 'number', defaultValue: 7 }],
    }
    const data = [{ value: '12' }, { value: '0012' }, { value: 'not a number' }]

    const preview = createSchemaOverlayPreview(target, data, source)

    expect(preview.columns[0]).toMatchObject({
      status: 'update',
      safe: false,
      defaultDecision: 'keep',
      counts: { preserved: 0, coerced: 1, reset: 2 },
    })
    expect(applySchemaOverlayPreview(preview)).toEqual({ schema: target, data })
    expect(applySchemaOverlayPreview(preview, { 0: 'apply' })).toEqual({
      schema: source,
      data: [{ value: 12 }, { value: 7 }, { value: 7 }],
    })
  })

  it('reports rename collisions and duplicate edited incoming columns as conflicts', () => {
    const target: TableSchema = {
      columns: [
        { id: 'first', name: 'first', type: 'string' },
        { id: 'second', name: 'second', type: 'string' },
      ],
    }
    const collision = createSchemaOverlayPreview(target, [{ first: 'a', second: 'b' }], {
      columns: [{ id: 'first', name: 'second', type: 'string' }],
    })
    const duplicate = createSchemaOverlayPreview(target, [], {
      columns: [
        { id: 'a', name: 'new', type: 'string' },
        { id: 'b', name: 'new', type: 'number' },
      ],
    })

    expect(collision.columns[0]).toMatchObject({
      status: 'conflict',
      defaultDecision: 'keep',
      conflict: expect.stringContaining('collide'),
    })
    expect(duplicate.columns.map(column => column.status)).toEqual(['conflict', 'conflict'])
    expect(() => applySchemaOverlayPreview(collision, { 0: 'apply' })).toThrow(
      'Cannot apply conflicting column'
    )
  })

  it('does not count default-filled new columns as destructive resets', () => {
    const preview = createSchemaOverlayPreview(
      { columns: [{ name: 'name', type: 'string' }] },
      [{ name: 'A' }, { name: 'B' }],
      { columns: [{ name: 'enabled', type: 'boolean', defaultValue: true }] }
    )

    expect(preview.columns[0]).toMatchObject({
      status: 'add',
      safe: true,
      defaultDecision: 'apply',
      counts: { preserved: 0, coerced: 0, reset: 0 },
    })
    expect(applySchemaOverlayPreview(preview).data).toEqual([
      { name: 'A', enabled: true },
      { name: 'B', enabled: true },
    ])
  })
})

describe('coerceSchemaValue', () => {
  it.each([
    [' 12.5 ', { name: 'value', type: 'number' }, 'coerced', 12.5],
    ['0012', { name: 'value', type: 'number' }, 'reset', 0],
    ['FALSE', { name: 'value', type: 'boolean' }, 'coerced', false],
    [42, { name: 'value', type: 'string' }, 'coerced', '42'],
    [' #ff00AA ', { name: 'value', type: 'color' }, 'coerced', '#ff00AA'],
    ['[1, 2]', { name: 'value', type: 'vec2' }, 'coerced', [1, 2]],
    ['1, 2, 3', { name: 'value', type: 'point3d' }, 'coerced', [1, 2, 3]],
    ['2026-02-29', { name: 'value', type: 'date' }, 'reset', expect.any(String)],
  ] as const)('coerces %j deterministically for %s', (value, column, expectedStatus, expectedValue) => {
    const result = coerceSchemaValue(value, column as ColumnSchema)
    expect(result.status).toBe(expectedStatus)
    expect(result.value).toEqual(expectedValue)
  })

  it('normalizes ISO instants and bare ISO date-times into DateTimeValue storage', () => {
    expect(coerceSchemaValue('2026-01-02T03:04:05Z', { name: 'when', type: 'dateTime' })).toEqual({
      status: 'coerced',
      value: { datetime: '2026-01-02T03:04:05.000', timezone: 'UTC' },
    })
    expect(coerceSchemaValue('2026-01-02T03:04:05', { name: 'when', type: 'dateTime' })).toEqual({
      status: 'coerced',
      value: { datetime: '2026-01-02T03:04:05.000', timezone: 'UTC' },
    })
  })

  it('enforces numeric and string-literal constraints after coercion', () => {
    expect(
      coerceSchemaValue('11', {
        name: 'limited',
        type: 'number',
        options: { max: 10 },
        defaultValue: 5,
      })
    ).toEqual({ status: 'reset', value: 5 })
    expect(
      coerceSchemaValue(2, {
        name: 'anchor',
        type: 'stringLiteral',
        options: { values: ['start', 'end'] },
        defaultValue: 'start',
      })
    ).toEqual({ status: 'reset', value: 'start' })
    expect(
      coerceSchemaValue(true, {
        name: 'literal',
        type: 'stringLiteral',
        options: { freeform: true },
      })
    ).toEqual({ status: 'coerced', value: 'true' })
  })

  it('preserves valid date-time, vector, and literal values', () => {
    const dateTime = { datetime: '2026-01-02T03:04:05.000', timezone: 'America/New_York' }
    expect(coerceSchemaValue(dateTime, { name: 'when', type: 'dateTime' }).status).toBe('preserved')
    expect(coerceSchemaValue([1, 2, 3], { name: 'position', type: 'vec3' }).status).toBe(
      'preserved'
    )
    expect(
      coerceSchemaValue('start', {
        name: 'anchor',
        type: 'stringLiteral',
        options: { values: ['start', 'end'] },
      }).status
    ).toBe('preserved')
  })
})
