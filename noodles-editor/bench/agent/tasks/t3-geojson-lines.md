---
id: t3-geojson-lines
taskVersion: 1
family: build
tier: T3
tags: [data-loading, geojson]
start: blank
budget:
  maxTurns: 12
  maxWallClockSeconds: 420
grader:
  checks:
    - type: nodeTypesPresent
      types: [FileOp, GeoJsonLayerOp]
    - { type: edgeExists, sourceType: FileOp, targetType: GeoJsonLayerOp, targetHandle: par.data }
    - { type: edgeExists, sourceType: GeoJsonLayerOp, target: /deck, targetHandle: par.layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewOperatorErrors
---

Draw the GeoJSON at https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart.geo.json on the map.
