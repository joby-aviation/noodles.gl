---
id: t1-explain-map-range
taskVersion: 2
family: knowledge
tier: T1
tags: [knowledge, inspection]
start: california-earthquakes
budget:
  maxTurns: 4
  maxWallClockSeconds: 180
grader:
  checks:
    - type: answerMatches
      patterns: ['magnitude', '2\.5', '\b7\b']
    # Answering must not change the project
    - type: nodeCount
      min: 8
      max: 8
---

What does the /map-range node do in this project, and what input range does it use?
