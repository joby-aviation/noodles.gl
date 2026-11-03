---
id: t3-scatterplot-from-url
taskVersion: 2
family: build
tier: T3
tags: [data-loading, scatterplot]
start: blank
budget:
  maxTurns: 12
  maxWallClockSeconds: 420
grader:
  checks:
    - type: opsPresent
      ops: [file, scatter]
    - { type: edgeExists, sourceOp: file, targetPort: in }
    # Positions from the coordinates column, on the layer or in an attribute node
    - type: anyOf
      checks:
        - { type: paramMatches, op: scatter, param: position, pattern: 'coordinates' }
        - { type: paramMatches, op: attribute, param: expression, pattern: 'coordinates' }
    - { type: edgeExists, sourceOp: scatter, targetOp: deck, targetPort: layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewErrors
---

Load the BART stations from https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart-stations.json and show them as a scatterplot on the map. Each station has a `coordinates` field with [longitude, latitude].
