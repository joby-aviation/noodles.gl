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

if (failures > 0) {
  console.error(`\n${failures} self-test(s) failed`)
  process.exit(1)
}
console.log('\nall self-tests passed')
