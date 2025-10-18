#!/usr/bin/env tsx
/**
 * Parse operator classes from operators.ts using TypeScript Compiler API
 * Extracts: displayName, description, inputs (with types), outputs (with types)
 */

import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'

interface OperatorInput {
  name: string
  fieldType: string
  defaultValue?: any
  options?: Record<string, any>
}

interface OperatorOutput {
  name: string
  fieldType: string
}

interface OperatorMetadata {
  name: string
  displayName: string
  description: string
  inputs: OperatorInput[]
  outputs: OperatorOutput[]
}

export function parseOperatorsFile(filePath: string): Map<string, OperatorMetadata> {
  const sourceText = fs.readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  )

  const operators = new Map<string, OperatorMetadata>()

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text

      // Only process operator classes (ends with 'Op' and extends Operator)
      if (!className?.endsWith('Op')) {
        return
      }

      const heritage = node.heritageClauses?.[0]
      if (!heritage || heritage.token !== ts.SyntaxKind.ExtendsKeyword) {
        return
      }

      const extendsType = heritage.types[0].expression
      if (!ts.isIdentifier(extendsType) || extendsType.text !== 'Operator') {
        return
      }

      // Extract static properties
      let displayName = className.replace(/Op$/, '')
      let description = `${className} operator`

      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) &&
            member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) {
          const propName = member.name.getText(sourceFile)
          const initializer = member.initializer

          if (propName === 'displayName' && initializer && ts.isStringLiteral(initializer)) {
            displayName = initializer.text
          } else if (propName === 'description' && initializer && ts.isStringLiteral(initializer)) {
            description = initializer.text
          }
        }
      }

      // Extract createInputs and createOutputs
      const inputs = extractFields(node, 'createInputs', sourceFile)
      const outputs = extractFields(node, 'createOutputs', sourceFile)

      operators.set(className, {
        name: className,
        displayName,
        description,
        inputs,
        outputs,
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return operators
}

function extractFields(
  classNode: ts.ClassDeclaration,
  methodName: 'createInputs' | 'createOutputs',
  sourceFile: ts.SourceFile
): OperatorInput[] | OperatorOutput[] {
  for (const member of classNode.members) {
    if (ts.isMethodDeclaration(member)) {
      const name = member.name.getText(sourceFile)
      if (name !== methodName) continue

      const body = member.body
      if (!body) continue

      // Find return statement
      for (const statement of body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          return parseFieldsFromReturnExpression(statement.expression, sourceFile)
        }
      }
    }
  }

  return []
}

function parseFieldsFromReturnExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile
): OperatorInput[] {
  const fields: OperatorInput[] = []

  if (!ts.isObjectLiteralExpression(expr)) {
    return fields
  }

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue

    const fieldName = prop.name.getText(sourceFile)
    const initializer = prop.initializer

    if (!ts.isNewExpression(initializer)) continue

    const fieldType = initializer.expression.getText(sourceFile)

    // Parse arguments
    let defaultValue: any = undefined
    let options: Record<string, any> = {}

    if (initializer.arguments) {
      if (initializer.arguments.length > 0) {
        const firstArg = initializer.arguments[0]
        defaultValue = getConstantValue(firstArg, sourceFile)
      }

      if (initializer.arguments.length > 1) {
        const secondArg = initializer.arguments[1]
        if (ts.isObjectLiteralExpression(secondArg)) {
          options = parseObjectLiteral(secondArg, sourceFile)
        }
      }
    }

    fields.push({
      name: fieldName,
      fieldType,
      defaultValue,
      options,
    })
  }

  return fields
}

function getConstantValue(expr: ts.Expression, sourceFile: ts.SourceFile): any {
  if (ts.isNumericLiteral(expr)) {
    return parseFloat(expr.text)
  }
  if (ts.isStringLiteral(expr)) {
    return expr.text
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return false
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return null
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.map(e => getConstantValue(e, sourceFile))
  }
  return undefined
}

function parseObjectLiteral(
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = prop.name.getText(sourceFile)
      const value = getConstantValue(prop.initializer, sourceFile)
      result[key] = value
    }
  }

  return result
}

// For testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const operatorsFile = path.join(process.cwd(), 'src', 'noodles', 'operators.ts')
  const operators = parseOperatorsFile(operatorsFile)

  console.log(`Parsed ${operators.size} operators\n`)

  // Show first few examples
  let count = 0
  for (const [name, meta] of operators) {
    if (count++ >= 3) break

    console.log(`${name}:`)
    console.log(`  Display: ${meta.displayName}`)
    console.log(`  Description: ${meta.description}`)
    console.log(`  Inputs:`, meta.inputs.map(i => `${i.name}: ${i.fieldType}`).join(', '))
    console.log(`  Outputs:`, meta.outputs.map(o => `${o.name}: ${o.fieldType}`).join(', '))
    console.log()
  }
}
