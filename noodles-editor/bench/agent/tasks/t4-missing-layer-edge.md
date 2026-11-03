---
id: t4-missing-layer-edge
taskVersion: 2
family: debug
tier: T4
tags: [connections]
start: california-earthquakes
setup:
  modifications:
    - { type: delete_edge, source: /scatterplot-layer, target: /deck, targetPort: layers }
budget:
  maxTurns: 8
  maxWallClockSeconds: 300
grader:
  checks:
    - { type: edgeExists, source: /scatterplot-layer, target: /deck, targetPort: layers }
    - type: edgesValid
    - type: applySucceeded
    - type: noNewErrors
---

The earthquakes stopped showing up on the map. Can you fix it?
