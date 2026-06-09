import { describe, expect, it } from 'vitest'
import type { CompilableNode } from './compiler'
import { computeFingerprint, fingerprintsMatch } from './fingerprint'

function makeNode(id: string, type: string, upstreamIds: string[]): CompilableNode {
  return {
    id,
    type,
    inputs: {},
    getUpstreamDataIds: () => upstreamIds,
  }
}

describe('Fingerprint', () => {
  it('computes deterministic fingerprint for same topology', () => {
    const nodes1 = [
      makeNode('/a', 'FileOp', []),
      makeNode('/b', 'FilterOp', ['/a']),
      makeNode('/c', 'Sort', ['/b']),
    ]

    const nodes2 = [
      makeNode('/a', 'FileOp', []),
      makeNode('/b', 'FilterOp', ['/a']),
      makeNode('/c', 'Sort', ['/b']),
    ]

    const fp1 = computeFingerprint(nodes1)
    const fp2 = computeFingerprint(nodes2)

    expect(fp1.hash).toBe(fp2.hash)
    expect(fingerprintsMatch(fp1, fp2)).toBe(true)
  })

  it('produces different fingerprints for different operator types', () => {
    const nodes1 = [
      makeNode('/a', 'FileOp', []),
      makeNode('/b', 'FilterOp', ['/a']),
    ]

    const nodes2 = [
      makeNode('/a', 'FileOp', []),
      makeNode('/b', 'Sort', ['/a']), // Different type
    ]

    const fp1 = computeFingerprint(nodes1)
    const fp2 = computeFingerprint(nodes2)

    expect(fp1.hash).not.toBe(fp2.hash)
    expect(fingerprintsMatch(fp1, fp2)).toBe(false)
  })

  it('produces different fingerprints for different connections', () => {
    const nodes1 = [
      makeNode('/a', 'FileOp', []),
      makeNode('/b', 'FileOp', []),
      makeNode('/c', 'Join', ['/a', '/b']),
    ]

    const nodes2 = [
      makeNode('/a', 'FileOp', []),
      makeNode('/b', 'FileOp', []),
      makeNode('/c', 'Join', ['/b', '/a']), // Swapped order
    ]

    const fp1 = computeFingerprint(nodes1)
    const fp2 = computeFingerprint(nodes2)

    expect(fp1.hash).not.toBe(fp2.hash)
  })

  it('includes operator IDs in fingerprint output', () => {
    const nodes = [
      makeNode('/source', 'FileOp', []),
      makeNode('/transform', 'FilterOp', ['/source']),
    ]

    const fp = computeFingerprint(nodes)

    expect(fp.operators).toEqual(['/source', '/transform'])
  })

  it('produces same fingerprint regardless of operator field values', () => {
    // Field values should NOT affect fingerprint
    const nodes1 = [
      { id: '/a', type: 'FileOp', inputs: { url: { value: 'file1.csv' } }, getUpstreamDataIds: () => [] },
      { id: '/b', type: 'FilterOp', inputs: { value: { value: 100 } }, getUpstreamDataIds: () => ['/a'] },
    ]

    const nodes2 = [
      { id: '/a', type: 'FileOp', inputs: { url: { value: 'file2.csv' } }, getUpstreamDataIds: () => [] },
      { id: '/b', type: 'FilterOp', inputs: { value: { value: 200 } }, getUpstreamDataIds: () => ['/a'] },
    ]

    const fp1 = computeFingerprint(nodes1 as any)
    const fp2 = computeFingerprint(nodes2 as any)

    expect(fp1.hash).toBe(fp2.hash)
  })
})
