import type { IOperator, Operator } from '../operators'

/**
 * Result of evaluating an enable expression
 */
export interface EvaluationResult {
  enabled: boolean
  error?: string
}

/**
 * Evaluates an enable expression for conditional field visibility.
 *
 * Supports:
 * - `par.fieldName` - reference local parameter values
 * - `op('/path').par.field` - reference cross-operator values
 * - `op('/path').out.field` - reference cross-operator outputs
 *
 * @param expr - JavaScript expression to evaluate (e.g., "par.mode === 'advanced'")
 * @param operator - The operator containing the field being evaluated
 * @param opFn - Function to resolve operator paths (e.g., getOp)
 * @returns Result with enabled status and optional error message
 */
export function evaluateEnableExpression(
  expr: string,
  operator: Operator<IOperator>,
  opFn: (path: string, contextOpId?: string) => Operator<IOperator> | undefined
): EvaluationResult {
  if (!expr || expr.trim() === '') {
    return { enabled: true }
  }

  try {
    // Build the par object from operator inputs
    const par: Record<string, unknown> = {}
    const allInputs = (operator.constructor as typeof Operator).supportsCustomFields
      ? operator.getAllInputs()
      : operator.inputs

    for (const [key, field] of Object.entries(allInputs)) {
      par[key] = field.value
    }

    // Create a safe op function that resolves paths relative to the operator
    const safeOp = (path: string) => {
      const targetOp = opFn(path, operator.id)
      if (!targetOp) {
        throw new Error(`Operator '${path}' not found`)
      }

      // Build par proxy for the target operator
      const targetPar: Record<string, unknown> = {}
      const targetAllInputs = (targetOp.constructor as typeof Operator).supportsCustomFields
        ? targetOp.getAllInputs()
        : targetOp.inputs

      for (const [key, field] of Object.entries(targetAllInputs)) {
        targetPar[key] = field.value
      }

      // Build out proxy for outputs
      const targetOut: Record<string, unknown> = {}
      for (const [key, field] of Object.entries(targetOp.outputs)) {
        targetOut[key] = field.value
      }

      return { par: targetPar, out: targetOut }
    }

    // Evaluate the expression with the safe context
    // Using Function constructor to create a sandboxed evaluation
    const fn = new Function('par', 'op', `'use strict'; return (${expr});`)
    const result = fn(par, safeOp)

    return { enabled: Boolean(result) }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    // Return error but default to showing the field (fail-open)
    return {
      enabled: true,
      error: `Expression error: ${errorMessage}`,
    }
  }
}

/**
 * Dependency information extracted from an expression
 */
export interface ExpressionDependency {
  type: 'local-par' | 'remote-par' | 'remote-out'
  field: string
  opPath?: string // Only for remote dependencies
  raw: string // The raw matched text
}

/**
 * Parses a JavaScript expression and extracts field dependencies using
 * a proper tokenizer approach instead of regex.
 *
 * Extracts:
 * - `par.fieldName` -> local parameter
 * - `op('/path').par.field` -> remote parameter
 * - `op('/path').out.field` -> remote output
 *
 * Handles complex expressions including:
 * - Ternary operators: `par.value ? par.a : par.b`
 * - Method calls: `op('/x').par.field.toUpperCase()`
 * - Nested expressions: `(par.a || par.b) && op('/c').par.d`
 *
 * @param expr - JavaScript expression to parse
 * @returns Array of dependencies found in the expression
 */
export function getEnableExpressionDependencies(expr: string): ExpressionDependency[] {
  if (!expr || expr.trim() === '') {
    return []
  }

  const dependencies: ExpressionDependency[] = []
  const tokens = tokenize(expr)

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // Look for `par.fieldName` (local parameter)
    if (token.type === 'identifier' && token.value === 'par') {
      const next = tokens[i + 1]
      if (next?.type === 'dot') {
        const field = tokens[i + 2]
        if (field?.type === 'identifier') {
          // Check if this is NOT preceded by op('...').
          // We need to look back to see if there's an op call
          let isPrecededByOp = false
          for (let j = i - 1; j >= 0; j--) {
            const prevToken = tokens[j]
            if (prevToken.type === 'whitespace') continue
            if (prevToken.type === 'dot') {
              // Check if before the dot is a closing paren from op()
              for (let k = j - 1; k >= 0; k--) {
                const t = tokens[k]
                if (t.type === 'whitespace') continue
                if (t.type === 'paren' && t.value === ')') {
                  // This might be op('...').par.field
                  isPrecededByOp = true
                }
                break
              }
            }
            break
          }

          if (!isPrecededByOp) {
            dependencies.push({
              type: 'local-par',
              field: field.value,
              raw: `par.${field.value}`,
            })
          }
        }
      }
    }

    // Look for `op('...').par.field` or `op("...").par.field`
    if (token.type === 'identifier' && token.value === 'op') {
      const paren = tokens[i + 1]
      if (paren?.type === 'paren' && paren.value === '(') {
        const pathToken = tokens[i + 2]
        if (pathToken?.type === 'string') {
          const closeParen = tokens[i + 3]
          if (closeParen?.type === 'paren' && closeParen.value === ')') {
            const dot1 = tokens[i + 4]
            if (dot1?.type === 'dot') {
              const accessor = tokens[i + 5]
              if (
                accessor?.type === 'identifier' &&
                (accessor.value === 'par' || accessor.value === 'out')
              ) {
                const dot2 = tokens[i + 6]
                if (dot2?.type === 'dot') {
                  const field = tokens[i + 7]
                  if (field?.type === 'identifier') {
                    dependencies.push({
                      type: accessor.value === 'par' ? 'remote-par' : 'remote-out',
                      field: field.value,
                      opPath: pathToken.value,
                      raw: `op('${pathToken.value}').${accessor.value}.${field.value}`,
                    })
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Remove duplicates based on raw value
  const seen = new Set<string>()
  return dependencies.filter(dep => {
    if (seen.has(dep.raw)) {
      return false
    }
    seen.add(dep.raw)
    return true
  })
}

/**
 * Token types for the simple tokenizer
 */
interface Token {
  type: 'identifier' | 'string' | 'number' | 'operator' | 'paren' | 'dot' | 'whitespace' | 'other'
  value: string
}

/**
 * Simple tokenizer for JavaScript expressions.
 * This is a lightweight alternative to a full parser for extracting identifiers and access patterns.
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    const char = expr[i]

    // Whitespace
    if (/\s/.test(char)) {
      let value = char
      i++
      while (i < expr.length && /\s/.test(expr[i])) {
        value += expr[i]
        i++
      }
      tokens.push({ type: 'whitespace', value })
      continue
    }

    // String literals (single or double quotes)
    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      i++ // Skip opening quote
      let escaped = false
      while (i < expr.length) {
        const c = expr[i]
        if (escaped) {
          value += c
          escaped = false
        } else if (c === '\\') {
          escaped = true
        } else if (c === quote) {
          i++ // Skip closing quote
          break
        } else {
          value += c
        }
        i++
      }
      tokens.push({ type: 'string', value })
      continue
    }

    // Template literals
    if (char === '`') {
      let value = ''
      i++ // Skip opening backtick
      let escaped = false
      while (i < expr.length) {
        const c = expr[i]
        if (escaped) {
          value += c
          escaped = false
        } else if (c === '\\') {
          escaped = true
        } else if (c === '`') {
          i++ // Skip closing backtick
          break
        } else {
          value += c
        }
        i++
      }
      tokens.push({ type: 'string', value })
      continue
    }

    // Numbers
    if (/\d/.test(char)) {
      let value = char
      i++
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        value += expr[i]
        i++
      }
      tokens.push({ type: 'number', value })
      continue
    }

    // Identifiers
    if (/[a-zA-Z_$]/.test(char)) {
      let value = char
      i++
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i])) {
        value += expr[i]
        i++
      }
      tokens.push({ type: 'identifier', value })
      continue
    }

    // Dot
    if (char === '.') {
      tokens.push({ type: 'dot', value: char })
      i++
      continue
    }

    // Parentheses and brackets
    if ('()[]{}' .includes(char)) {
      tokens.push({ type: 'paren', value: char })
      i++
      continue
    }

    // Operators (multi-char like ===, !==, <=, >=, &&, ||)
    if ('+-*/%<>=!&|?:,;'.includes(char)) {
      let value = char
      i++
      // Look ahead for multi-char operators
      while (i < expr.length && '=&|'.includes(expr[i])) {
        value += expr[i]
        i++
      }
      tokens.push({ type: 'operator', value })
      continue
    }

    // Other characters
    tokens.push({ type: 'other', value: char })
    i++
  }

  return tokens
}

/**
 * Validates an enable expression and returns any errors.
 * This performs a dry-run evaluation without actual field values.
 *
 * @param expr - Expression to validate
 * @returns Error message if invalid, null if valid
 */
export function validateEnableExpression(expr: string): string | null {
  if (!expr || expr.trim() === '') {
    return null
  }

  try {
    // Try to parse the expression as a function
    // This will catch syntax errors without executing
    new Function('par', 'op', `'use strict'; return (${expr});`)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Gets a list of dependencies as strings (legacy format for backward compatibility)
 */
export function getEnableExpressionDependenciesAsStrings(expr: string): string[] {
  const deps = getEnableExpressionDependencies(expr)
  return deps.map(dep => {
    if (dep.type === 'local-par') {
      return `par.${dep.field}`
    }
    return `${dep.opPath}.${dep.type === 'remote-par' ? 'par' : 'out'}.${dep.field}`
  })
}
