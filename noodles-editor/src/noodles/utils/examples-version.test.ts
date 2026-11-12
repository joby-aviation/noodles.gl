import { describe, expect, it } from 'vitest'
import { isEditorDoc } from '../../editor/load-doc'

// Import all example project files
const allProjects = import.meta.glob('../../examples/**/noodles.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

describe('Example projects', () => {
  it('should have at least one example project', () => {
    expect(Object.keys(allProjects).length).toBeGreaterThan(0)
  })

  // Older operator-graph files convert when they open, but an example ships as a document
  it('are all documents', () => {
    const graphs = Object.keys(allProjects).filter(path => !isEditorDoc(allProjects[path]))
    expect(graphs).toEqual([])
  })
})
