---
id: t2-color-scheme
taskVersion: 2
family: single-edit
tier: T2
tags: [styling, color-ramp]
start: california-earthquakes
budget:
  maxTurns: 6
  maxWallClockSeconds: 240
grader:
  checks:
    - { type: paramEquals, node: /magnitude-color, param: ramp, value: magma }
    - type: applySucceeded
    - type: edgesValid
    - type: noNewErrors
---

Switch the earthquake color ramp to the magma color scheme.
