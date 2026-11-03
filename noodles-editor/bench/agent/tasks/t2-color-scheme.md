---
id: t2-color-scheme
taskVersion: 1
family: single-edit
tier: T2
tags: [styling, color-ramp]
start: california-earthquakes
budget:
  maxTurns: 6
  maxWallClockSeconds: 240
grader:
  checks:
    - { type: inputEquals, node: /magnitude-color, input: colorScheme, value: magma }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewOperatorErrors
---

Switch the earthquake color ramp to the magma color scheme.
