# RFC: Mergeable TableEditor row deltas

Status: Draft for discussion

## Decision summary

A standalone `TableEditorOp` should continue to own and serialize its complete table in
`inputs.data`.

An unlocked, connected `TableEditorOp` should not save a second full table. It should save a
small, row-keyed change set containing inserts, deletes, and the cells changed by the user. On
each upstream update, the operator should deterministically apply that change set and identify
conflicts by comparing the original upstream value, the user's value, and the latest upstream
value.

There is no broadly adopted interchange standard for this exact feature. The recurring industry
pattern is stable row identity plus explicit add/update/remove operations and optimistic,
three-way conflict handling.

This proposal intentionally does not change lock behavior. Lock remains the snapshot/freeze
workflow for ignoring future upstream values. Deltas serve a different workflow: remaining live
while preserving local edits across upstream refreshes.

## Motivation

The Table Editor currently supports two clear ownership modes:

- With no incoming `data` edge, the table is local operator state and serializes in
  `inputs.data`.
- With an incoming `data` edge, the upstream operator owns `inputs.data`, so serialization omits
  that value.

The UI nevertheless permits edits while connected. Those edits only affect the current field
value and can be overwritten by the next upstream emission. Saving a complete hidden override
would preserve edits, but it would also freeze every untouched row and cell, defeating the reason
to keep the edge live.

The desired connected workflow is:

1. Load rows from a file, query, geocoder, or another operator.
2. Correct a few labels, offsets, categories, or rows in the Table Editor.
3. Continue receiving upstream additions and unrelated changes.
4. Preserve the user's edits unless upstream changed the same logical cell.
5. Surface genuine collisions instead of silently selecting one side.

## Prior Noodles intent

- TableEditor v2 (PR #423) introduced an Airtable-like typed, editable table over the operator's
  `data` input. Hiding the generic `data` row was a layout cleanup; the change also removed the
  React Flow handle, which was an unintended consequence.
- Viewer conversion (PR #480) deliberately preserved the Viewer node's connections, position,
  schema, and lock state. It assumed the Table Editor would remain connected after conversion.
- Locking issue #122 describes TouchDesigner-style snapshot semantics: locked operators preserve
  their current state and ignore new upstream values.

The delta model should complement those intentions rather than add a second full-table override.

## Related industry patterns

### Stable identity and row transactions

AG Grid represents table changes as `add`, `update`, and `remove` transactions. Its recommended
matching path uses an application-provided stable row ID; without one it must depend on object
identity and slower scans. This maps well to a Noodles table change set, but AG Grid's transaction
format alone does not solve upstream-versus-local conflicts.

PostgreSQL `ON CONFLICT` and SQL `MERGE` similarly require a key or unique constraint to decide
whether a proposed row identifies an existing row. The transferable principle is that identity
must be explicit before an update can be safely replayed.

Kubernetes models mergeable arrays as list-maps whose entries have one or more scalar key fields.
It can then track individual fields granularly instead of treating the entire array as one atomic
value. This is a useful precedent for composite keys and cell-level ownership.

### Three-way optimistic reconciliation

Entity Framework's optimistic concurrency guidance exposes three value sets when resolving a
conflict: original values, locally proposed values, and current database values. Comparing those
three values distinguishes an upstream change from an unchanged base and permits unrelated fields
to merge automatically.

Kubernetes Server-Side Apply follows a related field-ownership model: a conflicting write is
surfaced rather than silently overwriting another manager's differing value, and the user can
either force the local value or relinquish it.

### Change records

Delta Lake's Change Data Feed records row-level `insert`, `delete`, `update_preimage`, and
`update_postimage` events. Noodles does not need an append-only event log, but retaining a base-row
snapshot and the desired values for edited rows provides the same information needed to reconcile
later upstream versions or recover when upstream deletes a locally edited row.

### Why not JSON Patch or JSON Merge Patch?

JSON Patch (RFC 6902) is useful operation vocabulary, but array paths use numeric positions.
Sorting, filtering, insertion, or a refreshed query can move a logical row to another index and
cause a saved patch to edit the wrong row.

JSON Merge Patch (RFC 7396) treats arrays atomically, so changing one cell requires replacing the
whole table. It also assigns deletion meaning to `null`, which is a valid table cell value.

Noodles should therefore use a small domain-specific, keyed change set rather than claim
compatibility with either JSON patch format.

## Proposed data model

The exact field names remain open for review. A representative serialized model is:

```ts
type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }

type RowKey = JsonScalar[]

interface CellChange {
  column: string
  value: JsonValue
}

interface RowUpdate {
  key: RowKey
  base: Record<string, JsonValue>
  cells: CellChange[]
}

interface RowDelete {
  key: RowKey
  base: Record<string, JsonValue>
}

interface RowInsert {
  localId: string
  value: Record<string, JsonValue>
}

interface TableChangeSetV1 {
  version: 1
  keyColumns: string[]
  updates: RowUpdate[]
  deletes: RowDelete[]
  inserts: RowInsert[]
}
```

Recommended operator representation:

- Keep `data` as the upstream-or-local `DataField`.
- Keep `schema` as the typed table schema.
- Store `keyColumns` in schema metadata or a dedicated local input.
- Store the change set in a local, normally hidden input so `execute()` remains pure and the
  existing serializer and undo system can persist it normally.
- Compute `out.data` from `data + changes`; do not mutate either input during execution.

This is not a `dataOverride`: only user-owned differences are stored.

All rows and changes must first pass through one canonical editable/storage representation. In
particular, a chained Table Editor can receive runtime values such as `Temporal` objects while the
project file stores date-time strings. Schema validation and normalization happen before keys or
diffs are computed. Captured base rows are deep-cloned so later upstream mutation cannot alter the
comparison baseline, and comparisons use Noodles deep equality rather than JavaScript reference
equality.

## Row identity

Connected editing requires one or more key columns selected by the user.

Requirements:

- Keys must be present and unique in the current upstream rows.
- Composite keys are supported.
- Key components retain their JSON types, so numeric `1` differs from string `"1"`.
- Row index is never used as persistent identity.
- Key cells are initially read-only while connected. Changing identity is modeled as deleting the
  old row and inserting a new row.
- Missing or duplicate keys stop delta application and show an actionable table error.

The UI may suggest likely columns such as `id`, but should not silently choose a potentially
unstable key. A future data-source schema could provide key metadata automatically.

## Reconciliation algorithm

Index the latest upstream rows by the configured key, then apply changes in upstream order. Local
inserts are appended in version one.

For an edited cell with its value from the stored base row, local `value`, and latest `upstream`:

| Condition | Merged value | State |
| --- | --- | --- |
| `deepEqual(upstream, base)` | local value | clean local edit |
| `deepEqual(upstream, value)` | that shared value | converged edit |
| `upstream` differs from both | local value | conflict |

Unedited cells always take the latest upstream value. Thus an upstream update to a different
column merges automatically.

If upstream deletes a locally edited row, reconstruct the row from its stored base plus local cell
changes, keep it in the merged output, and mark the whole row conflicted. Choosing **Keep my edit**
converts it to a local insertion; choosing **Use upstream** drops the row update.

For deletes:

- If the upstream row still matches the stored base row, omit it from the merged output.
- If upstream already removed it, treat the deletion as converged.
- If upstream changed it, keep the local deletion for output but surface a conflict.

For inserts:

- If no upstream row has the key, append the local row.
- If an identical upstream row appears, treat the insertion as converged.
- If a different upstream row has the same key, surface a conflict.

Conflict output remains local-wins initially so an existing visualization does not jump when a
source refreshes. The Table Editor must visibly mark every conflict and offer:

- Keep my edit
- Use upstream
- Edit a resolved value

Conflict state is derived from upstream plus the change set and does not need separate
serialization.

Resolution updates the change set rather than merely dismissing the warning:

- **Keep my edit** rebases the stored base to the latest upstream row and retains the local value;
  for an upstream-deleted edited row, it converts the recovered row to an insertion.
- **Use upstream** removes the affected local cell change, row deletion, or insertion.
- **Edit a resolved value** uses the latest upstream row as its new base and stores the newly
  chosen value.

Converged changes remain as explicit local intent until the user clears or accepts them. Removing
them automatically would allow a later upstream regression to undo the user's choice.

## Editing behavior

### Standalone

With no incoming `par.data` edge, edits continue to update `inputs.data` directly. No key or
change set is required. Project files remain compatible with today's format.

Viewer conversion follows the same ownership rule: converting a truly disconnected Viewer must
copy its current rows into the new Table Editor's `inputs.data`; converting a connected Viewer
preserves the edge and does not duplicate the upstream table. The visible-handle fix makes the
second case honest in the UI, but the first invariant still requires a converter regression fix.

### Connected and unlocked

With an incoming edge and configured keys, cell edits update `changes`, not the connected
`inputs.data` value. The table displays and outputs the reconciled result.

Each gesture remains one undo transaction. Reverting a cell to its current base removes that cell
change. Empty row updates are removed.

### Connected and locked

Lock remains the existing snapshot/freeze mechanism. It should not be redefined as a mergeable
change set. The lock UX and its proposed unlock warning can evolve independently under issue #122.

### Disconnecting

Deleting the incoming edge must atomically:

1. Materialize the current reconciled output into `inputs.data`.
2. Clear the applied change set.
3. Preserve schema and row-key metadata.
4. Record edge deletion and materialization as one undo transaction.

This differs from generic connection removal because the raw connected input does not contain the
locally reconciled cells.

Today, edge history and operator-property history are separate and connection removal can enter
through the canvas, Properties Panel, AI/programmatic graph changes, node deletion, and undo/redo.
Delta materialization therefore requires a unified graph-and-operator transaction or a canonical
edge lifecycle hook before it can ship. Implementing it only in the Table Editor component would
miss valid removal paths and split one conceptual action across undo entries.

### Connecting a standalone table

Connecting upstream data to a non-empty standalone table is ambiguous. Prompt for one of:

- Replace local rows with upstream rows.
- Convert the differences to a change set after choosing keys.
- Cancel the connection.

Do not silently discard or reinterpret local rows.

## Schema changes and other edge cases

- A removed or renamed edited column becomes an orphaned change requiring resolution; never drop
  it silently.
- Upstream deletion of a locally edited row is a conflict.
- Upstream modification of a locally deleted row is a conflict.
- A changed key value appears as deletion of the old identity and insertion of the new identity.
- Invalid or duplicate keys disable connected editing until corrected.
- Preserve upstream row ordering. Persistent reorder deltas are deferred.
- Keep full base rows for deletes and edited rows. The latter is required to reconstruct a locally
  edited row if upstream deletes it.
- Nested cell values use the field system's serialized representation and deep equality.
- Large tables should reconcile in `O(rows + changed cells)` time using a key index.
- Timeline/keyframe semantics for individual cells are out of scope for the first version.

## Why not a CRDT?

The initial problem has two inputs: one latest upstream snapshot and one local editor. It does not
require peer-to-peer, offline, multi-user convergence. A CRDT would introduce stable element IDs,
tombstones, ordering rules, and metadata without removing the need for domain-specific row keys.
A deterministic keyed three-way merge is smaller and easier to explain.

## Proposed delivery phases

1. Fix disconnected Viewer conversion so local rows survive conversion into `inputs.data`.
2. Add a pure `reconcileTableChanges(upstream, changes)` utility with normalization and exhaustive
   update, insert, delete, key-validation, and conflict tests.
3. Add key selection and cell-update deltas for connected tables.
4. Add insertion, deletion, and conflict-resolution UI.
5. Add a unified edge lifecycle transaction, atomic disconnect materialization, and the reconnect
   prompt.
6. Add performance fixtures and project migration/default coverage before enabling the feature by
   default.

The current visible-handle fix should land independently so users can accurately see and remove
connections without waiting for this design.

## Open questions

1. Should key metadata live inside `TableSchema` or as a separate TableEditor input?
2. Should inserts require the user to populate key columns before leaving the row editor?
3. Do source operators such as DuckDB and File need a standard way to advertise primary keys?
4. How should schema renames remap existing change-set column names?

## References

- [AG Grid transaction updates](https://www.ag-grid.com/react-data-grid/data-update-transactions/)
- [Entity Framework Core concurrency resolution](https://learn.microsoft.com/en-us/ef/core/saving/concurrency)
- [Kubernetes Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
- [Kubernetes list-map schema semantics](https://kubernetes.io/docs/reference/kubernetes-api/apiextensions/custom-resource-definition-v1/)
- [Delta Lake Change Data Feed](https://docs.delta.io/delta-change-data-feed/)
- [PostgreSQL `INSERT ... ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html)
- [JSON Patch, RFC 6902](https://www.rfc-editor.org/rfc/rfc6902.html)
- [JSON Merge Patch, RFC 7396](https://www.rfc-editor.org/rfc/rfc7396.html)
- [Noodles issue #122: locking behavior updates](https://github.com/joby-aviation/noodles.gl/issues/122)
- [Noodles PR #423: TableEditorOp v2](https://github.com/joby-aviation/noodles.gl/pull/423)
- [Noodles PR #480: Viewer-to-TableEditor conversion](https://github.com/joby-aviation/noodles.gl/pull/480)
