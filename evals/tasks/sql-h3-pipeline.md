---
id: sql-h3-pipeline
taskVersion: 1
cuj: 3
family: authoring
tags: [authoring, data-source, sql]
budget:
  maxTurns: 40
  maxWallClockSeconds: 1500
tiers:
  T0: repo as-is (AGENTS.md, docs/, source, existing examples)
workspace:
  fixtures:
    - from: fixtures/earthquakes.csv
      to: noodles-editor/src/examples/quake-hexbins/data.csv
grader:
  rubric: authoring.yaml
  artifact: noodles-editor/src/examples/quake-hexbins/noodles.json
  mechanical:
    validateProject: noodles-editor/src/examples/quake-hexbins/noodles.json
    custom: sql-h3-pipeline
    requiredNodeTypes: [DuckDbOp, H3HexagonLayerOp, MaplibreBasemapOp, DeckRendererOp]
---

# sql-h3-pipeline

Author a SQL → H3 aggregation pipeline. Graded on graph coherence, not on the
data actually flowing (see the environment note below).

## Prompt (verbatim)

> I've put a CSV of California earthquake points at
> `noodles-editor/src/examples/quake-hexbins/data.csv`. Create a Noodles
> project at `noodles-editor/src/examples/quake-hexbins/noodles.json` that
> uses SQL to aggregate the points into H3 hexagons, colored by how many
> points fall in each hexagon, shown over a basemap. I should be able to open
> it at `/examples/quake-hexbins`.

## Mechanical checks (Layer 1, frozen at run time)

1. Interim `validateProject()` passes.
2. Required node types: `DuckDbOp`, `H3HexagonLayerOp`, `MaplibreBasemapOp`,
   `DeckRendererOp`.
3. Custom (`sql-h3-pipeline`): the DuckDbOp query performs an H3 aggregation
   (`h3_*` function + `GROUP BY`); an edge path exists from the DuckDbOp to
   the hex layer; `getHexagon` is fed from the SQL output; fill color is
   driven by the count.

**No load/render check.** Two environment/app facts make rendering
unachievable headlessly at T0, verified before any session ran: the DuckDB
`h3` functions are a community extension the app never preloads (a correct
query needs `INSTALL h3 FROM community`, fetched from
community-extensions.duckdb.org — egress-blocked in the eval container), and
DuckDbOp has no table-registration path for project data files (`h3-js` isn't
a CodeOp global either). A pipeline that is *correct as a graph* is the most
this task can mechanically require today; if a later sub-plan or app change
makes the data path executable, that lands as a task-version bump.

## Notes

- This is deliberately the hardest authoring task at T0 — the app gives an
  agent almost nothing to verify H3 SQL against.
