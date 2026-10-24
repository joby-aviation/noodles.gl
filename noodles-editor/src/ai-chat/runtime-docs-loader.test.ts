import { describe, expect, it } from 'vitest'
import { getDocsIndex } from './runtime-docs-loader'

describe('getDocsIndex', () => {
  it('leaves the generated operator pages out of the bundled docs', () => {
    const files = Object.values(getDocsIndex().topics).map(topic => topic.file)

    expect(files.some(file => file.startsWith('users/'))).toBe(true)
    expect(files.filter(file => file.startsWith('reference/operators/'))).toEqual([])
  })
})
