export type { CompilableNode } from './compiler'

export { collectSubgraph, compile, isCompilable } from './compiler'

export {
  acceptsArrowTables,
  getCapabilities,
  isCompilableByCapability,
  producesArrowTables,
  registerCapabilities,
  registerSQLCompilableOperators,
  type SQLCapabilities,
} from './capabilities'

export {
  addOperatorComment,
  attributeError,
  enrichErrorContext,
  extractLineNumber,
  findOperatorAtLine,
  OperatorError,
} from './error-attribution'

export {
  computeFingerprint,
  fingerprintsMatch,
  type TopologyFingerprint,
} from './fingerprint'
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
