---
id: modify-arcs
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, modification]
budget:
  maxTurns: 30
  maxWallClockSeconds: 1200
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  project: noodles-editor/src/examples/uk-commute/noodles.json
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/uk-commute/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/uk-commute/noodles.json
    custom: modify-arcs
    load:
      route: /examples/uk-commute
      screenshot: non-blank
---

# modify-arcs

Modify an existing project without collateral damage. The base project is
uk-commute as committed on main; the runner snapshots it before the session so
the checks can diff.

## Prompt (verbatim)

> In the uk-commute example project
> (`noodles-editor/src/examples/uk-commute/noodles.json`), make the arcs red
> and twice as thick. Don't change anything else about how the project looks
> or behaves.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes.
2. Custom (`modify-arcs`): effective arc source+target colors are red
   (literal or via a dedicated upstream ColorOp); effective arc width is 160
   (2 × the base 80); **both scatterplot layers' fill colors are unchanged**;
   `timeline`, `viewport`, `name`, `editorSettings`, `version` byte-identical
   to the base.
3. Loads under Playwright without (non-environment) console errors.

## Notes

- The base wiring contains the task's teeth: `/source-color` and
  `/target-color` feed the arc layer AND both scatterplot layers. Recoloring
  those shared ColorOps turns the dots red too — the correct edit detaches the
  arc (literal colors on `/arc-layer` or dedicated new ColorOps).
- The project's data is a remote CSV (raw.githubusercontent.com); in the eval
  container that fetch may be egress-blocked, which the console-noise filter
  already classifies as environment. The JSON checks carry this task.
