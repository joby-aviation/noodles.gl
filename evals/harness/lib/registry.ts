// Operator registry for handle-lint, extracted from the WORKSPACE's
// operators.ts (the commit under test), via the repo's TS-compiler-API parser
// (noodles-editor/scripts/parse-operators.ts). Never imports operators.ts
// itself — that file only loads under Vite.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
// eslint-disable-next-line import/no-relative-packages
import { parseOperatorsFile } from '../../../noodles-editor/scripts/parse-operators'

export interface OperatorSchema {
  inputs: Set<string>
  outputs: Set<string>
  /** true when createInputs/createOutputs uses object spreads the static
   * parser can't resolve (e.g. ...createBaseViewFields()) — that side is
   * "open": field-level lint must be skipped to avoid false positives. */
  inputsOpen: boolean
  outputsOpen: boolean
}

export interface Registry {
  /** every known operator type name */
  types: Set<string>
  /** parsed field names per type (types missing here get no field-level lint) */
  schemas: Map<string, OperatorSchema>
}

export function loadRegistry(workspaceRoot: string): Registry {
  const operatorsPath = path.join(workspaceRoot, 'noodles-editor', 'src', 'noodles', 'operators.ts')
  const parsed = parseOperatorsFile(operatorsPath)

  const source = fs.readFileSync(operatorsPath, 'utf-8')
  const openSides = findSpreadSides(operatorsPath, source)

  const schemas = new Map<string, OperatorSchema>()
  for (const [name, meta] of parsed) {
    schemas.set(name, {
      inputs: new Set(meta.inputs.map(i => i.name)),
      outputs: new Set(meta.outputs.map(o => o.name)),
      inputsOpen: openSides.get(name)?.inputs ?? false,
      outputsOpen: openSides.get(name)?.outputs ?? false,
    })
  }

  // The opTypes export is the authoritative membership list; union it in so an
  // operator the static parser missed is still a known type (it just gets no
  // field-level lint).
  const types = new Set<string>(schemas.keys())
  const opTypesMatch = source.match(/export const opTypes = \{([\s\S]*?)\n\}/)
  if (opTypesMatch) {
    for (const m of opTypesMatch[1].matchAll(/^\s*([A-Za-z0-9_]+),?\s*$/gm)) {
      types.add(m[1])
    }
  }

  return { types, schemas }
}

/** Classes whose createInputs/createOutputs return object contains spread
 * elements the static field parser silently drops. */
function findSpreadSides(fileName: string, source: string): Map<string, { inputs: boolean; outputs: boolean }> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const result = new Map<string, { inputs: boolean; outputs: boolean }>()

  function hasSpreadInReturn(method: ts.MethodDeclaration): boolean {
    let found = false
    method.body?.statements.forEach(statement => {
      if (ts.isReturnStatement(statement) && statement.expression && ts.isObjectLiteralExpression(statement.expression)) {
        if (statement.expression.properties.some(p => ts.isSpreadAssignment(p))) found = true
      }
    })
    return found
  }

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && node.name) {
      const entry = { inputs: false, outputs: false }
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue
        const name = member.name.getText(sourceFile)
        if (name === 'createInputs' && hasSpreadInReturn(member)) entry.inputs = true
        if (name === 'createOutputs' && hasSpreadInReturn(member)) entry.outputs = true
      }
      if (entry.inputs || entry.outputs) result.set(node.name.text, entry)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

// Current schema version = highest-numbered migration in the workspace
// (mirrors migrate-schema.ts's NOODLES_VERSION without importing Vite code).
export function noodlesVersion(workspaceRoot: string): number {
  const dir = path.join(workspaceRoot, 'noodles-editor', 'src', 'noodles', '__migrations__')
  let max = 0
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d+)-.*(?<!\.test)\.ts$/)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  if (max === 0) throw new Error(`No migrations found under ${dir}`)
  return max
}
