---
id: t1-pickup-color
taskVersion: 2
family: knowledge
tier: T1
tags: [knowledge, inspection, color]
start: nyc-taxis
budget:
  maxTurns: 4
  maxWallClockSeconds: 180
grader:
  checks:
    - type: answerMatches
      patterns: ['pickup\b']
    # The color as hex or as channels
    - type: answerMatches
      any: true
      patterns: ['8d12af', '141\D{1,3}18\D{1,3}175']
    - type: nodeCount
      min: 9
      max: 9
---

Which node sets the color of the pickup points, and what color is it set to right now?
