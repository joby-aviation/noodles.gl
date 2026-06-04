import type { Table } from 'apache-arrow'
import { debugApp } from '../utils/debug'
import type { IOperator, Operator } from './operators'
import { duckDbInstance } from './operators'

// SQL fragment that can be composed into a query
export interface SqlFragment {
  select?: string[] // SELECT expressions
  from?: string // FROM clause
  where?: string[] // WHERE conditions
  orderBy?: string[] // ORDER BY expressions
  limit?: number
  offset?: number
  computedColumns?: Record<string, string> // name -> expression
}

// Result of analyzing operator graph for SQL compilation
export interface CompilationPlan {
  sqlChains: SqlChain[]
  barriers: CompilationBarrier[]
  estimatedSpeedup: number
}

export interface SqlChain {
  operators: Array<Operator<IOperator>>
  headOpId: string // First operator in chain (data source)
  tailOpId: string // Last operator before barrier/layer
  estimatedRows: number
  sqlFragment: SqlFragment
}

export interface CompilationBarrier {
  opId: string
  opType: string
  reason: 'code_op' | 'accessor_op' | 'timeline_op' | 'unsupported'
}

// Metadata for SQL-compilable operators
export interface SqlOperatorMetadata {
  sqlCompilable: boolean
  generateSql?: (inputs: Record<string, unknown>, params: SqlParams) => SqlFragment
  estimateRows?: (inputs: Record<string, unknown>) => number
}

// Parameters available during SQL generation
export interface SqlParams {
  // Parameterized values (for keyframes/timeline)
  params: Map<string, unknown>
  paramIndex: number // Next available $N index

  // Context
  upstreamTable?: string // Name of upstream CTE or table

  // Get next parameter placeholder
  nextParam(value: unknown): string
}

export class GraphCompiler {
  private sqlMetadata = new Map<string, SqlOperatorMetadata>()

  constructor() {
    // Register SQL-compilable operators
    this.registerOperatorMetadata()
  }

  // Register operator SQL generation capabilities
  private registerOperatorMetadata() {
    // FileOp - data source
    this.sqlMetadata.set('FileOp', {
      sqlCompilable: true,
      generateSql: (inputs, params) => {
        const { url, format } = inputs

        // DuckDB read functions
        const reader =
          format === 'csv'
            ? 'read_csv_auto'
            : format === 'json'
              ? 'read_json_auto'
              : format === 'parquet'
                ? 'read_parquet'
                : null

        if (!reader) return {}

        return {
          from: `${reader}(${params.nextParam(url)})`,
        }
      },
      estimateRows: () => 10000, // Default estimate
    })

    // FilterOp - WHERE clause
    this.sqlMetadata.set('FilterOp', {
      sqlCompilable: true,
      generateSql: (inputs, _params) => {
        // biome-ignore lint/complexity/noBannedTypes: FilterOp condition can be string or function
        const { condition } = inputs as { condition: string | Function }

        // Simple expression mode: "population > 1000000"
        if (typeof condition === 'string') {
          return {
            where: [condition],
          }
        }

        // Complex: JS function - cannot compile
        return {}
      },
    })

    // SortOp - ORDER BY
    this.sqlMetadata.set('SortOp', {
      sqlCompilable: true,
      generateSql: (inputs, _params) => {
        const { key, order = 'asc' } = inputs as { key: string; order?: 'asc' | 'desc' }

        return {
          orderBy: [`${key} ${order.toUpperCase()}`],
        }
      },
    })

    // SliceOp - LIMIT/OFFSET
    this.sqlMetadata.set('SliceOp', {
      sqlCompilable: true,
      generateSql: (inputs, _params) => {
        const { start = 0, end } = inputs as { start?: number; end?: number }

        return {
          limit: end !== undefined ? end - start : undefined,
          offset: start > 0 ? start : undefined,
        }
      },
    })

    // CreateAttributeOp - computed columns
    this.sqlMetadata.set('CreateAttributeOp', {
      sqlCompilable: true,
      generateSql: (inputs, _params) => {
        const { name, expression } = inputs as { name: string; expression: string }

        // Convert JS expression to SQL
        // Simple cases: "d.lat", "[d.lng, d.lat, 0]"
        const sqlExpr = this.jsExpressionToSql(expression)

        if (!sqlExpr) return {}

        return {
          computedColumns: { [`_attr_${name}`]: sqlExpr },
        }
      },
    })

    // MathOp - SQL functions
    this.sqlMetadata.set('MathOp', {
      sqlCompilable: true,
      generateSql: (inputs, params) => {
        const { operation, a, b } = inputs as { operation: string; a: number; b: number }

        const ops: Record<string, string> = {
          add: `${params.nextParam(a)} + ${params.nextParam(b)}`,
          subtract: `${params.nextParam(a)} - ${params.nextParam(b)}`,
          multiply: `${params.nextParam(a)} * ${params.nextParam(b)}`,
          divide: `${params.nextParam(a)} / ${params.nextParam(b)}`,
          pow: `POWER(${params.nextParam(a)}, ${params.nextParam(b)})`,
          sqrt: `SQRT(${params.nextParam(a)})`,
          abs: `ABS(${params.nextParam(a)})`,
          min: `LEAST(${params.nextParam(a)}, ${params.nextParam(b)})`,
          max: `GREATEST(${params.nextParam(a)}, ${params.nextParam(b)})`,
        }

        return {
          select: [ops[operation]],
        }
      },
    })
  }

  // Convert simple JS expression to SQL
  private jsExpressionToSql(expr: string): string | null {
    // "d.lat" → "lat"
    const simpleField = expr.match(/^d\.(\w+)$/)
    if (simpleField) {
      return simpleField[1]
    }

    // "[d.lng, d.lat, 0]" → "ARRAY[lng, lat, 0]"
    const arrayExpr = expr.match(/^\[([^\]]+)\]$/)
    if (arrayExpr) {
      const elements = arrayExpr[1].split(',').map(e => {
        const trimmed = e.trim()
        if (trimmed.startsWith('d.')) return trimmed.substring(2)
        return trimmed
      })
      return `[${elements.join(', ')}]`
    }

    // "d.value * 10" → "value * 10"
    const arithmeticExpr = expr.replace(/d\.(\w+)/g, '$1')
    if (arithmeticExpr !== expr) {
      return arithmeticExpr
    }

    // Cannot compile
    return null
  }

  // Analyze graph and identify SQL-compilable chains
  analyze(
    operators: Map<string, Operator<IOperator>>,
    edges: Array<{ source: string; target: string }>
  ): CompilationPlan {
    const chains: SqlChain[] = []
    const barriers: CompilationBarrier[] = []

    // Build adjacency lists
    const downstream = new Map<string, string[]>()
    for (const edge of edges) {
      const targets = downstream.get(edge.source) || []
      targets.push(edge.target)
      downstream.set(edge.source, targets)
    }

    // Find data source operators (FileOp, DuckDbOp)
    const sources = Array.from(operators.values()).filter(op => {
      const type = op.constructor.name
      return type === 'FileOp' || type === 'DuckDbOp'
    })

    // For each source, walk downstream until barrier
    for (const source of sources) {
      const chain = this.buildSqlChain(source, operators, downstream)

      if (chain && chain.operators.length > 1) {
        chains.push(chain)
      }
    }

    // Estimate speedup
    const estimatedSpeedup =
      chains.reduce((sum, chain) => {
        // Rough heuristic: SQL is 10x faster for chains with >1K rows
        return sum + (chain.estimatedRows > 1000 ? 10 : 1)
      }, 0) / Math.max(chains.length, 1)

    return { sqlChains: chains, barriers, estimatedSpeedup }
  }

  // Build SQL chain starting from source operator
  private buildSqlChain(
    source: Operator<IOperator>,
    operators: Map<string, Operator<IOperator>>,
    downstream: Map<string, string[]>
  ): SqlChain | null {
    const chain: Array<Operator<IOperator>> = [source]
    let current = source

    // Walk downstream until barrier or layer
    while (true) {
      const targets = downstream.get(current.id) || []

      // Multiple targets = barrier (can't compile branching)
      if (targets.length !== 1) break

      const nextId = targets[0]
      const next = operators.get(nextId)
      if (!next) break

      const type = next.constructor.name

      // Check if compilable
      const metadata = this.sqlMetadata.get(type)
      if (!metadata?.sqlCompilable) {
        // Barrier reached
        break
      }

      chain.push(next)
      current = next
    }

    if (chain.length < 2) return null

    return {
      operators: chain,
      headOpId: source.id,
      tailOpId: current.id,
      estimatedRows: 10000, // TODO: Better estimation
      sqlFragment: {}, // Will be generated during compilation
    }
  }

  // Compile SQL chain to DuckDB query
  compileToDuckDB(chain: SqlChain): { sql: string; params: unknown[] } {
    const params: unknown[] = []
    let paramIndex = 1

    const sqlParams: SqlParams = {
      params: new Map(),
      paramIndex,
      nextParam: (value: unknown) => {
        params.push(value)
        return `$${paramIndex++}`
      },
    }

    // Accumulate SQL fragments
    let from = ''
    const where: string[] = []
    const orderBy: string[] = []
    const computedColumns: Record<string, string> = {}
    const select: string[] = ['*']
    let limit: number | undefined
    let offset: number | undefined

    for (const op of chain.operators) {
      const type = op.constructor.name
      const metadata = this.sqlMetadata.get(type)

      if (!metadata?.generateSql) continue

      const inputs = this.getOperatorInputs(op)
      const fragment = metadata.generateSql(inputs, sqlParams)

      // Accumulate fragments
      if (fragment.from) from = fragment.from
      if (fragment.where) where.push(...fragment.where)
      if (fragment.orderBy) orderBy.push(...fragment.orderBy)
      if (fragment.computedColumns) {
        Object.assign(computedColumns, fragment.computedColumns)
      }
      if (fragment.select) select.push(...fragment.select)
      if (fragment.limit !== undefined) limit = fragment.limit
      if (fragment.offset !== undefined) offset = fragment.offset
    }

    // Build final SQL
    const selectClause = [
      ...select,
      ...Object.entries(computedColumns).map(([name, expr]) => `${expr} AS ${name}`),
    ]

    let sql = `SELECT ${selectClause.join(', ')}\nFROM ${from}`

    if (where.length > 0) {
      sql += `\nWHERE ${where.join(' AND ')}`
    }

    if (orderBy.length > 0) {
      sql += `\nORDER BY ${orderBy.join(', ')}`
    }

    if (limit !== undefined) {
      sql += `\nLIMIT ${limit}`
    }

    if (offset !== undefined) {
      sql += `\nOFFSET ${offset}`
    }

    debugApp('Compiled SQL:\n%s', sql)
    debugApp('Params: %O', params)

    return { sql, params }
  }

  // Extract operator input values
  private getOperatorInputs(op: Operator<IOperator>): Record<string, unknown> {
    const inputs: Record<string, unknown> = {}

    for (const [key, field] of Object.entries(op.inputs)) {
      inputs[key] = field.value
    }

    return inputs
  }

  // Execute compiled SQL query
  async executeSql(sql: string, params: unknown[]): Promise<Table> {
    const db = await duckDbInstance

    // Prepare statement with parameters
    const stmt = await db.prepare(sql)

    // Execute with parameters
    const result = await stmt.query(...params)

    return result
  }
}
