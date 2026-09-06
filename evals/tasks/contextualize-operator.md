---
id: contextualize-operator
taskVersion: 1
cuj: 2
family: contextualization
tags: [knowledge]
budget:
  maxTurns: 30
  maxWallClockSeconds: 1200
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/contextualize-questions.json
      to: QUESTIONS.json
grader:
  rubric: contextualization.yaml
  artifact: answers.json
  mechanical:
    answers:
      file: answers.json
      key: fixtures/contextualize-answer-key.json
---

# contextualize-operator

One knowledge task: 29 factual questions with ground-truth answers, spread
across the four question kinds from 07 D2 — field schemas and defaults, enum
values/semantics, operator history (sourced only from `__migrations__/`), and
format invariants. The invariants set includes reference-syntax and
container-path questions (see the journal entry for 2026-07-06: partial
coverage of the references/containers gap inside phase 0's two tasks).

## Prompt (verbatim)

> The file `QUESTIONS.json` in the repository root contains questions about
> this codebase. Answer them and write your answers to `answers.json` in the
> repository root, as a JSON object mapping each question id (like "q01") to a
> concise answer string. Base every answer on what's actually in this
> repository — if you can't verify an answer here, say so in the answer.

## Mechanical checks (Layer 1, frozen at run time)

1. `answers.json` exists and parses as a JSON object keyed by question id —
   missing or unparseable is a mechanical failure (score capped at 40%).
2. Answer accuracy vs the answer key (`fixtures/contextualize-answer-key.json`):
   deterministic matchers (`regex`, `containsAll`) are scored at run time;
   `judge`-matched questions are scored at grade time (one judge call each)
   and flagged as judge-matched in the stored results.

The accuracy ratio (correct / total) is the mechanical score for this task.

## Notes

- Ground truth was verified against origin/main source; each key entry records
  its `source` location. History answers come only from `__migrations__/*.ts`
  (the program's no-invented-history rule).
- Task changes bump `taskVersion` and start a new comparison series (07 D7).
