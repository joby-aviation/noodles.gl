#!/usr/bin/env node
// Pre-commit hooks installed before validate-projects existed call this file
// directly, so it stays as a shim. Reinstall the hook with scripts/setup-hooks.sh,
// which runs npm run validate:examples instead.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'noodles-validate/bin/validate-projects.ts'),
    path.join(root, 'noodles-editor/src/examples'),
  ],
  { stdio: 'inherit' }
)
process.exit(result.status ?? 1)
