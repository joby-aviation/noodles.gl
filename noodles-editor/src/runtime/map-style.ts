// A basemap style with the style editor's changes applied: what the Map Style operator builds,
// and what a deck builds from its own Style changes when none is wired in. Base styles are
// fetched once by URL, so an edit to the changes doesn't refetch the style.

import { applyStyleOverrides, type StyleConfiguratorData } from '../utils/map-style-utils'

const styles = new Map<string, Promise<Record<string, unknown>>>()

export function fetchStyle(url: string): Promise<Record<string, unknown>> {
  let style = styles.get(url)
  if (!style) {
    style = fetch(url).then(r => {
      if (!r.ok) throw new Error(`Failed to fetch map style: ${r.statusText}`)
      return r.json()
    })
    styles.set(url, style)
    style.catch(() => styles.delete(url))
  }
  return style
}

/** Style changes as the deck keeps them, a JSON string, or undefined when there are none. */
export function parseStyleChanges(text: unknown): StyleConfiguratorData | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined
  try {
    const data = JSON.parse(text) as StyleConfiguratorData
    const changed = (data.layers?.length ?? 0) > 0 || Object.keys(data.global ?? {}).length > 0
    return changed ? data : undefined
  } catch {
    return undefined
  }
}

export async function styleWithChanges(
  base: string | Record<string, unknown>,
  changes: StyleConfiguratorData
): Promise<Record<string, unknown>> {
  const style = typeof base === 'string' ? await fetchStyle(base) : base
  return applyStyleOverrides(style as never, changes) as unknown as Record<string, unknown>
}
