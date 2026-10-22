# Scripts

This directory contains utility scripts for the Noodles.gl project.

## Available Scripts

### validate:examples

`npm run validate:examples` runs [`validate-projects`](../noodles-validate/README.md) over `noodles-editor/src/examples`. It checks each project against the operator registry: schema version, operator types, input names, edge endpoints and handles, duplicate edges, and generic node names (e.g. `duckdb-0`, `accessor-1`, now a warning).

Run manually:
```bash
npm run validate:examples
```

### setup-hooks.sh

Installs git pre-commit hooks that automatically validate example projects before commits.

Run once to set up:
```bash
./scripts/setup-hooks.sh
```

The pre-commit hook will:
- Run validation when example `noodles.json` files are modified
- Prevent commits with invalid examples
- Can be bypassed with `git commit --no-verify` if needed

### Other Scripts

These live in `noodles-editor/scripts/`:

- `generate-migration.ts` - Generate migration scripts for project schema updates
- `migrate-project-files.ts` - Apply migrations to project files
