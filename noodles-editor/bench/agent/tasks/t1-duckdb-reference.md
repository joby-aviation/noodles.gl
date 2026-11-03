---
id: t1-duckdb-reference
taskVersion: 1
family: knowledge
tier: T1
tags: [knowledge, duckdb, references]
start: blank
budget:
  maxTurns: 4
  maxWallClockSeconds: 180
grader:
  checks:
    # Mustache reference to another operator's field
    - type: answerMatches
      patterns: ['\{\{\s*[./\w-]+\.(par|out)\.\w+\s*\}\}']
---

In a DuckDbOp SQL query, how do I use the value of a NumberOp at /threshold? Show the query syntax.
