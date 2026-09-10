// Operator capability flags for SQL compilation and Arrow Table support.
// This enables gradual migration without forcing every operator to change at once.

export interface SQLCapabilities {
  // Can this operator accept Arrow Tables as input?
  acceptsArrowTables: boolean

  // Does this operator produce Arrow Tables as output?
  producesArrowTables: boolean

  // Is this operator SQL-compilable?
  sqlCompilable: boolean
}

// Default capabilities for operators (backward compatible)
export const DEFAULT_CAPABILITIES: SQLCapabilities = {
  acceptsArrowTables: false,
  producesArrowTables: false,
  sqlCompilable: false,
}

// Capability registry: maps operator type name → capabilities
const capabilityRegistry = new Map<string, SQLCapabilities>()

export function registerCapabilities(operatorType: string, capabilities: Partial<SQLCapabilities>) {
  capabilityRegistry.set(operatorType, {
    ...DEFAULT_CAPABILITIES,
    ...capabilities,
  })
}

export function getCapabilities(operatorType: string): SQLCapabilities {
  return capabilityRegistry.get(operatorType) || DEFAULT_CAPABILITIES
}

// Check if an operator can be compiled to SQL
export function isCompilableByCapability(operatorType: string): boolean {
  return getCapabilities(operatorType).sqlCompilable
}

// Check if an operator accepts Arrow Tables
export function acceptsArrowTables(operatorType: string): boolean {
  return getCapabilities(operatorType).acceptsArrowTables
}

// Check if an operator produces Arrow Tables
export function producesArrowTables(operatorType: string): boolean {
  return getCapabilities(operatorType).producesArrowTables
}

// Register capabilities for SQL-compilable operators
// This is called during initialization
export function registerSQLCompilableOperators() {
  // Data source operators
  registerCapabilities('File', { sqlCompilable: true, producesArrowTables: true })

  // Data processing operators
  registerCapabilities('FilterOp', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Sort', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Slice', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('GroupBy', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Join', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Unique', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Pivot', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Unpivot', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Window', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Cast', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('StringTransform', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('Coalesce', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })
  registerCapabilities('FillNulls', { sqlCompilable: true, acceptsArrowTables: true, producesArrowTables: true })

  // Boundary operators (not SQL-compilable, break the chain)
  registerCapabilities('CodeOp', { sqlCompilable: false })
  registerCapabilities('AccessorOp', { sqlCompilable: false })
  registerCapabilities('ColorRamp', { sqlCompilable: false })
  registerCapabilities('ExpressionOp', { sqlCompilable: false }) // Could be partially compilable in future
}
