---
id: t3-add-heatmap
taskVersion: 2
family: build
tier: T3
tags: [heatmap, existing-project]
start: nyc-taxis
budget:
  maxTurns: 12
  maxWallClockSeconds: 420
grader:
  checks:
    - type: opsPresent
      ops: [heatmap]
    # Fed by a table carrying the pickup positions, drawn in the deck
    - { type: edgeExists, targetOp: heatmap, targetPort: in }
    - { type: paramMatches, op: heatmap, param: position, pattern: 'pickup' }
    - { type: edgeExists, sourceOp: heatmap, target: /deck, targetPort: layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewErrors
---

Add a heatmap of the pickup locations alongside the existing layers.
