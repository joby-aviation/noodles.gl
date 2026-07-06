---
id: code-refs-containers
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, data-source, references, containers]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/earthquakes.csv
      to: noodles-editor/src/examples/quake-pipeline/data.csv
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/quake-pipeline/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/quake-pipeline/noodles.json
    custom: code-refs-containers
    requiredNodeTypes: [CodeOp, ContainerOp, ScatterplotLayerOp, MaplibreBasemapOp, DeckRendererOp]
    load:
      route: /examples/quake-pipeline
      screenshot: non-blank
---

# code-refs-containers

The task added to D2 in phase 0 for the coverage gap: writing reactive `op()`
references and organizing a graph with containers. (Added to the spec's task
table for step 5; this is that task.)

## Prompt (verbatim)

> I've put a CSV of California earthquakes at
> `noodles-editor/src/examples/quake-pipeline/data.csv`. Build a project at
> `noodles-editor/src/examples/quake-pipeline/noodles.json` that plots the
> quakes on a map with each point sized by its energy — compute the energy
> with a CodeOp as `10^(1.5 × magnitude)`. Keep the minimum-magnitude cutoff
> (use 4.0) in its own separate operator, and have the code reference it with
> `op()` so I can change the cutoff in one place. Organize the data-processing
> nodes into a container to keep the graph tidy. It should open at
> `/examples/quake-pipeline`.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes (container bridge edges are recognized
   as of `interim-2`).
2. Required node types: `CodeOp`, `ContainerOp`, `ScatterplotLayerOp`,
   `MaplibreBasemapOp`, `DeckRendererOp`.
3. Custom (`code-refs-containers`): the container has ≥ 1 functional
   (non-GraphInput/Output) child addressed by the `/container/child` path
   prefix; a code-ish input contains an `op()` reference that resolves to an
   existing node; the scatterplot's radius is fed by the derived value.
4. Loads under Playwright without console errors; screenshot non-blank.

## Notes

- Container membership is encoded purely in the node-id path prefix;
  GraphInputOp/GraphOutputOp + bridge edges are the app's pass-through
  mechanism, but `op()` references across the boundary are also legitimate —
  the checks don't mandate the bridge.
