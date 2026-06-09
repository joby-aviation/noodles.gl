import type { CompilableNode } from './compiler'

// Computes a topology fingerprint for cache invalidation.
// The fingerprint includes operator IDs, types, and edge connections,
// but NOT field values — so param-only changes don't invalidate the cache.

export interface TopologyFingerprint {
  hash: string
  operators: string[] // operator IDs in topological order
}

export function computeFingerprint(nodes: CompilableNode[]): TopologyFingerprint {
  const parts: string[] = []

  for (const node of nodes) {
    const upstreamIds = node.getUpstreamDataIds()
    const upstreamStr = upstreamIds.length > 0 ? upstreamIds.join(',') : 'LEAF'
    parts.push(`${node.id}:${node.type}:[${upstreamStr}]`)
  }

  const hash = simpleHash(parts.join('|'))

  return {
    hash,
    operators: nodes.map(n => n.id),
  }
}

// Simple hash function for fingerprinting (not cryptographic)
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

// Check if two fingerprints represent the same topology
export function fingerprintsMatch(a: TopologyFingerprint, b: TopologyFingerprint): boolean {
  return a.hash === b.hash
}
