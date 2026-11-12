import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheFileNameToOpId, opIdToCacheFileName, readOutputCache } from './output-cache'

const position = { x: 0, y: 0 }
const route = {
  distance: 29992,
  duration: 2301,
  durationFormatted: '38 mins, 21 secs',
  timestamps: [0, 2301],
  path: [
    [-81.31, 28.43],
    [-81.52, 28.37],
  ],
  hasTolls: true,
  tollAmount: 2.54,
  tollCurrency: 'USD',
}

function cacheFile(id: string, type = 'DirectionsOp', outputs: unknown = { route }) {
  return JSON.stringify({ version: 1, id, type, outputs })
}

// A real directory in the browser's origin private file system, removed after each test
let root: FileSystemDirectoryHandle
let projectName: string
let project: FileSystemDirectoryHandle

beforeEach(async () => {
  root = await navigator.storage.getDirectory()
  projectName = `output-cache-test-${crypto.randomUUID()}`
  project = await root.getDirectoryHandle(projectName, { create: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await root.removeEntry(projectName, { recursive: true })
})

async function listCache() {
  try {
    const cache = await project.getDirectoryHandle('cache')
    const names: string[] = []
    for await (const entry of cache.values()) names.push(entry.name)
    return names.sort()
  } catch {
    return null
  }
}

async function readCache(name: string) {
  const cache = await project.getDirectoryHandle('cache')
  return (await (await cache.getFileHandle(name)).getFile()).text()
}

describe('opIdToCacheFileName', () => {
  it('names the file after the op id', () => {
    expect(opIdToCacheFileName('/directions')).toBe('directions.json')
    expect(opIdToCacheFileName('/drive_directions-2')).toBe('drive_directions-2.json')
  })

  it('joins container segments with dots', () => {
    expect(opIdToCacheFileName('/container/drive-directions')).toBe(
      'container.drive-directions.json'
    )
  })

  it('escapes dots so nested and dotted ids stay distinct', () => {
    expect(opIdToCacheFileName('/a.b')).toBe('a%2Eb.json')
    expect(opIdToCacheFileName('/a/b')).toBe('a.b.json')
  })

  it('escapes characters Windows or macOS refuse', () => {
    const name = opIdToCacheFileName('/my op<>:"\\|?*')
    expect(name).toBe('my%20op%3C%3E%3A%22%5C%7C%3F%2A.json')
    expect(name).toMatch(/^[A-Za-z0-9_%.-]+$/)
  })

  it('escapes names Windows reserves', () => {
    expect(opIdToCacheFileName('/con')).toBe('%63on.json')
    expect(opIdToCacheFileName('/LPT1/route')).toBe('%4CPT1.route.json')
    expect(opIdToCacheFileName('/console')).toBe('console.json')
  })

  it('encodes unicode as UTF-8', () => {
    expect(opIdToCacheFileName('/café')).toBe('caf%C3%A9.json')
  })

  it('round-trips through cacheFileNameToOpId', () => {
    const ids = [
      '/directions',
      '/container/drive-directions',
      '/a.b',
      '/my op<>:"\\|?*',
      '/con',
      '/café/über',
      '/100%',
    ]
    for (const id of ids) {
      expect(cacheFileNameToOpId(opIdToCacheFileName(id))).toBe(id)
    }
  })

  it('rejects names that are not cache files', () => {
    expect(cacheFileNameToOpId('.gitignore')).toBeNull()
    expect(cacheFileNameToOpId('broken%E0%A4.json')).toBeNull()
  })
})

describe('readOutputCache', () => {
  const lockedNode = (id: string, type = 'DirectionsOp') => ({ id, type, data: { locked: true } })

  function reader(files: Record<string, string>) {
    return vi.fn(async (name: string) => files[name] ?? null)
  }

  it('reads the outputs of locked nodes', async () => {
    const cache = await readOutputCache(reader({ 'directions.json': cacheFile('/directions') }), [
      lockedNode('/directions'),
    ])

    expect(cache.get('/directions')).toEqual({ route })
  })

  it('does not read files for unlocked nodes', async () => {
    const readFile = reader({ 'directions.json': cacheFile('/directions') })

    const cache = await readOutputCache(readFile, [
      { id: '/directions', type: 'DirectionsOp', data: { locked: false } },
    ])

    expect(cache.size).toBe(0)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('skips missing, unreadable, corrupt and mismatched files', async () => {
    const readFile = vi.fn(async (name: string) => {
      if (name === 'unreadable.json') throw new Error('NotReadableError')
      const files: Record<string, string> = {
        'corrupt.json': '{"version":1,',
        'other-id.json': cacheFile('/someone-else'),
        'other-type.json': cacheFile('/other-type', 'NumberOp'),
        'other-version.json': JSON.stringify({
          version: 2,
          id: '/other-version',
          type: 'DirectionsOp',
          outputs: { route },
        }),
        'bad-outputs.json': cacheFile('/bad-outputs', 'DirectionsOp', [route]),
      }
      return files[name] ?? null
    })

    const cache = await readOutputCache(readFile, [
      lockedNode('/missing'),
      lockedNode('/unreadable'),
      lockedNode('/corrupt'),
      lockedNode('/other-id'),
      lockedNode('/other-type'),
      lockedNode('/other-version'),
      lockedNode('/bad-outputs'),
    ])

    expect(cache.size).toBe(0)
    expect(readFile).toHaveBeenCalledTimes(7)
  })
})
