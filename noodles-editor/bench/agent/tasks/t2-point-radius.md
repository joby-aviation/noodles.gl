---
id: t2-point-radius
taskVersion: 1
family: single-edit
tier: T2
tags: [geojson, sizing]
start: geojson-example
budget:
  maxTurns: 6
  maxWallClockSeconds: 240
grader:
  checks:
    - { type: inputEquals, node: /geojson-layer, input: getPointRadius, value: 10 }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewOperatorErrors
---

Set the point radius of the GeoJSON layer to 10.
