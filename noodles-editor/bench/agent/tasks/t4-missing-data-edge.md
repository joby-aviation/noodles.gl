---
id: t4-missing-data-edge
taskVersion: 2
family: debug
tier: T4
tags: [connections]
start: nyc-taxis
setup:
  modifications:
    - { type: delete_edge, source: /dropoff-position, target: /pickup-layer, targetPort: in }
budget:
  maxTurns: 8
  maxWallClockSeconds: 300
grader:
  checks:
    - { type: edgeExists, target: /pickup-layer, targetPort: in }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewErrors
---

The pickup points disappeared but the dropoff points are still there. What happened? Please fix it.
