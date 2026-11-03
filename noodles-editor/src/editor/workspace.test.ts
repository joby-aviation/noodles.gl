import { describe, expect, it } from 'vitest'
import {
  areas,
  closeArea,
  findEditor,
  hasEditor,
  hideEditor,
  type LayoutNode,
  PRESETS,
  parentOf,
  sanitize,
  setEditor,
  showEditor,
  splitArea,
  WORKSPACES,
} from './workspace'

const editors = (tree: LayoutNode) => areas(tree).map(a => a.editor)

// Every split's sizes add up to 100
function expectSizesSumTo100(node: LayoutNode) {
  if (node.type === 'area') return
  const total = node.children.reduce((sum, c) => sum + (node.sizes?.[c.id] ?? 0), 0)
  expect(total).toBeCloseTo(100, 5)
  node.children.forEach(expectSizesSumTo100)
}

describe('presets', () => {
  it('has one preset per workspace, each with a map and no editor twice', () => {
    for (const { id } of WORKSPACES) {
      const tree = PRESETS[id]()
      const shown = editors(tree)
      expect(new Set(shown).size).toBe(shown.length)
      expect(shown).toContain('map')
      expectSizesSumTo100(tree)
    }
  })

  it('leaves the node graph out of the default workspace', () => {
    expect(hasEditor(PRESETS.layout(), 'graph')).toBe(false)
    expect(hasEditor(PRESETS.nodes(), 'graph')).toBe(true)
  })

  it('puts the timeline under the whole window in Animation', () => {
    const tree = PRESETS.animation()
    expect(tree.type === 'split' && tree.orientation).toBe('vertical')
    expect(parentOf(tree, findEditor(tree, 'timeline')!.id)).toBe(tree)
  })
})

describe('setEditor', () => {
  it('swaps with the area that already shows the editor', () => {
    const tree = PRESETS.layout()
    const layers = findEditor(tree, 'layers')!
    const next = setEditor(tree, layers.id, 'map')
    expect(findEditor(next, 'map')!.id).toBe(layers.id)
    expect(findEditor(next, 'layers')!.id).toBe(findEditor(tree, 'map')!.id)
    expect(editors(next).sort()).toEqual(editors(tree).sort())
  })

  it('leaves the tree alone when the area already shows it', () => {
    const tree = PRESETS.layout()
    expect(setEditor(tree, findEditor(tree, 'map')!.id, 'map')).toBe(tree)
  })
})

describe('splitArea', () => {
  it('adds a sibling to a split running the same way, sharing the area’s size', () => {
    const tree = PRESETS.layout()
    const map = findEditor(tree, 'map')!
    const next = splitArea(tree, map.id, 'vertical')
    const parent = parentOf(next, map.id)!
    expect(parent.id).toBe('main')
    expect(parent.children.map(c => (c.type === 'area' ? c.editor : 'split'))).toEqual([
      'map',
      'empty',
      'timeline',
    ])
    expect(parent.sizes?.[map.id]).toBeCloseTo(37.5)
    expectSizesSumTo100(next)
  })

  it('wraps the area in a new split across its parent', () => {
    const tree = PRESETS.layout()
    const map = findEditor(tree, 'map')!
    const next = splitArea(tree, map.id, 'horizontal', 'graph')
    const parent = parentOf(next, map.id)!
    expect(parent.orientation).toBe('horizontal')
    expect(parent.children.map(c => c.type === 'area' && c.editor)).toEqual(['map', 'graph'])
    // The wrapper takes the map's place and its size
    expect(parentOf(next, parent.id)!.sizes?.[parent.id]).toBe(75)
    expectSizesSumTo100(next)
  })

  it('opens an editor already shown elsewhere as an empty area instead', () => {
    const tree = PRESETS.layout()
    const next = splitArea(tree, findEditor(tree, 'map')!.id, 'vertical', 'layers')
    expect(editors(next).filter(e => e === 'layers')).toHaveLength(1)
    expect(hasEditor(next, 'empty')).toBe(true)
  })
})

describe('closeArea', () => {
  it('gives the space to the area’s siblings and unwraps a split left with one child', () => {
    const tree = PRESETS.layout()
    const next = closeArea(tree, findEditor(tree, 'timeline')!.id)
    // `main` held the map and the timeline; the map now sits in the root directly
    const root = next as Extract<LayoutNode, { type: 'split' }>
    expect(root.children.map(c => c.id)).toEqual(['left', findEditor(tree, 'map')!.id])
    expect(root.sizes?.[findEditor(tree, 'map')!.id]).toBe(78)
    expectSizesSumTo100(next)
  })

  it('merges a split left running the same way as its parent into it', () => {
    // root(h)[a | s(v)[b / t(h)[c | d]]]: closing b leaves t alone in s, so t takes s's
    // place, runs the same way as the root, and merges into it
    const tree: LayoutNode = {
      type: 'split',
      id: 'root',
      orientation: 'horizontal',
      sizes: { a: 50, s: 50 },
      children: [
        { type: 'area', id: 'a', editor: 'layers' },
        {
          type: 'split',
          id: 's',
          orientation: 'vertical',
          sizes: { b: 50, t: 50 },
          children: [
            { type: 'area', id: 'b', editor: 'timeline' },
            {
              type: 'split',
              id: 't',
              orientation: 'horizontal',
              sizes: { c: 40, d: 60 },
              children: [
                { type: 'area', id: 'c', editor: 'map' },
                { type: 'area', id: 'd', editor: 'graph' },
              ],
            },
          ],
        },
      ],
    }
    const next = closeArea(tree, 'b')
    expect(next).toMatchObject({ id: 'root', orientation: 'horizontal' })
    expect(editors(next)).toEqual(['layers', 'map', 'graph'])
    expect(next.type === 'split' && next.sizes).toEqual({ a: 50, c: 20, d: 30 })
  })

  it('never closes the last area', () => {
    const only: LayoutNode = { type: 'area', id: 'x', editor: 'map' }
    expect(closeArea(only, 'x')).toBe(only)
  })
})

describe('showEditor and hideEditor', () => {
  it('opens the spreadsheet beside the map, and closes it again', () => {
    const tree = PRESETS.layout()
    const shown = showEditor(tree, 'spreadsheet')
    const map = findEditor(shown, 'map')!
    const parent = parentOf(shown, map.id)!
    expect(parent.orientation).toBe('horizontal')
    expect(parent.children.map(c => c.type === 'area' && c.editor)).toEqual(['map', 'spreadsheet'])
    expectSizesSumTo100(shown)

    const hidden = hideEditor(shown, 'spreadsheet')
    expect(editors(hidden)).toEqual(editors(tree))
    expectSizesSumTo100(hidden)
  })

  it('fills an empty area before splitting one', () => {
    const tree = PRESETS.layout()
    const withEmpty = splitArea(tree, findEditor(tree, 'map')!.id, 'vertical')
    const empty = findEditor(withEmpty, 'empty')!
    expect(findEditor(showEditor(withEmpty, 'graph'), 'graph')!.id).toBe(empty.id)
  })

  it('opens layers along the left edge when nothing it belongs with is open', () => {
    const tree = hideEditor(hideEditor(PRESETS.layout(), 'layers'), 'properties')
    const next = showEditor(tree, 'layers')
    expect(next.type === 'split' && next.orientation).toBe('horizontal')
    expect(next.type === 'split' && next.children[0]).toMatchObject({ editor: 'layers' })
  })

  it('brings the map back as the large area right of the panels', () => {
    const tree = hideEditor(hideEditor(PRESETS.layout(), 'timeline'), 'map')
    const next = showEditor(tree, 'map')
    expect(next.type === 'split' && next.orientation).toBe('horizontal')
    expect(next.type === 'split' && next.children.map(c => c.id)).toEqual([
      'left',
      expect.any(String),
    ])
    expect(findEditor(next, 'map')).toBeDefined()
    expect(next.type === 'split' && next.sizes?.[findEditor(next, 'map')!.id]).toBe(75)
    expectSizesSumTo100(next)
  })

  it('does nothing for an editor already shown', () => {
    const tree = PRESETS.layout()
    expect(showEditor(tree, 'map')).toBe(tree)
    expect(hideEditor(tree, 'graph')).toBe(tree)
  })
})

describe('sanitize', () => {
  it('reads back a saved tree unchanged', () => {
    const tree = PRESETS.nodes()
    expect(sanitize(JSON.parse(JSON.stringify(tree)))).toEqual(tree)
  })

  it('empties unknown editors and second copies of an editor', () => {
    const tree = sanitize({
      type: 'split',
      id: 'r',
      orientation: 'horizontal',
      children: [
        { type: 'area', id: 'a', editor: 'map' },
        { type: 'area', id: 'b', editor: 'map' },
        { type: 'area', id: 'c', editor: 'teapot' },
      ],
    })
    expect(tree && editors(tree)).toEqual(['map', 'empty', 'empty'])
  })

  it('drops malformed nodes and returns nothing when none are left', () => {
    expect(sanitize(null)).toBeUndefined()
    expect(
      sanitize({ type: 'split', id: 'r', orientation: 'diagonal', children: [] })
    ).toBeUndefined()
    expect(
      sanitize({
        type: 'split',
        id: 'r',
        orientation: 'vertical',
        children: [{ type: 'area', id: 'a', editor: 'map' }, { nope: true }],
      })
    ).toEqual({ type: 'area', id: 'a', editor: 'map' })
  })
})
