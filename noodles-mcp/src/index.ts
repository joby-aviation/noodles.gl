import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_ORIGINS, DEFAULT_PORT } from './acp-bridge.ts'

export { startBridge } from './acp-bridge.ts'
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

const ACP_USAGE = `Usage: noodles-mcp acp [options] -- <agent command> [args...]

Connects the Noodles.gl chat panel to an ACP agent (agentclientprotocol.com).
Starts the agent, gives it the editor's tools, and prints the URL to paste
into Settings → AI Provider → ACP agent.

  --port <n>            Port on 127.0.0.1. Default ${DEFAULT_PORT}.
  --cwd <dir>           The agent's working directory. Default: this one.
  --allow-origin <url>  Another origin the editor is served from. Repeatable.
                        Always allowed: ${DEFAULT_ORIGINS.join(', ')}.
  --token <token>       Use this token instead of a random one, so a saved URL
                        keeps working. Also read from NOODLES_ACP_TOKEN.

Examples:
  noodles-mcp acp -- npx -y @agentclientprotocol/claude-agent-acp
  noodles-mcp acp -- npx -y @agentclientprotocol/codex-acp`

const ACP_FLAGS = ['--port', '--cwd', '--allow-origin', '--token']

export type AcpArgs =
  | {
      command: string
      args: string[]
      cwd: string
      port: number
      origins: string[]
      token?: string
    }
  | { help: string }
  | { error: string }

export function parseAcpArgs(argv: string[], cwd: string, env: NodeJS.ProcessEnv): AcpArgs {
  let port = DEFAULT_PORT
  let agentCwd = cwd
  let token = env.NOODLES_ACP_TOKEN || undefined
  const origins = [...DEFAULT_ORIGINS]

  let i = 0
  const value = (flag: string): string | { error: string } => {
    const next = argv[++i]
    return next && !next.startsWith('-')
      ? next
      : { error: `${flag} needs a value.\n\n${ACP_USAGE}` }
  }

  for (; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      i++
      break
    }
    if (arg === '--help' || arg === '-h') return { help: ACP_USAGE }
    if (!arg.startsWith('-')) break
    if (!ACP_FLAGS.includes(arg)) return { error: `Unknown option ${arg}.\n\n${ACP_USAGE}` }

    const given = value(arg)
    if (typeof given !== 'string') return given
    if (arg === '--port') {
      port = Number(given)
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return { error: `--port needs a port number, not ${given}.` }
      }
    } else if (arg === '--cwd') {
      agentCwd = resolve(cwd, given)
    } else if (arg === '--allow-origin') {
      // Normalized the way a browser sends it: scheme, host and port only
      try {
        origins.push(new URL(given).origin)
      } catch {
        return { error: `--allow-origin needs a URL like https://example.com, not ${given}.` }
      }
    } else {
      token = given
    }
  }

  const [command, ...args] = argv.slice(i)
  if (!command) return { error: `Name the agent to run after --.\n\n${ACP_USAGE}` }
  return { command, args, cwd: agentCwd, port, origins, token }
}
