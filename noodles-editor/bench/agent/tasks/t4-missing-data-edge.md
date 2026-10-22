---
id: t4-missing-data-edge
taskVersion: 1
family: debug
tier: T4
tags: [connections]
start: nyc-taxis
setup:
  modifications:
    - type: delete_edge
      data: { id: '/data-source.out.data->/pickup-layer.par.data' }
budget:
  maxTurns: 8
  maxWallClockSeconds: 300
grader:
  checks:
    - { type: edgeExists, source: /data-source, target: /pickup-layer, targetHandle: par.data }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewOperatorErrors
---

The pickup points disappeared but the dropoff points are still there. What happened? Please fix it.
