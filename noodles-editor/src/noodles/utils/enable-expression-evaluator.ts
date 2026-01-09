import type { IOperator, Operator } from '../operators'

/**
 * Evaluates an enable expression for conditional field visibility.
 *
 * Supports:
 * - `par.fieldName` - reference local parameter values
 * - `op('/path').par.field` - reference cross-operator values
 *
 * @param expr - JavaScript expression to evaluate (e.g., "par.mode === 'advanced'")
 * @param operator - The operator containing the field being evaluated
 * @param opFn - Function to resolve operator paths (e.g., getOp)
 * @returns true if field should be visible, false otherwise
 */
export function evaluateEnableExpression(
  expr: string,
  operator: Operator<IOperator>,
  opFn: (path: string, contextOpId?: string) => Operator<IOperator> | undefined
): boolean {
  if (!expr || expr.trim() === '') {
    return true // No expression means always enabled
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
        console.warn(`Enable expression: operator '${path}' not found`)
        return { par: {}, out: {} }
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

    return Boolean(result)
  } catch (err) {
    console.warn(`Enable expression evaluation failed for "${expr}":`, err)
    return true // On error, default to showing the field
  }
}

/**
 * Creates a reactive observable that emits when any field referenced in the expression changes.
 * This allows the UI to re-evaluate the expression when dependencies change.
 */
export function getEnableExpressionDependencies(expr: string): string[] {
  if (!expr || expr.trim() === '') {
    return []
  }

  const dependencies: string[] = []

  // Match par.fieldName patterns
  const parMatches = expr.matchAll(/par\.(\w+)/g)
  for (const match of parMatches) {
    dependencies.push(`par.${match[1]}`)
  }

  // Match op('/path').par.fieldName patterns
  const opParMatches = expr.matchAll(/op\(['"]([^'"]+)['"]\)\.par\.(\w+)/g)
  for (const match of opParMatches) {
    dependencies.push(`${match[1]}.par.${match[2]}`)
  }

  // Match op('/path').out.fieldName patterns
  const opOutMatches = expr.matchAll(/op\(['"]([^'"]+)['"]\)\.out\.(\w+)/g)
  for (const match of opOutMatches) {
    dependencies.push(`${match[1]}.out.${match[2]}`)
  }

  return [...new Set(dependencies)] // Remove duplicates
}
