import { describe, expect, it } from 'vitest'
import { extractDescription, listExamples } from './runtime-examples-loader'

describe('extractDescription', () => {
  it('skips headings and attribution lines', () => {
    const readme = [
      '# NYC Taxis',
      '',
      '_Adapted from [Kepler.gl examples](https://kepler.gl/demo/nyctrips)_',
      '',
      '## Overview',
      '',
      'This example shows taxi trips. Arcs connect pickups to dropoffs.',
    ].join('\n')
    expect(extractDescription(readme)).toBe('This example shows taxi trips.')
  })

  it('keeps periods inside words', () => {
    expect(extractDescription("# T\n\nUses deck.gl's layer (Denver, CO). More.")).toBe(
      "Uses deck.gl's layer (Denver, CO)."
    )
  })

  it('returns the whole line when it has no sentence end', () => {
    expect(extractDescription('# T\n\nNo period here')).toBe('No period here')
  })

  it('returns undefined for an empty README', () => {
    expect(extractDescription('')).toBeUndefined()
  })
})

describe('listExamples', () => {
  it('reads a name and description from every bundled README', () => {
    const examples = listExamples()
    expect(examples.length).toBeGreaterThan(10)
    for (const example of examples) {
      expect(example.description).not.toMatch(/^(#|_|Example project:)/)
      expect(example.name).not.toBe('')
    }
  })
})
