import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry } from './index.ts'
import { validateProject } from './lint.ts'
import type { Diagnostic, Registry, ValidationResult } from './types.ts'

export const EXIT_OK = 0
export const EXIT_INVALID = 1
export const EXIT_USAGE = 2

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_PATHS = ['noodles-editor/src/examples', 'noodles-editor/public/noodles'].map(p =>
  join(REPO_ROOT, p)
)
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])
// Data files sit next to projects; don't parse big ones to find out they aren't
const MAX_SNIFF_BYTES = 2 * 1024 * 1024

const USAGE = `Usage: validate-projects [--json] [path ...]

Checks noodles.json project files against the operator registry: schema
version, operator types, input names, edge handles, duplicate edges.

  path     A project file, or a directory to search for them. Defaults to
           noodles-editor/src/examples and noodles-editor/public/noodles.
  --json   Print results as JSON.

Exit status: 0 when every file is valid (warnings allowed), 1 when any file
has errors, 2 for bad arguments or when no project files are found.`

interface Io {
  cwd: string
  stdout: (text: string) => void
  stderr: (text: string) => void
}

interface FileResult extends ValidationResult {
  file: string
}

export function run(argv: string[], io: Io, registry: Registry = loadRegistry()): number {
  const flags = argv.filter(arg => arg.startsWith('-'))
  const paths = argv.filter(arg => !arg.startsWith('-'))
  if (flags.includes('--help') || flags.includes('-h')) {
    io.stdout(USAGE)
    return EXIT_OK
  }
  const unknown = flags.filter(flag => flag !== '--json')
  if (unknown.length > 0) {
    io.stderr(`Unknown option ${unknown[0]}.\n\n${USAGE}`)
    return EXIT_USAGE
  }
  const json = flags.includes('--json')

  const roots = paths.length > 0 ? paths.map(p => resolve(io.cwd, p)) : DEFAULT_PATHS
  const files: string[] = []
  for (const root of roots) {
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(root)
    } catch {
      io.stderr(`${relative(io.cwd, root) || root}: no such file or directory.`)
      return EXIT_USAGE
    }
    if (stat.isDirectory()) files.push(...findProjects(root))
    else files.push(root)
  }
  if (files.length === 0) {
    io.stderr(
      `No project files found in ${roots.map(r => relative(io.cwd, r) || '.').join(', ')}. Project files are named noodles.json.`
    )
    return EXIT_USAGE
  }

  const results = files.map(file => ({
    file: relative(io.cwd, file) || file,
    ...validateFile(file, registry),
  }))
  const valid = results.every(r => r.valid)

  if (json) {
    io.stdout(
      JSON.stringify(
        {
          valid,
          registry: {
            projectVersion: registry.projectVersion,
            operators: Object.keys(registry.operators).length,
          },
          files: results,
        },
        null,
        2
      )
    )
  } else {
    io.stdout(formatResults(results, registry))
  }
  return valid ? EXIT_OK : EXIT_INVALID
}

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

// Every noodles.json, plus other .json files shaped like a project (e.g.
// public/noodles/table-editor-demo.json)
function findProjects(dir: string): string[] {
  const found: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...findProjects(path))
    } else if (
      entry.name === 'noodles.json' ||
      (entry.name.endsWith('.json') && looksLikeProject(path))
    ) {
      found.push(path)
    }
  }
  return found
}

function looksLikeProject(path: string): boolean {
  if (statSync(path).size > MAX_SNIFF_BYTES) return false
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed?.version === 'number' && Array.isArray(parsed.nodes)
  } catch {
    return false
  }
}

function formatResults(results: FileResult[], registry: Registry): string {
  const lines: string[] = []
  for (const result of results) {
    const diagnostics = [...result.errors, ...result.warnings]
    if (diagnostics.length === 0) continue
    lines.push(result.file)
    for (const d of diagnostics) {
      lines.push(`  ${d.severity.padEnd(7)} ${d.at}  ${d.message} [${d.rule}]`)
    }
    lines.push('')
  }

  const errors = results.reduce((n, r) => n + r.errors.length, 0)
  const warnings = results.reduce((n, r) => n + r.warnings.length, 0)
  const failed = results.filter(r => !r.valid).length
  const files = `${results.length} ${results.length === 1 ? 'file' : 'files'}`
  const warned = warnings > 0 ? `, ${plural(warnings, 'warning')}` : ''
  if (errors === 0) {
    lines.push(
      `OK: ${files} valid against ${Object.keys(registry.operators).length} operators, schema version ${registry.projectVersion}${warned}.`
    )
  } else {
    lines.push(
      `FAIL: ${plural(errors, 'error')}${warned} in ${failed} of ${files}. Fix the errors and run validate-projects again.`
    )
  }
  return lines.join('\n')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
