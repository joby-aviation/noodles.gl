import { readFileSync } from 'node:fs'
import { validateProject } from './lint.ts'
import type { Diagnostic, Registry, ValidationResult } from './types.ts'

// A file that doesn't parse is a validation failure, not an exception
export function validateFile(file: string, registry: Registry): ValidationResult {
  let project: unknown
  try {
    project = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    const diagnostic: Diagnostic = {
      severity: 'error',
      rule: 'invalid-json',
      at: '$',
      message: `Not valid JSON: ${(error as Error).message}`,
    }
    return { valid: false, errors: [diagnostic], warnings: [] }
  }
  return validateProject(project, registry)
}
