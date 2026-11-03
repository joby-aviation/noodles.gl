// What to suggest while typing an expression or a column name: the input table's columns, and
// for an expression the functions it can call. Pure, so the input component only renders it.

import { FUNCTIONS, GEO_PRELUDE } from '@noodles.gl/planner'

export interface ColumnInfo {
  name: string
  /** DuckDB's type name, shown beside the column */
  type: string
}

export interface Completion {
  kind: 'column' | 'function'
  label: string
  /** What replaces the word being typed */
  insert: string
  detail: string
}

/** The word at the caret, which a completion replaces. */
export interface Word {
  start: number
  end: number
  text: string
}

// An expression names a column the way it names anything: a bare identifier
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const WORD_CHAR = /[A-Za-z0-9_]/
// After one of these, or at the start, a new operand begins
const OPERAND_START = /[([,+\-*/%<>=!&|?:]/

// Aggregates only mean something where rows are grouped, and `ramp` belongs to color nodes
const HIDDEN = new Set(['ramp'])

const FUNCTION_LIST: Completion[] = (() => {
  const out = new Map<string, Completion>()
  for (const [name, spec] of Object.entries(FUNCTIONS)) {
    if (spec.aggregate || HIDDEN.has(name)) continue
    const [min, max] = spec.arity
    const args = ['a', 'b', 'c', 'd'].slice(0, Math.max(min, Math.min(max, 4)))
    out.set(name, {
      kind: 'function',
      label: name,
      insert: `${name}(`,
      detail: `${name}(${args.join(', ')})`,
    })
  }
  for (const [name, def] of GEO_PRELUDE) {
    out.set(name, {
      kind: 'function',
      label: name,
      insert: `${name}(`,
      detail: `${name}(${def.params.join(', ')})`,
    })
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label))
})()

/** Columns an expression can name: identifiers only, a vector once rather than per component. */
export function usableColumns(columns: ColumnInfo[]): ColumnInfo[] {
  const vectors = new Set(columns.filter(c => /\[\d+\]$/.test(c.type)).map(c => c.name))
  return columns.filter(c => {
    if (!IDENT.test(c.name)) return false
    const m = /^(.+)_\d+$/.exec(c.name)
    return !(m && vectors.has(m[1]))
  })
}

// Inside a quoted string, nothing is a name
function inString(text: string, caret: number): boolean {
  let quote: string | undefined
  for (let i = 0; i < caret; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = undefined
    } else if (ch === "'" || ch === '"') quote = ch
  }
  return !!quote
}

/**
 * The word an expression completion replaces at `caret`, or undefined where no name can go: in
 * a string, in a number, or after a `.` (a swizzle such as `position.x`).
 */
export function wordAt(text: string, caret: number): Word | undefined {
  if (inString(text, caret)) return undefined
  let start = caret
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--
  let end = caret
  while (end < text.length && WORD_CHAR.test(text[end])) end++
  const word = text.slice(start, end)
  if (/^[0-9]/.test(word)) return undefined
  const before = text.slice(0, start).trimEnd()
  if (before.endsWith('.')) return undefined
  // An empty word is only a place for a name where an operand can start
  if (!word && before && !OPERAND_START.test(before.at(-1) ?? '')) return undefined
  return { start, end, text: word }
}

// Columns first, those starting with what was typed before those merely containing it
function rank<T extends { label: string }>(items: T[], typed: string): T[] {
  const q = typed.toLowerCase()
  if (!q) return items
  const starts = items.filter(i => i.label.toLowerCase().startsWith(q))
  const contains = items.filter(
    i => !i.label.toLowerCase().startsWith(q) && i.label.toLowerCase().includes(q)
  )
  return [...starts, ...contains]
}

const columnCompletion = (c: ColumnInfo): Completion => ({
  kind: 'column',
  label: c.name,
  insert: c.name,
  detail: c.type.toLowerCase(),
})

/**
 * Suggestions at the caret. An expression offers columns and, once a letter is typed,
 * functions; a column parameter offers columns for its whole value.
 */
export function completionsAt(
  mode: 'expr' | 'column',
  text: string,
  caret: number,
  columns: ColumnInfo[]
): { word: Word; items: Completion[] } | undefined {
  const usable = usableColumns(columns).map(columnCompletion)
  if (mode === 'column') {
    const word = { start: 0, end: text.length, text }
    const items = rank(usable, text)
    // The value already names a column: nothing more to offer than that column
    if (items.length === 1 && items[0].label === text) return undefined
    return { word, items }
  }
  const word = wordAt(text, caret)
  if (!word) return undefined
  const items = [
    ...rank(usable, word.text),
    // Functions by their first letters: a match inside a name is noise among them
    ...(word.text ? FUNCTION_LIST.filter(f => f.label.startsWith(word.text.toLowerCase())) : []),
  ].filter(i => i.label !== word.text || i.kind === 'function')
  return items.length ? { word, items } : undefined
}

/** The text with `item` in place of `word`, and where the caret goes after it. */
export function applyCompletion(
  text: string,
  word: Word,
  item: Completion
): { text: string; caret: number } {
  // A function already followed by its parenthesis keeps the one that is there
  const after = text.slice(word.end)
  const insert = item.kind === 'function' && after.startsWith('(') ? item.label : item.insert
  const next = text.slice(0, word.start) + insert + after
  const caret =
    word.start + insert.length + (insert === item.label && after.startsWith('(') ? 1 : 0)
  return { text: next, caret }
}
