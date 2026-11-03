---
id: t2-pickup-red
taskVersion: 2
family: single-edit
tier: T2
tags: [styling, color]
start: nyc-taxis
budget:
  maxTurns: 6
  maxWallClockSeconds: 240
grader:
  checks:
    # Either recolor the shared Color node or override the layer's fill directly
    - type: anyOf
      checks:
        - { type: paramEquals, node: /pickup, param: color, value: '#ff0000', tolerance: 60 }
        - { type: paramEquals, node: /pickup-layer, param: fillColor, value: '#ff0000', tolerance: 60 }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewErrors
---

Make the pickup points red.
