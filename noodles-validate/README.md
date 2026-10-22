# noodles-validate

Checks Noodles.gl project files (`noodles.json`) against the operator registry, in plain Node, with no browser or build step. Use it after writing or editing a project file: when it prints `OK`, the file is done.

From the repo root, after `npm install`:

```bash
npm run validate:projects -- path/to/noodles.json
```

From anywhere else, run the file directly; paths are relative to where you run it:

```bash
node /path/to/noodles.gl/noodles-validate/bin/validate-projects.ts path/to/noodles.json
```

Don't run it as a bare `npx validate-projects`: the name isn't published on npm, so in a checkout without `node_modules` (a fresh clone, or a git worktree) npx would download and run whatever package someone publishes under it.

With no paths it checks `noodles-editor/src/examples` and `noodles-editor/public/noodles`. A directory is searched for `noodles.json` files and other `.json` files shaped like a project.

```
noodles-editor/src/examples/quakes/noodles.json
  error   nodes[0]  /earthquakes: Unknown operator type File. Did you mean: FileOp? Types end in "Op", e.g. FileOp, ScatterplotLayerOp. [unknown-operator]
  error   edges[1]  Edge /deck.out.vis->/out.in.vis: targetHandle in.vis is malformed: inputs are "par.<name>". Did you mean: par.vis. [edge-handle]

FAIL: 2 errors in 1 of 1 file. Fix the errors and run validate-projects again.
```

`--json` prints `{valid, registry, files: [{file, valid, errors, warnings}]}` instead.

Exit status: `0` when every file is valid (warnings allowed), `1` when any file has errors, `2` for bad arguments or when no project files are found.

## What it checks

| Rule | Severity | Fires when |
|---|---|---|
| `invalid-json` | error | The file doesn't parse |
| `project-shape` | error | `version`, `nodes` or `edges` is missing or the wrong type, or a node has no `type` |
| `version` | error | `version` isn't the current schema version. Older files need a migration, not a new number |
| `node-id` | error | A node id isn't an absolute path like `/earthquake-data` |
| `duplicate-node-id` | error | Two nodes share an id |
| `unknown-operator` | error | A node's `type` isn't a registered operator (`group` nodes are allowed) |
| `unknown-input` | error | `data.inputs` names an input the operator doesn't have and `data.customInputs` doesn't declare (a GraphInputOp also has its container's custom inputs) |
| `custom-input` | error | A `data.customInputs` entry has no name, or a type the editor can't load (`number`, `string`, `color` and the rest of `customFieldTypes` in `registry.json`) |
| `edge-shape` | error | An edge is missing `id`, `source`, `sourceHandle`, `target` or `targetHandle` |
| `edge-unknown-node` | error | An edge's `source` or `target` isn't a node |
| `edge-handle` | error | A handle isn't `out.<field>` on the source and `par.<field>` on the target, or names a field the operator doesn't have. Container boundary edges (`/c.par.in` to its GraphInputOp, its GraphOutputOp to `/c.out.out`) are allowed |
| `duplicate-edge` | error | Two edges make the same connection |
| `duplicate-edge-id` | error | Two different connections share an id |
| `multiple-inputs` | error | More than one edge goes into an input that isn't a list |
| `stale-edge-id` | warning | An id in the `source.sourceHandle->target.targetHandle` form names other endpoints. Legacy ids in other forms are left alone, as migrations leave them |
| `generic-node-name` | warning | A node id ends in `-<number>`, like `/file-1` |

Saved `ReferenceEdge`s are skipped: the editor drops them on load and re-derives them from `op()` references.

It does not run the project. It doesn't check timeline tracks and keyframes, input values against their field types, or that nested node ids sit inside a container.

## The registry

`registry.json` is a snapshot of every operator's inputs and outputs and the current schema version, taken from the editor's operator classes. They can't load in plain Node, so the CLI reads the snapshot. `npm test` in `noodles-editor/` fails when the snapshot is out of date. After changing an operator, a field or a migration, regenerate it:

```bash
cd noodles-editor && npm run generate:registry
```

## From code

```ts
import { loadRegistry, validateProject } from 'noodles-validate'

const { valid, errors, warnings } = validateProject(JSON.parse(text), loadRegistry())
```

## Development

The package is TypeScript run by Node's built-in type stripping (Node 22.18 or later), so there is no build step. Imports use `.ts` extensions and only erasable syntax.

```bash
cd noodles-validate
npm test
npm run typecheck
npm run lint
```
