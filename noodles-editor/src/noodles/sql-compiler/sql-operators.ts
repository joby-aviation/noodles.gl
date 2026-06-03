import type { CompilationContext, SQLCompilable, SQLFragment } from './types'
import { escapeIdentifier, escapeLiteral, operatorIdToAlias } from './utils'

// Mixin interface: operators that implement this can participate in SQL compilation.
// The toSQL() method receives the compilation context (which tracks upstream aliases
// and parameters) and returns a SQL fragment (CTE body + metadata).
//
// Each function below generates the toSQL implementation for a specific operator type.
// These are designed to be mixed into existing Operator classes or used standalone.

export function fileOpToSQL(
  opId: string,
  inputs: { url: string; format?: string },
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const paramIdx = ctx.nextParamIndex()

  const reader = inputs.format === 'json' ? 'read_json_auto' : 'read_csv_auto'
  const cte = `SELECT * FROM ${reader}($${paramIdx})`

  return {
    alias,
    cte,
    params: [{ index: paramIdx, fieldPath: `${opId}.par.url`, value: inputs.url }],
    udfs: [],
  }
}

export function filterOpToSQL(
  opId: string,
  inputs: { columnName: string; condition: string; value: string },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const col = escapeIdentifier(inputs.columnName)
  const paramIdx = ctx.nextParamIndex()

  let sqlOp: string
  switch (inputs.condition) {
    case 'equals': sqlOp = '='; break
    case 'not equals': sqlOp = '!='; break
    case 'greater than': sqlOp = '>'; break
    case 'less than': sqlOp = '<'; break
    case 'greater than or equal to': sqlOp = '>='; break
    case 'less than or equal to': sqlOp = '<='; break
    case 'contains': {
      const cte = `SELECT * FROM ${upstream} WHERE ${col} LIKE '%' || $${paramIdx} || '%'`
      return {
        alias,
        cte,
        params: [{ index: paramIdx, fieldPath: `${opId}.par.value`, value: inputs.value }],
        udfs: [],
      }
    }
    case 'not contains': {
      const cte = `SELECT * FROM ${upstream} WHERE ${col} NOT LIKE '%' || $${paramIdx} || '%'`
      return {
        alias,
        cte,
        params: [{ index: paramIdx, fieldPath: `${opId}.par.value`, value: inputs.value }],
        udfs: [],
      }
    }
    case 'in': {
      const values = inputs.value.split(',').map(v => escapeLiteral(v.trim())).join(', ')
      const cte = `SELECT * FROM ${upstream} WHERE ${col} IN (${values})`
      return { alias, cte, params: [], udfs: [] }
    }
    case 'not in': {
      const values = inputs.value.split(',').map(v => escapeLiteral(v.trim())).join(', ')
      const cte = `SELECT * FROM ${upstream} WHERE ${col} NOT IN (${values})`
      return { alias, cte, params: [], udfs: [] }
    }
    default: sqlOp = '='
  }

  const cte = `SELECT * FROM ${upstream} WHERE ${col} ${sqlOp} $${paramIdx}`

  return {
    alias,
    cte,
    params: [{ index: paramIdx, fieldPath: `${opId}.par.value`, value: inputs.value }],
    udfs: [],
  }
}

export function sortOpToSQL(
  opId: string,
  inputs: { key: string; order: 'asc' | 'desc' },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const col = escapeIdentifier(inputs.key)
  const dir = inputs.order === 'desc' ? 'DESC' : 'ASC'

  return {
    alias,
    cte: `SELECT * FROM ${upstream} ORDER BY ${col} ${dir}`,
    params: [],
    udfs: [],
  }
}

export function sliceOpToSQL(
  opId: string,
  inputs: { start: number; end?: number },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const startIdx = ctx.nextParamIndex()

  const limit = inputs.end != null ? inputs.end - inputs.start : null
  let cte: string

  if (limit != null) {
    const limitIdx = ctx.nextParamIndex()
    cte = `SELECT * FROM ${upstream} LIMIT $${limitIdx} OFFSET $${startIdx}`
    return {
      alias,
      cte,
      params: [
        { index: startIdx, fieldPath: `${opId}.par.start`, value: inputs.start },
        { index: limitIdx, fieldPath: `${opId}.par.end`, value: limit },
      ],
      udfs: [],
    }
  }

  cte = `SELECT * FROM ${upstream} OFFSET $${startIdx}`
  return {
    alias,
    cte,
    params: [{ index: startIdx, fieldPath: `${opId}.par.start`, value: inputs.start }],
    udfs: [],
  }
}

export function groupByOpToSQL(
  opId: string,
  inputs: {
    groupByColumns: string[]
    aggregations: Array<{ column: string; function: string; alias?: string }>
  },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)

  const groupCols = inputs.groupByColumns.map(escapeIdentifier).join(', ')
  const aggExprs = inputs.aggregations.map(agg => {
    const col = agg.column === '*' ? '*' : escapeIdentifier(agg.column)
    const fn = agg.function.toUpperCase()
    const outputName = agg.alias || `${agg.function}_${agg.column}`
    return `${fn}(${col}) AS ${escapeIdentifier(outputName)}`
  }).join(', ')

  const selectList = groupCols ? `${groupCols}, ${aggExprs}` : aggExprs
  const groupByClause = groupCols ? `GROUP BY ${groupCols}` : ''

  return {
    alias,
    cte: `SELECT ${selectList} FROM ${upstream} ${groupByClause}`,
    params: [],
    udfs: [],
  }
}

export function joinOpToSQL(
  opId: string,
  inputs: {
    leftKey: string
    rightKey: string
    joinType: 'inner' | 'left' | 'right' | 'full' | 'cross'
  },
  leftUpstreamId: string,
  rightUpstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const left = ctx.getUpstreamAlias(leftUpstreamId)
  const right = ctx.getUpstreamAlias(rightUpstreamId)

  const joinType = inputs.joinType.toUpperCase()
  const onClause = inputs.joinType === 'cross'
    ? ''
    : `ON l.${escapeIdentifier(inputs.leftKey)} = r.${escapeIdentifier(inputs.rightKey)}`

  return {
    alias,
    cte: `SELECT l.*, r.* FROM ${left} l ${joinType} JOIN ${right} r ${onClause}`,
    params: [],
    udfs: [],
  }
}

export function uniqueOpToSQL(
  opId: string,
  inputs: { columns?: string[] },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)

  if (inputs.columns && inputs.columns.length > 0) {
    const cols = inputs.columns.map(escapeIdentifier).join(', ')
    return {
      alias,
      cte: `SELECT DISTINCT ON (${cols}) * FROM ${upstream}`,
      params: [],
      udfs: [],
    }
  }

  return {
    alias,
    cte: `SELECT DISTINCT * FROM ${upstream}`,
    params: [],
    udfs: [],
  }
}

export function pivotOpToSQL(
  opId: string,
  inputs: {
    pivotColumn: string
    valueColumn: string
    indexColumn: string
    aggregation: string
  },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const agg = inputs.aggregation.toUpperCase()

  return {
    alias,
    cte: `PIVOT ${upstream} ON ${escapeIdentifier(inputs.pivotColumn)} USING ${agg}(${escapeIdentifier(inputs.valueColumn)}) GROUP BY ${escapeIdentifier(inputs.indexColumn)}`,
    params: [],
    udfs: [],
  }
}

export function unpivotOpToSQL(
  opId: string,
  inputs: {
    valueColumns: string[]
    variableName: string
    valueName: string
  },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const valCols = inputs.valueColumns.map(escapeIdentifier).join(', ')

  return {
    alias,
    cte: `UNPIVOT ${upstream} ON (${valCols}) INTO NAME ${escapeIdentifier(inputs.variableName)} VALUE ${escapeIdentifier(inputs.valueName)}`,
    params: [],
    udfs: [],
  }
}

export function windowOpToSQL(
  opId: string,
  inputs: {
    column: string
    function: 'row_number' | 'rank' | 'dense_rank' | 'lag' | 'lead' | 'sum' | 'avg' | 'min' | 'max'
    partitionBy?: string[]
    orderBy: string
    order: 'asc' | 'desc'
    windowSize?: number
    outputColumn?: string
  },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)

  const partitionClause = inputs.partitionBy?.length
    ? `PARTITION BY ${inputs.partitionBy.map(escapeIdentifier).join(', ')}`
    : ''
  const orderClause = `ORDER BY ${escapeIdentifier(inputs.orderBy)} ${inputs.order === 'desc' ? 'DESC' : 'ASC'}`

  let fnExpr: string
  const col = escapeIdentifier(inputs.column)
  const fn = inputs.function.toUpperCase()

  if (['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(fn)) {
    fnExpr = `${fn}()`
  } else if (['LAG', 'LEAD'].includes(fn)) {
    fnExpr = `${fn}(${col})`
  } else {
    // Aggregate window function
    const frame = inputs.windowSize
      ? `ROWS BETWEEN ${inputs.windowSize - 1} PRECEDING AND CURRENT ROW`
      : ''
    fnExpr = `${fn}(${col})`
    const windowSpec = `${partitionClause} ${orderClause} ${frame}`.trim()
    const outputName = inputs.outputColumn || `${inputs.function}_${inputs.column}`
    return {
      alias,
      cte: `SELECT *, ${fnExpr} OVER (${windowSpec}) AS ${escapeIdentifier(outputName)} FROM ${upstream}`,
      params: [],
      udfs: [],
    }
  }

  const windowSpec = `${partitionClause} ${orderClause}`.trim()
  const outputName = inputs.outputColumn || `${inputs.function}_${inputs.column}`

  return {
    alias,
    cte: `SELECT *, ${fnExpr} OVER (${windowSpec}) AS ${escapeIdentifier(outputName)} FROM ${upstream}`,
    params: [],
    udfs: [],
  }
}

export function castOpToSQL(
  opId: string,
  inputs: { column: string; targetType: string; outputColumn?: string },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const col = escapeIdentifier(inputs.column)
  const outputName = inputs.outputColumn || inputs.column

  if (outputName === inputs.column) {
    return {
      alias,
      cte: `SELECT * REPLACE (CAST(${col} AS ${inputs.targetType}) AS ${col}) FROM ${upstream}`,
      params: [],
      udfs: [],
    }
  }

  return {
    alias,
    cte: `SELECT *, CAST(${col} AS ${inputs.targetType}) AS ${escapeIdentifier(outputName)} FROM ${upstream}`,
    params: [],
    udfs: [],
  }
}

export function stringTransformOpToSQL(
  opId: string,
  inputs: {
    column: string
    operation: string
    pattern?: string
    replacement?: string
    outputColumn?: string
  },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const col = escapeIdentifier(inputs.column)
  const outputName = inputs.outputColumn || inputs.column

  let expr: string
  switch (inputs.operation) {
    case 'upper': expr = `UPPER(${col})`; break
    case 'lower': expr = `LOWER(${col})`; break
    case 'trim': expr = `TRIM(${col})`; break
    case 'title': expr = `INITCAP(${col})`; break
    case 'regex_extract': {
      const patIdx = ctx.nextParamIndex()
      expr = `regexp_extract(${col}, $${patIdx}, 1)`
      return {
        alias,
        cte: `SELECT *, ${expr} AS ${escapeIdentifier(outputName)} FROM ${upstream}`,
        params: [{ index: patIdx, fieldPath: `${opId}.par.pattern`, value: inputs.pattern || '' }],
        udfs: [],
      }
    }
    case 'regex_replace': {
      const patIdx = ctx.nextParamIndex()
      const replIdx = ctx.nextParamIndex()
      expr = `regexp_replace(${col}, $${patIdx}, $${replIdx}, 'g')`
      return {
        alias,
        cte: `SELECT *, ${expr} AS ${escapeIdentifier(outputName)} FROM ${upstream}`,
        params: [
          { index: patIdx, fieldPath: `${opId}.par.pattern`, value: inputs.pattern || '' },
          { index: replIdx, fieldPath: `${opId}.par.replacement`, value: inputs.replacement || '' },
        ],
        udfs: [],
      }
    }
    case 'length': expr = `LENGTH(${col})`; break
    case 'reverse': expr = `REVERSE(${col})`; break
    case 'hash_md5': expr = `MD5(${col})`; break
    default: expr = col
  }

  if (outputName === inputs.column) {
    return {
      alias,
      cte: `SELECT * REPLACE (${expr} AS ${col}) FROM ${upstream}`,
      params: [],
      udfs: [],
    }
  }

  return {
    alias,
    cte: `SELECT *, ${expr} AS ${escapeIdentifier(outputName)} FROM ${upstream}`,
    params: [],
    udfs: [],
  }
}

export function coalesceOpToSQL(
  opId: string,
  inputs: { columns: string[]; outputColumn: string },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const cols = inputs.columns.map(escapeIdentifier).join(', ')

  return {
    alias,
    cte: `SELECT *, COALESCE(${cols}) AS ${escapeIdentifier(inputs.outputColumn)} FROM ${upstream}`,
    params: [],
    udfs: [],
  }
}

export function fillNullsOpToSQL(
  opId: string,
  inputs: {
    column: string
    strategy: 'forward' | 'backward' | 'constant'
    constantValue?: unknown
    orderBy?: string
  },
  upstreamId: string,
  ctx: CompilationContext
): SQLFragment {
  const alias = operatorIdToAlias(opId)
  const upstream = ctx.getUpstreamAlias(upstreamId)
  const col = escapeIdentifier(inputs.column)
  const orderCol = inputs.orderBy ? escapeIdentifier(inputs.orderBy) : 'rowid'

  let expr: string
  switch (inputs.strategy) {
    case 'forward':
      // Last non-null value looking backward
      expr = `COALESCE(${col}, LAG(${col}) IGNORE NULLS OVER (ORDER BY ${orderCol}))`
      break
    case 'backward':
      expr = `COALESCE(${col}, LEAD(${col}) IGNORE NULLS OVER (ORDER BY ${orderCol}))`
      break
    case 'constant': {
      const valIdx = ctx.nextParamIndex()
      expr = `COALESCE(${col}, $${valIdx})`
      return {
        alias,
        cte: `SELECT * REPLACE (${expr} AS ${col}) FROM ${upstream}`,
        params: [{ index: valIdx, fieldPath: `${opId}.par.constantValue`, value: inputs.constantValue }],
        udfs: [],
      }
    }
    default:
      expr = col
  }

  return {
    alias,
    cte: `SELECT * REPLACE (${expr} AS ${col}) FROM ${upstream}`,
    params: [],
    udfs: [],
  }
}
