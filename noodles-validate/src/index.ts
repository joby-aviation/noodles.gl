import { readFileSync } from 'node:fs'
import type { Registry } from './types.ts'

export { handleProblem, resolveOperatorType, suggest, unknownInput, unknownType } from './fields.ts'
export { validateFile } from './file.ts'
export { lintProject, validateProject } from './lint.ts'
export type * from './types.ts'

// The snapshot generated from the editor's operator classes by
// noodles-editor/src/noodles/operator-registry-snapshot.test.ts
export const REGISTRY_PATH = new URL('../registry.json', import.meta.url)

let cached: Registry | null = null

export function loadRegistry(): Registry {
  cached ??= JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry
  return cached
}
