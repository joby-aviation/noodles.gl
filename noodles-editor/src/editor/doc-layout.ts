// Lays out one network left to right, as data flows: a column per step, each node level with
// what feeds it so a chain reads as a straight line, notes above the node they explain.
//
// The layout takes the sizes the network draws nodes at (`size`) and a note's height at a width
// (`noteHeight`), since only the page knows either.

import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { nameOf } from '@noodles.gl/planner'

export interface Size {
  w: number
  h: number
}

export interface LayoutOptions {
  size(id: string): Size
  /** A note's height when its text wraps at `width` */
  noteHeight(id: string, width: number): number
}

export interface Placed {
  x: number
  y: number
  /** A note's new size: notes take their column's width */
  width?: number
  height?: number
}

const GAP_X = 64
const GAP_Y = 24
const NOTE_GAP = 8
// Narrower than this, a note's text wraps a word or two per line
const MIN_NOTE_WIDTH = 220

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** New positions for the nodes and notes in `network` (the root when undefined). */
export function layoutNetwork(
  doc: EditorDoc,
  network: string | undefined,
  { size, noteHeight }: LayoutOptions
): Map<string, Placed> {
  const members = doc.nodes.filter(n => n.parent === network)
  const nodes = members.filter(n => n.op !== 'comment')
  const notes = members.filter(n => n.op === 'comment')
  const placed = new Map<string, Placed>()
  if (nodes.length === 0) return placed

  // What each node reads: its wires, and the siblings its parameters reference
  const ids = new Set(nodes.map(n => n.id))
  const byName = new Map(nodes.map(n => [nameOf(n), n.id]))
  const deps = new Map(nodes.map(n => [n.id, new Set<string>()]))
  for (const e of doc.edges) {
    if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      deps.get(e.target)?.add(e.source)
  }
  for (const n of nodes) {
    const text = JSON.stringify(n.params)
    for (const m of text.matchAll(/"ref":"([^"/.][^"/]*)\/|ch\('([^'/.][^'/]*)\//g)) {
      const source = byName.get(m[1] ?? m[2])
      if (source && source !== n.id) deps.get(n.id)?.add(source)
    }
  }
  const readers = new Map(nodes.map(n => [n.id, [] as string[]]))
  for (const [target, sources] of deps) for (const s of sources) readers.get(s)?.push(target)

  // Columns: the longest path from a source, then each node moved right to sit just before
  // the nearest node that reads it
  const rank = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (id: string): number => {
    const known = rank.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const r = Math.max(-1, ...[...(deps.get(id) ?? [])].map(rankOf)) + 1
    visiting.delete(id)
    rank.set(id, r)
    return r
  }
  for (const n of nodes) rankOf(n.id)
  const byRankDesc = [...nodes].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
  for (const n of byRankDesc) {
    const r = (readers.get(n.id) ?? []).map(id => rank.get(id) ?? 0)
    if (r.length) rank.set(n.id, Math.max(rank.get(n.id) ?? 0, Math.min(...r) - 1))
  }
  const last = Math.max(...rank.values())
  const columns: DocNode[][] = Array.from({ length: last + 1 }, () => [])
  for (const n of nodes) columns[rank.get(n.id) ?? 0].push(n)

  // Each note explains the node right below it: the nearest one its width overlaps, which is
  // where a laid-out note sits, so laying out again keeps every note on its node. Failing that,
  // the nearest node, preferring ones below it.
  const notesOf = new Map<string, DocNode[]>()
  for (const note of notes) {
    const s = size(note.id)
    const cx = note.x + s.w / 2
    const bottom = note.y + s.h
    let best: DocNode | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const n of nodes) {
      const t = size(n.id)
      const dy = n.y - bottom
      const under = dy >= -4 && n.x < note.x + s.w && note.x < n.x + t.w
      const d = under ? dy - 1e6 : Math.hypot(n.x + t.w / 2 - cx, dy * (dy >= -20 ? 1 : 2.5))
      if (d < bestDistance) {
        bestDistance = d
        best = n
      }
    }
    if (!best) continue
    notesOf.set(best.id, [...(notesOf.get(best.id) ?? []), note])
  }
  // The last column's notes go beside it rather than above, where the pane has room to spare
  const side = columns[last].flatMap(n => notesOf.get(n.id) ?? [])
  for (const n of columns[last]) notesOf.delete(n.id)

  const widths = columns.map(c =>
    Math.max(...c.map(n => size(n.id).w), c.some(n => notesOf.has(n.id)) ? MIN_NOTE_WIDTH : 0)
  )
  const heights = new Map<string, number>()
  columns.forEach((c, i) => {
    for (const n of c)
      for (const note of notesOf.get(n.id) ?? [])
        heights.set(note.id, noteHeight(note.id, widths[i]))
  })
  const above = (id: string) =>
    (notesOf.get(id) ?? []).reduce((sum, note) => sum + (heights.get(note.id) ?? 0) + NOTE_GAP, 0)

  // Rows: each node level with the median of what it reads (left to right), then each node
  // with no reader-side preference level with what reads it (right to left), then again
  const y = new Map<string, number>()
  let top = 0
  for (const n of [...columns[0]].sort((a, b) => a.y - b.y)) {
    top += above(n.id)
    y.set(n.id, top)
    top += size(n.id).h + GAP_Y
  }
  // Nodes that feed one multi-input port (the deck's layers) keep the order of its wires
  const portIndex = new Map<string, number>()
  for (const e of doc.edges) if (e.index !== undefined) portIndex.set(e.source, e.index)
  const place = (column: DocNode[], wanted: (id: string) => number | undefined) => {
    const desired = new Map(column.map(n => [n.id, wanted(n.id) ?? y.get(n.id) ?? 0]))
    const order = [...column].sort((a, b) => (desired.get(a.id) ?? 0) - (desired.get(b.id) ?? 0))
    const indexed = order.filter(n => portIndex.has(n.id))
    const slots = indexed.map(n => order.indexOf(n))
    const byIndex = [...indexed].sort(
      (a, b) => (portIndex.get(a.id) ?? 0) - (portIndex.get(b.id) ?? 0)
    )
    slots.forEach((slot, i) => {
      order[slot] = byIndex[i]
    })
    let bottom = Number.NEGATIVE_INFINITY
    for (const n of order) {
      const at = Math.max(desired.get(n.id) ?? 0, bottom + GAP_Y + above(n.id))
      y.set(n.id, at)
      bottom = at + size(n.id).h
    }
  }
  // Where a node's top goes to be centered on the nodes it reads or that read it. Centers, not
  // ports: every node's outputs sit below its inputs, so lining up ports steps each link of a
  // chain further down the page.
  const level = (id: string, side: 'reads' | 'readers') => {
    const others = side === 'reads' ? (deps.get(id) ?? []) : (readers.get(id) ?? [])
    const ys = [...others]
      .filter(other => y.has(other))
      .map(other => (y.get(other) ?? 0) + size(other).h / 2 - size(id).h / 2)
    return ys.length ? median(ys) : undefined
  }
  const fromReads = (id: string) => level(id, 'reads')
  const fromReaders = (id: string) => level(id, 'readers')
  for (let c = 1; c <= last; c++) place(columns[c], fromReads)
  for (let c = last - 1; c >= 0; c--) place(columns[c], id => fromReaders(id) ?? fromReads(id))
  for (let c = 1; c <= last; c++) place(columns[c], id => fromReads(id) ?? fromReaders(id))

  let x = 0
  columns.forEach((column, i) => {
    for (const n of column) {
      const nodeY = y.get(n.id) ?? 0
      placed.set(n.id, { x, y: nodeY })
      let noteY = nodeY - above(n.id)
      for (const note of notesOf.get(n.id) ?? []) {
        const height = heights.get(note.id) ?? 0
        placed.set(note.id, { x, y: noteY, width: widths[i], height })
        noteY += height + NOTE_GAP
      }
    }
    x += widths[i] + GAP_X
  })
  // The last column's notes, stacked to its right from the top of the column
  let sideY = Math.min(...columns[last].map(n => y.get(n.id) ?? 0))
  const sideWidth = Math.max(MIN_NOTE_WIDTH, ...side.map(note => size(note.id).w))
  for (const note of side) {
    const height = noteHeight(note.id, sideWidth)
    placed.set(note.id, { x, y: sideY, width: sideWidth, height })
    sideY += height + NOTE_GAP
  }

  // From the origin, on whole pixels
  const minY = Math.min(...[...placed.values()].map(p => p.y))
  for (const p of placed.values()) {
    p.x = Math.round(p.x)
    p.y = Math.round(p.y - minY)
  }
  return placed
}

/** The document with a layout's positions, and its notes' sizes, written in. */
export function applyLayout(doc: EditorDoc, placed: Map<string, Placed>): EditorDoc {
  return {
    ...doc,
    nodes: doc.nodes.map(n => {
      const p = placed.get(n.id)
      if (!p) return n
      const params =
        p.width !== undefined && p.height !== undefined
          ? { ...n.params, width: p.width, height: Math.ceil(p.height) }
          : n.params
      return { ...n, x: p.x, y: p.y, params }
    }),
  }
}
