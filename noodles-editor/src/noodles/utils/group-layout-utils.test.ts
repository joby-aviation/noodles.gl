import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { layoutGroups } from './group-layout-utils'

function node(
  id: string,
  position: { x: number; y: number },
  parentId?: string,
  size?: { width: number; height: number }
): Node {
  return { id, position, parentId, measured: size, data: {} }
}

function group(id: string, position = { x: 0, y: 0 }, parentId?: string): Node {
  return {
    id,
    type: 'group',
    position,
    parentId,
    style: { width: 1200, height: 400 },
    data: {},
  }
}

function byId(nodes: Node[], id: string): Node {
  return nodes.find(node => node.id === id)!
}

function absolutePosition(nodes: Node[], id: string): { x: number; y: number } {
  const current = byId(nodes, id)
  if (!current.parentId) return current.position
  const parent = absolutePosition(nodes, current.parentId)
  return { x: parent.x + current.position.x, y: parent.y + current.position.y }
}

describe('layoutGroups', () => {
  it('shrinks and moves a group around its children with padding', () => {
    const nodes = [
      group('/body'),
      node('/begin', { x: 100, y: 100 }, '/body', { width: 100, height: 60 }),
      node('/end', { x: 400, y: 100 }, '/body', { width: 100, height: 60 }),
    ]
    const parents = new Map(nodes.map(node => [node.id, node.parentId]))

    const result = layoutGroups(nodes, new Set(['/body']), parents)
    const body = byId(result, '/body')

    expect(body.position).toEqual({ x: 60, y: 60 })
    expect(body.style).toMatchObject({ width: 480, height: 140 })
    expect(absolutePosition(result, '/begin')).toEqual({ x: 100, y: 100 })
    expect(absolutePosition(result, '/end')).toEqual({ x: 400, y: 100 })
  })

  it('reparents nodes without changing their canvas position and orders the parent first', () => {
    const nodes = [
      node('/child', { x: 500, y: 180 }, undefined, { width: 100, height: 60 }),
      group('/body', { x: 100, y: 100 }),
    ]
    const parents = new Map<string, string | undefined>([
      ['/child', '/body'],
      ['/body', undefined],
    ])

    const result = layoutGroups(nodes, new Set(['/body']), parents)

    expect(byId(result, '/child').parentId).toBe('/body')
    expect(absolutePosition(result, '/child')).toEqual({ x: 500, y: 180 })
    expect(result.map(node => node.id)).toEqual(['/body', '/child'])
  })

  it('fits nested groups from the inside out', () => {
    const nodes = [
      group('/outer'),
      group('/inner', { x: 300, y: 100 }),
      node('/child', { x: 40, y: 40 }, '/inner', { width: 100, height: 60 }),
    ]
    const parents = new Map<string, string | undefined>([
      ['/outer', undefined],
      ['/inner', '/outer'],
      ['/child', '/inner'],
    ])

    const result = layoutGroups(nodes, new Set(['/outer', '/inner']), parents)

    expect(byId(result, '/inner').parentId).toBe('/outer')
    expect(byId(result, '/inner').style).toMatchObject({ width: 200, height: 140 })
    expect(byId(result, '/outer').style).toMatchObject({ width: 280, height: 220 })
    expect(absolutePosition(result, '/child')).toEqual({ x: 340, y: 140 })
  })

  it('keeps existing bounds until every child is measured', () => {
    const nodes = [
      group('/body', { x: 100, y: 100 }),
      node('/measured', { x: 40, y: 40 }, '/body', { width: 100, height: 60 }),
      node('/waiting', { x: 300, y: 40 }, '/body'),
    ]
    const parents = new Map(nodes.map(node => [node.id, node.parentId]))

    const result = layoutGroups(nodes, new Set(['/body']), parents)

    expect(byId(result, '/body').position).toEqual({ x: 100, y: 100 })
    expect(byId(result, '/body').style).toMatchObject({ width: 1200, height: 400 })
  })
})
