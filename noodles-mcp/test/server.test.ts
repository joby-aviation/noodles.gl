import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { currentFixtures } from '../../noodles-validate/test/fixtures.ts'
import { createServer, DEFAULT_REPO_ROOT, parseArgs } from '../src/index.ts'

const REPO_ROOT = DEFAULT_REPO_ROOT
// noodles-validate's fixtures at the current schema version; relative paths in
// these tests resolve against WORKDIR
const WORKDIR = currentFixtures()
const FIXTURES = join(WORKDIR, 'test/fixtures')
const BIN = fileURLToPath(new URL('../bin/noodles-mcp.ts', import.meta.url))

let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const [content] = result.content as Array<{ type: string; text: string }>
  return { isError: result.isError === true, text: content.text }
}

async function data(name: string, args: Record<string, unknown> = {}) {
  const { isError, text } = await call(name, args)
  assert.equal(isError, false, text)
  return JSON.parse(text)
}

before(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer({ repoRoot: REPO_ROOT, cwd: WORKDIR }).connect(serverSide)
  client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
})

after(() => client.close())

describe('noodles-mcp', () => {
  it('serves the docs tools under the in-app names, plus validate_project', async () => {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(t => t.name).sort(), [
      'get_documentation',
      'get_example',
      'get_operator_schema',
      'list_examples',
      'list_operators',
      'validate_project',
    ])
    assert.ok(tools.every(t => t.annotations?.readOnlyHint))
  })

  it('tells the client when to stop', () => {
    assert.match(client.getInstructions() ?? '', /"valid": true, the file is done/)
  })

  describe('list_operators', () => {
    it('lists every operator', async () => {
      const operators = await data('list_operators')
      assert.ok(operators.length > 100)
      assert.ok(operators.some((op: { type: string }) => op.type === 'ScatterplotLayerOp'))
    })

    it('filters by category, and names the categories when one is wrong', async () => {
      const layers = await data('list_operators', { category: 'layer' })
      assert.ok(layers.every((op: { category: string }) => op.category === 'layer'))
      const { isError, text } = await call('list_operators', { category: 'layers' })
      assert.equal(isError, true)
      assert.match(text, /Categories: .*layer/)
    })
  })

  describe('get_operator_schema', () => {
    it('returns fields and the handles to wire them', async () => {
      const schema = await data('get_operator_schema', { type: 'ScatterplotLayerOp' })
      assert.equal(schema.inputs.getRadius.type, 'NumberField')
      assert.ok(schema.handles.inputs.includes('par.getPosition'))
      assert.deepEqual(schema.handles.outputs, ['out.layer'])
    })

    it('accepts a display name', async () => {
      assert.equal((await data('get_operator_schema', { type: 'File' })).type, 'FileOp')
    })

    it('points at list_operators when no type is close', async () => {
      const { isError, text } = await call('get_operator_schema', { type: 'QwertyOp' })
      assert.equal(isError, true)
      assert.match(text, /list_operators shows every type\./)
    })

    it('suggests a type for one that does not exist', async () => {
      const { isError, text } = await call('get_operator_schema', { type: 'ScaterplotLayerOp' })
      assert.equal(isError, true)
      assert.match(text, /Did you mean: .*ScatterplotLayerOp/)
    })
  })

  describe('get_documentation', () => {
    it('searches and returns excerpts with ids', async () => {
      const { results } = await data('get_documentation', { query: 'keyframe animation timeline' })
      assert.ok(results.length > 0)
      // A window of 600 characters, widened to whole lines
      assert.ok(results.every((r: { excerpt: string }) => r.excerpt.length <= 600 + 2 * 120 + 2))
    })

    it('reads a topic in full by id, with the in-app ids', async () => {
      const topic = await data('get_documentation', { id: 'workflow-timeline-animation' })
      assert.equal(topic.section, 'ai-assistant')
      assert.ok(topic.content.length > 0)
      const page = await data('get_documentation', { id: 'developers-field-system' })
      assert.equal(page.url, 'https://noodles.gl/developers/field-system')
    })

    it('limits a search to a section', async () => {
      const { results } = await data('get_documentation', {
        query: 'bitmap',
        section: 'examples',
      })
      assert.ok(results.length > 0)
      assert.ok(results.every((r: { section: string }) => r.section === 'examples'))
    })

    it('needs a query or an id', async () => {
      assert.equal((await call('get_documentation')).isError, true)
      assert.equal((await call('get_documentation', { id: 'nope' })).isError, true)
    })
  })

  describe('examples', () => {
    it('lists the example projects with their directories', async () => {
      const examples = await data('list_examples')
      const quakes = examples.find((ex: { id: string }) => ex.id === 'california-earthquakes')
      assert.equal(quakes.path, 'noodles-editor/src/examples/california-earthquakes')
      assert.equal(
        (await data('list_examples', { category: 'geospatial' })).length,
        examples.length
      )
      assert.deepEqual(await data('list_examples', { category: 'other' }), [])
      const tagged = await data('list_examples', { tag: 'nyc' })
      assert.ok(
        tagged.length > 0 && tagged.every((ex: { tags: string[] }) => ex.tags.includes('nyc'))
      )
    })

    it('leaves hidden examples out of the list but loads them by id', async () => {
      const ids = (await data('list_examples')).map((ex: { id: string }) => ex.id)
      assert.ok(!ids.includes('table-editor-demo'))
      const demo = await data('get_example', { id: 'table-editor-demo' })
      assert.equal(demo.name, 'Table Editor Demo')
    })

    it('returns a project with its README and data files', async () => {
      const example = await data('get_example', { id: 'california-earthquakes' })
      assert.ok(example.files.includes('noodles.json'))
      assert.ok(example.layerTypes.includes('ScatterplotLayerOp'))
      assert.equal(typeof example.project.version, 'number')
    })

    it('rejects an unknown id or a path', async () => {
      const { isError, text } = await call('get_example', { id: 'nope' })
      assert.equal(isError, true)
      assert.match(text, /Examples: .*california-earthquakes/)
      assert.equal((await call('get_example', { id: '../../noodles-validate' })).isError, true)
    })
  })

  describe('validate_project', () => {
    it('passes a valid file and says it is done', async () => {
      const result = await data('validate_project', {
        path: join(FIXTURES, 'valid/noodles.json'),
      })
      assert.equal(result.valid, true)
      assert.match(result.summary, /^OK: .*The file is done\.$/)
      assert.equal(typeof result.registry.projectVersion, 'number')
    })

    it('reports each error with its fix', async () => {
      const result = await data('validate_project', {
        path: join(FIXTURES, 'broken/noodles.json'),
      })
      assert.equal(result.valid, false)
      assert.match(result.summary, /^FAIL: 4 errors/)
      assert.match(result.errors[0].message, /Did you mean: FileOp\?/)
    })

    it('resolves a relative path against the working directory', async () => {
      const result = await data('validate_project', {
        path: 'test/fixtures/valid/noodles.json',
      })
      assert.equal(result.valid, true)
    })

    it('takes the project inline, as an object or a string', async () => {
      const text = readFileSync(join(FIXTURES, 'valid/noodles.json'), 'utf8')
      assert.equal((await data('validate_project', { project: JSON.parse(text) })).valid, true)
      assert.equal((await data('validate_project', { project: text })).valid, true)
      assert.equal((await call('validate_project', { project: '{ nope' })).isError, true)
    })

    it('needs exactly one of path and project, and a file that exists', async () => {
      assert.equal((await call('validate_project')).isError, true)
      assert.equal((await call('validate_project', { path: 'a', project: {} })).isError, true)
      assert.match((await call('validate_project', { path: 'missing.json' })).text, /No file at/)
    })
  })

  describe('command line', () => {
    it('rejects unknown arguments and a directory that is not a checkout', () => {
      assert.ok('error' in parseArgs(['--remote'], REPO_ROOT))
      assert.ok('error' in parseArgs(['--local'], REPO_ROOT))
      assert.ok('error' in parseArgs(['--local', 'noodles-mcp'], REPO_ROOT))
      assert.deepEqual(parseArgs(['--local', '.'], REPO_ROOT), { repoRoot: REPO_ROOT })
    })

    it('serves over stdio', async () => {
      const stdio = new Client({ name: 'stdio-test', version: '0' })
      await stdio.connect(
        new StdioClientTransport({ command: process.execPath, args: [BIN], cwd: WORKDIR })
      )
      const result = await stdio.callTool({
        name: 'validate_project',
        arguments: { path: 'test/fixtures/valid/noodles.json' },
      })
      const [content] = result.content as Array<{ text: string }>
      assert.equal(JSON.parse(content.text).valid, true)
      await stdio.close()
    })
  })
})
