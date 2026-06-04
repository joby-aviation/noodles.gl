import type { DynamicTemplate, GeneratedSQL, OperatorTemplate, StaticTemplate } from './templates'
import { templateRegistry } from './templates'
import type { CompilationContext, CompiledQuery } from './types'
import { escapeIdentifier, operatorIdToAlias } from './utils'

// Minimal operator interface the compiler needs
export interface CompilableNode {
  id: string
  type: string
  inputs: Record<string, { value: unknown }>
  getUpstreamDataIds(): string[]
}

// Check if a node's operator type has a SQL template
export function isCompilable(node: CompilableNode): boolean {
  return templateRegistry.has(node.type)
}

// Compile a subgraph of SQL-compilable nodes into a single CTE-based query.
// Nodes must be in topological order (sources first).
export function compile(nodes: CompilableNode[]): CompiledQuery {
  if (nodes.length === 0) throw new Error('Cannot compile empty node list')

  const ctx: CompilationContext = {
    paramSlots: [],
    nextParamIndex: 1,
    aliases: new Map(),
  }

  // Assign aliases
  for (const node of nodes) {
    ctx.aliases.set(node.id, operatorIdToAlias(node.id))
  }

  const ctes: string[] = []
  const operatorAliases = new Map<string, string>()

  for (const node of nodes) {
    const alias = ctx.aliases.get(node.id)!
    operatorAliases.set(node.id, alias)

    const template = templateRegistry.get(node.type)
    if (!template) throw new Error(`No SQL template for operator type: ${node.type}`)

    const sql = resolveTemplate(template, node, ctx)
    ctes.push(`${alias} AS (${sql})`)
  }

  const lastAlias = ctx.aliases.get(nodes[nodes.length - 1].id)!
  const fullSql =
    ctes.length === 1
      ? `WITH ${ctes[0]} SELECT * FROM ${lastAlias}`
      : `WITH\n  ${ctes.join(',\n  ')}\nSELECT * FROM ${lastAlias}`

  return {
    sql: fullSql,
    paramSlots: ctx.paramSlots,
    operatorAliases,
  }
}

function resolveTemplate(
  template: OperatorTemplate,
  node: CompilableNode,
  ctx: CompilationContext
): string {
  const upstreamIds = node.getUpstreamDataIds()
  const upstream = upstreamIds[0]
    ? ctx.aliases.get(upstreamIds[0]) || operatorIdToAlias(upstreamIds[0])
    : ''
  const upstream2 = upstreamIds[1]
    ? ctx.aliases.get(upstreamIds[1]) || operatorIdToAlias(upstreamIds[1])
    : undefined

  if (template.upstreamCount === 2 && upstreamIds.length < 2) {
    throw new Error(
      `Operator ${node.type} at ${node.id} requires ${template.upstreamCount} upstream(s) but has ${upstreamIds.length}`
    )
  }

  if (template.dynamic) {
    return resolveDynamic(template, node, upstream, upstream2, ctx)
  }

  return resolveStatic(template, node, upstream, ctx)
}

function resolveStatic(
  template: StaticTemplate,
  node: CompilableNode,
  upstream: string,
  ctx: CompilationContext
): string {
  let sql = template.sql

  // Replace {{upstream}}
  sql = sql.replace(/\{\{upstream\}\}/g, upstream)

  // Replace {{$fieldName}} with parameter placeholders
  for (const param of template.params) {
    const placeholder = `{{$${param.field}}}`
    if (sql.includes(placeholder)) {
      const idx = ctx.nextParamIndex++
      ctx.paramSlots.push({
        index: idx,
        fieldPath: `${node.id}.${param.field}`,
        type: param.type,
      })
      sql = sql.replace(placeholder, `$${idx}`)
    }
  }

  // Replace {{ident:hole}} with escaped identifiers
  for (const ident of template.identifiers) {
    const placeholder = `{{ident:${ident.hole}}}`
    if (sql.includes(placeholder)) {
      const value = node.inputs[ident.field]?.value
      if (value === undefined || value === null) {
        throw new Error(
          `Missing required field '${ident.field}' for operator ${node.type} at ${node.id}`
        )
      }
      if (ident.multi && typeof value === 'string') {
        const cols = value
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
        if (cols.length === 0) {
          throw new Error(
            `Field '${ident.field}' in operator ${node.type} at ${node.id} cannot be empty`
          )
        }
        sql = sql.replace(placeholder, cols.map(escapeIdentifier).join(', '))
      } else {
        // For order direction (ASC/DESC) don't escape
        const strVal = String(value)
        if (['asc', 'desc', 'ASC', 'DESC'].includes(strVal)) {
          sql = sql.replace(placeholder, strVal.toUpperCase())
        } else {
          if (strVal === '') {
            throw new Error(
              `Field '${ident.field}' in operator ${node.type} at ${node.id} cannot be empty`
            )
          }
          sql = sql.replace(placeholder, escapeIdentifier(strVal))
        }
      }
    }
  }

  return sql
}

function resolveDynamic(
  template: DynamicTemplate,
  node: CompilableNode,
  upstream: string,
  upstream2: string | undefined,
  ctx: CompilationContext
): string {
  // Collect param values from node inputs
  const params: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(node.inputs)) {
    params[key] = field.value
  }

  // Collect identifier values
  const identifiers: Record<string, string | string[]> = {}
  for (const [key, field] of Object.entries(node.inputs)) {
    const val = field.value
    if (typeof val === 'string') {
      // Check if it's a comma-separated multi-value
      if (
        key.toLowerCase().includes('columns') ||
        key === 'partitionBy' ||
        key === 'groupByColumns'
      ) {
        identifiers[key] = val
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      } else {
        identifiers[key] = val
      }
    }
  }

  const allocParam = (field: string, type: 'string' | 'number' | 'boolean' | 'json'): string => {
    const idx = ctx.nextParamIndex++
    ctx.paramSlots.push({
      index: idx,
      fieldPath: `${node.id}.${field}`,
      type,
    })
    return `$${idx}`
  }

  const result: GeneratedSQL = template.generate({
    upstream,
    upstream2,
    params,
    identifiers,
    allocParam,
  })

  // Handle any extra params from the generator (e.g., IN lists)
  if (result.extraParams) {
    for (const extra of result.extraParams) {
      const idx = ctx.nextParamIndex++
      ctx.paramSlots.push({
        index: idx,
        fieldPath: `${node.id}.${extra.field}`,
        type: extra.type,
        value: extra.value,
      })
      result.sql = result.sql.replace(`$${extra.field}`, `$${idx}`)
    }
  }

  return result.sql
}

// Collect all nodes in a SQL-compilable subgraph by walking backward from a sink.
// Returns nodes in topological order (sources first).
export function collectSubgraph(
  sinkId: string,
  getNode: (id: string) => CompilableNode | undefined
): CompilableNode[] {
  const visited = new Set<string>()
  const result: CompilableNode[] = []

  function walk(id: string): boolean {
    if (visited.has(id)) return true
    visited.add(id)

    const node = getNode(id)
    if (!node || !isCompilable(node)) return false

    const upstreamIds = node.getUpstreamDataIds()
    for (const uid of upstreamIds) {
      if (!walk(uid)) return false
    }

    result.push(node)
    return true
  }

  walk(sinkId)
  return result
}
