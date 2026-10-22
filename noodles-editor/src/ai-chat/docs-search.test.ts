import { describe, expect, it } from 'vitest'
import { searchDocumentation } from './docs-search'
import { extractHeadings } from './runtime-docs-loader'
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

  it('finds camelCase operator names by their parts', () => {
    const content =
      '# Operators\n\nCreate any deck.gl layer, such as `ScatterPlotLayerOp` or `GeoJsonLayerOp`.'
    const docs: DocsIndex = {
      version: 'test',
      topics: {
        operators: {
          id: 'operators',
          title: 'Operators',
          section: 'users',
          file: 'users/operators-guide.md',
          url: null,
          content,
          headings: extractHeadings(content),
          codeExamples: [],
          relatedTopics: [],
        },
      },
    }

    for (const query of ['scatterplot', 'ScatterplotLayerOp', 'plot layer', 'GeoJsonLayer']) {
      expect(searchDocumentation(docs, query).map(result => result.id)).toEqual(['operators'])
    }
  })

  it('links a repeated heading to its own occurrence', () => {
    const content = [
      '# Changelog',
      '## August',
      '### Added',
      'Transparent video export.',
      '## July',
      '### Added',
      'A spreadsheet editor for tables.',
    ].join('\n\n')
    const docs: DocsIndex = {
      version: 'test',
      topics: {
        changelog: {
          id: 'changelog',
          title: 'Changelog',
          section: 'users',
          file: 'changelog.md',
          url: 'https://noodles.gl/docs/changelog',
          content,
          headings: extractHeadings(content),
          codeExamples: [],
          relatedTopics: [],
        },
      },
    }

    expect(docs.topics.changelog.headings.map(heading => heading.anchor)).toEqual([
      'changelog',
      'august',
      'added',
      'july',
      'added-1',
    ])
    expect(searchDocumentation(docs, 'spreadsheet')[0].url).toBe(
      'https://noodles.gl/docs/changelog#added-1'
    )
    expect(searchDocumentation(docs, 'transparent video')[0].url).toBe(
      'https://noodles.gl/docs/changelog#added'
    )
  })
})
