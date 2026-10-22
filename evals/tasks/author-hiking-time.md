---
id: author-hiking-time
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, math-heuristic]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/naismith-reference.md
      to: REFERENCE.md
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/hiking-time-estimate/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/hiking-time-estimate/noodles.json
    requiredNodeTypes: [CodeOp, NumberOp, SwitchOp, PointOp, ViewerOp]
    custom: hiking-time
    load:
      route: /examples/hiking-time-estimate
      screenshot: non-blank
---

# author-hiking-time

One artifact-producing authoring task: build a working heuristic calculator
project from a reference document, from scratch, in a greenfield checkout.
**Public and non-proprietary** (Naismith's Rule, 1892) — suitable for
open-source distribution of the harness, and the designated smoke-lane task
(07 D6): no data files, no basemap, no egress dependencies. Unlike the other
authoring tasks it terminates in a ViewerOp, not a map renderer — the
rapid-prototyping/data-exploration journey.

## Prompt (verbatim)

> I've placed a reference document at `REFERENCE.md` describing Naismith's Rule
> for hiking time estimation. Please create a Noodles project file at
> `noodles-editor/src/examples/hiking-time-estimate/noodles.json` that
> calculates estimated hiking time between two geographic points. The project
> should include:
>
> - Two PointOp inputs for origin and destination
> - A CodeOp that computes distance between them (using turf.distance, kilometers)
> - A terrain factor heuristic (CodeOp) that estimates terrain difficulty from distance
> - SwitchOps to toggle between computed and manual values for distance and terrain
> - NumberOp constants for base speed (km/h), elevation gain (m), and elevation descent (m)
> - A main CodeOp implementing Naismith's Rule with Langmuir descent corrections
> - ViewerOp(s) showing the calculation result
>
> The formula should break down: horizontal time + ascent penalty + descent
> correction. I should be able to open it at `/examples/hiking-time-estimate`.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes (schema + registry handle-lint).
2. Required node types: `CodeOp`, `NumberOp`, `SwitchOp`, `PointOp`, `ViewerOp`.
3. Custom (`hiking-time`): a CodeOp calls `turf.distance` with kilometers; a
   terrain-factor heuristic CodeOp exists (piecewise on distance); a main
   formula CodeOp references elevation + speed + time terms; descent/slope
   (Langmuir) logic present; NumberOps with sensible defaults (speed ~5 km/h,
   elevation > 0); a ViewerOp is wired to the formula output; ≥ 2 PointOps and
   ≥ 2 SwitchOps.
4. Loads under Playwright without console errors; screenshot non-blank.

A mechanical failure caps the task score at 40% regardless of judge opinion.

## Notes

- `REFERENCE.md` provides all formulas, constants, and worked examples — the
  task measures translating a well-specified reference into the node-graph
  format, not domain knowledge. The worked examples let the judge check the
  math exactly.
- Structurally parallel to a distance → heuristic-multiplier → multi-term
  formula pattern: the terrain factor is a piecewise function of distance
  acting as a scaling multiplier; the formula decomposes into horizontal +
  ascent + descent terms with tuneable NumberOp constants.
- Task changes bump `taskVersion` and start a new comparison series (07 D7).
