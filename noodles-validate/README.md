# noodles-validate

Checks Noodles.gl project files (`noodles.json` documents) against the operator registry, in plain Node, with no browser or build step. Use it after writing or editing a project file: when it prints `OK`, the file is done.

From the repo root, after `npm install`:

```bash
npm run validate:projects -- path/to/noodles.json
```

From anywhere else, run the file directly; paths are relative to where you run it:

```bash
node /path/to/noodles.gl/noodles-validate/bin/validate-projects.ts path/to/noodles.json
```

Don't run it as a bare `npx validate-projects`: the name isn't published on npm, so in a checkout without `node_modules` (a fresh clone, or a git worktree) npx would download and run whatever package someone publishes under it.

With no paths it checks `noodles-editor/src/examples`. A directory is searched for `noodles.json` files and other `.json` files shaped like a project.

```
noodles-editor/src/examples/quakes/noodles.json
  error   nodes[0]  n1: Unknown operator File. Did you mean: file? [unknown-operator]
  error   edges[1]  Edge e2: targetPort par.layers is an old handle; write layers. [edge-port]

FAIL: 2 errors in 1 of 1 file. Fix the errors and run validate-projects again.
```

`--json` prints `{valid, registry, files: [{file, valid, errors, warnings}]}` instead.

The same check is the `validate_project` tool in [noodles-mcp](../noodles-mcp/README.md), which Claude Code sessions in this repo have through `.mcp.json`.

Exit status: `0` when every file is valid (warnings allowed), `1` when any file has errors, `2` for bad arguments or when no project files are found.

## What it checks

| Rule | Severity | Fires when |
|---|---|---|
| `invalid-json` | error | The file doesn't parse |
| `project-shape` | error | `version`, `name`, `nodes` or `edges` is missing or the wrong type, or a node has no `op`, `x` or `y` |
| `version` | error | `version` is neither 1 (a document) nor an operator-graph schema the editor converts |
| `operator-graph` | warning | The file is an operator-graph file (schema 1 to 19, nodes with `type` and edges with handles). The editor converts it when it opens; nothing else is checked |
| `node-id` | error | A node id is missing or empty |
| `duplicate-node-id` | error | Two nodes share an id |
| `unknown-operator` | error | A node's `op` isn't a registered operator. An operator class from an older file (`ScatterplotLayerOp`) gets the operator it is now |
| `unknown-parent` | error | A node's `parent` isn't a `subnet` node |
| `duplicate-name` | error | Two nodes in one network share a `name` |
| `unknown-param` | error | `params` names a parameter the operator (or a subnet's promoted parameters) doesn't have |
| `param-value` | error | An `{expr}` or `{ref}` object holds anything else, or a menu value isn't one of its choices |
| `unknown-reference` | error | A `{ref}` or a `ch()` call in an expression or query names a node or parameter that isn't there |
| `edge-shape` | error | An edge is missing `id`, `source`, `sourcePort`, `target` or `targetPort` |
| `edge-unknown-node` | error | An edge's `source` or `target` isn't a node id (it says so when it is a node's name) |
| `edge-port` | error | `sourcePort` isn't an output, or `targetPort` isn't an input or `par:<parameter>` |
| `edge-type` | error | The output's type can't feed the input: a table into a deck's layers, a table into `par:` |
| `edge-network` | error | An edge joins nodes in different networks |
| `duplicate-edge` | error | Two edges make the same connection |
| `duplicate-edge-id` | error | Two edges share an id |
| `multiple-inputs` | error | More than one edge goes into a port that isn't multi-input (a deck's `layers` is) |
| `cycle` | error | Edges form a loop |
| `timeline-target` | warning | A track's target isn't `<node id>.<param>` for a node and parameter that exist |
| `generic-node-name` | warning | A node is named after its operator and a number, as the editor names new nodes (`scatter1`) |

It does not run the project. It doesn't check expressions beyond their `ch()` references, SQL, column names, or that a parameter's literal has the right type.

## The registry

`registry.json` is a snapshot of every operator's ports and parameters, taken from the editor's catalog (the planner operators plus the host operators, which can't load in plain Node), and the operator classes older files used with what they convert to. `npm test` in `noodles-editor/` fails when the snapshot is out of date. After changing an operator, regenerate it:

```bash
cd noodles-editor && npm run generate:registry
```

## From code

```ts
import { loadRegistry, validateProject } from 'noodles-validate'

const { valid, errors, warnings } = validateProject(JSON.parse(text), loadRegistry())
```

`noodles-validate/fields` has the operator, parameter and port checks on their own, with no Node APIs, for the browser.

## Development

The package is TypeScript run by Node's built-in type stripping (Node 22.18 or later), so there is no build step. Imports use `.ts` extensions and only erasable syntax.

```bash
cd noodles-validate
npm test
npm run typecheck
npm run lint
```
