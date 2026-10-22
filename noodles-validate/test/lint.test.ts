import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { loadRegistry, type Rule, validateProject } from '../src/index.ts'

const registry = loadRegistry()
const VALID = JSON.parse(
  readFileSync(new URL('./fixtures/valid/noodles.json', import.meta.url), 'utf8')
)
// The fixture is a current project whatever the latest migration is
VALID.version = registry.projectVersion

type Project = typeof VALID
type Node = Project['nodes'][number]
type Edge = Project['edges'][number]

function project(change: (p: Project) => void = () => {}): Project {
  const copy = structuredClone(VALID)
  change(copy)
  return copy
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}

function node(id: string, type: string, inputs: Record<string, unknown> = {}): Node {
  return { id, type, position: { x: 0, y: 0 }, data: { inputs } }
}

function rules(p: unknown): Rule[] {
  const { errors, warnings } = validateProject(p, registry)
  return [...errors, ...warnings].map(d => d.rule)
}

function messages(p: unknown): string[] {
  const { errors, warnings } = validateProject(p, registry)
  return [...errors, ...warnings].map(d => d.message)
}

describe('validateProject', () => {
  it('passes a current, correctly wired project with no warnings', () => {
    const result = validateProject(project(), registry)
    assert.deepEqual(result, { valid: true, errors: [], warnings: [] })
  })

  it('reads the schema version from the registry', () => {
    assert.equal(typeof registry.projectVersion, 'number')
    const stale = validateProject(
      project(p => (p.version = registry.projectVersion - 1)),
      registry
    )
    assert.deepEqual(
      stale.errors.map(d => d.rule),
      ['version']
    )
  })

  describe('project shape', () => {
    it('rejects a non-object', () => {
      assert.deepEqual(rules([]), ['project-shape'])
    })

    it('rejects missing nodes and edges arrays', () => {
      const result = validateProject({ version: registry.projectVersion }, registry)
      assert.equal(result.valid, false)
      assert.deepEqual(
        result.errors.map(d => d.at),
        ['nodes', 'edges']
      )
    })

    it('rejects a missing version', () => {
      assert.deepEqual(
        rules(
          project(p => {
            delete p.version
          })
        ),
        ['project-shape']
      )
    })
  })

  describe('version', () => {
    it('says to migrate an older file, not to edit the number', () => {
      const result = validateProject(
        project(p => (p.version = 6)),
        registry
      )
      assert.equal(result.errors[0].rule, 'version')
      assert.match(result.errors[0].message, /migrate-projects/)
      assert.match(result.errors[0].message, /rather than changing the number/)
    })

    it('rejects a file newer than the registry', () => {
      const result = validateProject(
        project(p => (p.version = registry.projectVersion + 1)),
        registry
      )
      assert.equal(result.errors[0].rule, 'version')
      assert.match(result.errors[0].message, /newer than this checkout/)
    })
  })

  describe('nodes', () => {
    it('suggests the Op type for a display name', () => {
      const p = project(p => (p.nodes[0].type = 'File'))
      assert.deepEqual(rules(p), ['unknown-operator'])
      assert.match(messages(p)[0], /Did you mean: FileOp\?/)
    })

    it('suggests a type one typo away', () => {
      const p = project(p => (p.nodes[2].type = 'ScaterplotLayerOp'))
      assert.match(messages(p)[0], /ScatterplotLayerOp/)
    })

    it('does not also report the edges of an unknown operator', () => {
      assert.deepEqual(rules(project(p => (p.nodes[0].type = 'NopeOp'))), ['unknown-operator'])
    })

    it('rejects an input the operator does not have, listing near names', () => {
      const p = project(p => (p.nodes[2].data.inputs.radius = 3))
      assert.deepEqual(rules(p), ['unknown-input'])
      assert.match(messages(p)[0], /has no input radius\. Did you mean: getRadius/)
    })

    it('accepts inputs the node declares in customInputs', () => {
      const p = project(p => {
        p.nodes[0].data.customInputs = [{ id: 'a', name: 'threshold', type: 'number', order: 0 }]
        p.nodes[0].data.inputs.threshold = 4
      })
      assert.deepEqual(rules(p), [])
    })

    it('rejects ids that are not absolute paths', () => {
      assert.deepEqual(rules(project(p => p.nodes.push(node('basemap-2', 'NumberOp')))), [
        'node-id',
      ])
      assert.deepEqual(rules(project(p => p.nodes.push(node('/trailing/', 'NumberOp')))), [
        'node-id',
      ])
    })

    it('rejects a duplicate node id', () => {
      assert.deepEqual(rules(project(p => p.nodes.push(node('/deck', 'NumberOp')))), [
        'duplicate-node-id',
      ])
    })

    it('does not take Object properties for operator types', () => {
      for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        assert.deepEqual(rules(project(p => p.nodes.push(node('/odd', type)))), [
          'unknown-operator',
        ])
      }
    })

    it('rejects a custom input type the editor cannot load', () => {
      const p = project(p => {
        p.nodes[0].data.customInputs = [
          { id: 'a', name: 'threshold', type: 'NumberField', order: 0 },
        ]
        p.nodes[0].data.inputs.threshold = 4
      })
      assert.deepEqual(rules(p), ['custom-input'])
      assert.match(messages(p)[0], /type "NumberField".*Custom input types are: number, string/)
    })

    it('rejects custom inputs without a name, or not in an array', () => {
      const unnamed = project(p => {
        p.nodes[0].data.customInputs = [{ id: 'a', type: 'number', order: 0 }]
      })
      assert.deepEqual(rules(unnamed), ['custom-input'])
      const notArray = project(p => {
        p.nodes[0].data.customInputs = { name: 'threshold' }
      })
      assert.deepEqual(rules(notArray), ['custom-input'])
    })

    it('skips React Flow group nodes', () => {
      assert.deepEqual(rules(project(p => p.nodes.push(node('/loop-group', 'group')))), [])
    })

    it('warns about generic names', () => {
      assert.deepEqual(rules(project(p => p.nodes.push(node('/number-1', 'NumberOp')))), [
        'generic-node-name',
      ])
    })
  })

  describe('edges', () => {
    it('rejects an edge to a node that does not exist, suggesting the near one', () => {
      const p = project(p => {
        p.edges[0].target = '/quakes-layr'
      })
      assert.ok(rules(p).includes('edge-unknown-node'))
      assert.match(messages(p).join('\n'), /Did you mean \/quakes-layer\?/)
    })

    it('rejects an output that does not exist', () => {
      const p = project(p => {
        p.edges[2] = edge('/quakes-layer', 'out.vis', '/deck', 'par.layers')
      })
      assert.deepEqual(rules(p), ['edge-handle'])
      assert.match(messages(p)[0], /has no output vis\. Outputs on \/quakes-layer: out\.layer/)
    })

    it('rejects an in. prefix and a bare field name', () => {
      const inPrefix = project(p => {
        p.edges[5] = edge('/deck', 'out.vis', '/out', 'in.vis')
      })
      assert.match(messages(inPrefix)[0], /in\.vis is malformed.*Did you mean: par\.vis/)

      const bare = project(p => {
        p.edges[0] = edge('/earthquakes', 'data', '/quakes-layer', 'par.data')
      })
      assert.match(messages(bare)[0], /sourceHandle data is malformed.*out\.data/)
    })

    it('rejects handles on the wrong side', () => {
      const p = project(p => {
        p.edges[0] = edge('/earthquakes', 'par.data', '/quakes-layer', 'out.data')
      })
      assert.deepEqual(rules(p), ['edge-handle', 'edge-handle'])
      assert.match(messages(p)[0], /on the wrong side/)
    })

    it('accepts edges into custom inputs', () => {
      const p = project(p => {
        p.nodes[1].data.customInputs = [{ id: 'a', name: 'scale', type: 'number', order: 0 }]
        p.edges.push(edge('/earthquakes', 'out.data', '/position', 'par.scale'))
      })
      assert.deepEqual(rules(p), [])
    })

    it('rejects a repeated connection', () => {
      assert.deepEqual(rules(project(p => p.edges.push({ ...p.edges[0] }))), ['duplicate-edge'])
    })

    it('rejects two connections sharing an id', () => {
      const p = project(p => {
        p.edges[1].id = p.edges[0].id
      })
      assert.ok(rules(p).includes('duplicate-edge-id'))
    })

    it('rejects two edges into an input that takes one', () => {
      const p = project(p => {
        p.nodes.push(node('/other-data', 'FileOp'))
        p.edges.push(edge('/other-data', 'out.data', '/quakes-layer', 'par.data'))
      })
      assert.deepEqual(rules(p), ['multiple-inputs'])
    })

    it('accepts several edges into a list input', () => {
      // The fixture already sends two layers into /deck par.layers
      assert.equal(VALID.edges.filter((e: Edge) => e.targetHandle === 'par.layers').length, 2)
      assert.deepEqual(rules(project()), [])
    })

    it('warns about a canonical id naming other endpoints', () => {
      const p = project(p => {
        p.edges[0].id = '/old-name.out.data->/quakes-layer.par.data'
      })
      assert.deepEqual(rules(p), ['stale-edge-id'])
      assert.match(messages(p)[0], /becomes \/earthquakes\.out\.data->\/quakes-layer\.par\.data/)
    })

    it('leaves legacy and repaired ids alone', () => {
      const p = project(p => {
        p.edges[0].id = 'reactflow__edge-1'
        p.edges[1].id = '/position.accessor->/quakes-layer.getPosition'
        p.edges[2].id = `${p.edges[2].id}#2`
      })
      assert.deepEqual(rules(p), [])
    })

    it('ignores saved ReferenceEdges, which load re-derives', () => {
      const p = project(p => {
        p.edges.push({ ...edge('/nowhere', 'out.x', '/deck', 'par.code'), type: 'ReferenceEdge' })
      })
      assert.deepEqual(rules(p), [])
    })

    it('rejects an edge missing its handles', () => {
      const p = project(p => {
        delete p.edges[0].sourceHandle
      })
      assert.deepEqual(rules(p), ['edge-shape'])
    })

    it("gives a GraphInputOp its container's custom inputs on both sides", () => {
      const withContainer = (customInputs: unknown[]) =>
        project(p => {
          const container = node('/scaled', 'ContainerOp')
          container.data.customInputs = customInputs
          p.nodes.push(
            container,
            node('/scaled/graph-input', 'GraphInputOp', { threshold: 2 }),
            node('/scaled/times', 'MathOp', { operator: 'multiply' })
          )
          p.edges.push(
            edge('/scaled', 'par.threshold', '/scaled/graph-input', 'par.threshold'),
            edge('/scaled/graph-input', 'out.threshold', '/scaled/times', 'par.a')
          )
        })
      const threshold = [{ id: 'a', name: 'threshold', type: 'number', order: 0 }]
      assert.deepEqual(rules(withContainer(threshold)), [])
      // Without the declaration, every use of the field is reported
      assert.deepEqual(rules(withContainer([])), [
        'unknown-input',
        'edge-handle',
        'edge-handle',
        'edge-handle',
      ])
    })

    it('accepts container boundary edges from par. and into out.', () => {
      const p = project(p => {
        p.nodes.push(
          node('/doubled', 'ContainerOp'),
          node('/doubled/graph-input', 'GraphInputOp'),
          node('/doubled/times-two', 'MathOp', { operator: 'multiply', b: 2 }),
          node('/doubled/graph-output', 'GraphOutputOp'),
          node('/radius', 'NumberOp', { val: 3 })
        )
        p.edges.push(
          edge('/radius', 'out.val', '/doubled', 'par.in'),
          edge('/doubled', 'par.in', '/doubled/graph-input', 'par.parentValue'),
          edge('/doubled/graph-input', 'out.value', '/doubled/times-two', 'par.a'),
          edge('/doubled/times-two', 'out.result', '/doubled/graph-output', 'par.value'),
          edge('/doubled/graph-output', 'out.propagatedValue', '/doubled', 'out.out'),
          edge('/doubled', 'out.out', '/quakes-layer', 'par.getRadius')
        )
      })
      assert.deepEqual(rules(p), [])
    })
  })
})
