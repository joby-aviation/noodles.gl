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
  toSlug,
} from './generate-operator-docs'

function makeRegistry(): Registry {
  return {
    projectVersion: 19,
    operators: {
      NumberOp: {
        name: 'Number',
        type: 'NumberOp',
        description: 'A number',
        inputs: { val: { type: 'NumberField', default: 0 } },
        outputs: { val: { type: 'NumberField' } },
      },
      FileOp: {
        name: 'File',
        type: 'FileOp',
        description: 'Fetch a file',
        inputs: {
          format: { type: 'StringLiteralField', default: 'json' },
          url: { type: 'FileUrlField', default: '' },
        },
        outputs: { data: { type: 'DataField' } },
      },
    },
  }
}

const REMARKS = `## Remarks

Hand-written text that has to survive regeneration, including a | pipe and {braces}.

## Examples

\`\`\`json
{ "id": "/number", "type": "NumberOp", "position": { "x": 0, "y": 0 }, "data": { "inputs": { "val": 2 } } }
\`\`\`
`

describe('generate-operator-docs', () => {
  let dir: string
  let options: DocsOptions

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-docs-'))
    options = {
      registry: makeRegistry(),
      categories: { data: ['File'], number: ['Number'] },
      migrations: [{ version: 7, name: '007-rename-number', types: ['NumberOp'] }],
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
    expect(number).toContain('| `val` | `NumberField` | `0` |')
    expect(number).toContain('[`007-rename-number`]')
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
      .replace('| `val` | `NumberField` | `0` |', '| `val` | `NumberField` | `42` |')
    fs.writeFileSync(page('number'), edited)

    generateDocs(options)

    const regenerated = read(page('number'))
    expect(regenerated).toContain(REMARKS)
    expect(regenerated).toContain('| `val` | `NumberField` | `0` |')
    expect(regenerated).not.toContain('`42`')
    expect(read(options.indexFile)).toContain('1 of 2 have written Remarks')
  })

  it('updates generated regions when the registry changes, without touching prose', () => {
    generateDocs(options)
    fs.writeFileSync(
      page('number'),
      read(page('number')).replace(/<!-- Add hand-written[^\n]*\n/, REMARKS)
    )
    options.registry.operators.NumberOp.inputs.val.default = 5
    options.registry.operators.NumberOp.name = 'Constant'

    generateDocs(options)

    const regenerated = read(page('number'))
    expect(regenerated.startsWith('# Constant\n')).toBe(true)
    expect(regenerated).toContain('| `val` | `NumberField` | `5` |')
    expect(regenerated).toContain(REMARKS)
  })

  describe('check', () => {
    it('reports drift without writing', () => {
      generateDocs(options)
      const before = read(page('number'))
      options.registry.operators.NumberOp.inputs.val.default = 5

      const result = generateDocs(options, { check: true })

      expect(result.changed).toEqual([page('number')])
      expect(read(page('number'))).toBe(before)
    })

    it('reports a new operator with no page', () => {
      generateDocs(options)
      options.registry.operators.StringOp = {
        name: 'String',
        type: 'StringOp',
        inputs: {},
        outputs: { val: { type: 'StringField' } },
      }

      const result = generateDocs(options, { check: true })

      expect(result.changed).toContain(page('string'))
      expect(result.changed).toContain(options.indexFile)
      expect(fs.existsSync(page('string'))).toBe(false)
    })

    it('reports pages for operators that no longer exist', () => {
      generateDocs(options)
      delete options.registry.operators.FileOp

      const result = generateDocs(options, { check: true })

      expect(result.orphans).toEqual([page('file')])
    })

    it('reports an example that does not validate', () => {
      generateDocs(options)
      const bad = REMARKS.replace('"type": "NumberOp"', '"type": "Number"')
      fs.writeFileSync(
        page('number'),
        read(page('number')).replace(/<!-- Add hand-written[^\n]*\n/, bad)
      )

      const result = generateDocs(options, { check: true })

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(
        /number\.md: example nodes\[0\].*Unknown operator type Number/
      )
    })

    it('reports broken markers instead of guessing', () => {
      generateDocs(options)
      fs.writeFileSync(page('number'), read(page('number')).replace('<!-- gen:end inputs -->', ''))

      const result = generateDocs(options, { check: true })

      expect(result.errors).toEqual([
        expect.stringMatching(/gen:begin outputs inside gen:begin inputs/),
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

  it('names files after the type without Op', () => {
    expect(toSlug('FileOp')).toBe('file')
    expect(toSlug('ScatterplotLayerOp')).toBe('scatterplot-layer')
    expect(toSlug('H3HexagonLayerOp')).toBe('h3-hexagon-layer')
    expect(toSlug('MVTLayerOp')).toBe('mvt-layer')
    expect(toSlug('Tile3DLayerOp')).toBe('tile3d-layer')
    expect(toSlug('DBScanClusterOp')).toBe('db-scan-cluster')
    expect(toSlug('JSONOp')).toBe('json')
  })

  it('escapes table cells and MDX-sensitive prose', () => {
    expect(renderDefault({ type: 'StringField', default: 'a|b' })).toBe('`"a\\|b"`')
    expect(renderDefault({ type: 'StringField', default: 'a`b' })).toBe('`` "a`b" ``')
    expect(renderDefault({ type: 'FunctionField' })).toBe('')
    expect(renderDefault({ type: 'UnknownField', default: { long: 'x'.repeat(200) } })).toMatch(
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

  it('validates project, fragment and node examples, filling in the version', () => {
    const registry = makeRegistry()
    const node = '{ "id": "/n", "type": "NumberOp", "position": { "x": 0, "y": 0 }, "data": {} }'
    const fence = (json: string) => `\`\`\`json\n${json}\n\`\`\`\n`

    expect(checkExamples(fence(node), registry)).toEqual([])
    expect(checkExamples(fence(`{ "nodes": [${node}] }`), registry)).toEqual([])
    expect(checkExamples(fence('[1, 2, 3]'), registry)).toEqual([])
    expect(checkExamples(fence('{ "nodes": [] '), registry)).toEqual([
      expect.stringMatching(/not valid JSON/),
    ])
    const badEdge = `{ "nodes": [${node}], "edges": [{ "id": "e", "source": "/n", "sourceHandle": "out.nope", "target": "/n", "targetHandle": "par.val" }] }`
    expect(checkExamples(fence(badEdge), registry)).toEqual([
      expect.stringMatching(/\[edge-handle\]/),
    ])
  })

  it('attributes migrations to the operators their source names', () => {
    const { migrations } = defaultOptions()
    const bounds = migrations.filter(m => m.types.includes('BoundsOp')).map(m => m.name)

    expect(bounds).toEqual(['017-rename-bounds-fields', '019-rename-bounds-literal-inputs'])
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
