// Golden verification: proves the committed golden fixtures (and any
// human-corrected candidates) are CORRECT, not merely loadable. Three layers
// per project — static (validator + custom-check polarity), semantic
// (independent recomputation of the values the task grades on), visual
// (2K load in a greenfield workspace). Also re-verifies the contextualize
// answer key against the repo sources each answer cites.
//
// Human-in-the-loop: a maintainer can open a golden in the app, tweak it, and
// hand the edited file back — verify it with --candidate (prints a structural
// diff vs the committed golden first), then land it with --promote once green.
//
//   npm run verify-goldens                            # everything
//   npm run verify-goldens -- --task hiking-time      # one target
//   npm run verify-goldens -- --task hiking-time --candidate /path/to/edited.noodles.json
//   npm run verify-goldens -- --task hiking-time --candidate ... --promote
//   npm run verify-goldens -- --screens-only          # just the 2K captures
//   npm run verify-goldens -- --no-browser            # static + semantic only
//
// Screenshots land in $EVALS_WORK_ROOT/golden-screens (review aids — frozen
// run/calibration screenshots are never regenerated).

import * as fs from 'node:fs'
import * as path from 'node:path'
import { REPO_ROOT, TASKS_ROOT, WORK_ROOT } from './lib/config'
import { loadAndScreenshot } from './lib/playwright-check'
import { loadRegistry, noodlesVersion } from './lib/registry'
import { CUSTOM_CHECKS, type ProjectJson } from './lib/task-checks'
import { loadTask } from './lib/task'
import { validateProject } from './lib/validate-project'
import { createWorkspace } from './lib/workspace'

const FIXTURES = path.join(TASKS_ROOT, 'fixtures')
const GOLDEN_DIR = path.join(FIXTURES, 'golden')
const SCREENS_DIR = path.join(WORK_ROOT, 'golden-screens')
const PORT_BASE = 5710

interface Finding {
  target: string
  check: string
  level: 'finding' | 'info'
  detail: string
}

interface Target {
  /** golden id (golden/<id>.noodles.json + CUSTOM_CHECKS key) */
  id: string
  /** task file whose frontmatter defines fixtures/artifact/route */
  taskId: string
  /** render expectation: 'healthy' asserts non-blank + no real console errors;
   * 'informational' captures without asserting (documented env limits) */
  render: 'healthy' | 'informational'
  grabBodyText?: boolean
}

const TARGETS: Target[] = [
  { id: 'modify-arcs', taskId: 'modify-arcs', render: 'healthy' },
  { id: 'debug-blank-viz', taskId: 'debug-blank-viz', render: 'healthy' },
  // No load gate at run time (h3 community extension is egress-blocked; see
  // the task file) — capture the screenshot but don't fail on blankness.
  { id: 'sql-h3-pipeline', taskId: 'sql-h3-pipeline', render: 'informational' },
  { id: 'animate-camera', taskId: 'animate-camera', render: 'healthy' },
  { id: 'code-refs-containers', taskId: 'code-refs-containers', render: 'healthy' },
  { id: 'hiking-time', taskId: 'author-hiking-time', render: 'healthy', grabBodyText: true },
]

// Reference diagnosis used ONLY to exercise the resultText checks' pass side
// (the golden has no session transcript). Matches selftest.ts.
const REFERENCE_DIAGNOSIS =
  'Two problems: the scatterplot layer was disconnected from the renderer, and the position accessor used ' +
  'lowercase d.longitude/d.latitude while the CSV columns are capitalized (Longitude/Latitude).'

// ---------- entry ----------

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const onlyTask = opt('task')
const candidatePath = opt('candidate')
const promote = flag('promote')
const screensOnly = flag('screens-only')
const noBrowser = flag('no-browser')

if (candidatePath && !onlyTask) {
  console.error('--candidate requires --task <id> so the diff/checks know which golden it replaces')
  process.exit(2)
}
if (promote && !candidatePath) {
  console.error('--promote requires --candidate')
  process.exit(2)
}

const selected = TARGETS.filter(t => !onlyTask || t.id === onlyTask || t.taskId === onlyTask)
if (onlyTask && selected.length === 0 && onlyTask !== 'answer-key') {
  console.error(`Unknown target "${onlyTask}". Known: ${TARGETS.map(t => t.id).join(', ')}, answer-key`)
  process.exit(2)
}

const findings: Finding[] = []
const report = (target: string, check: string, pass: boolean, detail: string, info = false) => {
  const level = pass ? undefined : info ? ('info' as const) : ('finding' as const)
  const mark = pass ? 'PASS' : info ? 'INFO' : 'FAIL'
  console.log(`  [${mark}] ${check}: ${detail}`)
  if (level) findings.push({ target, check, level, detail })
}

const loadJson = (file: string): ProjectJson => JSON.parse(fs.readFileSync(file, 'utf-8'))
const goldenPath = (id: string) => path.join(GOLDEN_DIR, `${id}.noodles.json`)

async function main(): Promise<void> {
  const registry = loadRegistry(REPO_ROOT)
  const version = noodlesVersion(REPO_ROOT)

  // Repo-vs-origin/main sanity: sessions run against origin/main; the semantic
  // layer verifies against this checkout. Flag divergence in the app tree.
  try {
    const { execFileSync } = await import('node:child_process')
    const diff = execFileSync('git', ['diff', '--stat', 'origin/main', '--', 'noodles-editor/src', 'AGENTS.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    }).trim()
    if (diff) {
      console.log('note: checkout diverges from origin/main in the app tree; verification uses the checkout:')
      console.log(diff.split('\n').slice(-3).join('\n'))
    }
  } catch {
    /* offline git is fine */
  }

  for (const target of selected) {
    const committed = goldenPath(target.id)
    const projectFile = candidatePath ?? committed
    console.log(`\n=== ${target.id}${candidatePath ? ` (candidate: ${candidatePath})` : ''} ===`)
    const project = loadJson(projectFile)

    if (candidatePath) printStructuralDiff(loadJson(committed), project)

    if (!screensOnly) {
      runStaticChecks(target, project, registry, version)
      runSemanticChecks(target, project)
    }
  }

  if (!screensOnly && (!onlyTask || onlyTask === 'answer-key' || onlyTask === 'contextualize-operator')) {
    console.log('\n=== answer-key (contextualize-operator) ===')
    verifyAnswerKey()
  }

  if (!noBrowser && selected.length > 0) {
    await runVisualChecks(selected)
  }

  // ---------- summary ----------
  const real = findings.filter(f => f.level === 'finding')
  const info = findings.filter(f => f.level === 'info')
  console.log(`\n${'='.repeat(60)}`)
  if (real.length === 0) {
    console.log(`ALL PASS${info.length ? ` (${info.length} informational note(s))` : ''}`)
  } else {
    console.log(`${real.length} FINDING(S):`)
    for (const f of real) console.log(`  ${f.target} / ${f.check}: ${f.detail}`)
  }
  for (const f of info) console.log(`  info: ${f.target} / ${f.check}: ${f.detail}`)

  if (promote) {
    if (real.length > 0) {
      console.log('\nNOT promoting: candidate has findings.')
      process.exit(1)
    }
    const target = selected[0]
    fs.copyFileSync(candidatePath as string, goldenPath(target.id))
    console.log(`\nPromoted ${candidatePath} -> ${goldenPath(target.id)}. Re-run without --candidate to confirm green.`)
  }

  process.exit(real.length > 0 ? 1 : 0)
}

// ---------- static layer ----------

function runStaticChecks(
  target: Target,
  project: ProjectJson,
  registry: ReturnType<typeof loadRegistry>,
  version: number
): void {
  const result = validateProject(JSON.stringify(project), registry, version)
  report(
    target.id,
    'validator',
    result.valid,
    result.valid
      ? `valid (${result.warnings.length} warning(s))`
      : result.errors.slice(0, 3).join('; ')
  )

  const checks = CUSTOM_CHECKS[target.id]?.({
    after: project,
    before: target.id === 'modify-arcs' ? loadJson(path.join(REPO_ROOT, loadTask(target.taskId).workspace?.project as string)) : null,
    resultText: target.id === 'debug-blank-viz' ? REFERENCE_DIAGNOSIS : null,
  })
  for (const [name, check] of Object.entries(checks ?? {})) {
    report(target.id, `check:${name}`, check.pass, check.detail ?? '')
  }
}

// ---------- semantic layer ----------

function runSemanticChecks(target: Target, project: ProjectJson): void {
  switch (target.id) {
    case 'hiking-time':
      return verifyHikingSemantics(project)
    case 'debug-blank-viz':
      return verifyDebugSemantics(project)
    case 'sql-h3-pipeline':
      return verifySqlH3Semantics(project)
    case 'animate-camera':
      return verifyAnimateSemantics(project)
    case 'code-refs-containers':
      return verifyCodeRefsSemantics(project)
    case 'modify-arcs':
      return verifyModifyArcsSemantics(project)
  }
}

const codeOf = (node: { data?: { inputs?: Record<string, unknown> } } | undefined): string => {
  const code = node?.data?.inputs?.code
  return Array.isArray(code) ? code.join('\n') : String(code ?? '')
}
const fmt = (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : JSON.stringify(v))
/** Set by the hiking semantic layer, cross-checked against the rendered DOM. */
let expectedHikingTotal: number | null = null

// Haversine with turf's earth radius — the independent oracle for
// turf.distance(units: kilometers). Agreement is exact, not approximate.
function haversineKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371.0088
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Run a CodeOp's source with harness-supplied context. The stub op() reads
 * values from the PROJECT (so human-tweaked constants flow through), with
 * optional overrides for reference-example injection. */
function runCodeOp(
  code: string,
  ctx: { d: unknown; data: unknown[]; project: ProjectJson; opOverrides?: (path: string) => number | undefined }
): unknown {
  const op = (ref: string) => {
    const override = ctx.opOverrides?.(ref)
    const node = ctx.project.nodes?.find(n => n.id === ref)
    const inputs = node?.data?.inputs ?? {}
    const outs: Record<string, unknown> = { ...inputs }
    if (override !== undefined) for (const k of Object.keys({ val: 1, ...outs })) outs[k] = override
    return { out: outs, par: outs }
  }
  const fn = new Function('d', 'data', 'op', 'turf', code)
  return fn(ctx.d, ctx.data, op, {
    distance: (a: unknown, b: unknown) => {
      const coords = (v: unknown): { lng: number; lat: number } => {
        const g = (v as { geometry?: { coordinates?: number[] } })?.geometry?.coordinates
        if (g) return { lng: g[0], lat: g[1] }
        const arr = v as number[]
        return { lng: arr[0], lat: arr[1] }
      }
      return haversineKm(coords(a), coords(b))
    },
  })
}

function verifyHikingSemantics(project: ProjectJson): void {
  const t = 'hiking-time'
  const codeOps = (project.nodes ?? []).filter(n => n.type === 'CodeOp')

  // -- locate the pipeline pieces generically (survives renamed candidates) --
  const distanceOp = codeOps.find(n => /turf\.distance/.test(codeOf(n)))
  const terrainOp = codeOps.find(n => /1\.[0-8]/.test(codeOf(n)) && n !== distanceOp)
  const formulaOp = codeOps.find(n => /totalTime|total_time/.test(codeOf(n)))
  if (!distanceOp || !terrainOp || !formulaOp) {
    report(t, 'pipeline-pieces', false, `distance=${distanceOp?.id}, terrain=${terrainOp?.id}, formula=${formulaOp?.id}`)
    return
  }

  // -- distance: recompute from the PointOps feeding the distance CodeOp --
  const pointSources = (project.edges ?? [])
    .filter(e => e.target === distanceOp.id)
    .map(e => project.nodes?.find(n => n.id === e.source))
    .filter(n => n?.type === 'PointOp')
  const coord = (n: (typeof pointSources)[number]) => n?.data?.inputs?.coordinates as { lng: number; lat: number }
  if (pointSources.length < 2) {
    report(t, 'distance-inputs', false, `${pointSources.length} PointOp(s) feed ${distanceOp.id}, need 2`)
    return
  }
  const [a, b] = [coord(pointSources[0]), coord(pointSources[1])]
  const expectedKm = haversineKm(a, b)
  const feature = (c: { lng: number; lat: number }) => ({ geometry: { coordinates: [c.lng, c.lat] } })
  const computedKm = runCodeOp(codeOf(distanceOp), {
    d: feature(a),
    data: [feature(a), feature(b)],
    project,
  }) as number
  report(
    t,
    'distance-recomputed',
    Math.abs(computedKm - expectedKm) < 0.01,
    `golden code: ${computedKm?.toFixed?.(3)} km, independent haversine: ${expectedKm.toFixed(3)} km ` +
      `(${JSON.stringify(a)} -> ${JSON.stringify(b)})`
  )

  // -- terrain heuristic vs the reference table --
  const terrainProbe = (km: number) => runCodeOp(codeOf(terrainOp), { d: km, data: [km], project })
  const expectedTerrain: Array<[number, number]> = [
    [0.3, 1.8],
    [2, 1.5],
    [4.9, 1.5],
    [5, 1.3],
    [10, 1.3],
    [15, 1.3],
    [16, 1.1],
    [expectedKm, expectedKm > 15 ? 1.1 : expectedKm >= 5 ? 1.3 : 1.5],
  ]
  const terrainResults = expectedTerrain.map(([km, want]) => ({ km, want, got: terrainProbe(km) }))
  const terrainBad = terrainResults.filter(r => r.got !== r.want)
  report(
    t,
    'terrain-heuristic-vs-reference',
    terrainBad.length === 0,
    terrainBad.length === 0
      ? `all ${terrainResults.length} probes match the reference table (incl. golden distance ${expectedKm.toFixed(1)}km -> ${terrainProbe(expectedKm)})`
      : terrainBad.map(r => `f(${r.km})=${r.got} want ${r.want}`).join(', ')
  )

  // -- full formula: golden code vs an independent implementation --
  const constants = {
    baseSpeed: findConstant(project, /speed/) ?? 5,
    elevGain: findConstant(project, /gain/) ?? 0,
    elevDescent: findConstant(project, /descent|down/) ?? 0,
  }
  const terrainFactor = terrainProbe(expectedKm) as number
  const independent = naismith(expectedKm, terrainFactor, constants.baseSpeed, constants.elevGain, constants.elevDescent)
  const goldenResult = runCodeOp(codeOf(formulaOp), {
    d: expectedKm,
    data: [expectedKm, terrainFactor],
    project,
  }) as { totalTime?: number } | number
  const goldenTotal = typeof goldenResult === 'number' ? goldenResult : goldenResult?.totalTime
  report(
    t,
    'formula-vs-independent',
    typeof goldenTotal === 'number' && Math.abs(goldenTotal - independent.total) < 0.01,
    `golden formula: ${fmt(goldenTotal)} min, independent Naismith+Langmuir: ${independent.total.toFixed(2)} min ` +
      `(dist ${expectedKm.toFixed(2)}km x ${terrainFactor}, speed ${constants.baseSpeed}, +${constants.elevGain}m/-${constants.elevDescent}m; ` +
      `horizontal ${independent.horizontal.toFixed(1)} + ascent ${independent.ascent.toFixed(1)} + descent ${independent.descent.toFixed(1)})`
  )
  // Stash for the visual layer's DOM cross-check.
  expectedHikingTotal = typeof goldenTotal === 'number' ? goldenTotal : null

  // -- the reference document's own worked examples through the golden code --
  const examples = [
    { name: 'ex1 moderate day hike', dist: 12, terrain: 1.2, speed: 5, gain: 600, descent: 400, want: 232.8 },
    { name: 'ex2 short steep scramble', dist: 2, terrain: 1.5, speed: 5, gain: 450, descent: 100, want: 81 },
    { name: 'ex3 long ridge walk', dist: 18, terrain: 1.2, speed: 5, gain: 300, descent: 800, want: 289.2 },
  ]
  for (const ex of examples) {
    const overrides = (ref: string): number | undefined => {
      if (/speed/.test(ref)) return ex.speed
      if (/gain/.test(ref)) return ex.gain
      if (/descent|down/.test(ref)) return ex.descent
      return undefined
    }
    const result = runCodeOp(codeOf(formulaOp), {
      d: ex.dist,
      data: [ex.dist, ex.terrain],
      project,
      opOverrides: overrides,
    }) as { totalTime?: number } | number
    const total = typeof result === 'number' ? result : result?.totalTime
    // Independent cross-check that the reference's own arithmetic holds.
    const indep = naismith(ex.dist, ex.terrain, ex.speed, ex.gain, ex.descent)
    const codeOk = typeof total === 'number' && Math.abs(total - ex.want) < 0.1
    const refOk = Math.abs(indep.total - ex.want) < 0.1
    report(
      t,
      `reference-${ex.name.split(' ')[0]}`,
      codeOk && refOk,
      `golden code: ${fmt(total)} min, reference says ${ex.want} min, independent: ${indep.total.toFixed(1)} min`
    )
  }

  function findConstant(p: ProjectJson, pattern: RegExp): number | undefined {
    const node = (p.nodes ?? []).find(n => n.type === 'NumberOp' && pattern.test(n.id ?? ''))
    return node ? (node.data?.inputs?.val as number) : undefined
  }
}

function naismith(distKm: number, terrain: number, speedKmh: number, gainM: number, descentM: number) {
  const horizontal = ((distKm * terrain) / speedKmh) * 60
  const ascent = gainM / 10
  const slopeDeg = Math.atan2(descentM, distKm * 1000) * (180 / Math.PI)
  let descent = 0
  if (slopeDeg >= 5 && slopeDeg <= 12) descent = -(descentM / 300) * 10
  else if (slopeDeg > 12) descent = (descentM / 300) * 10
  return { horizontal, ascent, descent, total: horizontal + ascent + descent }
}

function verifyDebugSemantics(golden: ProjectJson): void {
  const t = 'debug-blank-viz'
  const broken = loadJson(path.join(FIXTURES, 'quake-map-broken.noodles.json'))

  // The fixture must still carry BOTH seeded defects (an accidentally-fixed
  // fixture would make the task trivial).
  const brokenHasEdge = (broken.edges ?? []).some(e => e.source === '/scatterplot-layer' && e.target === '/deck')
  const brokenExpr = String(broken.nodes?.find(n => n.id === '/position-accessor')?.data?.inputs?.expression ?? '')
  report(t, 'fixture-defect-disconnected', !brokenHasEdge, brokenHasEdge ? 'fixture already wires layer->deck' : 'layer disconnected as seeded')
  report(
    t,
    'fixture-defect-lowercase',
    /d\.longitude/.test(brokenExpr) && !/d\.Longitude/.test(brokenExpr),
    `fixture accessor: ${JSON.stringify(brokenExpr)}`
  )
  const inverse = CUSTOM_CHECKS[t]({ after: broken, before: null, resultText: '' })
  const failing = Object.values(inverse).filter(c => !c.pass).length
  report(t, 'fixture-fails-checks', failing >= 2, `${failing} check(s) fail on the broken fixture (need >= 2)`)

  // Golden repairs ONLY the seeded defects — any other drift is a finding.
  const drift = structuralDiff(broken, golden).filter(
    line =>
      !/position-accessor/.test(line) && // repaired expression
      !/scatterplot-layer\.out\.layer->\/deck/.test(line) // restored edge
  )
  report(t, 'golden-repairs-only-defects', drift.length === 0, drift.length === 0 ? 'no drift beyond the two repairs' : drift.join('; '))
}

function verifySqlH3Semantics(project: ProjectJson): void {
  const t = 'sql-h3-pipeline'
  const duckdb = (project.nodes ?? []).find(n => n.type === 'DuckDbOp')
  const query = String(duckdb?.data?.inputs?.query ?? '')

  report(t, 'query-reads-fixture-csv', /data\.csv/.test(query), `query source: ${query.match(/from\s+[^\n]+/i)?.[0] ?? 'none'}`)

  const res = query.match(/h3_latlng_to_cell(?:_string)?\s*\(\s*[^,]+,\s*[^,]+,\s*(\d+)\s*\)/i)
  const resolution = res ? Number(res[1]) : null
  report(
    t,
    'h3-resolution-sane',
    resolution !== null && resolution >= 4 && resolution <= 10,
    resolution === null ? 'no h3_latlng_to_cell(lat, lng, N) literal found' : `resolution ${resolution} (sane range 4-10 for a state-sized extent)`
  )

  // Accessors must reference columns the query actually produces. The
  // accessor may be a literal on the layer or an upstream AccessorOp edge.
  const hexLayer = (project.nodes ?? []).find(n => n.type === 'H3HexagonLayerOp')
  const aliases = [...query.matchAll(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map(m => m[1].toLowerCase())
  const effectiveAccessor = (input: string): string => {
    const literal = String(hexLayer?.data?.inputs?.[input] ?? '')
    if (literal) return literal
    const edge = (project.edges ?? []).find(e => e.target === hexLayer?.id && e.targetHandle === `par.${input}`)
    const source = project.nodes?.find(n => n.id === edge?.source)
    return String(source?.data?.inputs?.expression ?? codeOf(source))
  }
  for (const [input, label] of [
    ['getHexagon', 'hexagon-accessor-column'],
    ['getFillColor', 'color-accessor-column'],
  ] as const) {
    const accessor = effectiveAccessor(input)
    const cols = [...accessor.matchAll(/d\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1].toLowerCase())
    const missing = cols.filter(c => !aliases.includes(c) && !query.toLowerCase().includes(c))
    report(
      t,
      label,
      cols.length > 0 && missing.length === 0,
      `${input}=${JSON.stringify(accessor)} uses [${cols.join(', ')}]; query aliases [${aliases.join(', ')}]` +
        (missing.length ? `; MISSING: ${missing.join(', ')}` : '')
    )
  }
}

function verifyAnimateSemantics(project: ProjectJson): void {
  const t = 'animate-camera'
  // The base fixture must be static — the animate checks must FAIL on it.
  const base = loadJson(path.join(FIXTURES, 'camera-tour.noodles.json'))
  const baseChecks = CUSTOM_CHECKS[t]({ after: base, before: null, resultText: null })
  const baseFails = Object.values(baseChecks).some(c => !c.pass)
  report(t, 'base-fixture-static', baseFails, baseFails ? 'animate checks fail on the base fixture as intended' : 'base fixture already passes — task is trivial')

  // Golden must only add animation on top of the base (same graph otherwise).
  const drift = structuralDiff(base, project).filter(line => !/timeline/.test(line))
  report(t, 'golden-only-adds-animation', drift.length === 0, drift.length === 0 ? 'graph identical to base; only timeline differs' : drift.join('; '))
}

function verifyCodeRefsSemantics(project: ProjectJson): void {
  const t = 'code-refs-containers'
  const container = (project.nodes ?? []).find(n => n.type === 'ContainerOp')
  const defs = ((container?.data as { customInputs?: Array<{ name?: string; type?: string; defaultValue?: unknown }> })?.customInputs ?? [])
  const numeric = defs.find(d => d.type === 'number')
  const dv = numeric?.defaultValue
  report(
    t,
    'promoted-default-sane',
    typeof dv === 'number' && dv > 0,
    `promoted param ${numeric?.name}: defaultValue = ${JSON.stringify(dv)} (must be a positive number)`
  )

  const fileOp = (project.nodes ?? []).find(n => n.type === 'FileOp')
  const url = String(fileOp?.data?.inputs?.url ?? '')
  report(t, 'file-op-reads-fixture', /@\/data\.csv|data\.csv/.test(url), `FileOp url = ${JSON.stringify(url)}`)
}

function verifyModifyArcsSemantics(golden: ProjectJson): void {
  const t = 'modify-arcs'
  const base = loadJson(path.join(REPO_ROOT, loadTask(t).workspace?.project as string))

  // The doubling target in the checks (160) must really be 2x the BASE width —
  // read the base instead of trusting the constant.
  const width = (p: ProjectJson) => p.nodes?.find(n => n.id === '/arc-layer')?.data?.inputs?.getWidth
  report(t, 'width-doubles-base', width(golden) === (width(base) as number) * 2, `base ${width(base)} -> golden ${width(golden)}`)

  // The trap colors hardcoded in the checks must match the actual base project.
  for (const [id, expected] of [
    ['/residence-layer', '#f69a00'],
    ['/workplace-layer', '#950c69'],
  ] as const) {
    const edge = (base.edges ?? []).find(e => e.target === id && e.targetHandle === 'par.getFillColor')
    const colorNode = base.nodes?.find(n => n.id === edge?.source)
    const actual = String(colorNode?.data?.inputs?.color ?? base.nodes?.find(n => n.id === id)?.data?.inputs?.getFillColor ?? '')
    report(t, `trap-color${id.replace(/\//g, '-')}`, actual.toLowerCase() === expected, `base ${id} fill = ${actual} (checks expect ${expected})`)
  }
}

// ---------- answer key ----------

function verifyAnswerKey(): void {
  const t = 'answer-key'
  const operators = fs.readFileSync(path.join(REPO_ROOT, 'noodles-editor/src/noodles/operators.ts'), 'utf-8')
  const agents = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf-8')
  const migrationsDir = path.join(REPO_ROOT, 'noodles-editor/src/noodles/__migrations__')
  const migration = (n: string) => {
    const f = fs.readdirSync(migrationsDir).find(f => f.startsWith(n))
    return f ? fs.readFileSync(path.join(migrationsDir, f), 'utf-8') : ''
  }
  const classBody = (name: string): string => {
    const start = operators.indexOf(`export class ${name} `)
    if (start < 0) return ''
    const next = operators.indexOf('\nexport class ', start + 1)
    return operators.slice(start, next < 0 ? undefined : next)
  }

  const scatter = classBody('ScatterplotLayerOp')
  const trips = classBody('TripsLayerOp')
  const file = classBody('FileOp')
  const math = classBody('MathOp')
  const basemap = classBody('MaplibreBasemapOp')
  const accessor = classBody('AccessorOp')
  const deckRenderer = classBody('DeckRendererOp')

  const q = (id: string, pass: boolean, detail: string) => report(t, id, pass, detail)

  // q01: TripsLayerOp inputs + defaults named in the judge rubric
  const tripsFields: Array<[string, RegExp]> = [
    ['data', /\bdata:/],
    ['visible', /visible:.*(true|BooleanField\(true)/],
    ['opacity', /opacity:.*1/],
    ['getPath', /getPath:/],
    ['getTimestamps', /getTimestamps:/],
    ['getColor #bfcae3', /getColor:.*#bfcae3/i],
    ['getWidth 8', /getWidth:.*\b8\b/],
    ['billboard false', /billboard:.*false/],
    ['capRounded true', /capRounded:.*true/],
    ['jointRounded true', /jointRounded:.*true/],
    ['currentTime 0', /currentTime:.*\b0\b/],
    ['fadeTrail false', /fadeTrail:.*false/],
    ['trailLength 120', /trailLength:.*120/],
    ["widthUnits 'meters'", /widthUnits:.*'meters'/],
    ['widthMinPixels 2', /widthMinPixels:.*\b2\b/],
    ['widthScale 20', /widthScale:.*\b20\b/],
    ['parameters', /parameters:/],
    ['extensions', /extensions:/],
  ]
  const missingTrips = tripsFields.filter(([, re]) => !re.test(trips)).map(([n]) => n)
  q('q01-trips-inputs', missingTrips.length === 0, missingTrips.length ? `not found in TripsLayerOp: ${missingTrips.join(', ')}` : 'all 18 expected fields+defaults present')

  q('q02-scatter-radius-20', /getRadius:\s*new NumberField\(20\b/.test(scatter), extract(scatter, /getRadius:[^\n]*/))
  q('q03-radius-units-default-pixels', /radiusUnits:[^\n]*'pixels'/.test(scatter), extract(scatter, /radiusUnits:[^\n]*/))
  q('q04-radius-units-values', /radiusUnits:[^\n]*pixels[^\n]*meters|radiusUnits:[^\n]*meters[^\n]*pixels/.test(scatter) || unitValuesNear(scatter, 'radiusUnits', ['pixels', 'meters']), extract(scatter, /radiusUnits:[\s\S]{0,160}/))
  q('q05-scatter-output-layer', /createOutputs\(\)[\s\S]{0,200}layer:/.test(scatter), extract(scatter, /createOutputs\(\)[\s\S]{0,120}/))
  q('q06-file-formats', ['json', 'csv', 'tsv', 'text', 'binary'].every(v => new RegExp(`'${v}'`).test(file)), extract(file, /format:[\s\S]{0,200}/))
  q('q07-file-default-json', /format:[^\n]*'json'/.test(file), extract(file, /format:[^\n]*/))
  q('q08-accessor-io', /expression/.test(accessor) && /accessor/.test(accessor), 'AccessorOp mentions expression + accessor')
  q('q09-basemap-output-maplibre', /createOutputs\(\)[\s\S]{0,300}maplibre/.test(basemap), extract(basemap, /createOutputs\(\)[\s\S]{0,160}/))
  q('q10-renderer-output-vis', /createOutputs\(\)[\s\S]{0,300}\bvis\b/.test(deckRenderer), extract(deckRenderer, /createOutputs\(\)[\s\S]{0,160}/))
  q('q11-trips-trail-120', /trailLength:\s*new NumberField\(120\b/.test(trips), extract(trips, /trailLength:[^\n]*/))
  // The whole operator-values array (multi-line; a fixed-width window cuts
  // before 'sqrt').
  const mathValues = math.match(/operator:\s*new StringLiteralField\('add',\s*\{\s*values:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
  q(
    'q12-math-sqrt-yes-atan-no',
    /'sqrt'/.test(mathValues) && !/'atan'/.test(mathValues) && /'tan'/.test(mathValues),
    `values: ${mathValues.replace(/\s+/g, ' ').trim().slice(0, 160)}`
  )
  q('q13-trips-width-units', unitValuesNear(trips, 'widthUnits', ['pixels', 'meters', 'common']), extract(trips, /widthUnits:[\s\S]{0,160}/))
  q('q14-basemap-projections', unitValuesNear(basemap, 'projection', ['mercator', 'globe']), extract(basemap, /projection:[\s\S]{0,160}/))
  q('q15-accessor-context', /`d` - Current data item/.test(agents) && /`data` - Full dataset/.test(agents), 'AGENTS.md AccessorOp Context section')
  const m014 = migration('014')
  q('q16-map-style-removed', /MapStyleOp/.test(m014) && /MaplibreBasemapOp|mapStyle/.test(m014), m014 ? 'migration 014 removes MapStyleOp, inlines onto basemap' : 'migration 014 missing')
  const m006 = migration('006')
  q('q17-sheet-rename', /sheetsById|Nodes.*Noodles/s.test(m006) && !/nodeType|node\.type\s*=/.test(m006), m006 ? 'migration 006 renames the timeline sheet id only' : 'migration 006 missing')
  const m008 = migration('008')
  q('q18-date-to-datetime', /DateOp/.test(m008) && /DateTimeOp/.test(m008), m008 ? 'migration 008 renames DateOp -> DateTimeOp' : 'migration 008 missing')
  q('q19-time-markers', /markers/.test(migration('013')), 'migration 013 adds markers')
  // q20-q22, q29: edge shape facts, verified against a committed example
  const example = loadJson(path.join(REPO_ROOT, 'noodles-editor/src/examples/uk-commute/noodles.json'))
  const edges = example.edges ?? []
  const wellFormed = edges.every(
    e => e.id === `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}` && e.sourceHandle?.startsWith('out.') && e.targetHandle?.startsWith('par.')
  )
  q('q20-22-edge-shape', edges.length > 0 && wellFormed, `${edges.length} edges in uk-commute all match {source}.{out.*}->{target}.{par.*}`)
  const multi = new Set<string>()
  let singleInput = true
  for (const e of edges) {
    const key = `${e.target}|${e.targetHandle}`
    // ListField fan-ins (par.values, par.data, par.layers) legally take many;
    // q29's "single input" rule is about scalar inputs.
    if (multi.has(key) && !/par\.(values|data|layers)/.test(e.targetHandle ?? '')) singleInput = false
    multi.add(key)
  }
  q('q29-single-input', singleInput, 'no scalar input receives two edges in the committed example')
  q('q23-version-14', noodlesVersion(REPO_ROOT) === 14 && example.version === 14, `migrations max = ${noodlesVersion(REPO_ROOT)}, uk-commute version = ${example.version}`)
  q('q24-at-prefix', /`@\/` - Relative to project data directory/.test(agents), 'AGENTS.md path-prefix section')
  q('q25-28-path-system', ["op('/data-loader')", "op('./sibling')", "op('/analysis/filter')"].every(s => agents.includes(s)), 'AGENTS.md operator path examples present')
  q('q26-reactive-ref', agents.includes("op('/data-loader').out.data"), 'AGENTS.md reactive reference example')

  function extract(src: string, re: RegExp): string {
    return (src.match(re)?.[0] ?? 'NOT FOUND').replace(/\s+/g, ' ').slice(0, 160)
  }
  function unitValuesNear(src: string, field: string, values: string[]): boolean {
    const seg = src.match(new RegExp(`${field}:[\\s\\S]{0,220}`))?.[0] ?? ''
    return values.every(v => seg.includes(`'${v}'`))
  }
}

// ---------- visual layer ----------

async function runVisualChecks(targets: Target[]): Promise<void> {
  console.log('\n=== visual (2K captures in a greenfield workspace) ===')
  fs.mkdirSync(SCREENS_DIR, { recursive: true })
  const ws = createWorkspace({ runId: 'verify-goldens', fixtures: [], fixturesRoot: FIXTURES })
  const examples = path.join(ws, 'noodles-editor', 'src', 'examples')

  interface Visual {
    name: string
    route: string
    render: 'healthy' | 'informational' | 'expected-unhealthy'
    grabBodyText?: boolean
    openTimeline?: boolean
  }
  const visuals: Visual[] = []

  // Install each target's fixtures + golden (or candidate) at the task's paths.
  for (const target of targets) {
    const task = loadTask(target.taskId)
    for (const fixture of task.workspace?.fixtures ?? []) {
      const to = path.join(ws, fixture.to)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(path.join(TASKS_ROOT, fixture.from), to)
    }
    const artifact = path.join(ws, task.grader.artifact)
    fs.mkdirSync(path.dirname(artifact), { recursive: true })
    fs.copyFileSync(candidatePath ?? goldenPath(target.id), artifact)
    const route = task.grader.mechanical.load?.route ?? `/examples/${path.basename(path.dirname(artifact))}`
    visuals.push({
      name: target.id,
      route,
      render: target.render,
      grabBodyText: target.grabBodyText,
      openTimeline: task.grader.mechanical.load?.openTimeline,
    })
  }

  // Fixture baselines, captured for eyeball review when running the full set:
  // camera-tour (static base, healthy) and quake-map-broken (must NOT render
  // points — it's the seeded-broken input).
  if (!onlyTask) {
    for (const [name, fixtureFile, render] of [
      ['camera-tour-base', 'camera-tour.noodles.json', 'healthy'],
      ['quake-map-broken-base', 'quake-map-broken.noodles.json', 'expected-unhealthy'],
    ] as const) {
      const dir = path.join(examples, name)
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(path.join(FIXTURES, fixtureFile), path.join(dir, 'noodles.json'))
      if (name === 'quake-map-broken-base') {
        fs.copyFileSync(path.join(FIXTURES, 'earthquakes.csv'), path.join(dir, 'data.csv'))
      }
      // camera-tour-base gets the open timeline too: the empty panel is the
      // visual contrast against the animate golden's keyframed one.
      visuals.push({ name, route: `/examples/${name}`, render, openTimeline: name === 'camera-tour-base' })
    }
  }

  let port = PORT_BASE
  for (const v of visuals) {
    const screenshotPath = path.join(SCREENS_DIR, `${v.name}.png`)
    let result: Awaited<ReturnType<typeof loadAndScreenshot>>
    try {
      result = await loadAndScreenshot({
        workspace: ws,
        route: v.route,
        screenshotPath,
        port: port++,
        grabBodyText: v.grabBodyText,
        openTimeline: v.openTimeline,
      })
    } catch (e) {
      // One wedged capture (e.g. the software rasterizer starving on a huge
      // dataset) must not kill the remaining targets' captures.
      report(v.name, 'render-2k', false, `capture failed: ${String(e).split('\n')[0].slice(0, 160)}`)
      continue
    }
    const healthy = result.loaded && result.consoleErrors.length === 0 && result.screenshotNonBlank === true
    const detail =
      `loaded=${result.loaded} errors=${result.consoleErrors.length} nonBlank=${result.screenshotNonBlank} ` +
      `stddev=${result.pixelStddev?.toFixed(1)} -> ${screenshotPath}`
    if (v.render === 'healthy') {
      report(v.name, 'render-2k', healthy, detail)
    } else if (v.render === 'expected-unhealthy') {
      // The broken fixture renders a basemap but must not look like the fixed
      // project; we can't assert "wrong pixels", so record informationally.
      report(v.name, 'render-2k-broken-fixture', true, detail)
    } else {
      report(v.name, 'render-2k-informational', healthy, detail, true)
    }
    for (const err of result.consoleErrors.slice(0, 3)) console.log(`      console: ${err.slice(0, 160)}`)

    if (v.grabBodyText && expectedHikingTotal !== null) {
      const text = result.bodyText ?? ''
      // react-json-view renders `"totalTime" : float 568.806...` — allow the
      // quote/colon/type-tag between the key and the number.
      const m = text.match(/totalTime\D{0,20}?(-?\d+(?:\.\d+)?)/)
      const domTotal = m ? Number(m[1]) : null
      report(
        v.name,
        'dom-total-time',
        domTotal !== null && Math.abs(domTotal - expectedHikingTotal) < 0.5,
        domTotal === null
          ? `could not find totalTime in the rendered DOM (bodyText ${text.length} chars)`
          : `ViewerOp shows totalTime=${domTotal}, independent computation ${expectedHikingTotal.toFixed(2)}`
      )
    }
  }
}

// ---------- structural diff (for --candidate review + drift checks) ----------

function structuralDiff(before: ProjectJson, after: ProjectJson): string[] {
  const lines: string[] = []
  const bNodes = new Map((before.nodes ?? []).map(n => [n.id, n]))
  const aNodes = new Map((after.nodes ?? []).map(n => [n.id, n]))
  for (const [id, node] of aNodes) {
    const prev = bNodes.get(id)
    if (!prev) {
      lines.push(`+node ${id} (${node.type})`)
      continue
    }
    if (prev.type !== node.type) lines.push(`~node ${id} type ${prev.type}->${node.type}`)
    const keys = new Set([...Object.keys(prev.data?.inputs ?? {}), ...Object.keys(node.data?.inputs ?? {})])
    for (const key of keys) {
      const b = JSON.stringify(prev.data?.inputs?.[key])
      const a = JSON.stringify(node.data?.inputs?.[key])
      if (a !== b) lines.push(`~node ${id} input ${key}: ${trunc(b)} -> ${trunc(a)}`)
    }
  }
  for (const id of bNodes.keys()) if (!aNodes.has(id)) lines.push(`-node ${id}`)
  const edgeKey = (e: { source?: string; sourceHandle?: string; target?: string; targetHandle?: string }) =>
    `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`
  const bEdges = new Set((before.edges ?? []).map(edgeKey))
  const aEdges = new Set((after.edges ?? []).map(edgeKey))
  for (const e of aEdges) if (!bEdges.has(e)) lines.push(`+edge ${e}`)
  for (const e of bEdges) if (!aEdges.has(e)) lines.push(`-edge ${e}`)
  if (JSON.stringify(before.timeline) !== JSON.stringify(after.timeline)) lines.push('~timeline changed')
  return lines
}

function printStructuralDiff(committed: ProjectJson, candidate: ProjectJson): void {
  const lines = structuralDiff(committed, candidate)
  console.log(lines.length === 0 ? '  candidate is structurally identical to the committed golden' : '  diff vs committed golden:')
  for (const line of lines) console.log(`    ${line}`)
}

function trunc(v: string | undefined): string {
  return v === undefined ? 'undefined' : v.length > 60 ? `${v.slice(0, 57)}...` : v
}

await main()
