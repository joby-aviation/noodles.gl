import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, run } from '../src/cli.ts'
import {
  checkAssets,
  EXAMPLES_DIR,
  loadRegistry,
  profileFor,
  validateFile,
  validateProject,
} from '../src/index.ts'

const registry = loadRegistry()
const CURRENT = registry.projectVersion
const VALID = JSON.parse(
  readFileSync(new URL('./fixtures/valid/noodles.json', import.meta.url), 'utf8')
)
VALID.version = CURRENT

type Project = typeof VALID

function project(change: (p: Project) => void = () => {}): Project {
  const copy = structuredClone(VALID)
  change(copy)
  return copy
}

function fileNode(id: string, url: string) {
  return { id, type: 'FileOp', position: { x: 0, y: 0 }, data: { inputs: { url } } }
}

// A projects/<name>/ folder, as a repo of projects lays them out: noodles.json
// beside a data/ folder. Names have spaces, as real project folders do
function projectFolder(
  p: unknown,
  files: Record<string, string> = { 'data/data.csv': 'a\n1\n' },
  name = 'Harbor Tour Route'
): { root: string; dir: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'noodles validate '))
  const dir = join(root, 'projects', name)
  mkdirSync(dir, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const file = join(dir, 'noodles.json')
  writeFileSync(file, JSON.stringify(p))
  return { root, dir, file }
}

function cli(cwd: string, ...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = run(argv, { cwd, stdout: t => out.push(t), stderr: t => err.push(t) })
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

describe('profileFor', () => {
  it('picks examples inside noodles-editor/src/examples and external anywhere else', () => {
    assert.equal(profileFor(join(EXAMPLES_DIR, 'nyc-taxis/noodles.json')), 'examples')
    assert.equal(profileFor(join(tmpdir(), 'projects/NYC/noodles.json')), 'external')
    assert.equal(profileFor(`${EXAMPLES_DIR}-old/nyc-taxis/noodles.json`), 'external')
    assert.equal(profileFor(join(EXAMPLES_DIR, '../noodles.json')), 'external')
  })
})

describe('external profile', () => {
  const external = { profile: 'external' } as const

  it('warns, rather than fails, on a file behind the current schema', () => {
    const result = validateProject(
      project(p => (p.version = 6)),
      registry,
      external
    )
    assert.equal(result.valid, true)
    assert.deepEqual(
      result.warnings.map(d => d.rule),
      ['version']
    )
    assert.match(result.warnings[0].message, /version is 6; the current schema version is \d+/)
    assert.match(result.warnings[0].message, /Open the project in the editor and save it/)
  })

  it('skips the schema checks on an older file, which migrations would rewrite', () => {
    // Before migration 005 node ids were bare names; reporting them as errors
    // would bury the one thing to do, which is migrate
    const old = {
      version: 4,
      nodes: [{ id: 'deck', type: 'MergeOpsOp', data: { inputs: { nope: 1 } } }],
      edges: [{ id: 'x', source: 'a', sourceHandle: 'out.x', target: 'deck', targetHandle: 'x' }],
    }
    const result = validateProject(old, registry, external)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(
      result.warnings.map(d => d.rule),
      ['version']
    )
    // Shape still matters
    assert.equal(validateProject({ version: 4 }, registry, external).valid, false)
  })

  it('still fails a file newer than the registry', () => {
    const result = validateProject(
      project(p => (p.version = CURRENT + 1)),
      registry,
      external
    )
    assert.deepEqual(
      result.errors.map(d => d.rule),
      ['version']
    )
  })

  it('runs every check on a current file, without the generic-node-name style rule', () => {
    const generic = project(p => p.nodes.push(fileNode('/file-1', 'https://example.com/a.csv')))
    assert.deepEqual(validateProject(generic, registry, external).warnings, [])
    assert.deepEqual(
      validateProject(generic, registry).warnings.map(d => d.rule),
      ['generic-node-name']
    )
    const broken = project(p => (p.nodes[0].type = 'File'))
    assert.deepEqual(
      validateProject(broken, registry, external).errors.map(d => d.rule),
      ['unknown-operator']
    )
  })

  it('leaves the examples profile as it was', () => {
    const stale = validateProject(
      project(p => (p.version = 6)),
      registry,
      { profile: 'examples' }
    )
    assert.equal(stale.valid, false)
    assert.match(stale.errors[0].message, /migrate-projects/)
  })
})

describe('checkAssets', () => {
  function problems(urls: string[], files: Record<string, string>): string[] {
    const p = project(q => {
      q.nodes = urls.map((url, i) => fileNode(`/data-${String.fromCharCode(97 + i)}`, url))
    })
    const { dir } = projectFolder(p, files)
    return checkAssets(p, dir).map(d => d.message)
  }

  it('reads @/x and @/data/x from the data/ folder, as the editor does', () => {
    const files = { 'data/flights.csv': '', 'data/routes/2026 Q1.json': '' }
    assert.deepEqual(
      problems(['@/flights.csv', '@/data/flights.csv', '@/routes/2026 Q1.json'], files),
      []
    )
  })

  it('ignores values that are not @/ references', () => {
    assert.deepEqual(problems(['https://example.com/a.csv', 'data/a.csv', 'x @/a.csv'], {}), [])
  })

  it('reports a missing file, and the folder that is missing', () => {
    const [missing] = problems(['@/flights.csv'], { 'data/routes.csv': '' })
    assert.match(
      missing,
      /^\/data-a url is @\/flights\.csv, but data\/flights\.csv doesn't exist\./
    )
    assert.match(missing, /add the file there or fix the name/)
    const [noData] = problems(['@/flights.csv'], {})
    assert.match(noData, /there is no data\/ folder/)
    const [noSub] = problems(['@/2026/flights.csv'], { 'data/flights.csv': '' })
    assert.match(noSub, /data\/2026 doesn't exist/)
  })

  it('matches names exactly, as git and Linux do, and names the near miss', () => {
    const [message] = problems(['@/flights.csv'], { 'data/Flights.csv': '' })
    assert.match(message, /The folder has data\/Flights\.csv; names must match in case\./)
  })

  it('points at a file next to noodles.json, where only the examples read from', () => {
    const [message] = problems(['@/rail.json'], { 'rail.json': '{}' })
    assert.match(message, /rail\.json is next to noodles\.json/)
    assert.match(message, /move it into data\/, or pass --examples/)
  })

  it('rejects a folder, an empty name, and a path out of data/', () => {
    const messages = problems(['@/routes', '@/', '@/../secrets.csv'], {
      'data/routes/a.csv': '',
      'secrets.csv': '',
    })
    assert.match(messages[0], /data\/routes is a folder/)
    assert.match(messages[1], /names no file/)
    assert.match(messages[2], /outside data\/ can't be read/)
  })
})

describe('validateFile', () => {
  it('picks the profile from where the file is', () => {
    const { file } = projectFolder(project(p => (p.version = 6)))
    const result = validateFile(file, registry)
    assert.equal(result.profile, 'external')
    assert.equal(result.partial, true)
    assert.equal(result.valid, true)
    assert.equal(validateFile(file, registry, { profile: 'examples' }).valid, false)
  })

  it('checks data files on stale and current files alike', () => {
    for (const version of [6, CURRENT]) {
      const { file } = projectFolder(
        project(p => (p.version = version)),
        {}
      )
      const result = validateFile(file, registry)
      assert.deepEqual(
        result.errors.map(d => d.rule),
        ['missing-asset'],
        `version ${version}`
      )
    }
  })
})

describe('validate-projects on external projects', () => {
  it('takes folders and files whose paths have spaces', () => {
    const { root } = projectFolder(project())
    const folder = cli(root, 'projects')
    assert.equal(folder.code, EXIT_OK, folder.stdout)
    assert.match(folder.stdout, /^OK: 1 file valid/)
    const file = cli(join(root, 'projects'), 'Harbor Tour Route/noodles.json')
    assert.equal(file.code, EXIT_OK, file.stdout)
  })

  it('exits 1 on a missing data file and 0 on a stale version alone', () => {
    const missing = projectFolder(project(), {})
    const failed = cli(missing.root, 'projects')
    assert.equal(failed.code, EXIT_INVALID)
    assert.match(failed.stdout, /^projects\/Harbor Tour Route\/noodles\.json$/m)
    assert.match(failed.stdout, /\[missing-asset\]/)

    const stale = projectFolder(project(p => (p.version = 6)))
    const warned = cli(stale.root, 'projects')
    assert.equal(warned.code, EXIT_OK)
    assert.match(warned.stdout, /warning version {2}version is 6/)
    assert.match(
      warned.stdout,
      /^1 file is behind schema version \d+, so only its JSON, version and data files were checked\./m
    )
  })

  it('fails on warnings with --strict', () => {
    const { root } = projectFolder(project(p => (p.version = 6)))
    const { code, stdout } = cli(root, '--strict', 'projects')
    assert.equal(code, EXIT_INVALID)
    assert.match(stdout, /^FAIL: 1 warning in 1 of 1 file, and --strict fails on warnings\.$/m)
    assert.equal(cli(projectFolder(project()).root, '--strict', 'projects').code, EXIT_OK)
  })

  it('takes --examples and --external to override the profile, but not both', () => {
    const { root } = projectFolder(project(p => (p.version = 6)))
    const examples = cli(root, '--examples', 'projects')
    assert.equal(examples.code, EXIT_INVALID)
    assert.match(examples.stdout, /error {3}version/)
    assert.equal(cli(root, '--external', 'projects').code, EXIT_OK)
    assert.equal(cli(root, '--external', '--examples', 'projects').code, EXIT_USAGE)
  })

  it('reports the profile and partial checks in --json', () => {
    const { root } = projectFolder(project(p => (p.version = 6)))
    const result = JSON.parse(cli(root, '--json', 'projects').stdout)
    assert.equal(result.files[0].profile, 'external')
    assert.equal(result.files[0].partial, true)
  })
})
