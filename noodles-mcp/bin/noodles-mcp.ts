#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer, parseArgs } from '../src/index.ts'

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
