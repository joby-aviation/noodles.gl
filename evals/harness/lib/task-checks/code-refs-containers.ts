// code-refs-containers: CodeOp transform + op() reference + ContainerOp
// grouping (the D2 task added in phase 0 for the coverage gap). Container
// membership is encoded by the /container/child id path prefix; the
// GraphInput/Output bridge is one legitimate route across the boundary but
// op() references are another, so the checks don't mandate the bridge.

import { type CheckContext, type CheckResult, edgesInto, findResolvingOpReference, nodesByType } from './types'

const PASS_THROUGH_TYPES = new Set(['GraphInputOp', 'GraphOutputOp'])

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  const containers = nodesByType(after, 'ContainerOp')
  const container = containers[0]
  checks['container-present'] = { pass: containers.length > 0, detail: `${containers.length} ContainerOp(s)` }

  if (container?.id) {
    const prefix = `${container.id}/`
    const children = (after.nodes ?? []).filter(n => n.id?.startsWith(prefix))
    const functional = children.filter(n => !PASS_THROUGH_TYPES.has(n.type ?? ''))
    checks['container-has-functional-children'] = {
      pass: functional.length >= 1,
      detail: `children: ${children.map(n => `${n.id} (${n.type})`).join(', ') || 'none'}`,
    }
  }

  const codeOps = nodesByType(after, 'CodeOp').concat(nodesByType(after, 'ExpressionOp'))
  checks['code-op-present'] = { pass: nodesByType(after, 'CodeOp').length > 0, detail: `${codeOps.length} code-ish node(s)` }

  const ref = findResolvingOpReference(after)
  checks['op-reference-resolves'] = {
    pass: ref !== null,
    detail: ref ? `${ref.ref} in ${ref.nodeId}` : 'no op() reference resolving to an existing node',
  }

  const scatter = nodesByType(after, 'ScatterplotLayerOp')[0]
  if (scatter?.id) {
    const getRadius = scatter.data?.inputs?.getRadius
    const fed =
      edgesInto(after, scatter.id, 'par.getRadius').length > 0 ||
      (typeof getRadius === 'string' && /d\.\w+|energy/i.test(getRadius))
    checks['points-sized-by-derived-value'] = {
      pass: fed,
      detail: `getRadius = ${JSON.stringify(getRadius)} (edges in: ${edgesInto(after, scatter.id, 'par.getRadius').length})`,
    }
  } else {
    checks['points-sized-by-derived-value'] = { pass: false, detail: 'no ScatterplotLayerOp' }
  }

  return checks
}
