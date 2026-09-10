// code-refs-containers v2: CodeOp transform + op() reference + ContainerOp
// grouping + a PROMOTED PARAMETER on the container (taskVersion 2 — v1 used a
// standalone NumberOp for the cutoff; promoting it to the container's own
// interface is the added ask). Container membership is encoded by the
// /container/child id path prefix; promoted params serialize as
// node.data.customInputs [{id, name, type, order, defaultValue}]. The
// GraphInput/Output bridge is one legitimate route for the value; an
// op('/<container>').par.<name> reference is another — neither is mandated.

import { type CheckContext, type CheckResult, edgesInto, findResolvingOpReference, nodesByType } from './types'

interface CustomInputDef {
  name?: string
  type?: string
  defaultValue?: unknown
}

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

  // v2: the cutoff must be a promoted parameter on the container itself.
  const customDefs = ((container?.data as { customInputs?: CustomInputDef[] } | undefined)?.customInputs ?? []).filter(
    d => d && typeof d.name === 'string'
  )
  const numericDef = customDefs.find(d => d.type === 'number')
  checks['container-has-promoted-param'] = {
    pass: numericDef !== undefined,
    detail: customDefs.length
      ? `customInputs: ${customDefs.map(d => `${d.name}:${d.type}`).join(', ')}`
      : 'container declares no customInputs (promoted parameters)',
  }

  if (container?.id && numericDef?.name) {
    // The promoted value must actually feed the pipeline: a code-ish input
    // references op('<container>').par.<name>, or a direct-child GraphInputOp
    // carries the mirrored dynamic input.
    const refPattern = new RegExp(`op\\(\\s*['"]${container.id}['"]\\s*\\)\\s*\\.par\\.${numericDef.name}\\b`)
    const referencedInCode = (after.nodes ?? []).some(n =>
      Object.values(n.data?.inputs ?? {}).some(v => typeof v === 'string' && refPattern.test(v))
    )
    const prefix = `${container.id}/`
    const graphInputCarries = (after.nodes ?? []).some(
      n =>
        n.type === 'GraphInputOp' &&
        n.id?.startsWith(prefix) &&
        (n.data?.inputs?.[numericDef.name as string] !== undefined ||
          (after.edges ?? []).some(e => e.source === n.id))
    )
    checks['promoted-param-feeds-cutoff'] = {
      pass: referencedInCode || graphInputCarries,
      detail: referencedInCode
        ? `referenced via op('${container.id}').par.${numericDef.name}`
        : graphInputCarries
          ? 'flows through a direct-child GraphInputOp'
          : `promoted param "${numericDef.name}" is declared but nothing consumes it`,
    }
  } else {
    checks['promoted-param-feeds-cutoff'] = {
      pass: false,
      detail: 'no numeric promoted parameter to consume',
    }
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
