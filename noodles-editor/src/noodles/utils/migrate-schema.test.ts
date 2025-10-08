import { describe, expect, it } from 'vitest'

import type { OpType } from '../operators'
import { changeDefaultValue, migrateProject, renameHandle } from './migrate-schema'
import type { NoodlesProjectJSON } from './serialization'

describe('migrateProject', () => {
  it('gathers existing migrations', async () => {
    const project = {
      version: 0,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await migrateProject(project, { to: 1 })

    expect(migrated.version).toEqual(1)
  })

  it('allows downgrading from any intermediate version', async () => {
    const project = {
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await migrateProject(project, { to: 0 })

    expect(migrated.version).toEqual(0)
  })

  it('upgrades through multiple versions', async () => {
    const project = {
      version: 0,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await migrateProject(project, { to: 2 })

    expect(migrated.version).toEqual(2)
  })

  it('downgrades through multiple versions', async () => {
    const project = {
      version: 2,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await migrateProject(project, { to: 0 })

    expect(migrated.version).toEqual(0)
  })

  it('migrates to version 5 (qualified paths)', async () => {
    const project = {
      version: 4,
      nodes: [
        {
          id: 'code1',
          type: 'CodeOp',
          position: { x: 100, y: 100 },
          data: { inputs: { code: ['console.log("hello")'] } },
        },
        {
          id: 'viewer1',
          type: 'ViewerOp',
          position: { x: 300, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: 'code1:result->viewer1:data',
          source: 'code1',
          target: 'viewer1',
          sourceHandle: 'result',
          targetHandle: 'data',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await migrateProject(project, { to: 5 })

    expect(migrated.version).toEqual(5)
    expect(migrated.nodes[0].id).toEqual('/code1')
    expect(migrated.nodes[1].id).toEqual('/viewer1')
    expect(migrated.edges[0].source).toEqual('/code1')
    expect(migrated.edges[0].target).toEqual('/viewer1')
    expect(migrated.edges[0].sourceHandle).toEqual('out.result')
    expect(migrated.edges[0].targetHandle).toEqual('par.data')
  })
})

describe('renameHandle', () => {
  const project: NoodlesProjectJSON = {
    nodes: [
      {
        id: '/1a',
        type: 'FirstOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/2',
        type: 'SecondOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/3',
        type: 'ThirdOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/1b',
        type: 'FirstOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [
      {
        id: '/1a.out.OLD_OUT->/2.par.OLD_PAR',
        source: '/1a',
        target: '/2',
        sourceHandle: 'out.OLD_OUT',
        targetHandle: 'par.OLD_PAR',
      },
      {
        id: '/1a.out.OLD_OUT->/3.par.OLD_PAR',
        source: '/1a',
        target: '/3',
        sourceHandle: 'out.OLD_OUT',
        targetHandle: 'par.OLD_PAR',
      },
      {
        id: '/3.out.OLD_OUT->/2.par.OLD_PAR',
        source: '/3',
        target: '/2',
        sourceHandle: 'out.OLD_OUT',
        targetHandle: 'par.OLD_PAR',
      },
      {
        id: '/3.out.OLD_OUT->/1b.par.OLD_PAR',
        source: '/3',
        target: '/1b',
        sourceHandle: 'out.OLD_OUT',
        targetHandle: 'par.OLD_PAR',
      },
      {
        id: '/2.out.OLD_OUT->/1b.par.OLD_PAR',
        source: '/2',
        target: '/1b',
        sourceHandle: 'out.OLD_OUT',
        targetHandle: 'par.OLD_PAR',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    version: 1,
    timeline: {},
  }

  it('renames the FirstOp output (source) handles', () => {
    const { nodes, edges } = renameHandle({
      type: 'FirstOp' as OpType,
      inOut: 'out',
      oldHandle: 'out.OLD_OUT',
      newHandle: 'out.NEW_OUT',
      project,
    })
    expect(edges[0].sourceHandle, 'FirstOp output renamed').toEqual('out.NEW_OUT')
    expect(edges[0].targetHandle, 'SecondOp input unchanged').toEqual('par.OLD_PAR')
    expect(edges[0].id, 'renamed FirstOp output in edge id').toEqual(
      '/1a.out.NEW_OUT->/2.par.OLD_PAR'
    )

    expect(edges[1].sourceHandle, 'FirstOp output renamed').toEqual('out.NEW_OUT')
    expect(edges[1].targetHandle, 'ThirdOp input unchanged').toEqual('par.OLD_PAR')
    expect(edges[1].id, 'renamed FirstOp output in edge id').toEqual(
      '/1a.out.NEW_OUT->/3.par.OLD_PAR'
    )

    expect(edges[2], 'ThirdOp->SecondOp edge unchanged').toEqual(project.edges[2])
    expect(edges[3], 'ThirdOp->FirstOp edge unchanged').toEqual(project.edges[3])
    expect(edges[4], 'SecondOp->FirstOp edge unchanged').toEqual(project.edges[4])

    expect(nodes[0].data.inputs, 'FirstOp inputs not renamed').toEqual({ OLD_PAR: 'input' })
    expect(nodes[1].data.inputs, 'SecondOp inputs not renamed').toEqual({ OLD_PAR: 'input' })
    expect(nodes[2].data.inputs, 'ThirdOp inputs not renamed').toEqual({ OLD_PAR: 'input' })
    expect(nodes[3].data.inputs, 'FirstOp inputs not renamed').toEqual({ OLD_PAR: 'input' })
    // TODO: ensure theatre state pointers are not renamed
  })

  it('renames the FirstOp parameter (target) handles', () => {
    const { nodes, edges } = renameHandle({
      type: 'FirstOp' as OpType,
      inOut: 'par',
      oldHandle: 'par.OLD_PAR',
      newHandle: 'par.NEW_PAR',
      project,
    })
    expect(edges[0], 'FirstOp->SecondOp edge unchanged').toEqual(project.edges[0])
    expect(edges[1], 'FirstOp->ThirdOp edge unchanged').toEqual(project.edges[1])
    expect(edges[2], 'ThirdOp->SecondOp edge unchanged').toEqual(project.edges[2])

    expect(edges[3].sourceHandle, 'ThirdOp output unchanged').toEqual('out.OLD_OUT')
    expect(edges[3].targetHandle, 'FirstOp parameter renamed').toEqual('par.NEW_PAR')
    expect(edges[3].id, 'FirstOp edge id renamed for parameter').toEqual(
      '/3.out.OLD_OUT->/1b.par.NEW_PAR'
    )

    expect(edges[4].sourceHandle, 'SecondOp output unchanged').toEqual('out.OLD_OUT')
    expect(edges[4].targetHandle, 'FirstOp parameter renamed').toEqual('par.NEW_PAR')
    expect(edges[4].id, 'FirstOp edge id renamed for parameter').toEqual(
      '/2.out.OLD_OUT->/1b.par.NEW_PAR'
    )

    expect(nodes[0].data.inputs, 'FirstOp inputs renamed').toEqual({ NEW_PAR: 'input' })
    expect(nodes[1].data.inputs, 'SecondOp inputs not renamed').toEqual({ OLD_PAR: 'input' })
    expect(nodes[2].data.inputs, 'ThirdOp inputs not renamed').toEqual({ OLD_PAR: 'input' })
    expect(nodes[3].data.inputs, 'FirstOp inputs renamed').toEqual({ NEW_PAR: 'input' })
    // TODO: confirm the theatre state pointers are renamed
  })

  it('throws error if the handle is not found', () => {
    expect(() =>
      renameHandle({
        type: 'FirstOp' as OpType,
        inOut: 'par',
        oldHandle: 'nonExistingHandle',
        newHandle: 'NEW_PAR',
        project,
      })
    ).toThrow()

    expect(() =>
      renameHandle({
        type: 'FirstOp' as OpType,
        inOut: 'out',
        oldHandle: 'nonExistingHandle',
        newHandle: 'out.NEW_OUT',
        project,
      })
    ).toThrow()
  })

  it('does not rename if the node type is not found', () => {
    const { nodes: newParNodes, edges: newParEdges } = renameHandle({
      type: 'nonExistingOpType' as OpType,
      inOut: 'par',
      oldHandle: 'par.OLD_PAR',
      newHandle: 'par.NEW_PAR',
      project,
    })
    expect(newParEdges).toEqual(project.edges)
    expect(newParNodes).toEqual(project.nodes)
    const { nodes: newOutNodes, edges: newOutEdges } = renameHandle({
      type: 'nonExistingOpType' as OpType,
      inOut: 'out',
      oldHandle: 'out.OLD_OUT',
      newHandle: 'out.NEW_OUT',
      project,
    })
    expect(newOutEdges).toEqual(project.edges)
    expect(newOutNodes).toEqual(project.nodes)
    // TODO: ensure theatre state pointers are not renamed
  })
})

describe('changeDefaultValue', () => {
  const project: NoodlesProjectJSON = {
    nodes: [
      {
        id: '/1a',
        type: 'FirstOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/2',
        type: 'SecondOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/3',
        type: 'ThirdOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/1b',
        type: 'FirstOp',
        data: { inputs: { OLD_PAR: 'input' } },
        position: { x: 0, y: 0 },
      },
    ],
  }
  it('changes the default value of the FirstOp input', () => {
    const { nodes } = changeDefaultValue({
      type: 'FirstOp' as OpType,
      handle: 'OLD_PAR',
      defaultValue: 'newInput',
      project,
    })
    expect(nodes[0].data.inputs).toEqual({ OLD_PAR: 'newInput' })
  })
})
