---
id: t2-pickup-red
taskVersion: 1
family: single-edit
tier: T2
tags: [styling, color]
start: nyc-taxis
budget:
  maxTurns: 6
  maxWallClockSeconds: 240
grader:
  checks:
    # Either recolor the shared ColorOp or override the layer directly
    - type: anyOf
      checks:
        - { type: inputEquals, node: /pickup, input: color, value: '#ff0000', tolerance: 60 }
        - { type: inputEquals, node: /pickup-layer, input: getFillColor, value: '#ff0000', tolerance: 60 }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewOperatorErrors
---

Make the pickup points red.
