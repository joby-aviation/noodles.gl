import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docStore, useEditor } from './doc-store'
import { HistogramEditor, roundTo } from './histogram-editor'

// Ten bins from 0 to 10, and a brush that keeps 40 rows
const BINS = Array.from({ length: 10 }, (_, i) => ({ x0: i, x1: i + 1, count: 10 }))
// One state object, as the real store keeps until the engine draws again
const engine = vi.hoisted(() => {
  const slots = new Map<string, unknown>()
  return {
    slots,
    state: {
      lowered: {
        outputs: { hist: { out: 'hist', bins: 'hist__bins' } },
        graph: { nodes: [{ id: 'hist', type: 'filter', input: 'src' }] },
      },
      slots,
    },
    asked: [] as { id: string; columns?: string[] }[],
  }
})

vi.mock('./doc-engine', () => ({
  useEngineState: () => engine.state,
  currentEngine: () => ({
    runtime: {
      nodeSql: async (id: string, columns?: string[]) => {
        engine.asked.push({ id, columns })
        return { sql: `SELECT * FROM ${id}`, shape: {}, hash: id }
      },
      query: async (sql: string) => (sql.startsWith('WITH') ? BINS : [{ n: 40 }]),
    },
  }),
}))

const node = (params: DocNode['params'] = {}): DocNode => ({
  id: 'hist',
  op: 'brushable-histogram',
  x: 0,
  y: 0,
  params: { column: 'mag', brushMin: 2, brushMax: 6, ...params },
})
const doc = (n: DocNode): EditorDoc => ({ version: 1, name: 'h', nodes: [n], edges: [] })
const params = () => docStore().get().doc.nodes[0].params

// The node as the pane gives it: re-read from the document on every edit
function Live() {
  const n = useEditor(st => st.doc.nodes[0])
  return <HistogramEditor node={n} />
}

async function show(n: DocNode) {
  docStore().load(doc(n))
  render(<Live />)
  // setupTests runs fake timers; the queries are promises
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

describe('HistogramEditor', () => {
  beforeEach(() => engine.slots.clear())
  afterEach(() => cleanup())

  it('draws the bins and how many rows the brush keeps', async () => {
    await show(node())
    expect(document.querySelectorAll('rect').length).toBe(BINS.length + 1)
    expect(screen.getByText('Kept 40 of 100 rows with a value')).toBeTruthy()
    // Bins of the rows it reads, the count of the rows it keeps: only the column is lowered
    expect(engine.asked).toContainEqual({ id: 'src', columns: ['mag'] })
    expect(engine.asked).toContainEqual({ id: 'hist', columns: ['mag'] })
    expect(
      screen.getByRole('slider', { name: 'Brush minimum' }).getAttribute('aria-valuenow')
    ).toBe('2')
  })

  it('moves a handle from the keyboard, inside the other handle', async () => {
    await show(node())
    const min = screen.getByRole('slider', { name: 'Brush minimum' })
    fireEvent.keyDown(min, { key: 'ArrowRight' })
    expect(params().brushMin).toBeCloseTo(2.1)
    fireEvent.keyDown(min, { key: 'End' })
    expect(params().brushMin).toBe(6)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Brush maximum' }), { key: 'Home' })
    expect(params().brushMax).toBe(6)
  })

  it('moves the brush by its center in offset mode, keeping its width', async () => {
    await show(node({ brushMode: 'offset' }))
    fireEvent.change(screen.getByLabelText('Center'), { target: { value: '9' } })
    // The center stops where the brush meets the extent
    expect(params()).toMatchObject({ brushMin: 6, brushMax: 10 })
  })

  it('shows the brush where the playhead has it, for a keyframed one', async () => {
    engine.slots.set('hist.brushMin', 3.5)
    await show(node())
    const min = screen.getByRole('slider', { name: 'Brush minimum' })
    expect(min.getAttribute('aria-valuenow')).toBe('3.5')
  })
})

describe('roundTo', () => {
  it('keeps a thousandth of the extent', () => {
    expect(roundTo(4.542061152061152, [2.5, 7.4])).toBe(4.542)
    expect(roundTo(1234.5678, [0, 10_000])).toBe(1235)
    expect(roundTo(0.0123456, [0, 0.05])).toBe(0.01235)
  })
})
