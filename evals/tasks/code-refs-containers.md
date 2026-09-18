---
id: code-refs-containers
taskVersion: 2
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
> with a CodeOp as `10^(1.5 × magnitude)`. Organize the data-processing nodes
> into a container to keep the graph tidy, and promote the minimum-magnitude
> cutoff (use 4.0) as a parameter on the container itself, so I can adjust it
> from the container without opening it. Have the code reference the cutoff
> with `op()` so it's defined in one place. It should open at
> `/examples/quake-pipeline`.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes (container bridge edges are recognized
   as of `interim-2`).
2. Required node types: `CodeOp`, `ContainerOp`, `ScatterplotLayerOp`,
   `MaplibreBasemapOp`, `DeckRendererOp`.
3. Custom (`code-refs-containers`): the container has ≥ 1 functional
   (non-GraphInput/Output) child addressed by the `/container/child` path
   prefix; a code-ish input contains an `op()` reference that resolves to an
   existing node; the scatterplot's radius is fed by the derived value;
   **(v2)** the container declares a numeric promoted parameter
   (`data.customInputs`) and the cutoff actually flows from it (an
   `op('/<container>').par.<name>` reference or a direct-child GraphInputOp
   carrying the mirrored dynamic input).
4. Loads under Playwright without console errors; screenshot non-blank.

## Notes

- Container membership is encoded purely in the node-id path prefix. **The
  supported data route across the boundary is the GraphInputOp/GraphOutputOp
  pair + the container's own `par.in`/`out.out` ports** (maintainer guidance,
  2026-07-09): wiring a child directly to a node outside the container is not
  a supported pattern — the executor happens to run it, but the app draws no
  wire for it while the container is collapsed. The golden models the
  supported shape: file → container.in → GraphInput → child → GraphOutput →
  container.out → layer. `op()` *references* across the boundary remain
  legitimate for reading values (that is how the promoted parameter is
  consumed) — it is cross-boundary *edges* that are out.
- **Reference-only data paths inside containers go stale on fresh load** (found
  during golden verification, 2026-07-08): reference edges are synced into the
  executor by the CodeField editor component, which never renders for collapsed
  container children — a child whose only link to upstream data is an `op()`
  read executes once before async data arrives and never re-executes, silently
  yielding an empty layer. App fix in PR #514; until it merges to main,
  sessions that author the reference-only pattern render a blank viz — the
  judge sees that in the screenshot, but no mechanical check catches it today.
- **taskVersion 2** (breaks the v1 comparison series per 07 D7): v1 kept the
  cutoff in a standalone NumberOp; v2 requires promoting it onto the
  container's own interface (`data.customInputs`) — the promoted-parameters
  feature had no coverage anywhere in the suite. v1 rows remain in the series
  as their own historical line.
