---
id: t4-missing-layer-edge
taskVersion: 1
family: debug
tier: T4
tags: [connections]
start: california-earthquakes
setup:
  modifications:
    - type: delete_edge
      data: { id: '/scatterplot-layer.out.layer->/deck.par.layers' }
budget:
  maxTurns: 8
  maxWallClockSeconds: 300
grader:
  checks:
    - { type: edgeExists, source: /scatterplot-layer, target: /deck, targetHandle: par.layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewOperatorErrors
---

The earthquakes stopped showing up on the map. Can you fix it?
