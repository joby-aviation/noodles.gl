# Repro: container in/out idiom drops async data (PR #515 + executor follow-up)

## Setup

Copy this directory into `noodles-editor/src/examples/repro-container-io/` and
open `http://localhost:5173/examples/repro-container-io`.

## Graph (the sanctioned container shape)

`/quake-data` (FileOp, async CSV) → `/box.par.in` → `/box/input` (GraphInput) →
`/box/child` (CodeOp filtering by the promoted `minMagnitude` param) →
`/box/output` (GraphOutput) → `/box.out.out` → `/viewer`.

## Expected

The viewer shows the filtered earthquake rows (magnitude ≥ 4) shortly after
load.

## Actual on `main`

The viewer shows an empty array forever, zero console errors. Two stacked
causes:

1. **PR #515** — `GraphInputOp.rebuildFromContainer` recreates the base
   `parentValue`/`value` field objects on any custom-field rebuild, orphaning
   the `container.par.in → parentValue` connection `transformGraph` wires. The
   CSV rows reach `/box.par.in` but never enter the container. Fixed by
   preserving the base field objects (regression test in the PR fails on
   `main`).
2. **Executor dirty-propagation (unfixed follow-up)** — with #515 applied,
   `parentValue` receives the rows but `GraphInputOp` still never re-executes.
   Traces show `markDirty` early-returning at the already-dirty ContainerOp
   without propagating further, while the sink chain above it was pulled clean
   in an earlier frame; `pull()` returns cache for clean ops without recursing,
   so the dirty island under the clean sink is never revisited. Note the
   node-level cycle `box → input → child → output → box`: a naive
   always-propagate change recurses forever (same failure as loading a project
   that serializes BOTH bridge edges — instant
   "Maximum call stack size exceeded").

## How this was traced

Headless probes with ViewerOps on every hop, then `console.info` tracing of
`markDirty` / `addDownstreamDependent` / `GraphInputOp.execute` — see
`dev-docs/specs/agent-ready-docs/journal/2026-07-06-eval-harness-phase0.md`
(round 4) on the eval-harness branch for the full trail.
