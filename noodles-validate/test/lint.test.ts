import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { loadRegistry, type Rule, unknownType, validateProject } from '../src/index.ts'

const registry = loadRegistry()
const VALID = JSON.parse(
  readFileSync(new URL('./fixtures/valid/noodles.json', import.meta.url), 'utf8')
)

type Project = typeof VALID
type Node = Project['nodes'][number]
type Edge = Project['edges'][number]

function project(change: (p: Project) => void = () => {}): Project {
  const copy = structuredClone(VALID)
  change(copy)
  return copy
}

let edgeCount = 0
function edge(source: string, sourcePort: string, target: string, targetPort: string): Edge {
  return { id: `x${edgeCount++}`, source, sourcePort, target, targetPort }
}

function node(id: string, op: string, params: Record<string, unknown> = {}, extra = {}): Node {
  return { id, op, name: id, x: 0, y: 0, params, ...extra }
}

const byId = (p: Project, id: string): Node => p.nodes.find((n: Node) => n.id === id)

function rules(p: unknown): Rule[] {
  const { errors, warnings } = validateProject(p, registry)
  return [...errors, ...warnings].map(d => d.rule)
}

function messages(p: unknown): string[] {
  const { errors, warnings } = validateProject(p, registry)
  return [...errors, ...warnings].map(d => d.message)
}

describe('validateProject', () => {
  it('passes a correctly wired document with no warnings', () => {
    assert.deepEqual(validateProject(project(), registry), {
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  describe('project shape', () => {
    it('rejects a non-object', () => {
      assert.deepEqual(rules([]), ['project-shape'])
    })

    it('rejects missing nodes and edges arrays', () => {
      const result = validateProject({ version: 1, name: 'p' }, registry)
      assert.deepEqual(
        result.errors.map(d => d.at),
        ['nodes', 'edges']
      )
    })

    it('rejects a node without a position', () => {
      const p = project(p => {
        delete byId(p, 'n3').x
      })
      assert.deepEqual(rules(p), ['project-shape'])
    })
  })

  describe('version', () => {
    it('warns, and checks nothing else, on an operator-graph file', () => {
      const old = {
        version: 19,
        nodes: [{ id: '/a', type: 'NopeOp', data: {} }],
        edges: [],
      }
      const result = validateProject(old, registry)
      assert.equal(result.valid, true)
      assert.deepEqual(
        result.warnings.map(d => d.rule),
        ['operator-graph']
      )
      assert.match(result.warnings[0].message, /converts it when it opens/)
    })

    it('tells schema 1 of the operator graph from a document by its nodes', () => {
      const old = { version: 1, nodes: [{ id: '/a', type: 'FileOp', data: {} }], edges: [] }
      assert.deepEqual(rules(old), ['operator-graph'])
    })

    it('rejects a version no editor reads', () => {
      const result = validateProject(
        project(p => (p.version = registry.convertsFrom + 1)),
        registry
      )
      assert.deepEqual(
        result.errors.map(d => d.rule),
        ['version']
      )
    })
  })

  describe('nodes', () => {
    it('suggests the operator for a display name', () => {
      const p = project(p => (byId(p, 'n1').op = 'File'))
      assert.match(messages(p)[0], /Did you mean: file\?/)
    })

    it('says what an operator class from an older file is now', () => {
      const p = project(p => (byId(p, 'n4').op = 'ScatterplotLayerOp'))
      assert.deepEqual(rules(p), ['unknown-operator'])
      assert.match(
        messages(p)[0],
        /operator class from older files\. In a document it is scatter\./
      )
    })

    it('says where every operator is listed when nothing is close', () => {
      const p = project(p => (byId(p, 'n1').op = 'qwertyuiop'))
      assert.match(messages(p)[0], /registry\.json in noodles-validate lists every operator\./)
      assert.match(
        unknownType('qwertyuiop', registry, 'list_operators shows every operator.'),
        /list_operators shows every operator\./
      )
    })

    it('does not also report the edges of an unknown operator', () => {
      assert.deepEqual(rules(project(p => (byId(p, 'n1').op = 'nope'))), ['unknown-operator'])
    })

    it('rejects duplicate ids', () => {
      const p = project(p => p.nodes.push(node('n5', 'number', {}, { name: 'other' })))
      assert.deepEqual(rules(p), ['duplicate-node-id'])
    })

    it('rejects two nodes with one name in a network, and allows it across networks', () => {
      const p = project(p => p.nodes.push(node('n6', 'number', {}, { name: 'size' })))
      assert.deepEqual(rules(p), ['duplicate-name'])
      const nested = project(p => {
        p.nodes.push(node('sub', 'subnet', {}, { name: 'group' }))
        p.nodes.push(node('n6', 'number', {}, { name: 'size', parent: 'sub' }))
      })
      assert.deepEqual(rules(nested), [])
    })

    it('rejects a parent that is not a subnet', () => {
      const p = project(p => p.nodes.push(node('n6', 'number', {}, { parent: 'n1' })))
      assert.deepEqual(rules(p), ['unknown-parent'])
    })

    it('warns about a name the editor would give', () => {
      const p = project(p => (byId(p, 'n1').name = 'file1'))
      assert.deepEqual(rules(p), ['generic-node-name'])
    })
  })

  describe('parameters', () => {
    it('rejects a parameter the operator does not have, listing near names', () => {
      const p = project(p => (byId(p, 'n4').params.radiusScal = 3))
      assert.deepEqual(rules(p), ['unknown-param'])
      assert.match(messages(p)[0], /has no parameter radiusScal\. Did you mean: .*radiusScale/)
    })

    it('rejects a menu value that is not a choice', () => {
      const p = project(p => (byId(p, 'n4').params.radiusUnits = 'feet'))
      assert.deepEqual(rules(p), ['param-value'])
      assert.match(messages(p)[0], /not one of its choices/)
    })

    it('rejects an expression object with more than the expression', () => {
      const p = project(p => (byId(p, 'n4').params.opacity = { expr: 'T', value: 1 }))
      assert.deepEqual(rules(p), ['param-value'])
    })

    it('rejects a reference to a node or parameter that is not there', () => {
      const missingNode = project(p => (byId(p, 'n4').params.opacity = { ref: 'sise/value' }))
      assert.deepEqual(rules(missingNode), ['unknown-reference'])
      assert.match(messages(missingNode)[0], /no node named sise.*Did you mean size\?/)
      const missingParam = project(
        p => (byId(p, 'n4').params.radiusScale = { expr: "ch('size/val') * 2" })
      )
      assert.deepEqual(rules(missingParam), ['unknown-reference'])
      assert.match(messages(missingParam)[0], /size \(number\) has no parameter val\./)
    })

    it('resolves references up out of a subnet', () => {
      const p = project(p => {
        p.nodes.push(node('sub', 'subnet', {}, { name: 'group' }))
        p.nodes.push(
          node('inner', 'number', { value: { ref: '../size/value' } }, { parent: 'sub' })
        )
      })
      assert.deepEqual(rules(p), [])
    })
  })

  describe('edges', () => {
    it('rejects an edge missing a port', () => {
      const p = project(p => delete p.edges[0].targetPort)
      assert.deepEqual(rules(p), ['edge-shape'])
    })

    it('says an edge names a node by its name rather than its id', () => {
      const p = project(p => (p.edges[0].source = 'quakes'))
      assert.deepEqual(rules(p), ['edge-unknown-node'])
      assert.match(messages(p)[0], /Edges use node ids; quakes is the name of n1\./)
    })

    it('rejects ports the operators do not have, with the old handle spelled out', () => {
      const p = project(p => {
        p.edges[0].sourcePort = 'out.data'
        p.edges[1].targetPort = 'par.in'
      })
      assert.deepEqual(rules(p), ['edge-port', 'edge-port'])
      assert.match(messages(p)[1], /par\.in is an old handle; write in\./)
    })

    it('drives a parameter through par:, from a number only', () => {
      const ok = project(p => p.edges.push(edge('n3', 'out', 'n4', 'par:radiusScale')))
      assert.deepEqual(rules(ok), [])
      const table = project(p => p.edges.push(edge('n1', 'out', 'n4', 'par:radiusScale')))
      assert.deepEqual(rules(table), ['edge-type'])
      const unknown = project(p => p.edges.push(edge('n3', 'out', 'n4', 'par:size')))
      assert.deepEqual(rules(unknown), ['edge-port'])
    })

    it('rejects a table wired into a deck', () => {
      const p = project(p => p.edges.push(edge('n1', 'out', 'n5', 'layers')))
      assert.deepEqual(rules(p), ['edge-type'])
    })

    it('rejects an edge across networks', () => {
      const p = project(p => {
        p.nodes.push(node('sub', 'subnet', {}, { name: 'group' }))
        p.nodes.push(node('inner', 'attribute', {}, { parent: 'sub' }))
        p.edges.push(edge('n1', 'out', 'inner', 'in'))
      })
      assert.deepEqual(rules(p), ['edge-network'])
    })

    it('rejects a repeated connection and a repeated id', () => {
      const repeated = project(p => p.edges.push({ ...p.edges[0], id: 'e9' }))
      assert.deepEqual(rules(repeated), ['duplicate-edge'])
      const sameId = project(p =>
        p.edges.push({ ...edge('n3', 'out', 'n4', 'par:opacity'), id: 'e1' })
      )
      assert.deepEqual(rules(sameId), ['duplicate-edge-id'])
    })

    it('takes several edges into a multi-input port only', () => {
      const layers = project(p => {
        p.nodes.push(node('more', 'scatter', { position: 'position' }))
        p.edges.push(edge('n2', 'out', 'more', 'in'), edge('more', 'out', 'n5', 'layers'))
      })
      assert.deepEqual(rules(layers), [])
      const single = project(p => p.edges.push(edge('n1', 'out', 'n4', 'in')))
      assert.deepEqual(rules(single), ['multiple-inputs'])
    })

    it('reports a loop once, with its path', () => {
      const p = project(p => {
        p.nodes.push(node('again', 'attribute', { name: 'x', expression: '1' }))
        p.edges.push(edge('n2', 'out', 'again', 'in'))
        p.edges[0].source = 'again'
      })
      assert.deepEqual(rules(p), ['cycle'])
      assert.match(messages(p)[0], /n2 -> again -> n2|again -> n2 -> again/)
    })
  })

  describe('timeline', () => {
    it('warns about a track whose node or parameter is not there', () => {
      const p = project(p => p.timeline.tracks.push({ target: 'n9.opacity', keys: [] }))
      assert.deepEqual(rules(p), ['timeline-target'])
      const param = project(p => (p.timeline.tracks[0].target = 'n4.opacityy'))
      assert.deepEqual(rules(param), ['timeline-target'])
      const component = project(p => (p.timeline.tracks[0].target = 'n4.fillColor.0'))
      assert.deepEqual(rules(component), [])
    })
  })
})
