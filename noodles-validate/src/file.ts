import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { checkAssets } from './assets.ts'
import { validateProject } from './lint.ts'
import { profileFor } from './profile.ts'
import type { Diagnostic, Registry, ValidateOptions, ValidationResult } from './types.ts'

// A file that can't be read or doesn't parse is a validation failure, not an
// exception. The profile defaults to the one for where the file is: examples
// under noodles-editor/src/examples, external anywhere else
export function validateFile(
  file: string,
  registry: Registry,
  options: ValidateOptions = {}
): ValidationResult {
  const profile = options.profile ?? profileFor(file, options.examplesDir)
  const fail = (rule: Diagnostic['rule'], message: string): ValidationResult => ({
    valid: false,
    errors: [{ severity: 'error', rule, at: '$', message }],
    warnings: [],
    profile,
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
  const result = validateProject(project, registry, { profile })
  if (profile === 'examples') return { ...result, profile }

  // Examples load their files from the example's own folder, not data/, so
  // this is for external projects only
  const errors = [...result.errors, ...checkAssets(project, dirname(file), registry)]
  // An external file behind the schema gets a version warning, and only the
  // checks that don't depend on the schema
  const partial = result.warnings.some(d => d.rule === 'version')
  return {
    valid: errors.length === 0,
    errors,
    warnings: result.warnings,
    profile,
    ...(partial && { partial }),
  }
}
