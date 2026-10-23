---
id: t1-duckdb-reference
taskVersion: 2
family: knowledge
tier: T1
tags: [knowledge, duckdb, references]
start: blank
budget:
  maxTurns: 4
  maxWallClockSeconds: 180
grader:
  checks:
    # ch() reading the Number node's parameter, by name or path
    - type: answerMatches
      patterns: ['ch\(\s*[''"][./\w-]*threshold/value[''"]\s*\)']
---

In a SQL node's query, how do I use the value of a Number node named threshold? Show the query syntax.
