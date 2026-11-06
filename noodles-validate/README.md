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

With no paths it checks `noodles-editor/src/examples`. A directory is searched for `noodles.json` files and other `.json` files shaped like a project.

```
noodles-editor/src/examples/quakes/noodles.json
  error   nodes[0]  /earthquakes: Unknown operator type File. Did you mean: FileOp? Types end in "Op", e.g. FileOp, ScatterplotLayerOp. [unknown-operator]
  error   edges[1]  Edge /deck.out.vis->/out.in.vis: targetHandle in.vis is malformed: inputs are "par.<name>". Did you mean: par.vis. [edge-handle]

FAIL: 2 errors in 1 of 1 file. Fix the errors and run validate-projects again.
```

`--json` prints `{valid, registry, files: [{file, valid, errors, warnings, profile, partial?}]}` instead.

The same check is the `validate_project` tool in [noodles-mcp](../noodles-mcp/README.md), which Claude Code sessions in this repo have through `.mcp.json`.

Exit status: `0` when every file is valid (warnings allowed), `1` when any file has errors, `2` for bad arguments or when no project files are found. With `--strict`, warnings also exit `1`.

## Projects outside the examples

Each file is checked with one of two profiles, picked from where it is:

- **examples**, for files under `noodles-editor/src/examples`. They ship with the editor and `npm run migrate-projects` keeps them current, so an older `version` is an error, and node names are style-checked (`generic-node-name`).
- **external**, for every other file, such as `projects/<name>/noodles.json` in another repo. The editor migrates a project when it opens one, so an older `version` is a warning that says to open and save it. The operator, input and edge checks follow the current schema, which a migration rewrites nodes and edges to reach, so on an older file they are skipped rather than reported as errors the migration would fix; the summary says how many files were checked only in part. Every `@/` file reference must name a file in the project's `data/` folder (`missing-asset`), and node names aren't style-checked.

`--external` or `--examples` checks every file with one profile instead, e.g. `--examples` for a project laid out like a bundled example, with its files next to `noodles.json`.

```bash
npm run validate:projects -- ~/code/visualization/projects
npm run validate:projects -- --strict "../visualization/projects/Dubai Hero Route"
```

`@/` follows the editor's `readAsset`: `@/flights.csv` and `@/data/flights.csv` both name `<project>/data/flights.csv`, and `@/routes/q1.json` names `<project>/data/routes/q1.json`. Only a node input whose whole value starts with `@/` is a reference. Names must match in case, as they do in git and on Linux, even on macOS, which would find `Flights.csv` for `flights.csv`.

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
    git diff -z --name-only --diff-filter=d "origin/$GITHUB_BASE_REF..." -- projects \
      | while IFS= read -r -d '' file; do
          dir=$(echo "$file" | cut -d/ -f1-2)
          [ -f "$dir/noodles.json" ] && printf '%s\0' "$dir"
        done \
      | sort -zu \
      | xargs -0 -r node noodles.gl/noodles-validate/bin/validate-projects.ts
```

It needs no `npm install`. Passing the project folder, not just `noodles.json`, catches a change to its data files too, and the NUL-separated names keep folders with spaces whole. Add `--strict` to also fail on projects that haven't been migrated.

## What it checks

| Rule | Severity | Fires when |
|---|---|---|
| `invalid-json` | error | The file doesn't parse |
| `project-shape` | error | `version`, `nodes` or `edges` is missing or the wrong type, or a node has no `type` |
| `version` | error | `version` isn't the current schema version. Older files need a migration, not a new number. In the external profile an older version is a warning |
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
| `generic-node-name` | warning | A node id ends in `-<number>`, like `/file-1`. Examples profile only |
| `missing-asset` | error | An `@/` reference doesn't name a file in the project's `data/` folder. External profile only |

Saved `ReferenceEdge`s are skipped: the editor drops them on load and re-derives them from `op()` references.

It does not run the project or open remote URLs. It doesn't check timeline tracks and keyframes, input values against their field types, or that nested node ids sit inside a container.

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

`validateProject` uses the examples profile unless it's given `{ profile: 'external' }`; it reads no files, so the `@/` check is in `validateFile(path, registry)`, which picks the profile from the path, and `checkAssets(project, projectDir)`.

`noodles-validate/fields` has the type, input and handle checks on their own, with no Node APIs, for the browser. The editor's `apply_modifications` uses them (`noodles-editor/src/ai-chat/modification-fields.ts`), so it reports the same errors as the CLI.

## Development

The package is TypeScript run by Node's built-in type stripping (Node 22.18 or later), so there is no build step. Imports use `.ts` extensions and only erasable syntax.

```bash
cd noodles-validate
npm test
npm run typecheck
npm run lint
```
