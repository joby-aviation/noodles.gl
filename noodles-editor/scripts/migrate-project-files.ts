// Migrates noodles.json project files to this checkout's schema version.
//
//   npm run migrate-projects                                  # every project in src/examples
//   npm run migrate-projects -- ~/code/viz/projects "My Map"  # files or folders anywhere
//   npm run migrate-projects -- --check <paths>               # exit 1 if any file would change (CI)
//   npm run migrate-projects -- --from 19 <one project>       # ignore a wrong saved version
//
// Relative paths resolve against the directory npm was run from. The functions below are
// exported so other tools (e.g. the project validator) can migrate files the same way.

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { migrateProject, NOODLES_VERSION } from '../src/noodles/utils/migrate-schema.js'
import type { NoodlesProjectJSON } from '../src/noodles/utils/serialization.js'

const EXAMPLES_DIR = 'src/examples'

// Old migrations reuse editor modules that read settings from localStorage. Node has none
// (without a flag), so give them an empty one that lasts as long as the process.
if (!('localStorage' in globalThis)) {
  const items = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return items.size
      },
      key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, String(value)),
      removeItem: (key: string) => items.delete(key),
      clear: () => items.clear(),
    },
  })
}

export type MigrateResult =
  | {
      file: string
      status: 'migrated' | 'unchanged'
      savedVersion: number
      from: number
      to: number
    }
  // A document, the format the editor saves now: migrations are for the operator graphs
  // before it, which the editor converts when it opens them
  | { file: string; status: 'document' }
  | { file: string; status: 'error'; error: string }

export interface MigrateOptions {
  // Treat the project as saved at this version, for a file whose saved number is wrong
  from?: number
  // false reports what would change without writing anything
  write?: boolean
}

// As isEditorDoc in src/editor/load-doc.ts: both formats have small version numbers, so the
// shape decides. A document's nodes name an `op`, an operator graph's a `type`.
function isDocument(data: unknown): boolean {
  const j = data as { version?: unknown; nodes?: unknown; edges?: unknown } | null
  return (
    j?.version === 1 &&
    Array.isArray(j.nodes) &&
    Array.isArray(j.edges) &&
    j.nodes.every(n => typeof (n as { op?: unknown })?.op === 'string') &&
    j.edges.every(e => typeof (e as { sourcePort?: unknown })?.sourcePort === 'string')
  )
}

function isProject(data: unknown): data is NoodlesProjectJSON {
  const project = data as NoodlesProjectJSON | null
  return typeof project?.version === 'number' && Array.isArray(project.nodes)
}

async function walk(dir: string): Promise<string[]> {
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Dependencies and dot-folders (.git, .cache) never hold projects and can be huge
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      files.push(...(await walk(fullPath)))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath)
    }
  }
  return files
}

// Expands files and folders into the project files under them. Files named directly are
// always returned; JSON files found by walking a folder are returned only if they look
// like projects (or are named noodles.json, so a broken one is reported, not skipped).
export async function findProjectFiles(paths: string[]): Promise<string[]> {
  const found = new Set<string>()
  for (const path of paths) {
    const info = await stat(path).catch(() => null)
    if (!info) throw new Error(`No such file or folder: ${path}`)
    if (!info.isDirectory()) {
      found.add(path)
      continue
    }
    for (const file of await walk(path)) {
      if (basename(file) === 'noodles.json') {
        found.add(file)
        continue
      }
      try {
        if (isProject(JSON.parse(await readFile(file, 'utf8')))) found.add(file)
      } catch {
        // Not JSON we can read, so not a project (data files, editor configs, ...)
      }
    }
  }
  return [...found]
}

export async function migrateProjectFile(
  file: string,
  { from, write = true }: MigrateOptions = {}
): Promise<MigrateResult> {
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (isDocument(data)) return { file, status: 'document' }
    if (!isProject(data)) {
      return { file, status: 'error', error: 'not a noodles project (no version or nodes)' }
    }
    const savedVersion = data.version
    const start = from ?? savedVersion
    if (start > NOODLES_VERSION) {
      return {
        file,
        status: 'error',
        error: `saved at v${start}, newer than this checkout's v${NOODLES_VERSION}. Update noodles.gl, or pass --from with the last version it really has if the number came from an unmerged branch`,
      }
    }

    const migrated = await migrateProject({ ...data, version: start })
    const changed = JSON.stringify(migrated) !== JSON.stringify(data)
    if (changed && write) {
      await writeFile(file, `${JSON.stringify(migrated, null, 2)}\n`)
    }
    return {
      file,
      status: changed ? 'migrated' : 'unchanged',
      savedVersion,
      from: start,
      to: migrated.version,
    }
  } catch (error) {
    return { file, status: 'error', error: (error as Error).message }
  }
}

// Finds the project files under `paths` and migrates each one in turn
export async function migrateProjectFiles(
  paths: string[],
  options: MigrateOptions = {}
): Promise<MigrateResult[]> {
  const { from } = options
  if (from !== undefined && (!Number.isInteger(from) || from < 0 || from > NOODLES_VERSION)) {
    throw new Error(`--from must be a whole number from 0 to ${NOODLES_VERSION}, got ${from}`)
  }
  const files = await findProjectFiles(paths)
  // A wrong saved version is a fact about one file. Applying one number to many files
  // would re-run migrations on some and skip them on others, so name the file instead.
  if (from !== undefined && files.length !== 1) {
    throw new Error(
      `--from applies to a single project file, but ${files.length} were found. Pass just the one whose saved version is wrong`
    )
  }

  const results: MigrateResult[] = []
  for (const file of files) {
    results.push(await migrateProjectFile(file, options))
  }
  return results
}

const USAGE = `Usage: npm run migrate-projects -- [--check] [--from <version>] [file or folder ...]

Migrates noodles.json project files to schema v${NOODLES_VERSION}. Folders are searched for
project files. With no paths, migrates every project in noodles-editor/${EXAMPLES_DIR}.

  --check           Report which files would change without writing them. Exits 1 if any would
  --from <version>  Treat the project as saved at <version>, for one file whose saved version
                    is wrong (e.g. a number from an unmerged branch). Needs exactly one project
  -h, --help        Show this message`

export interface CliOptions {
  // Where relative paths resolve from (npm sets INIT_CWD to the directory it was run in)
  cwd?: string
  // Searched when no paths are given
  defaultPaths?: string[]
  log?: (line: string) => void
  error?: (line: string) => void
}

// Runs the command line and returns the exit code
export async function runMigrateCli(
  argv: string[],
  {
    cwd = process.cwd(),
    defaultPaths = [resolve(EXAMPLES_DIR)],
    log = console.log,
    error = console.error,
  }: CliOptions = {}
): Promise<number> {
  let values: { check?: boolean; from?: string; help?: boolean }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        check: { type: 'boolean' },
        from: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }))
  } catch (e) {
    error(`${(e as Error).message}\n\n${USAGE}`)
    return 1
  }
  if (values.help) {
    log(USAGE)
    return 0
  }

  const check = values.check ?? false
  const from = values.from === undefined ? undefined : Number(values.from)
  const paths = positionals.length ? positionals.map(path => resolve(cwd, path)) : defaultPaths
  const display = (file: string) => relative(cwd, file) || file

  let results: MigrateResult[]
  try {
    results = await migrateProjectFiles(paths, { from, write: !check })
  } catch (e) {
    error(`Error: ${(e as Error).message}`)
    return 1
  }

  let changed = 0
  let errors = 0
  for (const result of results) {
    const name = display(result.file)
    if (result.status === 'error') {
      errors++
      error(`✗ ${name}: ${result.error}`)
      continue
    }
    if (result.status === 'document') {
      log(`- No changes needed for ${name} (a document)`)
      continue
    }
    const saved = result.from === result.savedVersion ? '' : `, saved as v${result.savedVersion}`
    if (result.status === 'migrated') {
      changed++
      log(
        `${check ? '!' : '✓'} ${check ? 'Would migrate' : 'Migrated'} ${name} (v${result.from} → v${result.to}${saved})`
      )
    } else {
      log(`- No changes needed for ${name} (already v${result.to})`)
    }
  }

  const unchanged = results.length - changed - errors
  const failed = errors ? `, ${errors} failed` : ''
  if (check) {
    log(`\n${changed} file(s) would change, ${unchanged} up to date${failed}.`)
    if (changed) log('Run without --check to migrate them.')
    return changed || errors ? 1 : 0
  }
  log(`\nMigration complete. ${changed} file(s) updated, ${unchanged} already up to date${failed}.`)
  return errors ? 1 : 0
}

if (import.meta.main) {
  runMigrateCli(process.argv.slice(2), { cwd: process.env.INIT_CWD ?? process.cwd() }).then(
    code => {
      process.exitCode = code
    }
  )
}
