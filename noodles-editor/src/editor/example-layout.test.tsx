// Every example opens laid out: no node or note drawn over another, and every wire running
// left to right, at the sizes the network actually renders them
import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// The stylesheets the editor loads, so nodes take their real sizes
import '../index.css'
import '../noodles/layers.css'
import { DocNetwork } from './doc-network'
import { docStore } from './doc-store'

const examples = import.meta.glob('../examples/*/noodles.json', {
  eager: true,
  import: 'default',
}) as Record<string, EditorDoc>

type Rect = { id: string; x: number; y: number; w: number; h: number }

function rects(container: HTMLElement): Rect[] {
  return [...container.querySelectorAll<HTMLElement>('.react-flow__node')].map(el => {
    const [, x, y] = el.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/) ?? []
    return {
      id: el.dataset.id ?? '',
      x: Number(x),
      y: Number(y),
      w: el.offsetWidth,
      h: el.offsetHeight,
    }
  })
}

function overlaps(all: Rect[]): string[] {
  const found: string[] = []
  all.forEach((a, i) => {
    for (const b of all.slice(i + 1)) {
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        found.push(`${a.id} and ${b.id}`)
      }
    }
  })
  return found
}

describe('example layouts', () => {
  afterEach(() => cleanup())

  it.each(Object.entries(examples).map(([path, doc]) => [path.split('/')[2], doc] as const))(
    '%s has no overlapping nodes and its wires run left to right',
    async (_name, doc) => {
      vi.useRealTimers()
      docStore().load(structuredClone(doc))
      const { container } = render(
        <ReactFlowProvider>
          <div style={{ width: 1200, height: 400 }}>
            <DocNetwork />
          </div>
        </ReactFlowProvider>
      )
      await waitFor(() => {
        const drawn = rects(container)
        expect(drawn).toHaveLength(doc.nodes.length)
        expect(drawn.every(r => r.w > 0 && r.h > 0)).toBe(true)
      })
      const drawn = rects(container)
      expect(overlaps(drawn)).toEqual([])
      const at = new Map(drawn.map(r => [r.id, r]))
      const backward = doc.edges
        .filter(e => {
          const [a, b] = [at.get(e.source), at.get(e.target)]
          return a && b && a.x + a.w > b.x
        })
        .map(e => `${e.source} to ${e.target}`)
      expect(backward).toEqual([])
    }
  )
})
