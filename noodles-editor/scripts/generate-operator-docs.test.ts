import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Registry } from 'noodles-validate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkExamples,
  type DocsOptions,
  defaultOptions,
  escapeProse,
  generateDocs,
  hasRemarks,
  renderDefault,
  spliceRegions,
  stripComments,
  tableCode,
  toSlug,
} from './generate-operator-docs'

function makeRegistry(): Registry {
  return {
    documentVersion: 1,
    convertsFrom: 19,
    categories: ['data', 'number'],
    operators: {
      number: {
        name: 'Number',
        type: 'number',
        category: 'number',
        description: 'A number',
        inputs: {},
        outputs: { out: { type: 'number' } },
        params: { value: { kind: 'float', default: 0 } },
      },
      file: {
        name: 'File',
        type: 'file',
        category: 'data',
        description: 'Fetch a file',
        inputs: {},
        outputs: { out: { type: 'table' } },
        params: {
          format: { kind: 'menu', default: 'csv', options: ['csv', 'json'] },
          url: { kind: 'url', default: '' },
        },
      },
    },
    formerly: { NumberOp: ['number'] },
  }
}

const REMARKS = `## Remarks

Hand-written text that has to survive regeneration, including a | pipe and {braces}.

## Examples

\`\`\`json
{ "id": "n1", "op": "number", "name": "number", "x": 0, "y": 0, "params": { "value": 2 } }
\`\`\`
`

describe('generate-operator-docs', () => {
  let dir: string
  let options: DocsOptions

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-docs-'))
    options = {
      registry: makeRegistry(),
      pagesDir: path.join(dir, 'operators'),
      indexFile: path.join(dir, 'operators.md'),
    }
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const page = (slug: string) => path.join(options.pagesDir, `${slug}.md`)
  const read = (file: string) => fs.readFileSync(file, 'utf8')

  it('scaffolds a page per operator and an index', () => {
    const result = generateDocs(options)

    expect(result.errors).toEqual([])
    expect(fs.readdirSync(options.pagesDir).sort()).toEqual(['file.md', 'number.md'])
    const number = read(page('number'))
    expect(number.startsWith('# Number\n')).toBe(true)
    expect(number).toContain('| `value` | `float` | `0` |  |')
    // The operator class older projects used, which converts to it
    expect(number).toContain('These convert to `number` when they open: `NumberOp`.')
    expect(read(page('file'))).toContain('| `format` | `menu` | `"csv"` | `csv`, `json` |')
    expect(read(page('file'))).toContain('[Data](../operators.md#data)')
    const index = read(options.indexFile)
    expect(index).toContain('## Data\n\n- [File](./operators/file.md): Fetch a file.')
    expect(index).toContain('0 of 2 have written Remarks')
  })

  it('is a no-op the second time', () => {
    generateDocs(options)
    const before = read(page('number'))

    const result = generateDocs(options)

    expect(result.changed).toEqual([])
    expect(read(page('number'))).toBe(before)
  })

  it('keeps hand-written text and reverts edits inside markers', () => {
    generateDocs(options)
    const original = read(page('number'))
    const edited = original
      .replace(/<!-- Add hand-written[^\n]*\n/, REMARKS)
      .replace('| `value` | `float` | `0` |  |', '| `value` | `float` | `42` |  |')
    fs.writeFileSync(page('number'), edited)

    generateDocs(options)

    const regenerated = read(page('number'))
    expect(regenerated).toContain(REMARKS)
    expect(regenerated).toContain('| `value` | `float` | `0` |  |')
    expect(regenerated).not.toContain('`42`')
    expect(read(options.indexFile)).toContain('1 of 2 have written Remarks')
  })

  it('updates generated regions when the registry changes, without touching prose', () => {
    generateDocs(options)
    fs.writeFileSync(
      page('number'),
      read(page('number')).replace(/<!-- Add hand-written[^\n]*\n/, REMARKS)
    )
    options.registry.operators.number.params.value.default = 5
    options.registry.operators.number.name = 'Constant'

    generateDocs(options)

    const regenerated = read(page('number'))
    expect(regenerated.startsWith('# Constant\n')).toBe(true)
    expect(regenerated).toContain('| `value` | `float` | `5` |  |')
    expect(regenerated).toContain(REMARKS)
  })

  describe('check', () => {
    it('reports drift without writing', () => {
      generateDocs(options)
      const before = read(page('number'))
      options.registry.operators.number.params.value.default = 5

      const result = generateDocs(options, { check: true })

      expect(result.changed).toEqual([page('number')])
      expect(read(page('number'))).toBe(before)
    })

    it('reports a new operator with no page', () => {
      generateDocs(options)
      options.registry.operators.text = {
        name: 'Text',
        type: 'text',
        inputs: {},
        outputs: { out: { type: 'value' } },
        params: {},
      }

      const result = generateDocs(options, { check: true })

      expect(result.changed).toContain(page('text'))
      expect(result.changed).toContain(options.indexFile)
      expect(fs.existsSync(page('text'))).toBe(false)
    })

    it('reports pages for operators that no longer exist', () => {
      generateDocs(options)
      delete options.registry.operators.file

      const result = generateDocs(options, { check: true })

      expect(result.orphans).toEqual([page('file')])
    })

    it('reports an example that does not validate', () => {
      generateDocs(options)
      const bad = REMARKS.replace('"op": "number"', '"op": "Numbr"')
      fs.writeFileSync(
        page('number'),
        read(page('number')).replace(/<!-- Add hand-written[^\n]*\n/, bad)
      )

      const result = generateDocs(options, { check: true })

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(/number\.md: example nodes\[0\].*Unknown operator Numbr/)
    })

    it('reports broken markers instead of guessing', () => {
      generateDocs(options)
      fs.writeFileSync(page('number'), read(page('number')).replace('<!-- gen:end inputs -->', ''))

      const result = generateDocs(options, { check: true })

      expect(result.errors).toEqual([
        expect.stringMatching(/gen:begin params inside gen:begin inputs/),
      ])
    })
  })

  describe('spliceRegions', () => {
    const regions = { a: 'new a', b: 'new b' }

    it('replaces only region contents', () => {
      const text =
        'before\n<!-- gen:begin a -->\nold\n<!-- gen:end a -->\nmiddle\n<!-- gen:begin b -->\n<!-- gen:end b -->\nafter\n'

      expect(spliceRegions(text, regions)).toBe(
        'before\n<!-- gen:begin a -->\nnew a\n<!-- gen:end a -->\nmiddle\n<!-- gen:begin b -->\nnew b\n<!-- gen:end b -->\nafter\n'
      )
    })

    it('rejects a missing region', () => {
      expect(() =>
        spliceRegions('<!-- gen:begin a -->\n<!-- gen:end a -->', regions, 'x.md')
      ).toThrow(/x\.md: missing generated region "b"/)
    })

    it('rejects a duplicated region', () => {
      const text =
        '<!-- gen:begin a -->\n<!-- gen:end a -->\n<!-- gen:begin a -->\n<!-- gen:end a -->\n<!-- gen:begin b -->\n<!-- gen:end b -->'
      expect(() => spliceRegions(text, regions)).toThrow(/"a" appears twice/)
    })

    it('rejects an unclosed region', () => {
      expect(() => spliceRegions('<!-- gen:begin a -->\n', regions)).toThrow(/has no gen:end a/)
    })

    it('rejects an unknown region', () => {
      expect(() => spliceRegions('<!-- gen:begin c -->\n<!-- gen:end c -->', regions)).toThrow(
        /unknown generated region "c"/
      )
    })
  })

  it("names a page after the operator, and a host class's after its type without Op", () => {
    expect(toSlug('fit-bounds')).toBe('fit-bounds')
    expect(toSlug('FileOp')).toBe('file')
    expect(toSlug('ScatterplotLayerOp')).toBe('scatterplot-layer')
    expect(toSlug('H3HexagonLayerOp')).toBe('h3-hexagon-layer')
    expect(toSlug('MVTLayerOp')).toBe('mvt-layer')
    expect(toSlug('Tile3DLayerOp')).toBe('tile3d-layer')
    expect(toSlug('DBScanClusterOp')).toBe('db-scan-cluster')
    expect(toSlug('JSONOp')).toBe('json')
  })

  it('escapes backslashes before the characters it escapes', () => {
    // A backslash already in front of a brace would otherwise cancel the brace's escape
    expect(escapeProse('a\\{b}')).toBe('a\\\\\\{b\\}')
    expect(escapeProse('C:\\temp `C:\\temp`')).toBe('C:\\\\temp `C:\\temp`')
    // JSON text has even runs of backslashes before a pipe; each pipe takes one more
    expect(tableCode('"a\\\\|b"')).toBe('`"a\\\\\\|b"`')
    expect(tableCode('a\\\\b')).toBe('`a\\\\b`')
    expect(() => tableCode('a\\|b')).toThrow(/in a table cell/)
  })

  it('shows defaults JSON lost as their JS text', () => {
    expect(renderDefault({ kind: 'float', defaultText: 'Infinity' })).toBe('`Infinity`')
    expect(
      renderDefault({
        kind: 'field',
        defaultText: '[-Infinity,-Infinity,Infinity,Infinity]',
      })
    ).toBe('`[-Infinity,-Infinity,Infinity,Infinity]`')
  })

  it('strips comments that removing another comment would form', () => {
    expect(stripComments('<!-<!-- a -->- b -->c')).toBe('c')
    expect(hasRemarks('## Remarks\n\n<!-<!-- a -->- b -->\n')).toBe(false)
  })

  it('escapes table cells and MDX-sensitive prose', () => {
    expect(renderDefault({ kind: 'string', default: 'a|b' })).toBe('`"a\\|b"`')
    expect(renderDefault({ kind: 'string', default: 'a`b' })).toBe('`` "a`b" ``')
    expect(renderDefault({ kind: 'field' })).toBe('')
    expect(renderDefault({ kind: 'field', default: { long: 'x'.repeat(200) } })).toMatch(
      /^`\{"long":"x+\.\.\.`$/
    )
    expect(escapeProse('Use {a} or <b>, but `{code}` stays')).toBe(
      'Use \\{a\\} or &lt;b&gt;, but `{code}` stays'
    )
  })

  it('counts Remarks only when they have text', () => {
    expect(hasRemarks('# A\n\n## Remarks\n\n<!-- todo -->\n\n## Details\n')).toBe(false)
    expect(hasRemarks('# A\n\n## Remarks\n\nIt runs per row.\n')).toBe(true)
    expect(hasRemarks('# A\n\n<!-- gen:begin x -->\n## Remarks\n\nNo.\n<!-- gen:end x -->\n')).toBe(
      false
    )
  })

  it('validates document, fragment and node examples, filling in the version', () => {
    const registry = makeRegistry()
    const node = '{ "id": "n", "op": "number", "name": "count", "x": 0, "y": 0, "params": {} }'
    const fence = (json: string) => `\`\`\`json\n${json}\n\`\`\`\n`

    expect(checkExamples(fence(node), registry)).toEqual([])
    expect(checkExamples(fence(`{ "nodes": [${node}] }`), registry)).toEqual([])
    expect(checkExamples(fence('[1, 2, 3]'), registry)).toEqual([])
    expect(checkExamples(fence('{ "nodes": [] '), registry)).toEqual([
      expect.stringMatching(/not valid JSON/),
    ])
    const badEdge = `{ "nodes": [${node}], "edges": [{ "id": "e", "source": "n", "sourcePort": "nope", "target": "n", "targetPort": "par:value" }] }`
    expect(checkExamples(fence(badEdge), registry)).toEqual([
      expect.stringMatching(/\[edge-port\]/),
    ])
  })

  it('gives a host class its own page beside the planner operator of its name', () => {
    const registry = makeRegistry()
    registry.operators.CodeOp = {
      name: 'Code (page)',
      type: 'CodeOp',
      category: 'host',
      inputs: {},
      outputs: {},
      params: {},
    }
    registry.operators.code = { ...registry.operators.CodeOp, type: 'code', category: 'data' }
    generateDocs({ ...options, registry })
    expect(fs.existsSync(page('code'))).toBe(true)
    expect(read(page('code-host'))).toContain('on the page, not in the engine')
  })

  // CI runs this through npm test, the same way the registry snapshot test catches a
  // stale noodles-validate/registry.json
  it('committed pages match the registry (run npm run generate:op-docs)', () => {
    const result = generateDocs(defaultOptions(), { check: true })

    expect(result).toEqual({ changed: [], orphans: [], errors: [] })
  })

  it('--check exits 0 when the pages are up to date', async () => {
    // `--import tsx` loads TypeScript without the tsx CLI, which needs a local IPC socket
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'scripts/generate-operator-docs.ts', '--check'],
        { cwd: path.join(import.meta.dirname, '..'), stdio: 'ignore', timeout: 15_000 }
      )
      child.on('error', reject)
      child.on('close', resolve)
    })

    expect(code).toBe(0)
  }, 20_000)
})
