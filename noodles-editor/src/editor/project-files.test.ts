// A save writes the project's keys as Settings has them now, not as the file had them
import { afterEach, describe, expect, it } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { docStore } from './doc-store'
import { projectJson } from './project-files'

describe('projectJson', () => {
  afterEach(() => getKeysStore().setProjectKeys(undefined))

  it('saves the project keys as they are now, keeping the rest of meta', () => {
    docStore().load({
      version: 1,
      name: 'keys',
      nodes: [],
      edges: [],
      meta: { apiKeys: { mapbox: 'opened' }, startNode: 'n1' },
    })
    getKeysStore().setProjectKeys({ mapbox: 'edited' }, '/projects/keys')
    const saved = projectJson() as unknown as { meta: Record<string, unknown> }
    expect(saved.meta).toEqual({ apiKeys: { mapbox: 'edited' }, startNode: 'n1' })
  })

  it('leaves the keys out once the project has none', () => {
    docStore().load({ version: 1, name: 'keys', nodes: [], edges: [], meta: { apiKeys: {} } })
    getKeysStore().setProjectKeys(undefined)
    const saved = projectJson() as unknown as { meta: Record<string, unknown> }
    expect(saved.meta).not.toHaveProperty('apiKeys')
  })
})
