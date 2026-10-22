import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, run, validateFile } from '../src/cli.ts'
import { loadRegistry } from '../src/index.ts'
import { currentFixtures } from './fixtures.ts'

const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(PACKAGE, 'bin/validate-projects.ts')
// Paths in these tests are relative to a copy of the fixtures at the current version
const ROOT = currentFixtures()

function cli(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = run(argv, {
    cwd: ROOT,
    stdout: text => out.push(text),
    stderr: text => err.push(text),
  })
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

describe('validate-projects', () => {
  it('exits 0 and says OK for a valid project', () => {
    const { code, stdout } = cli('test/fixtures/valid/noodles.json')
    assert.equal(code, EXIT_OK)
    assert.match(stdout, /^OK: 1 file valid against \d+ operators, schema version \d+\.$/)
  })

  it('exits 1 and lists each problem with its location and rule', () => {
    const { code, stdout } = cli('test/fixtures/broken')
    assert.equal(code, EXIT_INVALID)
    assert.match(stdout, /^test\/fixtures\/broken\/noodles\.json$/m)
    assert.match(
      stdout,
      /error {3}nodes\[0\] {2}\/earthquakes: Unknown operator type File\..*\[unknown-operator\]/
    )
    assert.match(stdout, /error {3}edges\[1\] .*in\.vis is malformed.*\[edge-handle\]/)
    assert.match(stdout, /^FAIL: 4 errors in 1 of 1 file\./m)
  })

  it('searches directories for project files', () => {
    const { code, stdout } = cli('test/fixtures')
    assert.equal(code, EXIT_INVALID)
    assert.match(stdout, /in 1 of 2 files/)
  })

  it('prints JSON with --json', () => {
    const { code, stdout } = cli('--json', 'test/fixtures')
    assert.equal(code, EXIT_INVALID)
    const result = JSON.parse(stdout)
    assert.equal(result.valid, false)
    assert.equal(result.files.length, 2)
    const broken = result.files.find((f: { file: string }) => f.file.includes('broken'))
    assert.deepEqual(
      broken.errors.map((d: { rule: string }) => d.rule),
      ['unknown-operator', 'unknown-input', 'edge-handle', 'edge-handle']
    )
    assert.equal(typeof result.registry.projectVersion, 'number')
  })

  it('reports a file that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noodles-validate-'))
    const file = join(dir, 'noodles.json')
    writeFileSync(file, '{ "version": 18, ')
    const { code, stdout } = cli(file)
    assert.equal(code, EXIT_INVALID)
    assert.match(stdout, /Not valid JSON.*\[invalid-json\]/)
  })

  it('reports a file it cannot read under its own rule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noodles-validate-'))
    const result = validateFile(dir, loadRegistry())
    assert.equal(result.valid, false)
    assert.equal(result.errors[0].rule, 'unreadable-file')
  })

  it('exits 2 for a missing path, an unknown flag, or no projects found', () => {
    assert.equal(cli('does-not-exist.json').code, EXIT_USAGE)
    assert.equal(cli('--fix').code, EXIT_USAGE)
    assert.equal(cli(join(PACKAGE, 'src')).code, EXIT_USAGE)
  })

  it('finds every example project in the editor valid', () => {
    const { code, stdout } = cli(join(PACKAGE, '../noodles-editor/src/examples'))
    assert.equal(code, EXIT_OK, stdout)
  })

  it('runs as a plain Node script', () => {
    const result = spawnSync(process.execPath, [BIN, 'test/fixtures/broken'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    assert.equal(result.status, EXIT_INVALID)
    assert.match(result.stdout, /^FAIL:/m)
  })
})
