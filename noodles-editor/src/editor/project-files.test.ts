// A save writes the project's keys as Settings has them now, not as the file had them
import { afterEach, describe, expect, it } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { docStore } from './doc-store'
import { projectJson, queueSave } from './project-files'

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

describe('queueSave', () => {
  it('runs saves one at a time, a failed one not stopping the next', async () => {
    const order: string[] = []
    let finishFirst = () => {}
    const first = queueSave(
      () =>
        new Promise<void>(resolve => {
          order.push('first starts')
          finishFirst = () => {
            order.push('first ends')
            resolve()
          }
        })
    )
    const failing = queueSave(async () => {
      order.push('second starts')
      throw new Error('disk full')
    })
    const third = queueSave(async () => {
      order.push('third starts')
    })
    await Promise.resolve()
    expect(order).toEqual(['first starts'])
    finishFirst()
    await first
    await expect(failing).rejects.toThrow('disk full')
    await third
    expect(order).toEqual(['first starts', 'first ends', 'second starts', 'third starts'])
  })
})
