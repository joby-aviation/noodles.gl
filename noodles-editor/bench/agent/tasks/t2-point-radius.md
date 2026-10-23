---
id: t2-point-radius
taskVersion: 2
family: single-edit
tier: T2
tags: [geojson, sizing]
start: geojson-example
budget:
  maxTurns: 6
  maxWallClockSeconds: 240
grader:
  checks:
    # The GeoJSON layer converts to fill, line, point and label layers; points are a scatter
    - { type: paramEquals, node: /geojson-layer-points, param: radiusScale, value: 10 }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewErrors
---

Set the point radius of the GeoJSON layer to 10.
