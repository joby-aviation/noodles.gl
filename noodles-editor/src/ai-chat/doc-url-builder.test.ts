import { describe, expect, it } from 'vitest'
import { buildDocUrl } from './doc-url-builder'

describe('buildDocUrl', () => {
  it('converts user docs to URLs', () => {
    expect(buildDocUrl('users/ai-assistant.md', 'users')).toBe(
      'https://noodles.gl/users/ai-assistant'
    )
  })

  it('converts developer docs to URLs', () => {
    expect(buildDocUrl('developers/overview.md', 'developers')).toBe(
      'https://noodles.gl/developers/overview'
    )
  })

  it('handles root-level docs', () => {
    expect(buildDocUrl('intro.md', 'intro')).toBe('https://noodles.gl/intro')
  })

  it('handles changelog at root', () => {
    expect(buildDocUrl('changelog.md', 'intro')).toBe('https://noodles.gl/changelog')
  })

  it('includes anchor links when provided', () => {
    expect(buildDocUrl('users/ai-assistant.md', 'users', 'basic-usage')).toBe(
      'https://noodles.gl/users/ai-assistant#basic-usage'
    )
  })

  it('returns null for ai-assistant internal docs', () => {
    expect(buildDocUrl('ai-chat/workflow-timeline.md', 'ai-assistant')).toBe(null)
  })

  it('returns null for example READMEs', () => {
    expect(buildDocUrl('examples/sf-elevation/README.md', 'examples')).toBe(null)
  })

  it('handles nested paths correctly', () => {
    expect(buildDocUrl('developers/guides/testing.md', 'developers')).toBe(
      'https://noodles.gl/developers/guides/testing'
    )
  })

  it('handles paths without leading slash', () => {
    expect(buildDocUrl('intro.md', 'intro')).toBe('https://noodles.gl/intro')
  })

  it('removes trailing slash from base URL', () => {
    // This tests the internal logic that normalizes URLs
    expect(buildDocUrl('intro.md', 'intro')).toBe('https://noodles.gl/intro')
  })

  it('handles multiple nested levels', () => {
    expect(buildDocUrl('users/guides/advanced/animations.md', 'users')).toBe(
      'https://noodles.gl/users/guides/advanced/animations'
    )
  })
})
