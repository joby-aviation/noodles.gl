# Repro: container child `op()` reference goes stale (PR #514)

## Setup

Copy this directory into `noodles-editor/src/examples/repro-ref-edges/` and open
`http://localhost:5173/examples/repro-ref-edges`.

## Graph

- `/quake-data` — FileOp loading `data.csv` (200 earthquake rows, async)
- `/box` — collapsed container
- `/box/child` — CodeOp whose ONLY upstream link is `op('/quake-data').out.data`
  (no incoming edges)
- `/viewer` — root ViewerOp wired to the child's output so the value is
  observable without opening the container. (The child→root crossing edge is
  itself not a supported authoring pattern — it is used here purely as a probe.)

## Expected

The viewer shows `200` (the row count) shortly after load, and updates if the
CSV changes.

## Actual on `main`

The viewer shows `0` forever, with zero console errors. The child executed once
before the CSV arrived and is never re-executed: `op()` references only become
executor dependencies when the CodeField editor component mounts and syncs a
`ReferenceEdge` — and container children never mount while the container is
collapsed. Opening the container (mounting the editor) retroactively wires the
reference, which is why the bug hides during interactive authoring and only
bites on fresh loads.

## Fix

PR #514: `transformGraph` derives reference edges from `op()`/mustache text for
every node on each rebuild, mounted or not.
