import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Profile } from './types.ts'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const EXAMPLES_DIR = resolve(REPO_ROOT, 'noodles-editor/src/examples')

// The bundled examples are held to their own rules; any other project file,
// in this repo or not, is checked as an external project
export function profileFor(file: string): Profile {
  const path = relative(EXAMPLES_DIR, resolve(file))
  return path && !path.startsWith('..') && !isAbsolute(path) ? 'examples' : 'external'
}
