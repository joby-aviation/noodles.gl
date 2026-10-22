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

  it('returns one passage per topic, the best scoring one', () => {
    const content = [
      '# Layers',
      'Layers draw data.',
      '## Scatterplot',
      'A scatterplot layer draws points with a radius.',
      '## Radius units',
      'Radius is in meters by default; radius units switch to pixels.',
    ].join('\n\n')
    const docs: DocsIndex = {
      version: 'test',
      topics: {
        layers: {
          id: 'layers',
          title: 'Layers',
          section: 'users',
          file: 'users/layers.md',
          url: null,
          content,
          headings: [
            { level: 1, text: 'Layers', anchor: 'layers' },
            { level: 2, text: 'Scatterplot', anchor: 'scatterplot' },
            { level: 2, text: 'Radius units', anchor: 'radius-units' },
          ],
          codeExamples: [],
          relatedTopics: [],
        },
      },
    }

    const results = searchDocumentation(docs, 'radius units')

    expect(results).toHaveLength(1)
    expect(results[0].heading).toBe('Radius units')
  })
})
