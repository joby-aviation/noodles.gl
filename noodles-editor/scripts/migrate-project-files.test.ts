import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NOODLES_VERSION } from '../src/noodles/utils/migrate-schema'
import { findProjectFiles, migrateProjectFiles, runMigrateCli } from './migrate-project-files'

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function project(version: number) {
  return { version, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, timeline: {} }
}

const format = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`

// Writes `files` (relative path → JSON value or raw string) under a fresh temp folder
function writeFiles(files: Record<string, unknown>) {
  dir = mkdtempSync(join(tmpdir(), 'migrate-projects-'))
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, typeof contents === 'string' ? contents : format(contents))
  }
  return dir
}

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

async function cli(argv: string[], cwd: string) {
  const out: string[] = []
  const err: string[] = []
  const code = await runMigrateCli(argv, {
    cwd,
    defaultPaths: [cwd],
    log: line => out.push(line),
    error: line => err.push(line),
  })
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

describe('findProjectFiles', () => {
  it('walks folders for projects, skipping data files, node_modules and dot-folders', async () => {
    const root = writeFiles({
      'My Map/noodles.json': project(1),
      'My Map/data.json': [{ a: 1 }],
      'other/renamed.json': project(1),
      'node_modules/pkg/noodles.json': project(1),
      '.git/noodles.json': project(1),
    })

    const files = await findProjectFiles([root])

    expect(files).toEqual([join(root, 'My Map/noodles.json'), join(root, 'other/renamed.json')])
  })

  it('takes files and folders together without duplicates', async () => {
    const root = writeFiles({ 'a/noodles.json': project(1), 'b/noodles.json': project(1) })

    const files = await findProjectFiles([join(root, 'a/noodles.json'), root])

    expect(files).toEqual([join(root, 'a/noodles.json'), join(root, 'b/noodles.json')])
  })

  it('rejects a path that does not exist', async () => {
    await expect(findProjectFiles(['/no/such/project'])).rejects.toThrow('No such file or folder')
  })
})

describe('migrateProjectFiles', () => {
  it('migrates old projects and leaves current ones byte-for-byte alone', async () => {
    const current = '{"version":0,"nodes":[]}'
    const root = writeFiles({
      'old/noodles.json': project(0),
      // Not in the 2-space format, so any write would show up
      'current/noodles.json': current.replace('0', String(NOODLES_VERSION)),
    })

    const results = await migrateProjectFiles([root])

    expect(results.map(r => r.status)).toEqual(['unchanged', 'migrated'])
    expect(read(join(root, 'old/noodles.json')).version).toBe(NOODLES_VERSION)
    expect(readFileSync(join(root, 'old/noodles.json'), 'utf8')).toMatch(/^\{\n {2}"version"/)
    expect(readFileSync(join(root, 'current/noodles.json'), 'utf8')).toBe(
      current.replace('0', String(NOODLES_VERSION))
    )
  })

  it('does not write when write is false', async () => {
    const root = writeFiles({ 'old/noodles.json': project(0) })

    const [result] = await migrateProjectFiles([root], { write: false })

    expect(result).toMatchObject({ status: 'migrated', from: 0, to: NOODLES_VERSION })
    expect(read(join(root, 'old/noodles.json')).version).toBe(0)
  })

  it('starts from --from instead of the saved version', async () => {
    // Saved as current, so without --from nothing would run
    const root = writeFiles({ 'p/noodles.json': project(NOODLES_VERSION) })

    const [result] = await migrateProjectFiles([root], { from: NOODLES_VERSION - 1 })

    expect(result).toMatchObject({
      savedVersion: NOODLES_VERSION,
      from: NOODLES_VERSION - 1,
      to: NOODLES_VERSION,
    })
  })

  it('refuses --from when more than one project is found', async () => {
    const root = writeFiles({ 'a/noodles.json': project(0), 'b/noodles.json': project(0) })

    await expect(migrateProjectFiles([root], { from: 0 })).rejects.toThrow(
      '--from applies to a single project file, but 2 were found'
    )
    expect(read(join(root, 'a/noodles.json')).version).toBe(0)
  })

  it('refuses a --from outside the known versions', async () => {
    const root = writeFiles({ 'p/noodles.json': project(0) })

    await expect(migrateProjectFiles([root], { from: NOODLES_VERSION + 1 })).rejects.toThrow(
      '--from must be a whole number'
    )
  })

  it('reports a project saved at a version this checkout does not have', async () => {
    const root = writeFiles({ 'p/noodles.json': project(NOODLES_VERSION + 1) })

    const [result] = await migrateProjectFiles([root])

    expect(result).toMatchObject({ status: 'error' })
    expect(result.status === 'error' && result.error).toContain('newer than this checkout')
  })

  it('reports a broken noodles.json and a named file that is not a project', async () => {
    const root = writeFiles({ 'p/noodles.json': '{ not json', 'data.json': [1, 2] })

    const results = await migrateProjectFiles([join(root, 'p'), join(root, 'data.json')])

    expect(results.map(r => r.status)).toEqual(['error', 'error'])
  })
})

describe('runMigrateCli', () => {
  it('resolves relative paths with spaces against cwd', async () => {
    const root = writeFiles({ 'Dubai Hero Route/noodles.json': project(0) })

    const { code, stdout } = await cli(['Dubai Hero Route'], root)

    expect(code).toBe(0)
    expect(stdout).toContain(`✓ Migrated Dubai Hero Route/noodles.json (v0 → v${NOODLES_VERSION})`)
    expect(read(join(root, 'Dubai Hero Route/noodles.json')).version).toBe(NOODLES_VERSION)
  })

  it('searches the default paths when none are given', async () => {
    const root = writeFiles({ 'p/noodles.json': project(0) })

    const { code, stdout } = await cli([], root)

    expect(code).toBe(0)
    expect(stdout).toContain('1 file(s) updated')
  })

  it('--check lists what would change, writes nothing and exits 1', async () => {
    const root = writeFiles({
      'old/noodles.json': project(0),
      'current/noodles.json': project(NOODLES_VERSION),
    })

    const { code, stdout } = await cli(['--check', '.'], root)

    expect(code).toBe(1)
    expect(stdout).toContain(`Would migrate old/noodles.json (v0 → v${NOODLES_VERSION})`)
    expect(stdout).toContain('1 file(s) would change, 1 up to date')
    expect(read(join(root, 'old/noodles.json')).version).toBe(0)
  })

  it('--check exits 0 when everything is current', async () => {
    const root = writeFiles({ 'p/noodles.json': project(NOODLES_VERSION) })

    const { code } = await cli(['--check'], root)

    expect(code).toBe(0)
  })

  it('shows the saved version when --from overrides it', async () => {
    const root = writeFiles({ 'p/noodles.json': project(5) })

    const { code, stdout } = await cli(['--from', '0', 'p/noodles.json'], root)

    expect(code).toBe(0)
    expect(stdout).toContain(`(v0 → v${NOODLES_VERSION}, saved as v5)`)
  })

  it('exits 1 with a message for bad arguments and failed files', async () => {
    const root = writeFiles({ 'a/noodles.json': project(0), 'b/noodles.json': '{' })

    const fromMany = await cli(['--from', '0'], root)
    expect(fromMany.code).toBe(1)
    expect(fromMany.stderr).toContain('--from applies to a single project file')

    const unknown = await cli(['--bogus'], root)
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('Usage:')

    const failed = await cli([], root)
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('✗ b/noodles.json')
    expect(failed.stdout).toContain('1 file(s) updated, 0 already up to date, 1 failed')
  })
})

describe('documents', () => {
  it('leaves a document alone, as the format the editor saves now', async () => {
    const document = {
      version: 1,
      name: 'quakes',
      nodes: [{ id: 'n1', op: 'file', name: 'quakes', x: 0, y: 0, params: {} }],
      edges: [],
    }
    const root = writeFiles({ 'quakes/noodles.json': document, 'old/noodles.json': project(0) })
    const results = await migrateProjectFiles([root])
    expect(results.map(r => [r.file.split('/').at(-2), r.status])).toEqual([
      ['old', 'migrated'],
      ['quakes', 'document'],
    ])
    expect(read(join(root, 'quakes/noodles.json'))).toEqual(document)
    const { stdout } = await cli(['--check', join(root, 'quakes')], root)
    expect(stdout).toContain('(a document)')
    expect(stdout).toContain('0 file(s) would change, 1 up to date')
  })
})
