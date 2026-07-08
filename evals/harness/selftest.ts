// Harness self-tests that spend no model tokens. Covers Verification item 3
// (a deliberately broken artifact — invalid handles — scores ≤ 40% regardless
// of judge output), the no-bare-scales gate, matcher behavior, and the
// interim validator against every committed example project.
//
//   npm run selftest

import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'
import { REPO_ROOT } from './lib/config'
import { scoreAnswers } from './lib/matchers'
import { loadRegistry, noodlesVersion } from './lib/registry'
import { loadRubric, resolveApplicability } from './lib/rubric'
import { MECHANICAL_FAILURE_CAP, type MechanicalResults, median, totalScore } from './lib/scoring'
import { validateProject } from './lib/validate-project'

let failures = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.error(`FAIL ${name}: ${(e as Error).message}`)
  }
}

const registry = loadRegistry(REPO_ROOT)
const version = noodlesVersion(REPO_ROOT)

test('registry parses a plausible operator surface', () => {
  assert.ok(registry.types.size >= 100, `only ${registry.types.size} types`)
  assert.ok(registry.schemas.get('ScatterplotLayerOp')?.inputs.has('getRadius'))
  assert.ok(registry.schemas.get('DeckRendererOp')?.outputs.has('vis'))
})

test('every committed example project passes the interim validator', () => {
  const examplesDir = path.join(REPO_ROOT, 'noodles-editor', 'src', 'examples')
  for (const name of fs.readdirSync(examplesDir)) {
    const file = path.join(examplesDir, name, 'noodles.json')
    if (!fs.existsSync(file)) continue
    const result = validateProject(fs.readFileSync(file, 'utf-8'), registry, version)
    assert.ok(result.valid, `${name}: ${result.errors.slice(0, 3).join('; ')}`)
  }
})

test('deliberately broken artifact (invalid handles) fails validation', () => {
  const broken = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'noodles-editor', 'src', 'examples', 'california-earthquakes', 'noodles.json'), 'utf-8')
  )
  broken.edges[1].sourceHandle = 'out.dataz' // hallucinated field
  broken.edges[2].targetHandle = 'in.getPosition' // forbidden prefix
  const result = validateProject(JSON.stringify(broken), registry, version)
  assert.ok(!result.valid)
  assert.ok(result.errors.some(e => e.includes('dataz')), 'hallucinated field caught')
  assert.ok(result.errors.some(e => e.includes('par.')), 'bad prefix caught')
})

test('mechanical failure caps total at 40% regardless of judge output (Verification item 3)', () => {
  const mechanicalFail: MechanicalResults = {
    validatorVersion: 'interim-1',
    pass: false,
    checks: { validateProject: { pass: false, detail: 'invalid handles' } },
    score0to4: 3, // even with partial mechanical credit...
  }
  const perfectJudge = 4 // ...and a judge that loved the transcript
  const total = totalScore(mechanicalFail, perfectJudge)
  assert.ok(total <= MECHANICAL_FAILURE_CAP, `total ${total} > cap ${MECHANICAL_FAILURE_CAP}`)
})

test('rubrics load and reject bare scales', () => {
  loadRubric('authoring.yaml')
  loadRubric('contextualization.yaml')
  const bare = { rubricVersion: 99, family: 'x', dimensions: { vibes: { weight: 0.5 } } }
  const tmp = path.join(REPO_ROOT, 'evals', 'rubrics', '.selftest-bare.yaml')
  fs.writeFileSync(tmp, YAML.stringify(bare))
  try {
    assert.throws(() => loadRubric('.selftest-bare.yaml'), /bare scales are forbidden/)
  } finally {
    fs.rmSync(tmp)
  }
})

test('applicable_when is tag-matched, never free text', () => {
  const rubric = loadRubric('authoring.yaml')
  const withTag = resolveApplicability(rubric, ['authoring', 'data-source'])
  const without = resolveApplicability(rubric, ['authoring'])
  const dim = (r: typeof rubric) => r.dimensions.find(d => d.name === 'tool_use_discipline')!
  assert.equal(dim(withTag).criteria!.length, 3)
  assert.equal(dim(without).criteria!.length, 2) // purposeful-verification excluded
})

test('answer matchers behave', () => {
  const key = [
    { id: 'a', match: 'regex' as const, expected: '\\b20\\b', source: '' },
    { id: 'b', match: 'containsAll' as const, expected: ['pixels', 'meters'], source: '' },
    { id: 'c', match: 'judge' as const, expected: 'x', source: '' },
  ]
  const scored = scoreAnswers({ a: 'the default is 20', b: 'pixels or meters', c: 'whatever' }, key)
  assert.equal(scored.deterministicCorrect, 2)
  assert.equal(scored.deterministicTotal, 2)
  assert.equal(scored.outcomes.find(o => o.id === 'c')!.correct, null)
  const wrong = scoreAnswers({ a: 'the default is 2000', b: 'pixels only' }, key)
  assert.equal(wrong.deterministicCorrect, 0)
})

test('console-noise filter: external failures ignored, localhost failures count', async () => {
  const { isEnvironmentNoise } = await import('./lib/playwright-check')
  assert.ok(isEnvironmentNoise('Failed to load resource: net::ERR_TUNNEL_CONNECTION_FAILED'))
  assert.ok(
    isEnvironmentNoise(
      "NetworkError: Failed to load 'https://extensions.duckdb.org/x.wasm'.\n    at f.onMessage (http://localhost:5402/node_modules/duckdb.mjs:1:1)"
    )
  )
  assert.ok(
    isEnvironmentNoise(
      'AJAXError: Failed to fetch (0): https://basemaps.cartocdn.com/style.json\n    at http://localhost:5402/node_modules/maplibre.js:408:25'
    )
  )
  assert.ok(!isEnvironmentNoise('Failed to load resource: 404', 'http://localhost:5402/examples/x/data.csv'))
  assert.ok(!isEnvironmentNoise("TypeError: Cannot read properties of undefined (reading 'map')"))
  assert.ok(!isEnvironmentNoise("Failed to load 'http://localhost:5173/data.csv'"))
})

test('isolation audit: own workspace legal, harness paths flagged', async () => {
  const { isolationAudit } = await import('./lib/workspace')
  const ws = '/tmp/noodles-evals/workspaces/test--s1'
  const event = (input: string) =>
    JSON.stringify({ message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: input } }] } })
  const clean = [event(`ls ${ws}/noodles-editor/src`), event('cat AGENTS.md')].join('\n')
  assert.ok(isolationAudit(clean, ws).pass)
  const dirty = [event('cat /home/user/noodles.gl/evals/tasks/author-scatterplot.md')].join('\n')
  assert.ok(!isolationAudit(dirty, ws).pass)
  const specDirty = [event('grep -r foo dev-docs/specs/agent-ready-docs/')].join('\n')
  assert.ok(!isolationAudit(specDirty, ws).pass)
})

test('median', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 4]), 2.5)
})

// ---- step-5 task goldens: validity + custom-check polarity ----

const fixturesDir = path.join(REPO_ROOT, 'evals', 'tasks', 'fixtures')
const loadJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'))
const golden = (id: string) => loadJson(path.join(fixturesDir, 'golden', `${id}.noodles.json`))
const allPass = (r: Record<string, { pass: boolean; detail?: string }>) => {
  const failing = Object.entries(r).filter(([, v]) => !v.pass)
  assert.ok(failing.length === 0, failing.map(([k, v]) => `${k}: ${v.detail}`).join('; '))
}
const someFail = (r: Record<string, { pass: boolean }>) => {
  assert.ok(
    Object.values(r).some(v => !v.pass),
    'expected at least one failing check'
  )
}

test('every golden fixture passes the interim validator (incl. container bridges)', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  for (const id of Object.keys(CUSTOM_CHECKS)) {
    const result = validateProject(JSON.stringify(golden(id)), registry, version)
    assert.ok(result.valid, `${id} golden: ${result.errors.slice(0, 3).join('; ')}`)
  }
  // the seeded-broken fixture and camera-tour base must also validate (their
  // defects are semantic, not schema-level)
  for (const f of ['quake-map-broken.noodles.json', 'camera-tour.noodles.json']) {
    const result = validateProject(fs.readFileSync(path.join(fixturesDir, f), 'utf-8'), registry, version)
    assert.ok(result.valid, `${f}: ${result.errors.slice(0, 3).join('; ')}`)
  }
})

test('modify-arcs checks: golden passes, unmodified base fails', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  const base = loadJson(path.join(REPO_ROOT, 'noodles-editor', 'src', 'examples', 'uk-commute', 'noodles.json'))
  allPass(CUSTOM_CHECKS['modify-arcs']({ after: golden('modify-arcs'), before: base, resultText: null }))
  someFail(CUSTOM_CHECKS['modify-arcs']({ after: base, before: base, resultText: null }))
  // the trap: recoloring the shared ColorOps (dots turn red too) must fail
  const trapped = JSON.parse(JSON.stringify(base))
  for (const id of ['/source-color', '/target-color']) {
    trapped.nodes.find((n: { id: string }) => n.id === id).data.inputs.color = '#ff0000'
  }
  trapped.nodes.find((n: { id: string }) => n.id === '/arc-layer').data.inputs.getWidth = 160
  someFail(CUSTOM_CHECKS['modify-arcs']({ after: trapped, before: base, resultText: null }))
})

test('debug-blank-viz checks: fixed+diagnosed passes, broken fails', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  const diagnosis =
    'Two problems: the scatterplot layer was disconnected from the renderer, and the position accessor used lowercase d.longitude/d.latitude while the CSV columns are capitalized (Longitude/Latitude).'
  allPass(CUSTOM_CHECKS['debug-blank-viz']({ after: golden('debug-blank-viz'), before: null, resultText: diagnosis }))
  const broken = loadJson(path.join(fixturesDir, 'quake-map-broken.noodles.json'))
  someFail(CUSTOM_CHECKS['debug-blank-viz']({ after: broken, before: null, resultText: '' }))
})

test('sql-h3-pipeline checks: golden passes, unrelated project fails', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  allPass(CUSTOM_CHECKS['sql-h3-pipeline']({ after: golden('sql-h3-pipeline'), before: null, resultText: null }))
  someFail(CUSTOM_CHECKS['sql-h3-pipeline']({ after: golden('code-refs-containers'), before: null, resultText: null }))
})

test('animate-camera checks: golden passes, static base fails', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  allPass(CUSTOM_CHECKS['animate-camera']({ after: golden('animate-camera'), before: null, resultText: null }))
  const base = loadJson(path.join(fixturesDir, 'camera-tour.noodles.json'))
  someFail(CUSTOM_CHECKS['animate-camera']({ after: base, before: null, resultText: null }))
})

test('code-refs-containers v2 checks: golden passes, containerless AND v1-shaped projects fail', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  allPass(CUSTOM_CHECKS['code-refs-containers']({ after: golden('code-refs-containers'), before: null, resultText: null }))
  someFail(CUSTOM_CHECKS['code-refs-containers']({ after: golden('sql-h3-pipeline'), before: null, resultText: null }))
  // v1 shape (no promoted parameter on the container) must fail v2's checks
  const v1shaped = JSON.parse(JSON.stringify(golden('code-refs-containers')))
  const container = v1shaped.nodes.find((n: { id: string }) => n.id === '/processing')
  container.data.customInputs = undefined
  someFail(CUSTOM_CHECKS['code-refs-containers']({ after: v1shaped, before: null, resultText: null }))
})

test('hiking-time checks: golden passes, unrelated project fails', async () => {
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  allPass(CUSTOM_CHECKS['hiking-time']({ after: golden('hiking-time'), before: null, resultText: null }))
  someFail(CUSTOM_CHECKS['hiking-time']({ after: golden('sql-h3-pipeline'), before: null, resultText: null }))
})

test('author-hiking-time task file loads with checks wired', async () => {
  const { loadTask } = await import('./lib/task')
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  const task = loadTask('author-hiking-time')
  assert.equal(task.grader.mechanical.custom, 'hiking-time')
  assert.equal(task.taskVersion, 1)
  assert.ok(CUSTOM_CHECKS['hiking-time'])
  assert.ok(task.prompt.includes('REFERENCE.md'))
})

test('code-refs-containers task is at version 2', async () => {
  const { loadTask } = await import('./lib/task')
  const task = loadTask('code-refs-containers')
  assert.equal(task.taskVersion, 2)
  assert.ok(task.prompt.toLowerCase().includes('promote'))
})

test('all five new task files load with custom checks wired', async () => {
  const { loadTask } = await import('./lib/task')
  const { CUSTOM_CHECKS } = await import('./lib/task-checks')
  for (const id of ['modify-arcs', 'debug-blank-viz', 'sql-h3-pipeline', 'animate-camera', 'code-refs-containers']) {
    const task = loadTask(id)
    assert.equal(task.grader.mechanical.custom, id)
    assert.ok(CUSTOM_CHECKS[id], `no custom checks registered for ${id}`)
    assert.ok(task.prompt.length > 50)
  }
})

test('archive-season round-trip on a fake series (no model calls)', async () => {
  const { archiveSeason } = await import('./archive-season')
  const { RESULTS_ROOT } = await import('./lib/config')
  const series = '.selftest-archive'
  const seriesDir = path.join(RESULTS_ROOT, series)
  const runDir = path.join(seriesDir, 'runs', 'fake-run--s1')
  const outDir = path.join('/tmp/noodles-evals', 'selftest-archive-out')
  try {
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'transcript.jsonl'), '{"type":"result"}\n')
    fs.writeFileSync(path.join(runDir, 'transcript.txt'), 'L1: [result]\n')
    fs.writeFileSync(path.join(runDir, 'screenshot.png'), 'not-a-real-png')
    fs.writeFileSync(path.join(runDir, 'scores.json'), '{}')
    fs.writeFileSync(path.join(runDir, 'mechanical.json'), '{}')

    const tarball = archiveSeason(series, outDir, false)
    assert.ok(fs.existsSync(tarball))
    assert.ok(fs.existsSync(path.join(seriesDir, 'ARCHIVED.md')), 'ARCHIVED.md written')
    // heavy gone, curve stays
    assert.ok(!fs.existsSync(path.join(runDir, 'transcript.jsonl')))
    assert.ok(!fs.existsSync(path.join(runDir, 'screenshot.png')))
    assert.ok(fs.existsSync(path.join(runDir, 'scores.json')))
    assert.ok(fs.existsSync(path.join(runDir, 'mechanical.json')))
    // tarball round-trips the heavy files
    const { execFileSync } = await import('node:child_process')
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' }).trim().split('\n')
    assert.equal(listing.length, 3, `tarball lists ${listing.length} files`)
    // double-archive refused
    assert.throws(() => archiveSeason(series, outDir, false), /already archived/)
  } finally {
    fs.rmSync(seriesDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('archive-season refuses the current season without --force', async () => {
  const { archiveSeason } = await import('./archive-season')
  const { CURRENT_SERIES } = await import('./lib/config')
  assert.throws(() => archiveSeason(CURRENT_SERIES, '/tmp/noodles-evals/never', false), /CURRENT season/)
})

if (failures > 0) {
  console.error(`\n${failures} self-test(s) failed`)
  process.exit(1)
}
console.log('\nall self-tests passed')
