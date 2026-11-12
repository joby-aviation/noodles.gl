---
id: t3-geojson-lines
taskVersion: 2
family: build
tier: T3
tags: [data-loading, geojson]
start: blank
budget:
  maxTurns: 12
  maxWallClockSeconds: 420
grader:
  checks:
    - type: opsPresent
      ops: [geojson]
    # The vertex rows drawn by some layer, and that layer drawn in the deck
    - type: anyOf
      checks:
        - { type: edgeExists, sourceOp: geojson, targetOp: path, targetPort: in }
        - { type: edgeExists, sourceOp: geojson, targetOp: polygon, targetPort: in }
        - { type: edgeExists, sourceOp: geojson, targetOp: scatter, targetPort: in }
    - { type: edgeExists, targetOp: deck, targetPort: layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewErrors
---

Draw the GeoJSON at https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/bart.geo.json on the map.
