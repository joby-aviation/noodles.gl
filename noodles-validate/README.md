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

`--json` prints `{valid, registry, files: [{file, valid, errors, warnings, profile, partial?}]}` instead.

The same check is the `validate_project` tool in [noodles-mcp](../noodles-mcp/README.md), which Claude Code sessions in this repo have through `.mcp.json`.

Exit status: `0` when every file is valid (warnings allowed), `1` when any file has errors, `2` for bad arguments or when no project files are found. With `--strict`, warnings also exit `1`.

## Projects outside the examples

Each file is checked with one of two profiles, picked from where it is:

- **examples**, for files under `noodles-editor/src/examples`. They ship with the editor as documents, so an operator-graph file there is an error, and node names are style-checked (`generic-node-name`).
- **external**, for every other file, such as `projects/<name>/noodles.json` in another repo. The editor converts an operator-graph file when it opens it, so one is a warning that says to open and save it, and the document checks are skipped rather than reported as errors the conversion would fix; the summary says how many files were checked only in part. Every `@/` file reference must name a file in the project's `data/` folder (`missing-asset`), and node names aren't style-checked.

`--external` or `--examples` checks every file with one profile instead, e.g. `--examples` for a project laid out like a bundled example, with its files next to `noodles.json`.

```bash
npm run validate:projects -- ../my-maps/projects
npm run validate:projects -- --strict "../my-maps/projects/Harbor Tour"
```

`@/` follows the editor's `readAsset`: `@/flights.csv` and `@/data/flights.csv` both name `<project>/data/flights.csv`, and `@/routes/q1.json` names `<project>/data/routes/q1.json`. Only a parameter that takes a file (the registry's `url` kind, such as a file node's `url`, a map style or an icon atlas) whose whole value starts with `@/` is a reference; in a text or code parameter, `@/…` is just text. In an operator-graph file, the inputs checked are the ones that become such a parameter. Names must match in case, as they do in git and on Linux, even on macOS, which would find `Flights.csv` for `flights.csv`.

### In another repo's CI

For a repo with one project per `projects/<name>/` folder, a pull request workflow can check out noodles.gl beside it and validate the projects the pull request touched:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: actions/checkout@v4
  with: { repository: joby-aviation/noodles.gl, path: noodles.gl }
- uses: actions/setup-node@v4
  with: { node-version-file: noodles.gl/.nvmrc }
- name: Validate changed projects
  run: |
    git diff -z --name-only "origin/$GITHUB_BASE_REF..." -- projects \
      | while IFS= read -r -d '' file; do
          dir=$(echo "$file" | cut -d/ -f1-2)
          [ -f "$dir/noodles.json" ] && printf '%s\0' "$dir"
        done \
      | sort -zu \
      | xargs -0 -r node noodles.gl/noodles-validate/bin/validate-projects.ts
```

It needs no `npm install`. Passing the project folder, not just `noodles.json`, catches a change to its data files too, including a deleted one (a project deleted whole has no `noodles.json` left and is skipped), and the NUL-separated names keep folders with spaces whole. Add `--strict` to also fail on projects not yet saved as documents.

## What it checks

| Rule | Severity | Fires when |
|---|---|---|
| `invalid-json` | error | The file doesn't parse |
| `project-shape` | error | `version`, `name`, `nodes` or `edges` is missing or the wrong type, or a node has no `op`, `x` or `y` |
| `version` | error | `version` is neither 1 (a document) nor an operator-graph schema the editor converts |
| `operator-graph` | error | The file is an operator-graph file (schema 1 to 23, nodes with `type` and edges with handles). The editor converts it when it opens; nothing else is checked. A warning in the external profile |
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
| `generic-node-name` | warning | A node is named after its operator and a number, as the editor names new nodes (`scatter1`). Examples profile only |
| `missing-asset` | error | An `@/` reference doesn't name a file in the project's `data/` folder. External profile only |

It does not run the project or open remote URLs. It doesn't check expressions beyond their `ch()` references, SQL, column names, or that a parameter's literal has the right type.

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

`validateProject` uses the examples profile unless it's given `{ profile: 'external' }`; it reads no files, so the `@/` check is in `validateFile(path, registry)`, which picks the profile from the path, and `checkAssets(project, projectDir, registry)`.

`noodles-validate/fields` has the operator, parameter and port checks on their own, with no Node APIs, for the browser.

## Development

The package is TypeScript run by Node's built-in type stripping (Node 22.18 or later), so there is no build step. Imports use `.ts` extensions and only erasable syntax.

```bash
cd noodles-validate
npm test
npm run typecheck
npm run lint
```
