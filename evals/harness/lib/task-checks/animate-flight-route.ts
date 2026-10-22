// animate-flight-route: one flight from the made-up export, drawn as a
// TripsLayer route that animates over time, with a speed control. The app
// has no saved or on-screen playback-speed setting (the timeline store's
// playbackSpeed is internal), so "adjustable speed" must be a parameter in
// the graph that currentTime depends on.

import { ROUTE_FLIGHT_ID, flightsSeen, keyframedNodeIds, upstreamClosure } from './flight-fixture'
import { type CheckContext, type CheckResult, edgesInto, nodesByType } from './types'

// Names a speed control plausibly carries. Duration-style controls count:
// "play the route in N seconds" is a speed control.
const SPEED_RE = /speed|playback|pace|tempo|multiplier|duration|factor|(^|[-_])rate($|[-_])/i

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after, nodeOutputs } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  const trips = nodesByType(after, 'TripsLayerOp')[0]
  if (!trips?.id) {
    return { 'trips-layer-present': { pass: false, detail: 'no TripsLayerOp' } }
  }
  const tripsId = trips.id
  checks['trips-layer-present'] = { pass: true, detail: tripsId }

  // TripsLayerOp defaults getTimestamps to d.timestamps, so a timestamps
  // array in the layer's data counts as wired, as does an explicit accessor.
  const timestampEdges = edgesInto(after, tripsId, 'par.getTimestamps').length
  const timestampLiteral =
    typeof trips.data?.inputs?.getTimestamps === 'string' && /d\.\w+/.test(trips.data.inputs.getTimestamps)
  const timestampsInData = nodeOutputs ? hasNumericArray(nodeOutputs[tripsId], 'timestamps') : false
  checks['timestamps-wired'] = {
    pass: timestampEdges > 0 || timestampLiteral || timestampsInData,
    detail: `${nodeOutputs ? '' : 'no runtime probe; '}getTimestamps edges in: ${timestampEdges}; literal: ${timestampLiteral}; timestamps in layer data: ${timestampsInData}`,
  }

  // currentTime must move on its own: a TimeOp upstream, or keyframes on the
  // layer or anything it reads currentTime from.
  const timeUpstream = upstreamClosure(after, tripsId, 'par.currentTime')
  const keyframed = keyframedNodeIds(after)
  const typeOf = (id: string) => (after.nodes ?? []).find(n => n.id === id)?.type
  const drivers = [...timeUpstream].filter(id => typeOf(id) === 'TimeOp' || keyframed.has(id))
  if (keyframed.has(tripsId)) drivers.push(tripsId)
  checks['current-time-animated'] = {
    pass: drivers.length > 0,
    detail: drivers.length
      ? `driven by ${drivers.join(', ')}`
      : `currentTime upstream: [${[...timeUpstream].join(', ')}]; no TimeOp or keyframed node`,
  }

  // The speed control: a named numeric parameter that currentTime depends on
  // (a node, or a container's promoted parameter read through op()).
  const speedNodes = [...timeUpstream].filter(id => {
    if (typeOf(id) === 'TimeOp') return false
    const node = (after.nodes ?? []).find(n => n.id === id)
    const customInputs =
      (node?.data as { customInputs?: Array<{ name?: string }> } | undefined)?.customInputs ?? []
    return (
      SPEED_RE.test(id.split('/').pop() ?? '') ||
      customInputs.some(c => SPEED_RE.test(c.name ?? ''))
    )
  })
  checks['speed-control-feeds-current-time'] = {
    pass: speedNodes.length > 0,
    detail: speedNodes.length
      ? `speed control: ${speedNodes.join(', ')}`
      : `no node named like a speed control upstream of currentTime ([${[...timeUpstream].join(', ')}])`,
  }

  if (!nodeOutputs) {
    checks['trips-layer-gets-only-the-flight'] = {
      pass: false,
      detail: 'no runtime probe (project did not load, or WebMCP tools never registered)',
    }
    return checks
  }
  const { flights, via } = flightsSeen(nodeOutputs[tripsId])
  checks['trips-layer-gets-only-the-flight'] = {
    pass: flights.size === 1 && flights.has(ROUTE_FLIGHT_ID),
    detail: `via ${via}: [${[...flights].join(', ')}] (want only ${ROUTE_FLIGHT_ID})`,
  }
  return checks
}

function hasNumericArray(value: unknown, key: string, depth = 0): boolean {
  if (depth > 10 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(v => hasNumericArray(v, key, depth + 1))
  const record = value as Record<string, unknown>
  const candidate = record[key]
  if (Array.isArray(candidate) && candidate.length > 1 && candidate.every(v => typeof v === 'number')) return true
  return Object.values(record).some(v => hasNumericArray(v, key, depth + 1))
}
