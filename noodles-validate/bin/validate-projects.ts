#!/usr/bin/env node
import { run } from '../src/cli.ts'

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: text => console.log(text),
  stderr: text => console.error(text),
})
