export type { CompilableNode } from './compiler'

export { collectSubgraph, compile, isCompilable } from './compiler'
export {
  collectParamValues,
  execute,
  getDuckDbInstance,
  PreparedPipeline,
  setDuckDbInstance,
} from './executor'
export {
  getSQLIntegration,
  resetSQLIntegration,
  SQLGraphIntegration,
} from './graph-integration'
export {
  classifyRef,
  extractOperatorId,
  parseDuckDbSQL,
  parseMustacheRefs,
} from './mustache-parser'
export {
  adaptOperator,
  detectCompilableSubgraphs,
  resolveParamValues,
  SQLExecutionCache,
} from './subgraph-detector'
export { templateRegistry } from './templates'
export type {
  CompilationContext,
  CompiledQuery,
  ExecutionResult,
  ParamSlot,
  SQLCompilable,
  SQLTemplate,
} from './types'
export { escapeIdentifier, escapeLiteral, operatorIdToAlias } from './utils'
