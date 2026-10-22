// Example projects under noodles-editor/src/examples, shaped like the in-app
// list_examples and get_example results (src/ai-chat/runtime-examples-loader.ts)

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isFile, subdirectories } from './docs.ts'

export const EXAMPLES_DIR = 'noodles-editor/src/examples'

export interface ExampleSummary {
  id: string
  name: string
  description: string
  tags: string[]
  // Repo-relative directory, where the project's data files sit too
  path: string
}

export function listExamples(repoRoot: string): ExampleSummary[] {
  const dir = join(repoRoot, EXAMPLES_DIR)
  return subdirectories(dir)
    .filter(id => isFile(join(dir, id, 'noodles.json')))
    .map(id => summarize(repoRoot, id))
}

export function getExample(repoRoot: string, id: string) {
  // An id is a directory name; anything with a separator is not one
  if (!/^[\w-]+$/.test(id)) return null
  const dir = join(repoRoot, EXAMPLES_DIR, id)
  const projectPath = join(dir, 'noodles.json')
  if (!isFile(projectPath)) return null

  const project = JSON.parse(readFileSync(projectPath, 'utf8'))
  const types = [...new Set<string>((project.nodes ?? []).map((n: { type: string }) => n.type))]
  return {
    ...summarize(repoRoot, id),
    readme: readme(dir),
    files: readdirSync(dir).sort(),
    layerTypes: types.filter(t => t.includes('Layer')),
    dataSourceTypes: types.filter(
      t => t.includes('File') || t.includes('JSON') || t.includes('DuckDb')
    ),
    project: stripLargeData(project),
  }
}

function summarize(repoRoot: string, id: string): ExampleSummary {
  const text = readme(join(repoRoot, EXAMPLES_DIR, id))
  const name =
    text.match(/^#\s+(.+)$/m)?.[1] ?? id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const description = text.match(/^#\s+.+\n\n(.+)/m)?.[1].trim() ?? `Example project: ${id}`
  return { id, name, description, tags: id.split('-'), path: `${EXAMPLES_DIR}/${id}` }
}

function readme(dir: string): string {
  const path = join(dir, 'README.md')
  return isFile(path) ? readFileSync(path, 'utf8') : ''
}

// Inline datasets can run to megabytes; keep a sample of each
function stripLargeData(project: unknown): unknown {
  return JSON.parse(
    JSON.stringify(project, (key, value) => {
      if (key !== 'data') return value
      if (Array.isArray(value) && value.length > 10) {
        return {
          _sample: value.slice(0, 10),
          _note: `Sample of first 10 items. Full dataset has ${value.length} items (truncated for size).`,
        }
      }
      if (typeof value === 'string' && value.length > 1000) {
        return {
          _sample: value.substring(0, 1000),
          _note: `Sample of first 1000 characters. Full string has ${value.length} characters (truncated for size).`,
        }
      }
      return value
    })
  )
}
