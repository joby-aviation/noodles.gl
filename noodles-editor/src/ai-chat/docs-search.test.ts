import { describe, expect, it } from 'vitest'
import { searchDocumentation } from './docs-search'
import type { DocsIndex } from './types'

describe('searchDocumentation', () => {
  it('returns compact BM25-ranked passages with canonical section links', () => {
    const docs: DocsIndex = {
      version: 'test',
      topics: {
        timeline: {
          id: 'timeline',
          title: 'Timeline animation',
          section: 'users',
          file: 'users/timeline.md',
          url: 'https://noodles.gl/docs/users/timeline',
          content:
            '# Timeline animation\n\nKeyframe fields over time.\n\n## Interpolation\n\nBezier interpolation controls easing.',
          headings: [
            { level: 1, text: 'Timeline animation', anchor: 'timeline-animation' },
            { level: 2, text: 'Interpolation', anchor: 'interpolation' },
          ],
          codeExamples: [],
          relatedTopics: [],
        },
      },
    }

    const results = searchDocumentation(docs, 'bezier interpolation')

    expect(results[0].excerpt).toContain('Bezier interpolation')
    expect(results[0].url).toBe('https://noodles.gl/docs/users/timeline#interpolation')
  })
})
