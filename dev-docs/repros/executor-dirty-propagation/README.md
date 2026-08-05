# Repro: dirty island under a clean sink (executor dirty-propagation)

## Setup

Copy this directory into `noodles-editor/src/examples/repro-executor-dirty/`
and open `http://localhost:5173/examples/repro-executor-dirty`. Requires
PR #515's GraphInputOp fix to observe end-to-end (without it, data stops one
hop earlier — see `dev-docs/repros/graph-input-rebuild-orphan/` on that
branch).

## Graph

`/quake-data` (FileOp, async CSV, 200 rows) → `/box.par.in` → `/box/input`
(GraphInput) → `/box/child` (CodeOp filtering `Magnitude >= minMagnitude`,
promoted param = 4) → `/box/output` (GraphOutput) → `/box.out.out` → `/viewer`.

## Expected

The viewer shows the 12 rows with magnitude ≥ 4 shortly after load.

## Actual before this fix

Empty array forever, zero console errors. Trace of the failure (headless, with
`markDirty`/`pull` instrumentation):

```
pull /viewer dirty            <- first frame walks and executes the chain
GraphInput execute 0          <- CSV not resolved yet
markDirty /box/input          <- CSV resolves DURING the same frame's pull
markDirty /box                   (the FileOp is awaited by the same walk)
pull /viewer clean x847       <- every later frame; nothing re-executes
```

Two defects compose:

1. `markDirty` early-returned on already-DIRTY operators without propagating,
   assuming "dirty implies downstream already dirty" — async arrival
   interleaved with frame pulls breaks that invariant, stranding a dirty
   island beneath a clean, cached sink chain (`pull()` returns cache for CLEAN
   ops without recursing).
2. `_pullExecution` set CLEAN unconditionally on completion, clobbering DIRTY
   marks that arrived after the input snapshot (the CSV resolving mid-frame).

## After this fix

All six hops verified in-browser:
`container.in: 200 → GraphInput: 200 → child: 12 → GraphOutput: 12 →
container.out: 12 → viewer: 12 rows`.
