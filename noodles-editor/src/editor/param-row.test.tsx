import { type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../runtime/deck-ops'
import { docStore } from './doc-store'
import { NodeFields } from './field-adapter'
import { ParamRow } from './param-row'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'rows',
  nodes: [{ id: 'map', op: 'deck', x: 0, y: 0, params: { zoom: 5 } }],
  edges: [],
})

beforeAll(() => registerDeckOperators())
beforeEach(() => docStore().load(doc()))
afterEach(() => cleanup())

const row = (name: string) => {
  const node = docStore().get().doc.nodes[0]
  const def = OPERATOR_INDEX.get('deck')?.params.find(p => p.name === name)
  const b = def && new NodeFields(docStore(), node).bindings.get(name)
  if (!def || !b) throw new Error(`no ${name}`)
  const view = render(<ParamRow node={node} def={def} field={b.field} wired={false} />)
  return { ...view, el: view.container.querySelector('[data-field-row]') as HTMLElement }
}
const button = (text: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith(text)) as
    | HTMLElement
    | undefined

describe('a property’s right-click menu', () => {
  it('drives a number with a node made from its menu, starting at its value', () => {
    const { el } = row('zoom')
    fireEvent.contextMenu(el)
    const drive = button('Drive with')
    expect(drive).toBeTruthy()
    fireEvent.mouseEnter(drive as HTMLElement)
    fireEvent.click(button('Number') as HTMLElement)
    const d = docStore().get().doc
    const number = d.nodes.find(n => n.op === 'number')
    expect(number?.params.value).toBe(5)
    expect(d.edges).toContainEqual(
      expect.objectContaining({ source: number?.id, target: 'map', targetPort: 'par:zoom' })
    )
  })
})

describe('a URL property', () => {
  it('takes a URL dropped on it from outside the editor', () => {
    const { el } = row('mapStyle')
    const url = 'https://example.com/style.json'
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', url)
    // Native events: testing-library copies a DataTransfer into an empty one
    const drag = (type: string) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
    // Taken: the browser's default (refuse the drop) is prevented
    expect(drag('dragover')).toBe(false)
    drag('drop')
    expect(docStore().get().doc.nodes[0].params.mapStyle).toBe(url)
  })
})
