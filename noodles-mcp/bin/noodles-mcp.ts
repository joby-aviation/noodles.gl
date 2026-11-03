#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { startBridge } from '../src/acp-bridge.ts'
import { createToolsServer, forwardFromEnv } from '../src/acp-tools.ts'
import { createServer, parseAcpArgs, parseArgs } from '../src/index.ts'

const [subcommand, ...rest] = process.argv.slice(2)

if (subcommand === 'acp') {
  const args = parseAcpArgs(rest, process.cwd(), process.env)
  if ('help' in args) {
    console.log(args.help)
  } else if ('error' in args) {
    console.error(args.error)
    process.exitCode = 2
  } else {
    const bridge = await startBridge({ ...args, log: line => console.error(line) })
    console.log(
      `Running ${[args.command, ...args.args].join(' ')} in ${args.cwd}\n\n` +
        'In Noodles, open Settings → AI Provider → ACP agent and paste:\n\n' +
        `  ${bridge.url}\n`
    )
    const stop = () => bridge.close().then(() => process.exit(0))
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  }
} else if (subcommand === 'acp-tools') {
  // stdout carries the protocol, so nothing else may write to it
  await createToolsServer(forwardFromEnv(process.env)).connect(new StdioServerTransport())
} else {
  const args = parseArgs(process.argv.slice(2), process.cwd())
  if ('help' in args) {
    console.log(args.help)
  } else if ('error' in args) {
    console.error(args.error)
    process.exitCode = 2
  } else {
    // stdout carries the protocol, so nothing else may write to it
    await createServer({ repoRoot: args.repoRoot, cwd: process.cwd() }).connect(
      new StdioServerTransport()
    )
  }
}
