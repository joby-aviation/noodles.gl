import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryHandleCache } from './directory-handle-cache'

// Tests run in a real browser, so this is real IndexedDB. A plain object stands in for
// a folder handle: IndexedDB stores anything structured clone can copy.
function folder(name: string) {
  return { kind: 'directory', name } as FileSystemDirectoryHandle
}

describe('DirectoryHandleCache', () => {
  let cache: DirectoryHandleCache

  beforeEach(async () => {
    cache = new DirectoryHandleCache()
    await cache.clearCache()
  })

  afterEach(async () => {
    await cache.clearCache()
  })

  it('forgets one project and keeps the others', async () => {
    await cache.cacheHandle('alpha', folder('alpha'), 'alpha')
    await cache.cacheHandle('beta', folder('beta'), 'beta')

    await cache.removeHandle('alpha')

    expect(await cache.getAllProjectNames()).toEqual(['beta'])
    expect(await cache.getCachedHandle('alpha')).toBeNull()
  })

  it('moves a project to a folder with a new name', async () => {
    await cache.cacheHandle('alpha', folder('alpha'), 'alpha')

    await cache.renameProject('alpha', 'alpha-2', folder('alpha-2'))

    expect(await cache.getAllProjectNames()).toEqual(['alpha-2'])
    const entry = await cache.getCachedHandle('alpha-2')
    expect(entry?.handle.name).toBe('alpha-2')
    expect(entry?.path).toBe('alpha-2')
  })

  it('replaces the folder when the name stays the same', async () => {
    await cache.cacheHandle('alpha', folder('alpha'), 'alpha')
    const moved = {
      kind: 'directory',
      name: 'alpha',
      moved: true,
    } as unknown as FileSystemDirectoryHandle

    await cache.renameProject('alpha', 'alpha', moved)

    expect(await cache.getAllProjectNames()).toEqual(['alpha'])
    const entry = await cache.getCachedHandle('alpha')
    expect(entry?.handle).toEqual(moved)
  })

  it('tells subscribers when the list changes', async () => {
    const listener = vi.fn()
    const unsubscribe = cache.subscribe(listener)

    await cache.cacheHandle('alpha', folder('alpha'), 'alpha')
    await cache.renameProject('alpha', 'beta', folder('beta'))
    await cache.removeHandle('beta')
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    await cache.cacheHandle('gamma', folder('gamma'), 'gamma')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
