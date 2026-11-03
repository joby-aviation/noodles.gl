import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AddNodeMenu, ContextMenu } from './menus'

afterEach(() => cleanup())

describe('the add-node and context menus', () => {
  it('draw on the page itself, above any area, not inside the pane that opened them', () => {
    // An area's pane makes its own stacking context; a menu inside it sits under the map's
    const { container } = render(
      <div style={{ transform: 'translateZ(0)', position: 'relative', zIndex: 1 }}>
        <AddNodeMenu x={10} y={10} onPick={() => {}} onClose={() => {}} />
        <ContextMenu x={10} y={10} items={[{ label: 'Delete' }]} onClose={() => {}} />
      </div>
    )
    expect(container.querySelector('input[placeholder="Add operator…"]')).toBeNull()
    const menu = document.querySelector('input[placeholder="Add operator…"]')?.parentElement
    expect(menu?.parentElement).toBe(document.body)
    const context = [...document.querySelectorAll('button')].find(b => b.textContent === 'Delete')
    expect(context?.parentElement?.parentElement).toBe(document.body)
  })
})
