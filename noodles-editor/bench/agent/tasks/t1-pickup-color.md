---
id: t1-pickup-color
taskVersion: 1
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
      patterns: ['/pickup\b', '8d12af']
    - type: nodeCount
      min: 12
      max: 12
---

Which node sets the color of the pickup points, and what color is it set to right now?
