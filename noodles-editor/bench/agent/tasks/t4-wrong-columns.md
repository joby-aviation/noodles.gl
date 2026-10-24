---
id: t4-wrong-columns
taskVersion: 3
family: debug
tier: T4
tags: [attributes, data-inspection]
start: california-earthquakes
setup:
  modifications:
    - { type: update_node, id: /position, params: { expression: '[lng, lat]' } }
budget:
  maxTurns: 10
  maxWallClockSeconds: 360
grader:
  checks:
    # The CSV's columns are Longitude and Latitude
    - { type: paramMatches, node: /position, param: expression, pattern: 'Longitude[\s\S]*Latitude' }
    - type: errorsFixed
    - type: applySucceeded
    - type: edgesValid
    - type: noNewErrors
---

None of the earthquakes are where they should be on the map. Look at the data and fix whatever is wrong.
