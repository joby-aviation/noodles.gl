import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  currentVersion,
  SCHEMA_DIR,
  schemaFiles,
  staleSchemaFiles,
} from './generate-project-schema'

const cwd = join(import.meta.dirname, '..')

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function writeFiles(files: Map<string, string>) {
  dir = mkdtempSync(join(tmpdir(), 'project-schema-'))
  for (const [name, contents] of files) writeFileSync(join(dir, name), contents)
  return dir
}

describe('generate-project-schema', () => {
  it('reads the version from LATEST', () => {
    expect(currentVersion('019-rename-bounds-literal-inputs\n')).toBe(19)
    expect(() => currentVersion('')).toThrow('LATEST')
  })

  it('writes the document schema, a pinned copy, and the operator-graph schema', () => {
    const files = schemaFiles(7, 1)
    expect([...files.keys()]).toEqual([
      'noodles-project.schema.json',
      'noodles-document.v1.schema.json',
      'noodles-project.v7.schema.json',
    ])
    const [stable, pinned, graph] = [...files.values()].map(contents => JSON.parse(contents))
    expect(stable.$id).toBe('https://noodles.gl/schema/noodles-project.schema.json')
    expect(pinned.$id).toBe('https://noodles.gl/schema/noodles-document.v1.schema.json')
    expect({ ...stable, $id: undefined }).toEqual({ ...pinned, $id: undefined })
    expect(graph.$id).toBe('https://noodles.gl/schema/noodles-project.v7.schema.json')
    expect(graph.properties.version.const).toBe(7)
  })

  it('reports missing and changed files', () => {
    const files = schemaFiles(7)
    const at = writeFiles(new Map([['noodles-project.schema.json', '{}\n']]))
    expect(staleSchemaFiles(at, 7)).toEqual([...files.keys()])
  })

  it('passes once the files match, even beside older versions', () => {
    const at = writeFiles(new Map([...schemaFiles(6), ...schemaFiles(7)]))
    expect(staleSchemaFiles(at, 7)).toEqual([])
  })

  // The CI step: the checked-in files match this checkout
  it('--check passes on the checked-in schema', () => {
    expect(staleSchemaFiles(SCHEMA_DIR, currentVersion())).toEqual([])
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/generate-project-schema.ts', '--check'],
      { cwd, encoding: 'utf8', timeout: 15_000 }
    )
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 20_000)
})
