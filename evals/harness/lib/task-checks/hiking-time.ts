// author-hiking-time: Naismith's Rule hiking-time calculator. Structural
// checks: distance CodeOp, terrain heuristic, main formula with breakdown,
// tuneable constants, viewer wiring. Deliberately looser than value-exact
// checks — the judge grades formula quality against the reference document.

import { type CheckContext, type CheckResult, nodesByType, type ProjectJson } from './types'

function codeOf(node: { data?: { inputs?: Record<string, unknown> } }): string {
  const code = node.data?.inputs?.code
  return Array.isArray(code) ? code.join('\n') : String(code ?? '')
}

function findCodeOps(project: ProjectJson, pattern: RegExp) {
  return nodesByType(project, 'CodeOp').filter(n => pattern.test(codeOf(n)))
}

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }
  const ids = (nodes: Array<{ id?: string }>) => nodes.map(n => n.id).join(', ')

  const distanceOps = findCodeOps(after, /turf\.distance[\s\S]*kilometers/i)
  checks['distance-op-present'] = {
    pass: distanceOps.length > 0,
    detail: distanceOps.length ? `found: ${ids(distanceOps)}` : 'no CodeOp calling turf.distance with kilometers',
  }

  const terrainOps = [
    ...new Set([
      ...findCodeOps(after, /(?:1\.[0-8]|terrain|factor)[\s\S]*(?:dist|km)/i),
      ...findCodeOps(after, /(?:dist|km)[\s\S]*(?:1\.[0-8]|terrain|factor)/i),
    ]),
  ]
  checks['terrain-heuristic-present'] = {
    pass: terrainOps.length > 0,
    detail: terrainOps.length ? `found: ${ids(terrainOps)}` : 'no CodeOp with a terrain-factor heuristic pattern',
  }

  const formulaOps = [
    ...new Set([
      ...findCodeOps(after, /(?:elev|ascent|gain)[\s\S]*(?:speed|baseSpeed|base_speed)/i),
      ...findCodeOps(after, /(?:speed|baseSpeed|base_speed)[\s\S]*(?:elev|ascent|gain)/i),
      ...findCodeOps(after, /(?:horizontal|ascent|descent)[\s\S]*(?:time|min)/i),
    ]),
  ]
  checks['main-formula-present'] = {
    pass: formulaOps.length > 0,
    detail: formulaOps.length
      ? `found: ${ids(formulaOps)}`
      : 'no CodeOp implementing the Naismith formula (needs elevation + speed + time terms)',
  }

  const descentOps = findCodeOps(after, /descent|slope|langmuir/i)
  checks['descent-correction-present'] = {
    pass: descentOps.length > 0,
    detail: descentOps.length ? `found: ${ids(descentOps)}` : 'no CodeOp with descent/slope/Langmuir logic',
  }

  const numberOps = nodesByType(after, 'NumberOp')
  const val = (n: (typeof numberOps)[number]) => n.data?.inputs?.val as number | undefined
  const speedOp = numberOps.find(n => typeof val(n) === 'number' && (val(n) as number) >= 3 && (val(n) as number) <= 7)
  const elevOp = numberOps.find(
    n => n !== speedOp && typeof val(n) === 'number' && (val(n) as number) > 0 && (val(n) as number) <= 5000
  )
  checks['number-ops-sensible'] = {
    pass: Boolean(speedOp && elevOp),
    detail: `base speed: ${speedOp ? `${speedOp.id}=${val(speedOp)}` : 'MISSING (~5 km/h)'}, elevation: ${elevOp ? `${elevOp.id}=${val(elevOp)}` : 'MISSING (>0m)'}`,
  }

  const formulaIds = new Set(formulaOps.map(n => n.id))
  const viewerOps = nodesByType(after, 'ViewerOp')
  const viewerWired = viewerOps.some(v => (after.edges ?? []).some(e => formulaIds.has(e.source) && e.target === v.id))
  checks['viewer-wired-to-formula'] = {
    pass: viewerWired,
    detail: viewerWired
      ? 'ViewerOp connected to formula output'
      : `${viewerOps.length} ViewerOp(s), none wired to a formula output`,
  }

  const pointOps = nodesByType(after, 'PointOp')
  checks['point-ops-present'] = {
    pass: pointOps.length >= 2,
    detail: `${pointOps.length} PointOp(s) (need ≥ 2)`,
  }

  const switchOps = nodesByType(after, 'SwitchOp')
  checks['switch-ops-present'] = {
    pass: switchOps.length >= 2,
    detail: `${switchOps.length} SwitchOp(s) (need ≥ 2)`,
  }

  return checks
}
