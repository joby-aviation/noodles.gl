---
id: t3-scatterplot-from-url
taskVersion: 1
family: build
tier: T3
tags: [data-loading, scatterplot]
start: blank
budget:
  maxTurns: 12
  maxWallClockSeconds: 420
grader:
  checks:
    - type: nodeTypesPresent
      types: [FileOp, ScatterplotLayerOp]
    - { type: edgeExists, sourceType: FileOp, targetType: ScatterplotLayerOp, targetHandle: par.data }
    - { type: edgeExists, sourceType: ScatterplotLayerOp, target: /deck, targetHandle: par.layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewOperatorErrors
---

Load the BART stations from https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart-stations.json and show them as a scatterplot on the map. Each station has a `coordinates` field with [longitude, latitude].
