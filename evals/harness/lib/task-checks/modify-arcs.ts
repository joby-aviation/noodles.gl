// modify-arcs: "make the arcs red and twice as thick" against uk-commute.
// The trap (by construction of the example): /source-color and /target-color
// feed BOTH the arc layer and the two scatterplot layers — recoloring the
// shared ColorOps turns the dots red too. Correct edits detach the arc.

import {
  type CheckContext,
  type CheckResult,
  effectiveInput,
  isRed,
  jsonEqual,
} from './types'

const ARC = '/arc-layer'
const DOTS = ['/residence-layer', '/workplace-layer']
const DOT_ORIGINALS: Record<string, string> = {
  '/residence-layer': '#f69a00',
  '/workplace-layer': '#950c69',
}
const UNTOUCHED_KEYS = ['timeline', 'viewport', 'name', 'editorSettings', 'version'] as const

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after, before } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  for (const handle of ['getSourceColor', 'getTargetColor']) {
    const eff = effectiveInput(after, ARC, handle, 'color')
    checks[`arc-${handle}-red`] = {
      pass: isRed(eff.value),
      detail: `${handle} = ${JSON.stringify(eff.value)} via ${eff.via}${eff.sourceId ? ` (${eff.sourceId})` : ''}`,
    }
  }

  const width = effectiveInput(after, ARC, 'getWidth')
  checks['arc-width-doubled'] = {
    pass: width.value === 160,
    detail: `getWidth = ${JSON.stringify(width.value)} (expected 160 = 2 × 80)`,
  }

  for (const dot of DOTS) {
    const eff = effectiveInput(after, dot, 'getFillColor', 'color')
    const expected = DOT_ORIGINALS[dot]
    const unchanged = typeof eff.value === 'string' && eff.value.toLowerCase() === expected
    checks[`dots-unchanged${dot.replace(/\//g, '-')}`] = {
      pass: unchanged,
      detail: `${dot} fill = ${JSON.stringify(eff.value)} (must remain ${expected})`,
    }
  }

  if (before) {
    for (const key of UNTOUCHED_KEYS) {
      checks[`untouched-${key}`] = {
        pass: jsonEqual(after[key], before[key]),
        detail: jsonEqual(after[key], before[key]) ? 'identical' : `${key} was modified`,
      }
    }
  }

  return checks
}
