// map-flights-last-week: a map of last week's New York Blade flights from the
// made-up flights export. The filter is the task: the rendered layers must
// receive exactly the 12 target flights, measured in the loaded app (the
// frozen get_node_output probe), not inferred from the query text. A filter
// can be SQL, a CodeOp, or an accessor, and only the runtime data says
// whether it worked.

import {
  describeSetDiff,
  expectedLastWeekNewYorkBlade,
  flightsSeen,
  renderedLayerIds,
} from './flight-fixture'
import type { CheckContext, CheckResult } from './types'

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after, nodeOutputs } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  const layers = renderedLayerIds(after)
  checks['layer-wired-to-renderer'] = {
    pass: layers.length > 0,
    detail: layers.length
      ? `rendered layers: ${layers.join(', ')}`
      : 'no *LayerOp reaches a DeckRendererOp',
  }

  const basemaps = (after.nodes ?? []).filter(
    n => typeof n.type === 'string' && /Basemap/.test(n.type)
  )
  checks['basemap-present'] = {
    pass: basemaps.length > 0,
    detail: basemaps.length
      ? basemaps.map(n => `${n.id} (${n.type})`).join(', ')
      : 'no basemap operator',
  }

  if (!nodeOutputs) {
    checks['renders-exactly-last-weeks-ny-blade-flights'] = {
      pass: false,
      detail: 'no runtime probe (project did not load, or WebMCP tools never registered)',
    }
    return checks
  }
  const probed = layers.map(id => nodeOutputs[id])
  const { flights, via } = flightsSeen(probed)
  const expected = expectedLastWeekNewYorkBlade()
  const exact = flights.size === expected.size && [...expected].every(id => flights.has(id))
  checks['renders-exactly-last-weeks-ny-blade-flights'] = {
    pass: exact,
    detail: `via ${via}: ${describeSetDiff(flights, expected)}`,
  }
  return checks
}
