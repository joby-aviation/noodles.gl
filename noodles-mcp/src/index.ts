import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export { createServer, INSTRUCTIONS } from './server.ts'

const USAGE = `Usage: noodles-mcp [--local <repo-root>]

An MCP server (stdio) with Noodles.gl operator schemas, docs, examples and
project validation, read from a noodles.gl checkout.

  --local <repo-root>  The checkout to read. Defaults to the one this
                       package is in.`

export const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type Args = { repoRoot: string } | { help: string } | { error: string }

export function parseArgs(argv: string[], cwd: string): Args {
  let repoRoot = DEFAULT_REPO_ROOT
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: USAGE }
    if (arg === '--local') {
      const value = argv[++i]
      if (!value || value.startsWith('-')) return { error: `--local needs a path.\n\n${USAGE}` }
      repoRoot = resolve(cwd, value)
    } else {
      return { error: `Unknown argument ${arg}.\n\n${USAGE}` }
    }
  }
  try {
    statSync(join(repoRoot, 'noodles-validate/registry.json'))
  } catch {
    return {
      error: `${repoRoot} is not a noodles.gl checkout: noodles-validate/registry.json is missing.`,
    }
  }
  return { repoRoot }
}
