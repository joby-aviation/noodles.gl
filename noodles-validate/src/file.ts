import { readFileSync } from 'node:fs'
import { validateProject } from './lint.ts'
import type { Diagnostic, Registry, ValidationResult } from './types.ts'

// A file that can't be read or doesn't parse is a validation failure, not an exception
export function validateFile(file: string, registry: Registry): ValidationResult {
  const fail = (rule: Diagnostic['rule'], message: string): ValidationResult => ({
    valid: false,
    errors: [{ severity: 'error', rule, at: '$', message }],
    warnings: [],
  })
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return fail('unreadable-file', `Can't read the file: ${(error as Error).message}`)
  }
  let project: unknown
  try {
    project = JSON.parse(text)
  } catch (error) {
    return fail('invalid-json', `Not valid JSON: ${(error as Error).message}`)
  }
  return validateProject(project, registry)
}
