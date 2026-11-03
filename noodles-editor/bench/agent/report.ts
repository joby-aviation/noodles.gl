#!/usr/bin/env tsx

// Prints a benchmark summary as Markdown, or compares two.
//
//   npm run bench:agent:report -- results/<runId>.summary.json
//   npm run bench:agent:report -- --compare results/<before>.summary.json results/<after>.summary.json
//
// Several summaries without --compare are merged into one table, which is how
// runs from different machines or providers end up side by side.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { compare, renderComparison, renderMarkdown, type Summary } from './summary'

const { values, positionals } = parseArgs({
  options: { compare: { type: 'boolean', default: false } },
  allowPositionals: true,
})

const load = (path: string) => JSON.parse(readFileSync(resolve(path), 'utf8')) as Summary

if (positionals.length === 0) {
  console.error('Pass one or more summary files')
  process.exit(1)
}

if (values.compare) {
  if (positionals.length !== 2) {
    console.error('--compare takes exactly two summary files: before and after')
    process.exit(1)
  }
  const [before, after] = positionals.map(load)
  console.log(renderComparison(before, after))
  // Non-zero on a regression so a PR check can gate on it
  process.exitCode = compare(before, after).some(d => d.regression) ? 1 : 0
} else {
  const summaries = positionals.map(load)
  const merged: Summary = {
    ...summaries[0],
    runId: summaries.map(s => s.runId).join(' + '),
    rows: summaries.flatMap(s => s.rows),
  }
  console.log(renderMarkdown(merged))
}
