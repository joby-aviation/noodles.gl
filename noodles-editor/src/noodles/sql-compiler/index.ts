export type {
  CompiledQuery,
  CompilationContext,
  ExecutionResult,
  ParamSlot,
  SQLCompilable,
  SQLTemplate,
} from './types'

export { compile, collectSubgraph, isCompilable } from './compiler'
export type { CompilableNode } from './compiler'
export { execute, collectParamValues, setDuckDbInstance, getDuckDbInstance, PreparedPipeline } from './executor'
export { templateRegistry } from './templates'
export { operatorIdToAlias, escapeIdentifier, escapeLiteral } from './utils'
export { parseDuckDbSQL, parseMustacheRefs, classifyRef, extractOperatorId } from './mustache-parser'
export {
  adaptOperator,
  detectCompilableSubgraphs,
  resolveParamValues,
  SQLExecutionCache,
} from './subgraph-detector'
export {
  SQLGraphIntegration,
  getSQLIntegration,
  resetSQLIntegration,
} from './graph-integration'
