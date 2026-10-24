import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OPERATORS } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../deck-ops'
import { UNCONVERTIBLE } from './__fixtures__/unconvertible'
import { OP_CATALOG } from './op-catalog'
import { type NoodlesProject, toEditorDoc } from './to-editor-doc'

registerDeckOperators()
const plannerOps = new Set(OPERATORS.map(o => o.type))

// That every operator class has a plan is op-catalog.test.ts: the classes load only in a browser
describe('the operator catalog', () => {
  it('names planner operators that exist, once an operator converts', () => {
    const missing = Object.entries(OP_CATALOG)
      .filter(([, p]) => !p.pending)
      .flatMap(([type, p]) =>
        (p.ops ?? []).filter(o => !plannerOps.has(o)).map(o => `${type}: ${o}`)
      )
    expect(missing).toEqual([])
  })

  it('gives a reason for every host operator and every dropped one', () => {
    const unexplained = Object.entries(OP_CATALOG)
      .filter(
        ([, p]) =>
          (p.becomes === 'host' || p.becomes === 'dropped' || p.becomes === 'refused') && !p.reason
      )
      .map(([type]) => type)
    expect(unexplained).toEqual([])
  })

  it('leaves only host operators, or ones a later step converts, in the examples', () => {
    const left: string[] = []
    for (const name of readdirSync('src/runtime/migrate/__fixtures__')
      .filter(f => f.endsWith('.json') && !UNCONVERTIBLE[f.replace(/\.json$/, '')])
      .map(f => f.replace(/\.json$/, ''))) {
      const project = JSON.parse(
        readFileSync(resolve(`src/runtime/migrate/__fixtures__/${name}.json`), 'utf8')
      ) as NoodlesProject
      for (const n of toEditorDoc(project).doc.nodes) {
        const plan = OP_CATALOG[n.op]
        if (plan && plan.becomes !== 'host' && !plan.hostWhen && !plan.pending)
          left.push(`${name}: ${n.op}`)
      }
    }
    expect(left).toEqual([])
  })
})

describe('dropped operators', () => {
  it('wires through reroutes, even a reroute of a reroute', () => {
    const project = JSON.parse(
      readFileSync(resolve('src/runtime/migrate/__fixtures__/nyc-taxis.json'), 'utf8')
    ) as NoodlesProject
    const [first, ...rest] = project.edges
    const bent: NoodlesProject = {
      ...project,
      nodes: [
        ...project.nodes,
        { id: '/bend-1', type: 'RerouteOp' },
        { id: '/bend-2', type: 'RerouteOp' },
      ],
      edges: [
        { ...first, id: 'a', target: '/bend-1', targetHandle: 'par.value' },
        {
          id: 'b',
          source: '/bend-1',
          sourceHandle: 'out.value',
          target: '/bend-2',
          targetHandle: 'par.value',
        },
        { ...first, id: 'c', source: '/bend-2', sourceHandle: 'out.value' },
        ...rest,
      ],
    }
    expect(toEditorDoc(bent).doc).toEqual(toEditorDoc(project).doc)
  })
})
