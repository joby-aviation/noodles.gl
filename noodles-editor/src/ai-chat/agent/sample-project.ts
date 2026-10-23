// A 60-node project shaped like a real one, shared by the tests that measure what
// a turn costs in context. Not a real project file: it only has to look like one
// to list_nodes.

const CODE = `
// Aggregate trips by hour and normalise the counts so the ramp uses the full range
const byHour = d3.rollups(data, v => v.length, d => new Date(d.pickup_datetime).getHours())
const max = d3.max(byHour, d => d[1])
return byHour.map(([hour, count]) => ({ hour, count, intensity: count / max }))
`.trim()

const SQL = `
SELECT pickup_longitude AS lng, pickup_latitude AS lat, passenger_count, fare_amount
FROM 'trips.parquet'
WHERE fare_amount BETWEEN {{/min-fare.par.value}} AND {{/max-fare.par.value}}
  AND passenger_count >= {{/min-passengers.par.value}}
ORDER BY fare_amount DESC
LIMIT 5000
`.trim()

export function sampleProject() {
  const nodes = []
  for (let i = 0; i < 6; i++) {
    nodes.push({
      id: `/transform-${i}`,
      type: 'CodeOp',
      position: { x: i * 240, y: 0 },
      data: { inputs: { code: CODE } },
    })
  }
  for (let i = 0; i < 6; i++) {
    nodes.push({
      id: `/query-${i}`,
      type: 'DuckDbOp',
      position: { x: i * 240, y: 160 },
      data: { inputs: { sql: SQL } },
    })
  }
  for (let i = 0; i < 12; i++) {
    nodes.push({
      id: `/scatterplot-${i}`,
      type: 'ScatterplotLayerOp',
      position: { x: i * 240, y: 320 },
      data: {
        inputs: {
          radiusScale: 1 + i,
          radiusMinPixels: 2,
          radiusMaxPixels: 40,
          opacity: 0.8,
          pickable: true,
          getFillColor: [255, 140, 0, 200],
        },
      },
    })
  }
  for (let i = 0; i < 18; i++) {
    nodes.push({
      id: `/position-${i}`,
      type: 'AccessorOp',
      position: { x: i * 120, y: 480 },
      data: { inputs: { code: '[d.lng, d.lat]' } },
    })
  }
  for (let i = 0; i < 17; i++) {
    nodes.push({
      id: `/number-${i}`,
      type: 'NumberOp',
      position: { x: i * 120, y: 600 },
      data: { inputs: { value: i * 3.5 } },
    })
  }
  nodes.push({
    id: '/renderer',
    type: 'DeckRendererOp',
    position: { x: 0, y: 720 },
    data: { inputs: { layers: [] } },
  })
  return { version: 6, nodes, edges: [] }
}
