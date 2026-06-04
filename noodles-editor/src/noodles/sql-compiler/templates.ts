import type { SQLTemplate } from './types'

// Template registry: maps operator display names to their SQL templates.
// Templates use holes:
//   {{upstream}}     — first upstream CTE alias
//   {{upstream2}}    — second upstream CTE alias (JoinOp)
//   {{$fieldName}}   — prepared statement parameter (bound at runtime)
//   {{ident:hole}}   — escaped identifier from field value
//   {{expr:name}}    — complex expression built at compile time from field values
//
// Some operators need runtime SQL generation because the query structure
// depends on field values (e.g., FilterOp condition changes the SQL operator).
// These use the 'dynamic' flag and a generator function instead of a static template.

export interface StaticTemplate extends SQLTemplate {
  dynamic?: false
}

export interface DynamicTemplate {
  dynamic: true
  upstreamCount: 0 | 1 | 2
  generate: (ctx: TemplateGeneratorContext) => GeneratedSQL
}

export interface TemplateGeneratorContext {
  upstream: string
  upstream2?: string
  params: Record<string, unknown>
  identifiers: Record<string, string | string[]>
  allocParam: (field: string, type: 'string' | 'number' | 'boolean' | 'json') => string
}

export interface GeneratedSQL {
  sql: string
  extraParams?: Array<{ field: string; type: 'string' | 'number' | 'boolean' | 'json'; value: unknown }>
}

export type OperatorTemplate = StaticTemplate | DynamicTemplate

// --- Static Templates ---

export const fileOpTemplate: StaticTemplate = {
  sql: `SELECT * FROM read_csv_auto({{$url}}, header=true, auto_detect=true)`,
  params: [{ field: 'url', type: 'string' }],
  identifiers: [],
  upstreamCount: 0,
}

export const fileOpJsonTemplate: StaticTemplate = {
  sql: `SELECT * FROM read_json_auto({{$url}})`,
  params: [{ field: 'url', type: 'string' }],
  identifiers: [],
  upstreamCount: 0,
}

export const sortOpTemplate: StaticTemplate = {
  sql: `SELECT * FROM {{upstream}} ORDER BY {{ident:key}} {{ident:order}}`,
  params: [],
  identifiers: [
    { field: 'key', hole: 'key' },
    { field: 'order', hole: 'order' },
  ],
  upstreamCount: 1,
}

export const sliceOpTemplate: StaticTemplate = {
  sql: `SELECT * FROM {{upstream}} LIMIT {{$end}} OFFSET {{$start}}`,
  params: [
    { field: 'end', type: 'number' },
    { field: 'start', type: 'number' },
  ],
  identifiers: [],
  upstreamCount: 1,
}

export const uniqueOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers }) {
    const cols = identifiers.columns as string[] | undefined
    if (cols && cols.length > 0) {
      const colList = cols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
      return { sql: `SELECT DISTINCT ON (${colList}) * FROM ${upstream}` }
    }
    return { sql: `SELECT DISTINCT * FROM ${upstream}` }
  },
}

export const castOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers }) {
    const col = identifiers.column as string
    const targetType = identifiers.targetType as string
    const outputCol = (identifiers.outputColumn as string) || col
    const escaped = `"${col.replace(/"/g, '""')}"`
    const outEscaped = `"${outputCol.replace(/"/g, '""')}"`
    return {
      sql: `SELECT *, CAST(${escaped} AS ${targetType}) AS ${outEscaped} FROM ${upstream}`,
    }
  },
}

export const coalesceOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers }) {
    const cols = identifiers.columns as string[]
    const outputCol = identifiers.outputColumn as string
    const colList = cols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
    const outEscaped = `"${outputCol.replace(/"/g, '""')}"`
    return {
      sql: `SELECT *, COALESCE(${colList}) AS ${outEscaped} FROM ${upstream}`,
    }
  },
}

export const filterOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers, allocParam, params }) {
    const col = `"${(identifiers.columnName as string).replace(/"/g, '""')}"`
    const condition = identifiers.condition as string
    const valueParam = allocParam('value', 'string')

    let whereClause: string
    switch (condition) {
      case 'equals': whereClause = `${col} = ${valueParam}`; break
      case 'not equals': whereClause = `${col} != ${valueParam}`; break
      case 'greater than': whereClause = `${col} > ${valueParam}`; break
      case 'less than': whereClause = `${col} < ${valueParam}`; break
      case 'greater than or equal to': whereClause = `${col} >= ${valueParam}`; break
      case 'less than or equal to': whereClause = `${col} <= ${valueParam}`; break
      case 'contains': whereClause = `${col} LIKE '%' || ${valueParam} || '%'`; break
      case 'not contains': whereClause = `${col} NOT LIKE '%' || ${valueParam} || '%'`; break
      case 'in': {
        const values = String(params.value || '').split(',').map(s => s.trim())
        const placeholders = values.map((_, i) => allocParam(`value_in_${i}`, 'string')).join(', ')
        whereClause = `${col} IN (${placeholders})`
        return {
          sql: `SELECT * FROM ${upstream} WHERE ${whereClause}`,
          extraParams: values.map((v, i) => ({ field: `value_in_${i}`, type: 'string' as const, value: v })),
        }
      }
      case 'not in': {
        const values = String(params.value || '').split(',').map(s => s.trim())
        const placeholders = values.map((_, i) => allocParam(`value_notin_${i}`, 'string')).join(', ')
        whereClause = `${col} NOT IN (${placeholders})`
        return {
          sql: `SELECT * FROM ${upstream} WHERE ${whereClause}`,
          extraParams: values.map((v, i) => ({ field: `value_notin_${i}`, type: 'string' as const, value: v })),
        }
      }
      default: whereClause = 'TRUE'
    }

    return { sql: `SELECT * FROM ${upstream} WHERE ${whereClause}` }
  },
}

export const groupByOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers }) {
    const groupCols = identifiers.groupByColumns as string[]
    const aggs = identifiers.aggregations as string

    if (!groupCols.length) return { sql: `SELECT * FROM ${upstream}` }

    const groupList = groupCols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
    const aggSpecs = parseAggregationString(aggs as unknown as string)
    const aggExprs = aggSpecs.map(a => {
      const col = a.column === '*' ? '*' : `"${a.column.replace(/"/g, '""')}"`
      const alias = a.alias || `${a.function}_${a.column}`
      return `${a.function.toUpperCase()}(${col}) AS "${alias.replace(/"/g, '""')}"`
    }).join(', ')

    const selectList = aggExprs ? `${groupList}, ${aggExprs}` : groupList
    return { sql: `SELECT ${selectList} FROM ${upstream} GROUP BY ${groupList}` }
  },
}

export const joinOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 2,
  generate({ upstream, upstream2, identifiers }) {
    const joinType = (identifiers.joinType as string).toUpperCase()
    const leftKey = `"${(identifiers.leftKey as string).replace(/"/g, '""')}"`
    const rightKey = `"${(identifiers.rightKey as string).replace(/"/g, '""')}"`

    if (joinType === 'CROSS') {
      return { sql: `SELECT * FROM ${upstream} CROSS JOIN ${upstream2}` }
    }
    return {
      sql: `SELECT * FROM ${upstream} l ${joinType} JOIN ${upstream2} r ON l.${leftKey} = r.${rightKey}`,
    }
  },
}

export const pivotOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers }) {
    const pivotCol = `"${(identifiers.pivotColumn as string).replace(/"/g, '""')}"`
    const valueCol = `"${(identifiers.valueColumn as string).replace(/"/g, '""')}"`
    const indexCol = `"${(identifiers.indexColumn as string).replace(/"/g, '""')}"`
    const agg = (identifiers.aggregation as string).toUpperCase()
    return {
      sql: `PIVOT ${upstream} ON ${pivotCol} USING ${agg}(${valueCol}) GROUP BY ${indexCol}`,
    }
  },
}

export const unpivotOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers }) {
    const valueCols = identifiers.valueColumns as string[]
    const varName = `"${(identifiers.variableName as string).replace(/"/g, '""')}"`
    const valName = `"${(identifiers.valueName as string).replace(/"/g, '""')}"`
    const colList = valueCols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')
    return {
      sql: `UNPIVOT ${upstream} ON (${colList}) INTO NAME ${varName} VALUE ${valName}`,
    }
  },
}

export const windowOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers, params }) {
    const col = identifiers.column as string
    const fn = (identifiers.function as string).toLowerCase()
    const partitionBy = identifiers.partitionBy as string[]
    const orderBy = identifiers.orderBy as string
    const order = (identifiers.order as string).toUpperCase()
    const windowSize = params.windowSize as number
    const outputCol = (identifiers.outputColumn as string) || `${fn}_${col}`

    const partClause = partitionBy?.length
      ? `PARTITION BY ${partitionBy.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')}`
      : ''
    const orderClause = orderBy ? `ORDER BY "${orderBy.replace(/"/g, '""')}" ${order}` : ''
    const windowClause = [partClause, orderClause].filter(Boolean).join(' ')

    let fnExpr: string
    const escapedCol = `"${col.replace(/"/g, '""')}"`
    switch (fn) {
      case 'row_number': fnExpr = 'ROW_NUMBER()'; break
      case 'rank': fnExpr = 'RANK()'; break
      case 'dense_rank': fnExpr = 'DENSE_RANK()'; break
      case 'lag': fnExpr = `LAG(${escapedCol})`; break
      case 'lead': fnExpr = `LEAD(${escapedCol})`; break
      default: {
        const frame = windowSize > 0
          ? `ROWS BETWEEN ${windowSize - 1} PRECEDING AND CURRENT ROW`
          : 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'
        fnExpr = `${fn.toUpperCase()}(${escapedCol})`
        const fullWindow = `${windowClause} ${frame}`.trim()
        const outEscaped = `"${outputCol.replace(/"/g, '""')}"`
        return { sql: `SELECT *, ${fnExpr} OVER (${fullWindow}) AS ${outEscaped} FROM ${upstream}` }
      }
    }
    const outEscaped = `"${outputCol.replace(/"/g, '""')}"`
    return { sql: `SELECT *, ${fnExpr} OVER (${windowClause}) AS ${outEscaped} FROM ${upstream}` }
  },
}

export const stringTransformOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers, allocParam, params }) {
    const col = `"${(identifiers.column as string).replace(/"/g, '""')}"`
    const operation = identifiers.operation as string
    const outputCol = (identifiers.outputColumn as string) || (identifiers.column as string)
    const outEscaped = `"${outputCol.replace(/"/g, '""')}"`

    let expr: string
    switch (operation) {
      case 'upper': expr = `UPPER(${col})`; break
      case 'lower': expr = `LOWER(${col})`; break
      case 'trim': expr = `TRIM(${col})`; break
      case 'title': expr = `INITCAP(${col})`; break
      case 'length': expr = `LENGTH(${col})`; break
      case 'reverse': expr = `REVERSE(${col})`; break
      case 'hash_md5': expr = `MD5(${col})`; break
      case 'regex_extract': {
        const patternParam = allocParam('pattern', 'string')
        expr = `regexp_extract(${col}, ${patternParam})`
        break
      }
      case 'regex_replace': {
        const patternParam = allocParam('pattern', 'string')
        const replacementParam = allocParam('replacement', 'string')
        expr = `regexp_replace(${col}, ${patternParam}, ${replacementParam})`
        break
      }
      default: expr = col
    }
    return { sql: `SELECT *, ${expr} AS ${outEscaped} FROM ${upstream}` }
  },
}

export const fillNullsOpTemplate: DynamicTemplate = {
  dynamic: true,
  upstreamCount: 1,
  generate({ upstream, identifiers, allocParam }) {
    const col = `"${(identifiers.column as string).replace(/"/g, '""')}"`
    const strategy = identifiers.strategy as string
    const orderBy = identifiers.orderBy as string
    const orderClause = orderBy ? `ORDER BY "${orderBy.replace(/"/g, '""')}"` : ''

    let expr: string
    switch (strategy) {
      case 'forward':
        expr = `COALESCE(${col}, LAG(${col}) IGNORE NULLS OVER (${orderClause}))`
        break
      case 'backward':
        expr = `COALESCE(${col}, LEAD(${col}) IGNORE NULLS OVER (${orderClause}))`
        break
      case 'constant': {
        const constParam = allocParam('constantValue', 'string')
        expr = `COALESCE(${col}, ${constParam})`
        break
      }
      default:
        expr = col
    }
    return { sql: `SELECT *, ${expr} AS ${col} FROM ${upstream}` }
  },
}

// --- Helpers ---

function parseAggregationString(str: string): Array<{ column: string; function: string; alias?: string }> {
  if (!str) return []
  return str.split(';').map(s => s.trim()).filter(Boolean).map(spec => {
    const match = spec.match(/^(\w+)\(([^)]+)\)(?:\s+as\s+(\w+))?$/i)
    if (match) return { function: match[1].toLowerCase(), column: match[2], alias: match[3] }
    return { function: 'count', column: '*', alias: spec }
  })
}

// Template registry for looking up templates by operator type
// Keys must match the operator's static displayName property exactly.
// Most operators use the short form (e.g., 'Sort'), but FilterOp uses 'FilterOp'.
export const templateRegistry = new Map<string, OperatorTemplate>([
  ['File', fileOpTemplate],
  ['FilterOp', filterOpTemplate],
  ['Sort', sortOpTemplate],
  ['Slice', sliceOpTemplate],
  ['GroupBy', groupByOpTemplate],
  ['Join', joinOpTemplate],
  ['Unique', uniqueOpTemplate],
  ['Pivot', pivotOpTemplate],
  ['Unpivot', unpivotOpTemplate],
  ['Window', windowOpTemplate],
  ['Cast', castOpTemplate],
  ['StringTransform', stringTransformOpTemplate],
  ['Coalesce', coalesceOpTemplate],
  ['FillNulls', fillNullsOpTemplate],
])
