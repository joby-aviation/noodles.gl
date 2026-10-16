// debug-blank-viz: seeded-broken quake map — the scatterplot layer is not
// wired into the renderer, and the position accessor uses lowercase column
// names (the CSV has Longitude/Latitude). Both defects must be fixed; the
// diagnosis must mention both (leniently matched — the judge grades quality).

import { type CheckContext, type CheckResult, edgesInto, nodeById } from './types'

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after, resultText } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  const layerEdges = edgesInto(after, '/deck', 'par.layers')
  checks['renderer-edge-restored'] = {
    pass: layerEdges.some(e => e.source === '/scatterplot-layer'),
    detail: layerEdges.length
      ? `edges into /deck.par.layers from: ${layerEdges.map(e => e.source).join(', ')}`
      : 'no edge into /deck.par.layers',
  }

  const expr = String(nodeById(after, '/position-accessor')?.data?.inputs?.expression ?? '')
  checks['accessor-columns-fixed'] = {
    pass: expr.includes('d.Longitude') && expr.includes('d.Latitude'),
    detail: `position accessor expression: ${JSON.stringify(expr)}`,
  }

  const text = resultText ?? ''
  checks['diagnosis-mentions-disconnection'] = {
    pass: /(disconnect|not (?:hooked|wired|connected)|missing (?:edge|connection)|never (?:reaches|connected)|unwired|wasn'?t connected|no edge|connect(?:ed)? (?:the|to))/i.test(
      text
    ),
    detail: text ? `final answer length ${text.length}` : 'no final answer text',
  }
  checks['diagnosis-mentions-column-case'] = {
    pass: /(longitude|latitude|case|capitali[sz]|column name|field name|d\.Longitude)/i.test(text),
    detail: text ? 'see final answer' : 'no final answer text',
  }

  return checks
}
