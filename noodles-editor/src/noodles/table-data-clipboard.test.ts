import { describe, expect, it } from 'vitest'
import {
  inferTableData,
  normalizeTableColumnNames,
  parseTableClipboard,
  planAnchoredTablePaste,
  serializeTableRangeClipboard,
} from './table-data-clipboard'
import type { ColumnSchema } from './table-schema'

describe('table data clipboard', () => {
  const columns: ColumnSchema[] = [
    { name: 'label', type: 'string', defaultValue: '' },
    { name: 'offset', type: 'vec2', defaultValue: [0, 0] },
  ]

  it('serializes quoted TSV, semantic HTML, and a typed range payload', () => {
    const serialized = serializeTableRangeClipboard(
      columns,
      [
        ['A\tvalue', [1, 2]],
        ['two\nlines', [3, 4]],
      ],
      { includeColumnNames: true }
    )

    expect(serialized.plainText).toContain('label\toffset')
    expect(serialized.plainText).toContain('"A\tvalue"')
    expect(serialized.plainText).toContain('"two\nlines"')
    expect(serialized.html).toContain('<th>label</th>')
    expect(serialized.html).toContain('<td>[1,2]</td>')

    const parsed = parseTableClipboard({
      plainText: 'fallback',
      richText: serialized.richText,
    })
    expect(parsed).toMatchObject({
      kind: 'table',
      format: 'noodles-range',
      columnNames: ['label', 'offset'],
      columns,
      rows: [
        ['A\tvalue', [1, 2]],
        ['two\nlines', [3, 4]],
      ],
    })
  })

  it('parses Sheets HTML before plain-text fallback', () => {
    const parsed = parseTableClipboard({
      plainText: 'wrong\tfallback',
      html: '<table><thead><tr><th>City</th><th>Count</th></tr></thead><tbody><tr><td>LA</td><td>2</td></tr></tbody></table>',
    })
    expect(parsed).toEqual({
      kind: 'table',
      format: 'html',
      columnNames: ['City', 'Count'],
      rows: [['LA', '2']],
    })
  })

  it('preserves multiline cells from Sheets HTML', () => {
    const parsed = parseTableClipboard({
      plainText: 'wrong plain-text fallback',
      html: '<table><tbody><tr><td>one<br>two</td><td><div>alpha</div><div>beta</div></td></tr></tbody></table>',
    })

    expect(parsed).toMatchObject({
      kind: 'table',
      format: 'html',
      rows: [['one\ntwo', 'alpha\nbeta']],
    })
  })

  it('parses quoted TSV with CRLF, embedded tabs/newlines, and meaningful blank cells', () => {
    const parsed = parseTableClipboard({
      plainText: 'name\tnote\r\nA\t"tab\there"\r\nB\t"two\nlines"\r\n\t\r\n',
    })
    expect(parsed).toMatchObject({
      kind: 'table',
      format: 'tsv',
      rows: [
        ['name', 'note'],
        ['A', 'tab\there'],
        ['B', 'two\nlines'],
        ['', ''],
      ],
    })
  })

  it('routes tagged schemas and validated graph JSON ahead of tabular JSON', () => {
    const schema = parseTableClipboard({
      plainText: JSON.stringify({
        $noodles: 'table-schema',
        version: 1,
        schema: { columns: [{ name: 'name', type: 'string' }] },
      }),
    })
    expect(schema.kind).toBe('schema')

    const graph = parseTableClipboard({
      plainText: JSON.stringify({
        nodes: [{ id: '/x', type: 'NumberOp', position: { x: 0, y: 0 } }],
        edges: [],
      }),
    })
    expect(graph).toMatchObject({ kind: 'graph', graph: { nodes: [{ id: '/x' }], edges: [] } })

    expect(parseTableClipboard({ plainText: '{broken' })).toEqual({ kind: 'unrecognized' })
    expect(parseTableClipboard({ plainText: '{"nodes":{},"edges":[]}' })).toEqual({
      kind: 'unrecognized',
    })
  })

  it('rejects graphs with blank or duplicate identities', () => {
    const node = { id: '/x', type: 'NumberOp', position: { x: 0, y: 0 } }
    const cases = [
      { nodes: [{ ...node, id: '' }], edges: [] },
      { nodes: [node, node], edges: [] },
      {
        nodes: [node],
        edges: [
          { id: 'edge', source: '/x', target: '/x' },
          { id: 'edge', source: '/x', target: '/x' },
        ],
      },
      { nodes: [node], edges: [{ id: 'edge', source: '', target: '/x' }] },
    ]

    for (const graph of cases) {
      expect(parseTableClipboard({ plainText: JSON.stringify(graph) })).toEqual({
        kind: 'unrecognized',
      })
    }

    expect(
      parseTableClipboard({
        plainText: JSON.stringify({
          nodes: [],
          edges: [{ id: 'edge', source: '/existing-a', target: '/existing-b' }],
        }),
      }).kind
    ).toBe('graph')
  })

  it('parses JSON records, JSON arrays, consistent CSV, and opt-in scalars', () => {
    expect(parseTableClipboard({ plainText: '[{"a":1},{"b":2,"a":3}]' })).toMatchObject({
      kind: 'table',
      format: 'json-records',
      columnNames: ['a', 'b'],
      rows: [
        [1, undefined],
        [3, 2],
      ],
    })
    expect(parseTableClipboard({ plainText: '[[1,2],[3,4]]' })).toMatchObject({
      kind: 'table',
      format: 'json-arrays',
      rows: [
        [1, 2],
        [3, 4],
      ],
    })
    expect(parseTableClipboard({ plainText: 'name,note\nA,"two, values"' })).toMatchObject({
      kind: 'table',
      format: 'csv',
      rows: [
        ['name', 'note'],
        ['A', 'two, values'],
      ],
    })
    expect(parseTableClipboard({ plainText: 'hello' })).toEqual({ kind: 'unrecognized' })
    expect(parseTableClipboard({ plainText: 'hello' }, { allowScalar: true })).toMatchObject({
      kind: 'table',
      format: 'scalar',
      rows: [['hello']],
    })
  })

  it('accepts explicitly quoted one-column CSV without claiming arbitrary multiline text', () => {
    expect(parseTableClipboard({ plainText: 'offset\n"[1,2]"\n"[3,4]"' })).toMatchObject({
      kind: 'table',
      format: 'csv',
      rows: [['offset'], ['[1,2]'], ['[3,4]']],
    })
    expect(parseTableClipboard({ plainText: 'first line\nsecond line' })).toEqual({
      kind: 'unrecognized',
    })
  })

  it('normalizes blank and duplicate headers deterministically', () => {
    expect(normalizeTableColumnNames([' name ', '', 'name', '', 'name'], 5)).toEqual([
      'name',
      'Column 2',
      'name 2',
      'Column 4',
      'name 3',
    ])
  })

  it('infers conservative types from every nonblank row and coerces complete data', () => {
    const inferred = inferTableData(
      [
        ['flag', 'count', 'identifier', 'color', 'day', 'moment', 'v2', 'v3'],
        ['TRUE', '1', '001', '#ff0000', '2026-09-16', '2026-09-16T10:00:00Z', '[1,2]', '[1,2,3]'],
        [
          'false',
          '2.5',
          '002',
          '#00ff00',
          '2026-09-17',
          '2026-09-17T11:00:00Z',
          '[3,4]',
          '[4,5,6]',
        ],
      ],
      { firstRowContainsHeaders: true }
    )

    expect(inferred.schema.columns.map(column => column.type)).toEqual([
      'boolean',
      'number',
      'string',
      'color',
      'date',
      'dateTime',
      'vec2',
      'vec3',
    ])
    expect(inferred.data[1]).toMatchObject({
      flag: false,
      count: 2.5,
      identifier: '002',
      color: '#00ff00',
      day: '2026-09-17',
      v2: [3, 4],
      v3: [4, 5, 6],
    })
    expect(inferred.data[1].moment).toEqual({
      datetime: expect.any(String),
      timezone: 'UTC',
    })
  })

  it('uses all rows so mixed or ambiguous columns remain strings', () => {
    const inferred = inferTableData(
      [
        ['value', 'date'],
        ['1', '09/10/2026'],
        ['not a number', '10/09/2026'],
      ],
      { firstRowContainsHeaders: true }
    )
    expect(inferred.schema.columns.map(column => column.type)).toEqual(['string', 'string'])
  })

  it('plans lossless row growth and flags resets or right-edge overflow for preview', () => {
    const schema = {
      columns: [
        { name: 'name', type: 'string' as const, defaultValue: '' },
        { name: 'count', type: 'number' as const, defaultValue: 0 },
      ],
    }
    const safe = planAnchoredTablePaste(schema, [{ name: 'old', count: 1 }], [['new', '2']], {
      row: 1,
      column: 0,
    })
    expect(safe).toMatchObject({
      needsPreview: false,
      rowsAdded: 1,
      counts: { preserved: 1, coerced: 1, reset: 0 },
      data: [
        { name: 'old', count: 1 },
        { name: 'new', count: 2 },
      ],
    })

    const unsafe = planAnchoredTablePaste(schema, [], [['not-a-number', 'overflow']], {
      row: 0,
      column: 1,
    })
    expect(unsafe).toMatchObject({
      needsPreview: true,
      overflowColumnCount: 1,
      counts: { preserved: 0, coerced: 0, reset: 1 },
    })
    expect(unsafe.data).toEqual([{ name: '', count: 0 }])
  })

  it('imports every cell in a 1,000 × 10 TSV within the browser budget', () => {
    const rows = Array.from({ length: 1001 }, (_, rowIndex) =>
      Array.from({ length: 10 }, (_, columnIndex) =>
        rowIndex === 0 ? `Column ${columnIndex + 1}` : String(rowIndex * 10 + columnIndex)
      ).join('\t')
    ).join('\n')

    const started = performance.now()
    const parsed = parseTableClipboard({ plainText: rows })
    expect(parsed.kind).toBe('table')
    if (parsed.kind !== 'table') return
    const inferred = inferTableData(parsed.rows, { firstRowContainsHeaders: true })
    const elapsed = performance.now() - started

    expect(inferred.data).toHaveLength(1000)
    expect(inferred.schema.columns).toHaveLength(10)
    expect(inferred.data.at(-1)?.['Column 10']).toBe(10009)
    expect(elapsed).toBeLessThan(500)
  })
})
