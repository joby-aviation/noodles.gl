// A line diff for the review card's code changes (#303): which lines an assistant run added,
// removed and kept, with the unchanged stretches between changes cut to a few lines.

export type DiffLine =
  | { kind: 'same' | 'add' | 'del'; text: string }
  // Unchanged lines left out between two changes
  | { kind: 'skip'; count: number }

// Past this many lines a side, the diff is skipped rather than computed: the table is
// quadratic, and a value that long is data, not code to read line by line
const MAX_LINES = 2000

/**
 * The lines that turn `before` into `after`, by longest common subsequence, with `context`
 * unchanged lines kept around each change. Undefined when either side is too long to diff.
 */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] | undefined {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > MAX_LINES || b.length > MAX_LINES) return undefined
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const all: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      all.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      all.push({ kind: 'del', text: a[i++] })
    } else {
      all.push({ kind: 'add', text: b[j++] })
    }
  }
  while (i < a.length) all.push({ kind: 'del', text: a[i++] })
  while (j < b.length) all.push({ kind: 'add', text: b[j++] })
  return trimContext(all, context)
}

// Unchanged lines more than `context` away from any change become one skip
function trimContext(lines: DiffLine[], context: number): DiffLine[] {
  const changed = lines.map(l => l.kind === 'add' || l.kind === 'del')
  const near = (index: number) => {
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    )
      if (changed[k]) return true
    return false
  }
  const out: DiffLine[] = []
  for (const [index, line] of lines.entries()) {
    if (line.kind !== 'same' || near(index)) {
      out.push(line)
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'skip') last.count++
    else out.push({ kind: 'skip', count: 1 })
  }
  return out
}

/** A parameter's value as text to diff line by line, or undefined when it isn't text. */
export function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  // A CodeOp's code, as older documents store it: one string per line
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value.join('\n')
  if (value && typeof value === 'object' && 'expr' in value && typeof value.expr === 'string')
    return value.expr
  return undefined
}
