// Checks that a project's @/ file references name files next to it. Reads the
// file system, so it lives apart from the pure checks in lint.ts.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Diagnostic, Registry } from './types.ts'

// projectScheme in noodles-editor/src/noodles/utils/filesystem.ts
const PROJECT_SCHEME = '@/'
// DATA_DIRECTORY_NAME in noodles-editor/src/noodles/storage.ts
const DATA_DIRECTORY = 'data'
// The parameters that take a file are the registry's `url` kind: a file node's URL, a map
// style, an image, an icon atlas, a mesh. In any other parameter, such as text or code, an
// @/ string is just text.
const FILE_KIND = 'url'

// The parameters of `op` that take a file
function fileParams(registry: Registry, op: string): Set<string> {
  const params = registry.operators[op]?.params ?? {}
  return new Set(
    Object.entries(params).flatMap(([name, p]) => (p.kind === FILE_KIND ? [name] : []))
  )
}

// A node's id and the values that may name a file: a document's params, or an operator-graph
// node's inputs, whose class names the operators it converts to (`formerly`)
function fileValues(
  node: Record<string, unknown>,
  registry: Registry
): { id: string; values: [string, unknown][] } | null {
  if (typeof node.id !== 'string') return null
  if (typeof node.op === 'string') {
    const names = fileParams(registry, node.op)
    const params = isObject(node.params) ? node.params : {}
    return { id: node.id, values: Object.entries(params).filter(([name]) => names.has(name)) }
  }
  if (typeof node.type === 'string') {
    const names = new Set(
      (registry.formerly?.[node.type] ?? []).flatMap(op => [...fileParams(registry, op)])
    )
    const inputs = isObject(node.data) && isObject(node.data.inputs) ? node.data.inputs : {}
    return { id: node.id, values: Object.entries(inputs).filter(([name]) => names.has(name)) }
  }
  return null
}

// As readAsset and readAssetBinary in storage.ts read a saved project's files:
// @/x.csv and @/data/x.csv are both <project>/data/x.csv, and a nested name is
// split on "/" with empty segments dropped. Only a file parameter whose whole value
// is an @/ string names a file.
export function checkAssets(
  project: unknown,
  projectDir: string,
  registry: Registry
): Diagnostic[] {
  const out: Diagnostic[] = []
  if (!isObject(project) || !Array.isArray(project.nodes)) return out
  const listings = new Map<string, string[] | null>()

  project.nodes.forEach((node, index) => {
    const found = isObject(node) ? fileValues(node, registry) : null
    if (!found) return
    for (const [name, value] of found.values) {
      if (typeof value !== 'string' || !value.startsWith(PROJECT_SCHEME)) continue
      const problem = assetProblem(value, projectDir, listings)
      if (!problem) continue
      // Bundled examples read @/ files from the example's own folder; a project
      // opened from disk doesn't
      const beside = fileBesideProject(value, projectDir)
      const fix = beside
        ? `${beside} is next to noodles.json, where only the bundled examples read @/ files from: move it into ${DATA_DIRECTORY}/, or pass --examples if this is one.`
        : `@/ names a file in the project's ${DATA_DIRECTORY}/ folder: add the file there or fix the name.`
      out.push({
        severity: 'error',
        rule: 'missing-asset',
        at: `nodes[${index}]`,
        id: found.id,
        message: `${found.id} ${name} is ${value}, but ${problem} ${fix}`,
      })
    }
  })
  return out
}

// Why the reference doesn't resolve, or null when it names a file
function assetProblem(
  value: string,
  projectDir: string,
  listings: Map<string, string[] | null>
): string | null {
  const name = value.slice(PROJECT_SCHEME.length).replace(/^data\//, '')
  const segments = name.split('/').filter(segment => segment !== '')
  if (segments.length === 0) return 'that names no file.'
  // The browser's directory handles reject these names
  if (segments.some(segment => segment === '.' || segment === '..')) {
    return `files outside ${DATA_DIRECTORY}/ can't be read this way.`
  }

  // Walk the folders by name rather than stat the path: macOS matches names in
  // any case, git and a Linux CI runner don't, so compare them exactly
  let dir = join(projectDir, DATA_DIRECTORY)
  const shown = [DATA_DIRECTORY]
  for (const [i, segment] of segments.entries()) {
    const entries = list(dir, listings)
    if (entries === null) return `there is no ${shown.join('/')}/ folder.`
    const last = i === segments.length - 1
    if (!entries.includes(segment)) {
      const other = entries.find(entry => entry.toLowerCase() === segment.toLowerCase())
      const hint = other
        ? ` The folder has ${[...shown, other].join('/')}; names must match in case.`
        : ''
      return `${[...shown, segment].join('/')} doesn't exist.${hint}`
    }
    dir = join(dir, segment)
    shown.push(segment)
    if (last && list(dir, listings) !== null) return `${shown.join('/')} is a folder.`
  }
  return null
}

// The reference's name when it is a file beside the project file instead
function fileBesideProject(value: string, projectDir: string): string | null {
  const name = value.slice(PROJECT_SCHEME.length)
  try {
    return statSync(join(projectDir, name)).isFile() ? name : null
  } catch {
    return null
  }
}

// The names in a directory, or null when it isn't one
function list(dir: string, listings: Map<string, string[] | null>): string[] | null {
  if (!listings.has(dir)) {
    let names: string[] | null
    try {
      names = readdirSync(dir)
    } catch {
      names = null
    }
    listings.set(dir, names)
  }
  return listings.get(dir) ?? null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
