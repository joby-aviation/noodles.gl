---
id: debug-blank-viz
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, debugging, data-source]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/quake-map-broken.noodles.json
      to: noodles-editor/src/examples/quake-map-broken/noodles.json
    - from: fixtures/earthquakes.csv
      to: noodles-editor/src/examples/quake-map-broken/data.csv
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/quake-map-broken/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/quake-map-broken/noodles.json
    custom: debug-blank-viz
    load:
      route: /examples/quake-map-broken
      screenshot: non-blank
---

# debug-blank-viz

Diagnose and fix a seeded-broken project. Two independent defects, both
required: (1) the scatterplot layer is not connected to the renderer
(`/scatterplot-layer.out.layer -> /deck.par.layers` edge removed), and
(2) the position accessor uses lowercase column names
(`[d.longitude, d.latitude]`) while the CSV columns are `Longitude`/`Latitude`
— so even a reconnected layer renders nothing.

## Prompt (verbatim)

> The example at `/examples/quake-map-broken`
> (`noodles-editor/src/examples/quake-map-broken/noodles.json`) loads but the
> map is blank — no earthquake points show up. Figure out why and fix the
> project. Tell me what was wrong.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes on the fixed file.
2. Custom (`debug-blank-viz`): the renderer edge is restored; the position
   accessor references `d.Longitude`/`d.Latitude`; the final answer mentions
   both defects (lenient regex — the judge grades diagnosis quality).
3. Loads under Playwright without console errors; screenshot non-blank.

## Notes

- The fixture is a derivative of `california-earthquakes` (which also exists,
  working, in the workspace — comparing against it is a legitimate T0 debug
  strategy the process metrics will show).
