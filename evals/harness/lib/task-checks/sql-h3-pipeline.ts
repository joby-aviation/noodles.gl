// sql-h3-pipeline: points → SQL aggregation → H3 hexagons colored by count.
// Wiring checks only require the graph to be coherent; whether the DuckDB h3
// community extension can actually load is an environment question settled by
// the golden fixture (see task file + journal).

import { type CheckContext, type CheckResult, edgesInto, nodesByType } from './types'

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  const duckdbs = nodesByType(after, 'DuckDbOp')
  const query = duckdbs
    .map(n => String(n.data?.inputs?.query ?? ''))
    .find(q => q.length > 0)

  checks['duckdb-query-does-h3-aggregation'] = {
    pass: query !== undefined && /h3_/i.test(query) && /group\s+by/i.test(query),
    detail: query ? `query: ${query.slice(0, 200)}` : 'no DuckDbOp with a query',
  }

  const hexLayers = nodesByType(after, 'H3HexagonLayerOp')
  const hexLayer = hexLayers[0]
  checks['hex-layer-present'] = {
    pass: hexLayers.length > 0,
    detail: `${hexLayers.length} H3HexagonLayerOp node(s)`,
  }

  if (hexLayer?.id && duckdbs.length > 0) {
    // Data path: DuckDbOp output must reach the hex layer's data input,
    // possibly through intermediate nodes.
    const reachable = new Set<string>(duckdbs.map(n => n.id as string))
    let grew = true
    while (grew) {
      grew = false
      for (const e of after.edges ?? []) {
        if (e.source && e.target && reachable.has(e.source) && !reachable.has(e.target)) {
          reachable.add(e.target)
          grew = true
        }
      }
    }
    checks['duckdb-feeds-hex-layer'] = {
      pass: reachable.has(hexLayer.id),
      detail: reachable.has(hexLayer.id) ? 'data path exists' : 'no edge path from DuckDbOp to the hex layer',
    }

    const getHexagon = hexLayer.data?.inputs?.getHexagon
    const hexFed =
      edgesInto(after, hexLayer.id, 'par.getHexagon').length > 0 ||
      (typeof getHexagon === 'string' && /d\.\w+/.test(getHexagon))
    checks['hexagon-accessor-fed-from-sql'] = {
      pass: hexFed,
      detail: `getHexagon = ${JSON.stringify(getHexagon)} (edges in: ${edgesInto(after, hexLayer.id, 'par.getHexagon').length})`,
    }

    const getFillColor = hexLayer.data?.inputs?.getFillColor
    const colorFed =
      edgesInto(after, hexLayer.id, 'par.getFillColor').length > 0 ||
      (typeof getFillColor === 'string' && /(count|cnt|\bd\.\w+)/i.test(getFillColor))
    checks['color-driven-by-count'] = {
      pass: colorFed,
      detail: `getFillColor = ${JSON.stringify(getFillColor)} (edges in: ${edgesInto(after, hexLayer.id, 'par.getFillColor').length})`,
    }
  }

  return checks
}
