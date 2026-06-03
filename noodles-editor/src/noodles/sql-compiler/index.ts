export { compilePipeline, collectSQLSubgraph, createCompilationContext } from './compiler'
export { executePipeline, executeWithParams, setDuckDbInstance } from './executor'
export * from './sql-operators'
export * from './types'
export { escapeIdentifier, escapeLiteral, operatorIdToAlias } from './utils'

// Side-effect import: augments existing operators with toSQL() methods
import './operator-sql-mixins'
