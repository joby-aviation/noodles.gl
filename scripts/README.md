# Scripts

This directory contains utility scripts for the Noodles.gl project.

## Available Scripts

### validate-examples.js

Validates all example project files to ensure:
- Valid JSON structure
- Required fields present (version, nodes, edges)
- All edge references point to existing nodes
- No generic node names (e.g., `duckdb-0`, `accessor-1`)

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

- `benchmark-export.ts` - Performance benchmarking for export functionality
- `generate-context.ts` - Generate AI context bundles for Claude integration
- `generate-migration.ts` - Generate migration scripts for project schema updates
- `migrate-project-files.ts` - Apply migrations to project files
- `parse-operators.ts` - Parse operator definitions for documentation
