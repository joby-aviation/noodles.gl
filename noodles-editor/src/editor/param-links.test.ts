import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { canLink, linkParam, sourcesOn, targetsOn } from './param-links'

const node = (
  id: string,
  op: string,
  params: DocNode['params'] = {},
  extra: Partial<DocNode> = {}
) => ({ id, op, x: 0, y: 0, params, ...extra }) satisfies DocNode

// Two layers and two controls: a number and a color
function fixture(): EditorDoc {
  return {
    version: 1,
    name: 'links',
    nodes: [
      node('size', 'number', { value: 4 }),
      node('tint', 'color', { color: [255, 0, 0] }),
      node('dots', 'scatter'),
      node('rings', 'scatter'),
    ],
    edges: [],
  }
}

describe('linkParam', () => {
  it('makes the target read the source by a relative reference', () => {
    const doc = fixture()
    expect(linkParam(doc, 'size.value', 'dots.radiusScale')).toBe(true)
    expect(doc.nodes.find(n => n.id === 'dots')?.params.radiusScale).toEqual({ ref: 'size/value' })
  })

  it('writes an absolute path across networks', () => {
    const doc = fixture()
    doc.nodes.push(node('group', 'subnet'), node('inner', 'scatter', {}, { parent: 'group' }))
    expect(linkParam(doc, 'size.value', 'inner.opacity')).toBe(true)
    expect(doc.nodes.find(n => n.id === 'inner')?.params.opacity).toEqual({ ref: '/size/value' })
  })

  it('refuses a different kind of value, itself, and a wired parameter', () => {
    const doc = fixture()
    expect(canLink(doc, 'tint.color', 'dots.radiusScale')).toBe(false)
    expect(canLink(doc, 'dots.opacity', 'dots.opacity')).toBe(false)
    doc.edges.push({
      id: 'w',
      source: 'size',
      sourcePort: 'out',
      target: 'dots',
      targetPort: 'par:radiusScale',
    })
    expect(canLink(doc, 'size.value', 'dots.radiusScale')).toBe(false)
  })

  it('refuses a link that would make a reference loop', () => {
    const doc = fixture()
    expect(linkParam(doc, 'dots.opacity', 'rings.opacity')).toBe(true)
    expect(linkParam(doc, 'rings.opacity', 'dots.opacity')).toBe(false)
    expect(doc.nodes.find(n => n.id === 'dots')?.params.opacity).toBeUndefined()
  })
})

describe('loops through expressions', () => {
  it('refuses a link that would loop through a ch() expression', () => {
    const doc = fixture()
    doc.nodes.find(n => n.id === 'dots')!.params.opacity = { expr: "ch('rings/opacity') * 2" }
    expect(canLink(doc, 'dots.opacity', 'rings.opacity')).toBe(false)
    expect(linkParam(doc, 'dots.opacity', 'rings.opacity')).toBe(false)
    expect(doc.nodes.find(n => n.id === 'rings')?.params.opacity).toBeUndefined()
  })

  it('follows a reference into an expression further along', () => {
    const doc = fixture()
    doc.nodes.find(n => n.id === 'dots')!.params.opacity = { ref: 'size/value' }
    doc.nodes.find(n => n.id === 'size')!.params.value = { expr: "ch('rings/radiusScale') + 1" }
    expect(canLink(doc, 'dots.opacity', 'rings.radiusScale')).toBe(false)
    expect(canLink(doc, 'dots.opacity', 'rings.opacity')).toBe(true)
  })
})

describe('targetsOn and sourcesOn', () => {
  it('lists the parameters of one node a number can drive', () => {
    const keys = targetsOn(fixture(), 'dots', 'size.value').map(c => c.key)
    expect(keys).toContain('dots.radiusScale')
    expect(keys).toContain('dots.opacity')
    expect(keys).not.toContain('dots.fillColor')
  })

  it('lists the parameters of one node a color can read', () => {
    expect(sourcesOn(fixture(), 'tint', 'dots.fillColor').map(c => c.key)).toEqual(['tint.color'])
    expect(sourcesOn(fixture(), 'size', 'dots.fillColor')).toEqual([])
  })
})
