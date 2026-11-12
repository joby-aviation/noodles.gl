#!/usr/bin/env node
/**
 * Operator reference generator
 *
 * Writes one page per operator to docs/reference/operators/ and a category index at
 * docs/reference/operators.md, from noodles-validate/registry.json, the operator catalog's
 * snapshot (run `npm run generate:registry` first after changing an operator).
 *
 * The generator owns only the text between `<!-- gen:begin NAME -->` and
 * `<!-- gen:end NAME -->` markers, plus each page's `# Title` line. Everything else
 * (Remarks, Examples, See Also) is hand-written and kept as is.
 *
 * Usage:
 *   npm run generate:op-docs             write the pages
 *   npm run generate:op-docs -- --check  exit 1 if a page is out of date or an example is invalid
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type OperatorInfo,
  type ParamInfo,
  type PortInfo,
  type Registry,
  validateProject,
} from 'noodles-validate'

const repoRoot = path.join(import.meta.dirname, '../..')

// Regions in the order they appear on a page
const PAGE_REGIONS = [
  'summary',
  'syntax',
  'inputs',
  'params',
  'outputs',
  'details',
  'history',
] as const

const CATEGORY_LABELS: Record<string, string> = {
  data: 'Data',
  table: 'Tables',
  geometry: 'Geometry',
  rows: 'Rows',
  color: 'Color',
  layer: 'Layers',
  number: 'Numbers',
  output: 'Output',
  structure: 'Structure',
  host: 'Host operators',
}

const MAX_DEFAULT_CHARS = 100

export interface OpDoc {
  type: string
  name: string
  slug: string
  category: string
  description: string
  inputs: [string, PortInfo][]
  outputs: [string, PortInfo][]
  params: [string, ParamInfo][]
  // Operator classes of older projects that convert to this operator
  formerly: string[]
}

export interface DocsOptions {
  registry: Registry
  // docs/reference/operators/
  pagesDir: string
  // docs/reference/operators.md
  indexFile: string
}

export interface DocsResult {
  // Files that were (or, with check, would be) created or changed
  changed: string[]
  // Pages for operators that no longer exist
  orphans: string[]
  errors: string[]
}

// A planner operator's type is its slug already (`scatter`, `fit-bounds`); a host operator's
// class name is made one: CodeOp -> code, CustomMapLibreLayerOp -> custom-map-libre-layer
export function toSlug(type: string): string {
  return type
    .replace(/Op$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z0-9]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1)
}

export function buildModel({ registry }: Pick<DocsOptions, 'registry'>): OpDoc[] {
  const formerly = new Map<string, string[]>()
  for (const [old, ops] of Object.entries(registry.formerly ?? {})) {
    for (const op of ops) formerly.set(op, [...(formerly.get(op) ?? []), old])
  }
  const planner = new Set(
    Object.values(registry.operators)
      .filter(op => op.category !== 'host')
      .map(op => op.type)
  )
  const docs = Object.values(registry.operators)
    .map((op: OperatorInfo) => {
      // A host class whose slug a planner operator has (CodeOp, code) is told apart
      const slug =
        op.category === 'host' && planner.has(toSlug(op.type))
          ? `${toSlug(op.type)}-host`
          : toSlug(op.type)
      return {
        type: op.type,
        name: op.name,
        slug,
        category: op.category ?? 'host',
        description: op.description ?? '',
        inputs: Object.entries(op.inputs),
        outputs: Object.entries(op.outputs),
        params: Object.entries(op.params ?? {}),
        formerly: (formerly.get(op.type) ?? []).sort(),
      }
    })
    .sort((a, b) => a.slug.localeCompare(b.slug))
  const bySlug = new Map<string, string>()
  for (const doc of docs) {
    const other = bySlug.get(doc.slug)
    if (other)
      throw new Error(`${other} and ${doc.type} would both be documented in ${doc.slug}.md`)
    bySlug.set(doc.slug, doc.type)
  }
  return docs
}

// === Rendering ===

// Descriptions are plain text in .md files, which Docusaurus compiles as MDX: braces
// and angle brackets outside code would be read as JSX. Backslashes are escaped first,
// so a description's own backslash can't cancel the escape in front of a brace.
export function escapeProse(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/[\\{}]/g, '\\$&')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    )
    .join('')
}

function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) || !trimmed ? trimmed : `${trimmed}.`
}

function firstSentence(text: string): string {
  return sentence(text.split(/(?<=\.)\s/)[0])
}

// Inline code that survives a table cell. A pipe ends the cell, even inside code, unless
// a backslash escapes it. The table parser reads backslashes in pairs, and inside code
// every other backslash stays literal, so a pipe after an even run of backslashes (as
// JSON text always has) takes one more. After an odd run no escape can show the text
// as it is, so that's an error rather than a wrong cell.
export function tableCode(text: string): string {
  const escaped = text.replace(/(\\*)\|/g, (_, slashes: string) => {
    if (slashes.length % 2 === 1) throw new Error(`Can't show ${text} in a table cell`)
    return `${slashes}\\|`
  })
  return escaped.includes('`') ? `\`\` ${escaped} \`\`` : `\`${escaped}\``
}

export function renderDefault(param: ParamInfo): string {
  // JS text for a default JSON can't hold, such as Infinity
  let json = param.defaultText
  if (json === undefined) {
    if (!('default' in param) || param.default === undefined || param.default === null) return ''
    json = JSON.stringify(param.default)
  }
  if (json.length > MAX_DEFAULT_CHARS) json = `${json.slice(0, MAX_DEFAULT_CHARS - 3)}...`
  return tableCode(json)
}

function renderSummary(doc: OpDoc): string {
  return [
    '<!-- Generated by `npm run generate:op-docs` from noodles-validate/registry.json. The title and the text between gen:begin and gen:end markers are replaced on every run; write anywhere else. -->',
    '',
    escapeProse(sentence(doc.description)),
  ].join('\n')
}

function renderSyntax(doc: OpDoc): string {
  const lines = [
    '```json',
    `{ "id": "n1", "op": "${doc.type}", "name": "${doc.slug}", "x": 0, "y": 0, "params": {} }`,
    '```',
  ]
  const [input] = doc.inputs[0] ?? []
  const [output] = doc.outputs[0] ?? []
  // A number parameter: one an edge from a number output can drive
  const [param] = doc.params.find(([, p]) => p.kind === 'float' || p.kind === 'int') ?? []
  const parts = [
    input && `an edge into it ends at \`"targetPort": "${input}"\``,
    output && `one out of it starts at \`"sourcePort": "${output}"\``,
    param &&
      `a parameter is set in \`params\` (leave out the ones at their default), driven by an edge to \`par:${param}\`, or read elsewhere as \`ch('${doc.slug}/${param}')\``,
  ].filter(Boolean)
  if (parts.length) {
    const text = parts.join('; ')
    lines.push('', `${text.charAt(0).toUpperCase()}${text.slice(1)}.`)
  }
  return lines.join('\n')
}

const portFlags = (port: PortInfo) =>
  [port.multi && 'several, in order', port.optional && 'optional'].filter(Boolean).join(', ')

function renderInputs(doc: OpDoc): string {
  if (!doc.inputs.length) return 'This operator has no input ports.'
  return [
    '| Port | Type | Takes |',
    '|------|------|-------|',
    ...doc.inputs.map(
      ([name, port]) => `| \`${name}\` | \`${port.type}\` | ${portFlags(port) || 'one edge'} |`
    ),
  ].join('\n')
}

function renderParams(doc: OpDoc): string {
  if (!doc.params.length) return 'This operator has no parameters.'
  return [
    '| Parameter | Kind | Default | Choices |',
    '|-----------|------|---------|---------|',
    ...doc.params.map(([name, param]) => {
      const choices = param.options?.length
        ? param.options.length > 8
          ? `${param.options.length} choices`
          : param.options.map(o => tableCode(o)).join(', ')
        : ''
      return `| \`${name}\` | \`${param.kind}\` | ${renderDefault(param)} | ${choices} |`
    }),
  ].join('\n')
}

function renderOutputs(doc: OpDoc): string {
  if (!doc.outputs.length) return 'This operator has no outputs.'
  return [
    '| Port | Type |',
    '|------|------|',
    ...doc.outputs.map(([name, port]) => `| \`${name}\` | \`${port.type}\` |`),
  ].join('\n')
}

function renderDetails(doc: OpDoc): string {
  return [
    `- **Category:** [${categoryLabel(doc.category)}](../operators.md#${doc.category})`,
    `- **Operator:** \`${doc.type}\``,
    ...(doc.category === 'host'
      ? [
          '- **Runs:** on the page, not in the engine: it cannot be compiled to SQL or an expression',
        ]
      : []),
  ].join('\n')
}

function renderHistory(doc: OpDoc): string {
  if (!doc.formerly.length) return ''
  return [
    '## Older projects',
    '',
    `Projects saved before documents used operator classes. These convert to \`${doc.type}\` when they open: ${doc.formerly.map(t => `\`${t}\``).join(', ')}.`,
  ].join('\n')
}

export function renderPageRegions(doc: OpDoc): Record<(typeof PAGE_REGIONS)[number], string> {
  return {
    summary: renderSummary(doc),
    syntax: renderSyntax(doc),
    inputs: renderInputs(doc),
    params: renderParams(doc),
    outputs: renderOutputs(doc),
    details: renderDetails(doc),
    history: renderHistory(doc),
  }
}

function region(name: string, content: string): string {
  return content
    ? `<!-- gen:begin ${name} -->\n${content}\n<!-- gen:end ${name} -->`
    : `<!-- gen:begin ${name} -->\n<!-- gen:end ${name} -->`
}

function pageScaffold(doc: OpDoc, regions: Record<string, string>): string {
  return `# ${doc.name}

${region('summary', regions.summary)}

## Syntax

${region('syntax', regions.syntax)}

## Inputs

${region('inputs', regions.inputs)}

## Parameters

${region('params', regions.params)}

## Outputs

${region('outputs', regions.outputs)}

<!-- Add hand-written "## Remarks" and "## Examples" sections here. See the operator reference index for what goes in them. -->

## Details

${region('details', regions.details)}

${region('history', regions.history)}
`
}

// === Splicing ===

const MARKER = /<!-- gen:(begin|end) ([a-z-]+) -->/g

// Replace the content of each named region, keeping everything outside the markers.
// Missing, duplicated, unclosed or unknown markers are errors rather than guesses.
export function spliceRegions(
  text: string,
  regions: Record<string, string>,
  file = 'page'
): string {
  const expected = new Set(Object.keys(regions))
  const seen = new Set<string>()
  let open: { name: string; end: number } | null = null
  let out = ''
  let cursor = 0
  for (const match of text.matchAll(MARKER)) {
    const [marker, kind, name] = match
    const at = match.index
    if (kind === 'begin') {
      if (open) throw new Error(`${file}: gen:begin ${name} inside gen:begin ${open.name}`)
      if (!expected.has(name)) throw new Error(`${file}: unknown generated region "${name}"`)
      if (seen.has(name)) throw new Error(`${file}: generated region "${name}" appears twice`)
      seen.add(name)
      open = { name, end: at + marker.length }
      out += text.slice(cursor, at)
    } else {
      if (!open || open.name !== name) {
        throw new Error(`${file}: gen:end ${name} without a matching gen:begin ${name}`)
      }
      out += region(name, regions[name])
      cursor = at + marker.length
      open = null
    }
  }
  if (open) throw new Error(`${file}: gen:begin ${open.name} has no gen:end ${open.name}`)
  const missing = [...expected].filter(name => !seen.has(name))
  if (missing.length) {
    throw new Error(
      `${file}: missing generated region ${missing.map(n => `"${n}"`).join(', ')}. Restore its gen:begin and gen:end markers, or delete the file to scaffold it again`
    )
  }
  return out + text.slice(cursor)
}

// The text outside generated regions
export function handWritten(text: string): string {
  return text.replace(/<!-- gen:begin ([a-z-]+) -->[\s\S]*?<!-- gen:end \1 -->/g, '')
}

export function renderPage(doc: OpDoc, existing: string | null, file?: string): string {
  const regions = renderPageRegions(doc)
  if (existing === null) return pageScaffold(doc, regions)
  const spliced = spliceRegions(existing, regions, file)
  // The title line is generated too, so a renamed operator gets a new heading
  return /^# .*/.test(spliced)
    ? spliced.replace(/^# .*/, `# ${doc.name}`)
    : `# ${doc.name}\n\n${spliced}`
}

// Removing one comment can join the text around it into another, as in
// `<!-<!-- x -->- y -->`, so repeat until nothing changes
export function stripComments(text: string): string {
  let previous: string
  let current = text
  do {
    previous = current
    current = current.replace(/<!--[\s\S]*?-->/g, '')
  } while (current !== previous)
  return current
}

// A page has Remarks once its "## Remarks" section has text beyond comments
export function hasRemarks(text: string): boolean {
  const match = handWritten(text).match(/^## Remarks[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)
  return !!match && stripComments(match[1]).trim().length > 0
}

function renderIndexRegions(docs: OpDoc[], withRemarks: number, categoryOrder: string[]) {
  const byCategory = new Map<string, OpDoc[]>()
  for (const doc of docs) {
    byCategory.set(doc.category, [...(byCategory.get(doc.category) ?? []), doc])
  }
  const order = [...new Set([...categoryOrder, ...byCategory.keys()])]
  const sections = order
    .filter(category => byCategory.has(category))
    .map(category =>
      [
        `## ${categoryLabel(category)}`,
        '',
        ...(byCategory.get(category) ?? []).map(
          doc =>
            `- [${doc.name}](./operators/${doc.slug}.md)${doc.description ? `: ${escapeProse(firstSentence(doc.description))}` : ''}`
        ),
      ].join('\n')
    )
  return {
    coverage: `${docs.length} operators in ${byCategory.size} categories. ${withRemarks} of ${docs.length} have written Remarks.`,
    operators: sections.join('\n\n'),
  }
}

function indexScaffold(regions: Record<string, string>): string {
  return `# Operator Reference

${region('coverage', regions.coverage)}

One page per operator. The ports and parameters tables are generated from the operator catalog; Remarks and Examples are written by hand.

${region('operators', regions.operators)}
`
}

export function renderIndex(
  docs: OpDoc[],
  withRemarks: number,
  existing: string | null,
  file?: string,
  categoryOrder: string[] = []
): string {
  const regions = renderIndexRegions(docs, withRemarks, categoryOrder)
  return existing === null ? indexScaffold(regions) : spliceRegions(existing, regions, file)
}

// === Examples ===

// Every ```json block a person wrote must load: a whole document, a { nodes, edges } fragment,
// or a single node. The document version is filled in when it's left out.
export function checkExamples(text: string, registry: Registry, file = 'page'): string[] {
  const errors: string[] = []
  const blocks = handWritten(text).matchAll(/^```json[^\n]*\n([\s\S]*?)^```/gm)
  for (const [, source] of blocks) {
    let value: unknown
    try {
      value = JSON.parse(source)
    } catch (error) {
      errors.push(`${file}: example is not valid JSON: ${(error as Error).message}`)
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const object = value as Record<string, unknown>
    let project: Record<string, unknown>
    const base = { version: registry.documentVersion, name: 'example', edges: [] }
    if (Array.isArray(object.nodes)) {
      project = { ...base, ...object }
    } else if (typeof object.op === 'string') {
      project = { ...base, nodes: [object] }
    } else {
      continue
    }
    const result = validateProject(project, registry)
    for (const error of result.errors) {
      errors.push(`${file}: example ${error.at}: ${error.message} [${error.rule}]`)
    }
  }
  return errors
}

// === Files ===

function read(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

function relativeToRepo(file: string): string {
  return path.relative(repoRoot, file)
}

// Render every page and the index, and write them unless `check` is set
export function generateDocs(options: DocsOptions, { check = false } = {}): DocsResult {
  const { registry, pagesDir, indexFile } = options
  const docs = buildModel(options)
  const result: DocsResult = { changed: [], orphans: [], errors: [] }
  const pending: [string, string][] = []
  let withRemarks = 0

  for (const doc of docs) {
    const file = path.join(pagesDir, `${doc.slug}.md`)
    const existing = read(file)
    let page: string
    try {
      page = renderPage(doc, existing, relativeToRepo(file))
    } catch (error) {
      result.errors.push((error as Error).message)
      continue
    }
    if (hasRemarks(page)) withRemarks++
    result.errors.push(...checkExamples(page, registry, relativeToRepo(file)))
    if (page !== existing) pending.push([file, page])
  }

  try {
    const existing = read(indexFile)
    const index = renderIndex(
      docs,
      withRemarks,
      existing,
      relativeToRepo(indexFile),
      registry.categories ?? []
    )
    result.errors.push(...checkExamples(index, registry, relativeToRepo(indexFile)))
    if (index !== existing) pending.push([indexFile, index])
  } catch (error) {
    result.errors.push((error as Error).message)
  }

  const slugs = new Set(docs.map(doc => `${doc.slug}.md`))
  if (fs.existsSync(pagesDir)) {
    result.orphans = fs
      .readdirSync(pagesDir)
      .filter(file => file.endsWith('.md') && !slugs.has(file))
      .map(file => path.join(pagesDir, file))
  }

  result.changed = pending.map(([file]) => file)
  if (!check) {
    fs.mkdirSync(pagesDir, { recursive: true })
    for (const [file, text] of pending) fs.writeFileSync(file, text)
  }
  return result
}

export function defaultOptions(): DocsOptions {
  const registry = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'noodles-validate/registry.json'), 'utf8')
  ) as Registry
  return {
    registry,
    pagesDir: path.join(repoRoot, 'docs/reference/operators'),
    indexFile: path.join(repoRoot, 'docs/reference/operators.md'),
  }
}

function main(argv: string[]) {
  const check = argv.includes('--check')
  const { changed, orphans, errors } = generateDocs(defaultOptions(), { check })
  const list = (files: string[]) => files.map(file => `  ${relativeToRepo(file)}`).join('\n')

  for (const error of errors) console.error(`error: ${error}`)
  if (orphans.length) {
    console.error(`No operator for these pages. Delete or rename them:\n${list(orphans)}`)
  }
  if (check) {
    if (changed.length) {
      console.error(
        `Out of date:\n${list(changed)}\nRun \`npm run generate:op-docs\` in noodles-editor and commit the result.`
      )
    }
    if (changed.length || orphans.length || errors.length) process.exit(1)
    console.log('Operator reference is up to date.')
    return
  }
  console.log(changed.length ? `Wrote:\n${list(changed)}` : 'Operator reference is up to date.')
  if (orphans.length || errors.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
