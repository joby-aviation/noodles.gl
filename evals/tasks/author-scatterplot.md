---
id: author-scatterplot
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, data-source]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  # What the session may use at each tier. Tiers are enforced by environment
  # construction (07 D3), not by asking the agent to abstain — this block is
  # documentation of intent, consumed by humans and by the workspace builder.
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/earthquakes.csv
      to: noodles-editor/src/examples/quake-magnitude-viz/data.csv
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/quake-magnitude-viz/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/quake-magnitude-viz/noodles.json
    load:
      route: /examples/quake-magnitude-viz
      screenshot: non-blank
    requiredNodeTypes: [ScatterplotLayerOp, MaplibreBasemapOp, DeckRendererOp]
---

# author-scatterplot

One artifact-producing authoring task: build a working geospatial visualization
project from a CSV, from scratch, in a greenfield checkout.

## Prompt (verbatim)

> I've added a CSV of California earthquakes at
> `noodles-editor/src/examples/quake-magnitude-viz/data.csv`. Please create a
> Noodles project file at
> `noodles-editor/src/examples/quake-magnitude-viz/noodles.json` that plots the
> earthquakes on a map as a scatterplot, with each point sized by the
> earthquake's magnitude. I should be able to open it in the editor at
> `/examples/quake-magnitude-viz` and see the points over a basemap.

## Mechanical checks (Layer 1, frozen at run time)

1. The project file exists and passes the interim `validateProject()`
   (schema + registry handle-lint, `validatorVersion: interim-1`).
2. The project loads in the app under Playwright with no console errors.
3. The screenshot is non-blank (pixel-variance threshold).
4. Required node types present: `ScatterplotLayerOp`, `MaplibreBasemapOp`,
   `DeckRendererOp`.

A mechanical failure caps the task score at 40% regardless of judge opinion.

## Notes

- The workspace legitimately contains the `california-earthquakes` example —
  the repo as-is is exactly what T0 measures. Copying or adapting it is not
  cheating; the rubric's tool-use and graph-design dimensions observe *how*
  the agent worked, and process metrics record whether lookups preceded edits.
- Task changes bump `taskVersion` and start a new comparison series (07 D7).
