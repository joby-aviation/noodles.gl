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
import { REPO_ROOT, SESSION_MODELS, assertProviderEnv, providerFor } from './lib/config'
import { scoreAnswers } from './lib/matchers'
import { parseCodexTranscript, renderTranscript } from './lib/session'
import { loadRegistry, noodlesVersion } from './lib/registry'
import { loadRubric, resolveApplicability } from './lib/rubric'
import { MECHANICAL_FAILURE_CAP, type MechanicalResults, median, totalScore } from './lib/scoring'
import { validateProject } from './lib/validate-project'

let failures = 0
const pending: Promise<void>[] = []
function test(name: string, fn: () => void | Promise<void>): void {
  const fail = (e: unknown) => {
    failures++
    console.error(`FAIL ${name}: ${(e as Error).message}`)
  }
  try {
    const result = fn()
    if (result instanceof Promise) {
      pending.push(result.then(() => console.log(`ok   ${name}`)).catch(fail))
      return
    }
    console.log(`ok   ${name}`)
  } catch (e) {
    fail(e)
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

// ---- season-2 provider dispatch: codex (OpenAI) backend, no tokens spent ----

test('providerFor maps every pinned session model; unknown ids throw', () => {
  for (const m of SESSION_MODELS) providerFor(m) // must not throw
  assert.equal(providerFor('us.anthropic.claude-fable-5'), 'bedrock')
  assert.equal(providerFor('gpt-5.6-luna'), 'openai')
  assert.throws(() => providerFor('gemini-3-pro'))
})

test('assertProviderEnv demands OPENAI_API_KEY only for codex models', () => {
  const saved = process.env.OPENAI_API_KEY
  const savedExp = process.env.AWS_CREDENTIAL_EXPIRATION
  delete process.env.OPENAI_API_KEY
  delete process.env.AWS_CREDENTIAL_EXPIRATION
  try {
    assertProviderEnv('us.anthropic.claude-fable-5') // bedrock env is set in CI/dev
    assert.throws(() => assertProviderEnv('gpt-5.6-sol'), /OPENAI_API_KEY/)
    // expired temporary AWS creds fail fast with the refresh instruction
    process.env.AWS_CREDENTIAL_EXPIRATION = '2020-01-01T00:00:00Z'
    assert.throws(() => assertProviderEnv('us.anthropic.claude-fable-5'), /expired/)
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved
    if (savedExp !== undefined) process.env.AWS_CREDENTIAL_EXPIRATION = savedExp
    else delete process.env.AWS_CREDENTIAL_EXPIRATION
  }
})

const codexFixture = [
  JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'ls noodles-editor', aggregated_output: 'src\npackage.json', exit_code: 0 },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'Added the scatterplot layer.' },
  }),
  JSON.stringify({
    type: 'turn.completed',
    last_agent_message: 'Added the scatterplot layer.',
    usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 500, reasoning_output_tokens: 100 },
  }),
].join('\n')

test('codex transcript: turns, usage, cost from the pinned price table', () => {
  const parsed = parseCodexTranscript(codexFixture, 'gpt-5.6-luna')
  assert.equal(parsed.turns, 1)
  assert.equal(parsed.failed, false)
  assert.equal(parsed.lastAgentMessage, 'Added the scatterplot layer.')
  // luna: $1/M input (1000 + 200 cached), $6/M output (500 + 100 reasoning)
  assert.ok(Math.abs((parsed.costUsd ?? 0) - (1200 * 1 + 600 * 6) / 1_000_000) < 1e-9)
  // unpinned model -> tokens recorded, no cost invented
  assert.equal(parseCodexTranscript(codexFixture, 'gpt-7-unknown').costUsd, null)
})

test('codex transcript renders for the judge with stable labels', () => {
  const rendered = renderTranscript(codexFixture)
  assert.match(rendered, /L1: \[system] session started \(codex exec/)
  assert.match(rendered, /\[tool_use command] ls noodles-editor/)
  assert.match(rendered, /\[tool_result] src/)
  assert.match(rendered, /\[assistant] Added the scatterplot layer\./)
  // claude-format transcripts still render identically
  const claude = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })
  assert.match(renderTranscript(claude), /L1: \[assistant] hi/)
})

test('codex transcript: turn.failed marks the run failed', () => {
  const failed = `${JSON.stringify({ type: 'turn.failed', error: { message: 'context limit' } })}\n`
  assert.equal(parseCodexTranscript(failed, 'gpt-5.6-sol').failed, true)
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

test('sync-results round-trip on a fake series (offline object store)', async () => {
  const { pullSeries, pushSeries, verifySeries } = await import('./sync-results')
  const { FsObjectStore } = await import('./lib/object-store')
  const { readManifest } = await import('./lib/run-store')
  const { RESULTS_ROOT } = await import('./lib/config')
  const series = '.selftest-sync'
  const seriesDir = path.join(RESULTS_ROOT, series)
  const runDir = path.join(seriesDir, 'runs', 'fake-run--s1')
  const storeDir = path.join('/tmp/noodles-evals', 'selftest-sync-store')
  try {
    fs.rmSync(seriesDir, { recursive: true, force: true })
    fs.rmSync(storeDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true })
    fs.writeFileSync(path.join(runDir, 'transcript.jsonl'), '{"type":"result"}\n')
    fs.writeFileSync(path.join(runDir, 'screenshot.png'), 'not-a-real-png')
    fs.writeFileSync(path.join(runDir, 'artifacts', 'noodles.json'), '{"version":6}')
    const store = new FsObjectStore(storeDir)

    const first = await pushSeries(series, store)
    assert.equal(first.uploaded, 3)
    const manifest = readManifest(series)
    assert.equal(manifest?.objects.length, 3)
    assert.ok(manifest?.objects.every(o => o.key.startsWith(`${series}/runs/fake-run--s1/`)))
    // push is idempotent
    const second = await pushSeries(series, store)
    assert.equal(second.uploaded, 0)
    assert.equal(second.skipped, 3)
    // full verify clean
    const clean = await verifySeries(series, store, { all: true })
    assert.equal(clean.problems.length, 0, clean.problems.join('; '))
    // wipe local evidence; pull restores it byte-identically
    const original = fs.readFileSync(path.join(runDir, 'transcript.jsonl'))
    fs.rmSync(path.join(seriesDir, 'runs'), { recursive: true })
    const pulled = await pullSeries(series, store)
    assert.equal(pulled.downloaded, 3)
    assert.deepEqual(fs.readFileSync(path.join(runDir, 'transcript.jsonl')), original)
    // tamper with a remote object: verify flags it, pull refuses it
    await store.put(`${series}/runs/fake-run--s1/screenshot.png`, Buffer.from('tampered'))
    const tampered = await verifySeries(series, store, { all: true })
    assert.ok(
      tampered.problems.some(p => p.includes('mismatch')),
      tampered.problems.join('; ')
    )
    fs.rmSync(path.join(runDir, 'screenshot.png'))
    await assert.rejects(() => pullSeries(series, store), /sha256 mismatch/)
  } finally {
    fs.rmSync(seriesDir, { recursive: true, force: true })
    fs.rmSync(storeDir, { recursive: true, force: true })
  }
})

test('archive-season is a marker that requires full manifest coverage', async () => {
  const { archiveSeason } = await import('./archive-season')
  const { pushSeries } = await import('./sync-results')
  const { FsObjectStore } = await import('./lib/object-store')
  const { RESULTS_ROOT } = await import('./lib/config')
  const series = '.selftest-archive'
  const seriesDir = path.join(RESULTS_ROOT, series)
  const runDir = path.join(seriesDir, 'runs', 'fake-run--s1')
  const storeDir = path.join('/tmp/noodles-evals', 'selftest-archive-store')
  try {
    fs.rmSync(seriesDir, { recursive: true, force: true })
    fs.rmSync(storeDir, { recursive: true, force: true })
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'transcript.jsonl'), '{"type":"result"}\n')
    // no manifest yet: refuses to seal a season whose bytes exist only here
    assert.throws(() => archiveSeason(series, false), /no manifest\.json/)
    const store = new FsObjectStore(storeDir)
    await pushSeries(series, store)
    // local evidence the manifest doesn't cover also refuses
    fs.writeFileSync(path.join(runDir, 'scores.json'), '{}')
    assert.throws(() => archiveSeason(series, false), /missing from or stale/)
    await pushSeries(series, store)
    archiveSeason(series, false)
    assert.ok(fs.existsSync(path.join(seriesDir, 'ARCHIVED.md')), 'ARCHIVED.md written')
    // marker only: local evidence is untouched
    assert.ok(fs.existsSync(path.join(runDir, 'transcript.jsonl')))
    assert.throws(() => archiveSeason(series, false), /already archived/)
  } finally {
    fs.rmSync(seriesDir, { recursive: true, force: true })
    fs.rmSync(storeDir, { recursive: true, force: true })
  }
})

test('archive-season refuses the current season without --force', async () => {
  const { archiveSeason } = await import('./archive-season')
  const { CURRENT_SERIES } = await import('./lib/config')
  assert.throws(() => archiveSeason(CURRENT_SERIES, false), /CURRENT season/)
})

test('requireRunFiles names the pull command for remote-only evidence', async () => {
  const { requireRunFiles, writeManifest } = await import('./lib/run-store')
  const { RESULTS_ROOT } = await import('./lib/config')
  const series = '.selftest-runstore'
  const seriesDir = path.join(RESULTS_ROOT, series)
  try {
    fs.mkdirSync(seriesDir, { recursive: true })
    writeManifest({
      series,
      bucket: 'fs:test',
      generatedAt: '2026-07-10T00:00:00.000Z',
      objects: [{ key: `${series}/runs/gone--s1/transcript.jsonl`, sha256: 'x', bytes: 1 }],
    })
    // in the manifest but not on disk → actionable pull command
    assert.throws(() => requireRunFiles(series, 'gone--s1', ['transcript.jsonl']), /sync-results -- --pull/)
    // never recorded anywhere → says so instead of suggesting a futile pull
    assert.throws(() => requireRunFiles(series, 'never-ran--s1', ['transcript.jsonl']), /not in the series manifest/)
  } finally {
    fs.rmSync(seriesDir, { recursive: true, force: true })
  }
})

await Promise.all(pending)
if (failures > 0) {
  console.error(`\n${failures} self-test(s) failed`)
  process.exit(1)
}
console.log('\nall self-tests passed')
