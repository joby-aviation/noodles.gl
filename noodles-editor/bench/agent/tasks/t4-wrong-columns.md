---
id: t4-wrong-columns
taskVersion: 1
family: debug
tier: T4
tags: [accessors, data-inspection]
start: california-earthquakes
setup:
  modifications:
    - type: update_node
      data: { id: /position-accessor, data: { inputs: { expression: '[d.lng, d.lat]' } } }
budget:
  maxTurns: 10
  maxWallClockSeconds: 360
grader:
  checks:
    # The CSV's columns are Longitude and Latitude
    - { type: inputMatches, node: /position-accessor, input: expression, pattern: 'Longitude[\s\S]*Latitude' }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewOperatorErrors
---

None of the earthquakes are where they should be on the map. Look at the data and fix whatever is wrong.
